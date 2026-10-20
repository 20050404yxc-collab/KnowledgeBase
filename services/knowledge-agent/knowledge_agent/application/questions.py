# 文件：questions.py
# 层：Python application
# 作用：编排检索、证据预算、模型生成和原子知识收录。
# 说明：同问题串行复用，取消检查位于同步提交之前。
from __future__ import annotations

import asyncio
import json

from knowledge_agent.domain.answer_validation import validate_answer
from knowledge_agent.domain.knowledge_rules import identity, relevance
from knowledge_agent.domain.limits import MAX_ATTACHMENTS, MAX_CONTEXT_CHARS, MAX_QUERY_CHARS
from knowledge_agent.domain.provider_rules import resolve_generation

from .ports import Emit, Generator, QuestionRepository
from .question_locks import QuestionLocks
from .recommendations import Recommendations


# 拒绝空问题、非法范围及过量附件，避免无意义模型调用。
def validate_question(params: dict) -> tuple[str, str, list[str]]:
    query = str(params.get("query", "")).strip()
    # 连续校验在任何模型调用之前完成，错误不会产生调用费用。
    if not query or len(query) > MAX_QUERY_CHARS:
        raise ValueError("请输入 1–12000 字的问题；空问题不会调用接口")
    scope = params.get("scope", "knowledge")
    if not isinstance(scope, str) or scope not in {"files", "knowledge", "mixed"}:
        raise ValueError("无效检索范围")
    attachment_ids = params.get("attachment_ids", [])
    if not isinstance(attachment_ids, list) or len(attachment_ids) > MAX_ATTACHMENTS:
        raise ValueError("测试版一次最多使用 20 个附件")
    if any(not isinstance(item_id, str) for item_id in attachment_ids):
        raise ValueError("无效附件标识")
    if scope == "files" and not attachment_ids:
        raise ValueError("仅本次文件范围需要先加入附件")
    return query, scope, attachment_ids


# 按字符预算选取去重片段，全文覆盖不足则拒绝发送。
def select_evidence(
    evidence: list[dict], file_block_count: int, summary: bool, notice: list[str]
) -> list[dict]:
    selected, seen, budget = [], set(), 0
    # 保持证据优先顺序，去重后使用整块预算，不裁断引用文本。
    for block in evidence:
        if block["id"] in seen:
            continue
        if budget + len(block["text"]) > MAX_CONTEXT_CHARS:
            break
        selected.append(block)
        seen.add(block["id"])
        budget += len(block["text"])
    # 全文请求必须覆盖本次文件的全部片段，否则要求拆分而非假装概括全文。
    if summary and file_block_count > sum(b["id"] in seen for b in evidence[:file_block_count]):
        raise ValueError(
            "全文超过测试版单次上下文上限（约 28000 字），未发送接口；请拆分文档。不会把片段概括当作全文总结。"
        )
    # 普通检索可只用部分片段，但需要告知实际发送覆盖范围。
    if len(selected) < len(evidence):
        notice.append(f"本次使用 {len(selected)}/{len(evidence)} 个可用片段，未覆盖的内容未发送。")
    return selected


# 无模型或文件依据不足时返回明确的未收录本地结果。
def local_answer(
    scope: str, selected: list[dict], notice: list[str], config: dict | None
) -> dict | None:
    # 文件范围没有证据时直接终结，不借用模型常识伪装文档依据。
    if scope == "files" and not selected:
        return {
            "content": "文档中未找到足够依据。",
            "citations": [],
            "recommendations": [],
            "notice": "未调用模型、未收录。" + " ".join(notice),
        }

    # 无生成配置仍允许离线读写，返回原文片段并明确未收录。
    if not config:
        citations = selected[:8]
        content = "尚未配置生成接口。以下是本地找到的原文片段，供你核对：\n\n" + "\n\n".join(
            f"【{b['name']} · {b['locator']}】\n{b['text']}" for b in citations
        )
        # 空检索结果提示换词或配置接口，不制造空白成功回答。
        if not citations:
            content = (
                "未找到关键词相关的本地内容。换个说法试试，或在 API 配置中添加接口后生成学习内容。"
            )
        return {
            "content": content,
            "citations": citations,
            "recommendations": [],
            "notice": "本地检索结果；未调用模型、未自动收录。" + " ".join(notice),
        }
    return None


