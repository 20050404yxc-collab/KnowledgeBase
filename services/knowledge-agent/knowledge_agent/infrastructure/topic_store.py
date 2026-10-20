# 文件：topic_store.py
# 层：Python infrastructure
# 作用：提供主题知识、补充原子提交及分页词法检索。
# 说明：由 Store 共用事件循环所属连接，所有写入保持索引一致。
import hashlib
import json
import sqlite3
import uuid

from knowledge_agent.domain.knowledge_rules import identity, now, relevance, tokens, validate_note
from knowledge_agent.domain.taxonomy import classification

from .topic_schema import populate_index


# 摘录围绕最早命中的词，而非只截取正文开头。
def excerpt(text: str, query: str) -> str:
    positions = [text.casefold().find(term) for term in tokens(query)]
    start = max(0, min((p for p in positions if p >= 0), default=0) - 60)
    return ("…" if start else "") + text[start : start + 360]


class TopicStorage:
    # 遍历完整分类集合后按相关度选入有界摘要，不把近期知识当成全库分类。
    def taxonomy_summary(self, query: str) -> dict:
        rows = self.db.execute(
            "SELECT coalesce(t.theme,'未分类') AS theme,COUNT(*) AS count FROM knowledge k LEFT JOIN topic_links t ON k.id=t.knowledge_id GROUP BY coalesce(t.theme,'未分类')"
        ).fetchall()
        paths = [{**classification(row["theme"]), "count": row["count"]} for row in rows]
        paths.sort(key=lambda p: (-relevance(query, p["theme"], ""), p["theme"]))
        selected, size = [], 0
        for path in paths:
            length = len(json.dumps(path, ensure_ascii=False))
            if size + length > 8000:
                break
            selected.append(path)
            size += length
        return {
            "paths": selected,
            "total": len(paths),
            "included": len(selected),
            "notice": f"遍历全库 {len(paths)} 个分类，按相关度提供 {len(selected)} 个；旧主题未拆分。",
        }

    # 维护入口原子重建可派生索引，失败回滚且不修改用户知识。
    def rebuild_search_index(self) -> None:
        with self.db:
            if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone():
                self.db.execute("DELETE FROM search_fts")
            self.db.execute("DELETE FROM search_documents")
            populate_index(self.db)

    # 补充按创建顺序读取；引用的保留状态取当前资料，而非历史快照。
    def topic_details(self, item_id: str) -> dict:
        link = self.db.execute(
            "SELECT theme FROM topic_links WHERE knowledge_id=?", (item_id,)
        ).fetchone()
        supplements = []
        for row in self.db.execute(
            "SELECT * FROM supplements WHERE knowledge_id=? ORDER BY created_at,id", (item_id,)
        ):
            item = dict(row)
            item.pop("digest")
            item["edited"] = bool(item["edited"])
            item["citations"] = json.loads(item["citations"])
            for citation in item["citations"]:
                citation["retained"] = self.has_source(citation["source_id"])
            supplements.append(item)
        return {**classification(link[0] if link else "未分类"), "supplements": supplements}

    # 原正文和补充的内容版本用于乐观并发校验，不依赖时间戳精度。
    def topic_version(self, item: dict) -> str:
        data = [item["title"], item["content"], item.get("theme"), item.get("supplements", [])]
        return hashlib.sha256(
            json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()

    # 参数化 FTS 召回全库；缺少模块时逐批遍历完整索引，绝不截断记录范围。
    def search(self, params: dict) -> dict:
        value = params.get("query", "")
        if not isinstance(value, str):
            raise ValueError("请输入有效关键词")
        query = value.strip()
        page = params.get("page", 0)
        if not query or len(query) > 12000 or type(page) is not int or not 0 <= page <= 100000:
            raise ValueError("请输入有效关键词和分页位置")
        terms = sorted(tokens(query))
        if len(terms) > 256:
            raise ValueError("检索词过多，请缩小问题范围")
        fts = self.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone()
        sql, args = "SELECT * FROM search_documents", ()
        if fts and terms:
            sql += " WHERE rowid IN (SELECT rowid FROM search_fts WHERE terms MATCH ?)"
            args = (" OR ".join('"' + term.replace('"', '""') + '"' for term in terms),)
        matches = []
        cursor = self.db.execute(sql, args)
        while batch := cursor.fetchmany(200):
            # 每批只构造匹配摘要；完整排序稳定使用索引 ID 作为同分键。
            for row in batch:
                path = classification(row["theme"])
                score = relevance(query, path["theme"] + " " + row["title"], row["body"])
                if score <= 0:
                    continue
                if params.get("bucket"):
                    if (
                        not row["knowledge_id"]
                        or self.get(row["knowledge_id"])["bucket"] != params["bucket"]
                    ):
                        continue
                hit = {key: row[key] for key in ("id", "kind", "knowledge_id", "title", "theme")}
                hit.update(path)
                hit["knowledge_id"] = hit["knowledge_id"] or ""
                hit["excerpt"] = excerpt(row["body"], query)
                if row["kind"] == "source":
                    hit["citation"] = {
                        "id": row["id"].split(":", 2)[2],
                        "source_id": row["source_id"],
                        "name": row["title"],
                        "locator": row["locator"],
                        "text": row["body"],
                        "retained": True,
                    }
                matches.append((score, hit))
        matches.sort(key=lambda pair: (-pair[0], pair[1]["id"]))
        return {
            "items": [hit for _, hit in matches[page * 30 : (page + 1) * 30]],
            "total": len(matches),
            "page": page,
            "notice": "本地关键词检索；未调用模型，同义内容可能漏检。"
            + ("索引使用完整分批扫描回退。" if not fts else ""),
        }

    # 收录前检查版本，所有正文、关系、幂等记录和触发器索引在同一事务内更新。
    def capture_topic(self, draft: dict) -> dict:
        title, content, _ = validate_note(draft["title"], draft["content"])
        with self.db:
            receipt = self.db.execute(
                "SELECT knowledge_id FROM capture_receipts WHERE capture_key=?",
                (draft["capture_key"],),
            ).fetchone()
            if receipt:
                return self.get(receipt[0])
            target = draft.get("target_id")
            if target:
                current = self.get(target)
                if current["version"] != draft["version"]:
                    raise ValueError("知识已被修改，请重新打开并生成补充；未覆盖旧内容")
                self._append_supplement(target, title, content, draft)
            else:
                target = self._insert_topic(title, content, draft)
            self.db.execute(
                "INSERT INTO capture_receipts VALUES (?,?)", (draft["capture_key"], target)
            )
        return self.get(target)

    # 同目标的完全相同内容复用；原正文和手工修改始终不受生成覆盖。
    def _append_supplement(self, target: str, title: str, content: str, draft: dict) -> None:
        current = self.get(target)
        if content == current["content"].strip():
            return
        digest, stamp = hashlib.sha256(content.encode()).hexdigest(), now()
        self.db.execute(
            """INSERT OR IGNORE INTO supplements
            (id,knowledge_id,title,content,digest,created_at,updated_at,citations,model,provider_name)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                str(uuid.uuid4()),
                target,
                title,
                content,
                digest,
                stamp,
                stamp,
                json.dumps(draft["citations"], ensure_ascii=False),
                draft["model"],
                draft["provider_name"],
            ),
        )

    # 新主题身份与旧全库标题键隔离，同名不同领域不会相互覆盖。
    def _insert_topic(self, title: str, content: str, draft: dict) -> str:
        theme = draft["theme"]
        existing = self.db.execute(
            "SELECT knowledge_id FROM topic_links WHERE theme_key=? AND title_key=?",
            (identity(theme), identity(title)),
        ).fetchone()
        if existing:
            current = self.get(existing[0])
            if current["content"].strip() != content:
                raise ValueError("该主题已有同名知识，请选择已有项补充；未覆盖原文")
            return existing[0]
        item_id, stamp = str(uuid.uuid4()), now()
        self.db.execute(
            """INSERT INTO knowledge
            (id,concept,title,content,digest,created_at,updated_at,generated,citations,model,provider_name)
            VALUES (?,?,?,?,?,?,?,1,?,?,?)""",
            (
                item_id,
                "topic:" + item_id,
                title,
                content,
                hashlib.sha256(content.encode()).hexdigest(),
                stamp,
                stamp,
                json.dumps(draft["citations"], ensure_ascii=False),
                draft["model"],
                draft["provider_name"],
            ),
        )
        self.db.execute(
            "INSERT INTO topic_links VALUES (?,?,?,?)",
            (item_id, theme, identity(theme), identity(title)),
        )
        return item_id

    # 补充维护显式校验版本，失败不影响原正文，重复正文冲突给出受控错误。
    def maintain_supplement(self, params: dict, delete: bool = False) -> dict:
        target = params["knowledge_id"]
        current = self.get(target)
        if current["version"] != params.get("version"):
            raise ValueError("知识已变化，请重新打开后编辑补充")
        if not any(item["id"] == params["id"] for item in current["supplements"]):
            raise ValueError("补充不存在或已删除")
        try:
            with self.db:
                if delete:
                    self.db.execute(
                        "DELETE FROM supplements WHERE id=? AND knowledge_id=?",
                        (params["id"], target),
                    )
                else:
                    title, content, _ = validate_note(
                        params.get("title", ""), params.get("content", "")
                    )
                    self.db.execute(
                        """UPDATE supplements SET title=?,content=?,digest=?,updated_at=?,edited=1
                        WHERE id=? AND knowledge_id=?""",
                        (
                            title,
                            content,
                            hashlib.sha256(content.encode()).hexdigest(),
                            now(),
                            params["id"],
                            target,
                        ),
                    )
        except sqlite3.IntegrityError as error:
            raise ValueError("相同补充已存在，请保留一份") from error
        return self.get(target)
