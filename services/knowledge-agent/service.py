from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import uuid
from pathlib import Path

from parsers import parse_document, validate_path
from providers import ProviderClient, SecretVault, save_provider, validate_answer
from store import Store, identity, now, relevance


class KnowledgeService:
    def __init__(self, data_dir: Path, vault=None, client=None):
        self.store = Store(data_dir)
        self.vault = vault or SecretVault()
        self.client = client or ProviderClient(self.store, self.vault)
        self.attachments: dict[str, dict] = {}
        self.sessions = self.store.root / "sessions"
        self.sessions.mkdir(exist_ok=True)
        # Single app instance; leftover session directories belong to a previous crash.
        for path in self.sessions.iterdir():
            if path.is_dir() and path.name.startswith("session-"):
                shutil.rmtree(path)
        self.session = Path(tempfile.mkdtemp(prefix="session-", dir=self.sessions))
        self.locks: dict[str, asyncio.Lock] = {}

    def close(self):
        self.store.close()
        shutil.rmtree(self.session, ignore_errors=True)

    def info(self):
        return {"version": "test0.02", "data_dir": str(self.store.root), "providers": self.store.providers(),
                "knowledge": self.store.list_knowledge(), "sources": self.store.list_sources(),
                "notice": "关键词检索 · 未启用语义索引；OCR、旧 DOC 与安装包仍待验证"}

    @staticmethod
    def attachment_info(document):
        return {**{key: document[key] for key in ["id", "name", "fingerprint", "warnings", "retained"]}, "blocks": len(document["blocks"])}

    async def add_attachment(self, params, emit):
        path = validate_path(params.get("path", ""))
        target = self.session / f"{uuid.uuid4()}{path.suffix.lower()}"
        emit({"type": "progress", "message": f"正在读取 {path.name}"})

        def read_snapshot():
            # Copy and parse in the same thread: cancellation cannot delete a half-written target.
            shutil.copyfile(path, target)
            if target.stat().st_size > 50 * 1024 * 1024:
                raise ValueError("复制期间文件超过 50MB，未解析")
            return parse_document(target, path.name)

        work = asyncio.create_task(asyncio.to_thread(read_snapshot))
        try:
            document = await asyncio.shield(work)
        except asyncio.CancelledError:
            # Underlying parser is a bounded in-process thread, never an independent child.
            def cleanup(done):
                if not done.cancelled():
                    done.exception()  # Consume the failure; only the owned snapshot needs cleanup.
                target.unlink(missing_ok=True)
            work.add_done_callback(cleanup)
            raise
        except Exception:
            target.unlink(missing_ok=True)
            raise
        existing = self.attachments.get(document["id"])
        if existing:
            target.unlink(missing_ok=True)
            return self.attachment_info(existing)
        document["retained"] = bool(self.store.db.execute("SELECT 1 FROM sources WHERE id=?", (document["id"],)).fetchone())
        self.attachments[document["id"]] = document
        return self.attachment_info(document)

    def retain(self, item_id: str):
        document = self.attachments.get(item_id)
        if not document:
            raise ValueError("附件已移除，请重新加入")
        existing = self.store.db.execute("SELECT 1 FROM sources WHERE id=?", (item_id,)).fetchone()
        if not existing:
            filename = item_id + Path(document["path"]).suffix
            target = self.store.sources_dir / filename
            try:
                shutil.copyfile(document["path"], target)
                with self.store.db:
                    self.store.db.execute("INSERT INTO sources VALUES (?,?,?,?,?,?)", (
                        item_id, document["name"], filename, now(),
                        json.dumps(document["blocks"], ensure_ascii=False), json.dumps(document["warnings"], ensure_ascii=False)))
            except Exception:
                target.unlink(missing_ok=True)
                raise
        document["retained"] = True
        return self.store.list_sources()

    def delete_source(self, item_id: str):
        row = self.store.db.execute("SELECT filename FROM sources WHERE id=?", (item_id,)).fetchone()
        if row:
            # Delete owned bytes before database admission; failure is visible and metadata remains.
            (self.store.sources_dir / row[0]).unlink(missing_ok=True)
            with self.store.db:
                self.store.db.execute("DELETE FROM sources WHERE id=?", (item_id,))
        if item_id in self.attachments:
            self.attachments[item_id]["retained"] = False
        return self.store.list_sources()

    def recommendations(self, title: str, content: str, expansions=None, exclude: str | None = None):
        result, seen = [], {identity(title)}
        # Require actual lexical relation. Unrelated inventory cannot fill a card.
        candidates = self.store.list_knowledge(title, brief=False)
        if not candidates:
            candidates = self.store.list_knowledge(content[:120], brief=False)
        for item in candidates:
            if item["id"] == exclude or identity(item["title"]) in seen:
                continue
            result.append({"title": item["title"], "preview": item["content"][:100],
                           "reason": "与当前内容包含相关概念，可对照已有笔记继续阅读", "knowledge_id": item["id"]})
            seen.add(identity(item["title"]))
            if len(result) == 2:
                break
        for card in expansions or []:
            concept = identity(card["title"])
            if not concept or concept in seen:
                continue
            seen.add(concept)
            # A generated expansion that already exists is opened rather than regenerated.
            existing = self.store.db.execute("SELECT id FROM knowledge WHERE concept=?", (concept,)).fetchone()
            if existing:
                continue
            result.append(card)
            if len(result) == 3:
                break
        return result

    async def question(self, params, emit):
        query = str(params.get("query", "")).strip()
        if not query or len(query) > 12000:
            raise ValueError("请输入 1–12000 字的问题；空问题不会调用接口")
        scope = params.get("scope", "knowledge")
        if scope not in {"files", "knowledge", "mixed"}:
            raise ValueError("无效检索范围")
        attachment_ids = params.get("attachment_ids", [])
        if not isinstance(attachment_ids, list) or len(attachment_ids) > 20:
            raise ValueError("测试版一次最多使用 20 个附件")
        if scope == "files" and not attachment_ids:
            raise ValueError("仅本次文件范围需要先加入附件")
        lock_key = identity(query) + ":" + scope + ":" + ",".join(sorted(attachment_ids))
        lock = self.locks.setdefault(lock_key, asyncio.Lock())
        async with lock:
            emit({"type": "progress", "message": "检索本地知识与允许使用的文档"})
            local = self.store.list_knowledge(query, brief=False) if scope != "files" else []
            # Exact concept reuse protects personal edits and repeated expansion selections.
            if not attachment_ids and scope != "files":
                mapped = self.store.db.execute("SELECT knowledge_id FROM generation_keys WHERE concept=?", (identity(query),)).fetchone()
                existing = self.store.get(mapped[0]) if mapped else next((k for k in local if identity(k["title"]) == identity(query)), None)
                if existing:
                    return {"content": existing["content"], "knowledge": existing, "citations": existing["citations"],
                            "recommendations": self.recommendations(existing["title"], existing["content"], exclude=existing["id"]),
                            "notice": "已复用现有知识；未调用模型。关联拓展不足时不会凑数。"}
            evidence = []
            if scope != "knowledge":
                for item_id in dict.fromkeys(attachment_ids):
                    document = self.attachments.get(item_id)
                    if not document:
                        raise ValueError("附件已移除，请重新加入后再提问")
                    evidence.extend({**block, "source_id": document["id"], "name": document["name"],
                                     "retained": document["retained"]} for block in document["blocks"])
            file_block_count = len(evidence)
            summary = any(word in query for word in ["总结", "全文", "概览", "summari", "summary"])
            notice = ["关键词检索；未启用语义索引，同义内容可能漏检。"]
            if scope != "knowledge" and any(self.attachments[i]["warnings"] for i in attachment_ids):
                notice.append("仅使用已解析文字；图片、扫描页或复杂版式可能遗漏，请查看附件解析说明。")
            if not summary:
                evidence.sort(key=lambda block: relevance(query, block["name"], block["text"]), reverse=True)
            if scope != "files":
                library = self.store.source_blocks()
                library.sort(key=lambda block: relevance(query, block["name"], block["text"]), reverse=True)
                evidence.extend(block for block in library if relevance(query, block["name"], block["text"]) > 0)
                for item in local[:6]:
                    evidence.append({"id": "knowledge-" + item["id"], "source_id": item["id"], "name": "知识库 · " + item["title"],
                                     "locator": "知识正文", "text": item["content"][:5000], "retained": True})
            selected, seen, budget = [], set(), 0
            for block in evidence:
                if block["id"] in seen:
                    continue
                if budget + len(block["text"]) > 28000:
                    break
                selected.append(block)
                seen.add(block["id"])
                budget += len(block["text"])
            if summary and file_block_count > sum(b["id"] in seen for b in evidence[:file_block_count]):
                raise ValueError("全文超过测试版单次上下文上限（约 28000 字），未发送接口；请拆分文档。不会把片段概括当作全文总结。")
            if len(selected) < len(evidence):
                notice.append(f"本次使用 {len(selected)}/{len(evidence)} 个可用片段，未覆盖的内容未发送。")
            if scope == "files" and not selected:
                return {"content": "文档中未找到足够依据。", "citations": [], "recommendations": [],
                        "notice": "未调用模型、未收录。" + " ".join(notice)}
            config = self.store.provider()
            if not config:
                citations = selected[:8]
                content = "尚未配置生成接口。以下是本地找到的原文片段，供你核对：\n\n" + "\n\n".join(
                    f"【{b['name']} · {b['locator']}】\n{b['text']}" for b in citations)
                if not citations:
                    content = "未找到关键词相关的本地内容。换个说法试试，或在 API 配置中添加接口后生成学习内容。"
                return {"content": content, "citations": citations, "recommendations": [],
                        "notice": "本地检索结果；未调用模型、未自动收录。" + " ".join(notice)}
            emit({"type": "progress", "message": f"正在请求 {config['name']}；完成校验后才会收录"})
            prompt = json.dumps({"question": query, "scope": scope, "evidence": selected,
                                 "coverage_notice": " ".join(notice)}, ensure_ascii=False)
            text = await self.client.generate(config, prompt, str(params.get("purpose", "question")), emit)
            result = validate_answer(text, selected, scope == "files")
            await asyncio.sleep(0)  # Last cancellation checkpoint before the synchronous commit boundary.
            if result.get("insufficient"):
                return {"content": "文档中未找到足够依据。\n\n" + result["content"], "citations": result["citations"],
                        "recommendations": [], "notice": "依据不足，未自动收录。" + " ".join(notice)}
            item = self.store.save(result["title"], result["content"], generated=True, citations=result["citations"],
                                   model=config["model"], provider_name=config["name"],
                                   capture_key=identity(query) if not attachment_ids and scope != "files" else None)
            cards = self.recommendations(item["title"], item["content"], result["recommendations"], item["id"])
            if len(cards) < 3:
                notice.append(f"仅找到 {len(cards)} 条有效关联，未用无关条目补足。")
            reused_different = item["content"] != result["content"].strip()
            capture_notice = ("已有同标题知识，本次回答未新建条目、未覆盖原笔记；可手动新建不同标题保存补充。"
                              if reused_different else "已收录或复用现有知识。")
            return {"content": result["content"], "knowledge": None if reused_different else item, "citations": result["citations"],
                    "recommendations": cards, "notice": capture_notice + " ".join(notice)}

    async def dispatch(self, operation: str, params: dict, emit):
        store = self.store
        if operation == "bootstrap":
            return self.info()
        if operation == "knowledge.list":
            return store.list_knowledge(str(params.get("query", "")), params.get("bucket"))
        if operation == "knowledge.get":
            return store.get(params["id"], active_use=True)
        if operation == "knowledge.save":
            return store.save(str(params.get("title", "")), str(params.get("content", "")), item_id=params.get("id"))
        if operation == "knowledge.delete":
            return store.delete_knowledge(params["id"])
        if operation == "knowledge.bucket":
            return store.set_bucket(params["id"], params.get("bucket"))
        if operation == "attachments.add":
            return await self.add_attachment(params, emit)
        if operation == "attachments.remove":
            document = self.attachments.pop(params["id"], None)
            if document:
                Path(document["path"]).unlink(missing_ok=True)
            return {"removed": True}
        if operation == "sources.list":
            return store.list_sources()
        if operation == "sources.retain":
            return self.retain(params["id"])
        if operation == "sources.delete":
            return self.delete_source(params["id"])
        if operation == "providers.save":
            return save_provider(store, self.vault, params)
        if operation == "providers.select":
            return store.select_provider(params["id"])
        if operation == "providers.delete":
            self.vault.delete(params["id"])
            with store.db:
                store.db.execute("DELETE FROM providers WHERE id=?", (params["id"],))
            return store.providers()
        if operation == "providers.test":
            config = store.provider(params["id"])
            if not config:
                raise ValueError("配置不存在")
            await self.client.generate(config, "请回复 OK", "connection-test", emit, test=True)
            return {"message": "生成接口已响应；此测试会产生调用记录，不表示具备向量能力。"}
        if operation == "usage.list":
            return [dict(row) for row in store.db.execute("SELECT * FROM attempts ORDER BY started_at DESC LIMIT 500")]
        if operation == "question":
            return await self.question(params, emit)
        if operation == "recommendations":
            item = store.get(params["id"])
            return self.recommendations(item["title"], item["content"], exclude=item["id"])
        raise ValueError("不支持的操作")