class Questions:
    # 共享会话附件，但只由附件用例负责其文件生命周期。
    def __init__(
        self,
        store: QuestionRepository,
        client: Generator,
        documents: dict[str, dict],
        cards: Recommendations,
    ) -> None:
        self.store = store
        self.client = client
        self.documents = documents
        self.cards = cards
        self.locks = QuestionLocks()

    # 同一查询的检索、生成及提交处于同一把锁内，防止重复调用。
    async def question(self, params: dict, emit: Emit) -> dict:
        query, scope, attachment_ids = validate_question(params)
        # 在等待同问题锁之前固定配置，后续编辑或切换不改变本次请求。
        params = dict(params)
        config = self.store.provider(params.get("provider_id"))
        if params.get("provider_id") and not config:
            raise ValueError("所选接口已删除，请重新选择")
        params["_config"] = config
        lock_key = identity(query) + ":" + scope + ":" + ",".join(sorted(attachment_ids))
        async with self.locks.acquire(lock_key):
            return await self.answer(params, emit, query, scope, attachment_ids)

    # 检索及无模型回退先执行，只有需要生成才请求外部接口。
    async def answer(
        self, params: dict, emit: Emit, query: str, scope: str, attachment_ids: list[str]
    ) -> dict:
        emit({"type": "progress", "message": "检索本地知识与允许使用的文档"})
        local = self.store.list_knowledge(query, brief=False) if scope != "files" else []
        existing = self.reuse(query, scope, attachment_ids, local)
        # 已有同问题知识优先返回，避免无意义的再次付费生成。
        if existing:
            return existing
        evidence, file_count, summary, notice = self.collect(query, scope, attachment_ids, local)
        selected = select_evidence(evidence, file_count, summary, notice)
        config = params["_config"]
        fallback = local_answer(scope, selected, notice, config)
        # 本地可完成的情况在请求模型前终结。
        if fallback:
            return fallback
        if config is None:
            raise ValueError("未配置生成接口")
        config = resolve_generation(config, params)
        return await self.generate(
            params, emit, query, scope, attachment_ids, selected, notice, config
        )

    # 优先复用问题映射与同标题知识，保留手工正文不再调用模型。
    def reuse(
        self, query: str, scope: str, attachment_ids: list[str], local: list[dict]
    ) -> dict | None:
        # 精确概念复用保护手工修改，并避免重复生成拓展内容。
        if not attachment_ids and scope != "files":
            mapped = self.store.generation_item(identity(query))
            existing = (
                mapped
                if mapped
                else next((k for k in local if identity(k["title"]) == identity(query)), None)
            )
            if existing:
                return {
                    "content": existing["content"],
                    "knowledge": existing,
                    "citations": existing["citations"],
                    "recommendations": self.cards.recommend(
                        existing["title"], existing["content"], exclude=existing["id"]
                    ),
                    "notice": "已复用现有知识；未调用模型。关联拓展不足时不会凑数。",
                }
        return None

    # 按检索范围构造证据，文件范围不得混入知识库来源。
    def collect(
        self, query: str, scope: str, attachment_ids: list[str], local: list[dict]
    ) -> tuple[list[dict], int, bool, list[str]]:
        evidence = []
        # 本次文件按用户选择加入；已移除附件必须重新选择，不能静默忽略。
        if scope != "knowledge":
            for item_id in dict.fromkeys(attachment_ids):
                document = self.documents.get(item_id)
                if not document:
                    raise ValueError("附件已移除，请重新加入后再提问")
                evidence.extend(
                    {
                        **block,
                        "source_id": document["id"],
                        "name": document["name"],
                        "retained": document["retained"],
                    }
                    for block in document["blocks"]
                )
        file_block_count = len(evidence)
        summary = any(word in query for word in ["总结", "全文", "概览", "summari", "summary"])
        notice = ["关键词检索；未启用语义索引，同义内容可能漏检。"]
        # 明确解析局限，图片或复杂布局中的内容不能当作已经读取。
        if scope != "knowledge" and any(self.documents[i]["warnings"] for i in attachment_ids):
            notice.append("仅使用已解析文字；图片、扫描页或复杂版式可能遗漏，请查看附件解析说明。")
        # 全文保留原文件片段顺序；普通问题按关键词相关度排序。
        if not summary:
            evidence.sort(
                key=lambda block: relevance(query, block["name"], block["text"]), reverse=True
            )
        # 只有授权知识库范围时才追加保留资料和知识正文。
        if scope != "files":
            library = self.store.source_blocks()
            library.sort(
                key=lambda block: relevance(query, block["name"], block["text"]), reverse=True
            )
            evidence.extend(
                block for block in library if relevance(query, block["name"], block["text"]) > 0
            )
            for item in local[:6]:
                evidence.append(
                    {
                        "id": "knowledge-" + item["id"],
                        "source_id": item["id"],
                        "name": "知识库 · " + item["title"],
                        "locator": "知识正文",
                        "text": item["content"][:5000],
                        "retained": True,
                    }
                )
        return evidence, file_block_count, summary, notice

    # 仅使用选定证据生成，提交前响应取消并校验完整结果。
    async def generate(
        self,
        params: dict,
        emit: Emit,
        query: str,
        scope: str,
        attachment_ids: list[str],
        selected: list[dict],
        notice: list[str],
        config: dict,
    ) -> dict:
        emit({"type": "progress", "message": f"正在请求 {config['name']}；完成校验后才会收录"})
        prompt = json.dumps(
            {
                "question": query,
                "scope": scope,
                "evidence": selected,
                "coverage_notice": " ".join(notice),
            },
            ensure_ascii=False,
        )
        text = await self.client.generate(
            config, prompt, str(params.get("purpose", "question")), emit
        )
        result = validate_answer(text, selected, scope == "files")
        # 这是同步原子提交前的最后取消点；提交之后只能报告实际保存结果。
        await asyncio.sleep(0)
        # 结构合法仍可能依据不足，这条路径返回内容但不执行正式收录。
        if result.get("insufficient"):
            return {
                "content": "文档中未找到足够依据。\n\n" + result["content"],
                "citations": result["citations"],
                "recommendations": [],
                "notice": "依据不足，未自动收录。" + " ".join(notice),
            }
        # 此后没有异步让出点，原子保存完成就按实际结果报告。
        return self.capture(result, config, query, scope, attachment_ids, notice)

    # 原子收录合格结果，同标题不同正文不得谎报保存或覆盖。
    def capture(
        self,
        result: dict,
        config: dict,
        query: str,
        scope: str,
        attachment_ids: list[str],
        notice: list[str],
    ) -> dict:
        item = self.store.save(
            result["title"],
            result["content"],
            generated=True,
            citations=result["citations"],
            model=config["model"],
            provider_name=config["name"],
            capture_key=identity(query) if not attachment_ids and scope != "files" else None,
        )
        cards = self.cards.recommend(
            item["title"], item["content"], result["recommendations"], item["id"]
        )
        # 推荐不足如实显示，不使用无关知识凑满卡片。
        if len(cards) < 3:
            notice.append(f"仅找到 {len(cards)} 条有效关联，未用无关条目补足。")
        reused_different = item["content"] != result["content"].strip()
        # 同标题已有正文受到保护，生成内容未保存时不能显示知识已收录。
        capture_notice = (
            "已有同标题知识，本次回答未新建条目、未覆盖原笔记；可手动新建不同标题保存补充。"
            if reused_different
            else "已收录或复用现有知识。"
        )
        return {
            "content": result["content"],
            "knowledge": None if reused_different else item,
            "citations": result["citations"],
            "recommendations": cards,
            "notice": capture_notice + " ".join(notice),
        }
