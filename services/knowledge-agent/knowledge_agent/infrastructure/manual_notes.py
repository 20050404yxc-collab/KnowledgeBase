# 文件：manual_notes.py
# 层：Python infrastructure
# 作用：严格保存手写笔记、移动分类并分页读取保留资料。
# 说明：与生成复用分离；写入及派生索引在同一事务提交。
import hashlib
import json
import uuid

from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.knowledge_rules import identity, now, validate_note
from knowledge_agent.domain.taxonomy import encode_path, validate_path


class ManualNotes:
    # 只在同一父路径内检查标题；未分类笔记保留原有全局概念身份。
    def _note_collision(
        self, title: str, path: list[str], excluded: str = "", legacy_theme: str = ""
    ) -> bool:
        theme = encode_path(path) if path else legacy_theme or None
        if theme is None:
            return any(
                identity(row[0]) == identity(title)
                for row in self.db.execute(
                    """SELECT k.title FROM knowledge k LEFT JOIN topic_links t ON t.knowledge_id=k.id
                    WHERE k.id!=? AND t.knowledge_id IS NULL
                    AND k.id NOT IN (SELECT source_id FROM knowledge_merges)""",
                    (excluded,),
                )
            )
        return (
            self.db.execute(
                """SELECT k.id FROM knowledge k LEFT JOIN topic_links t ON t.knowledge_id=k.id
            WHERE k.id!=? AND k.id NOT IN (SELECT source_id FROM knowledge_merges)
            AND t.theme_key=? AND t.title_key=?""",
                (
                    excluded,
                    identity(theme) if theme else None,
                    identity(title),
                ),
            ).fetchone()
            is not None
        )

    # 空路径表示保持未分类；显式路径逐层校验，不猜测斜线含义。
    def _note_path(self, params: dict, current: dict | None) -> list[str]:
        value = params.get("category_path", (current or {}).get("category_path", []))
        if value == []:
            return []
        return validate_path(value)

    # 删除旧关系再添加新关系，正文身份和搜索触发器始终看到同一提交。
    def _write_note_path(
        self, item_id: str, title: str, path: list[str], legacy_theme: str = ""
    ) -> None:
        self.db.execute("DELETE FROM topic_links WHERE knowledge_id=?", (item_id,))
        concept = "topic:" + item_id if path or legacy_theme else identity(title)
        # 旧分类或隐藏原件可能保留历史全局键；新笔记使用独立键，不改旧复用身份。
        if self.db.execute(
            "SELECT 1 FROM knowledge WHERE concept=? AND id!=?", (concept, item_id)
        ).fetchone():
            concept = "topic:" + item_id
        self.db.execute("UPDATE knowledge SET concept=? WHERE id=?", (concept, item_id))
        if path:
            self._apply_library_point({"id": item_id, "title": title, "category_path": path})
        elif legacy_theme:
            self.db.execute(
                "INSERT INTO topic_links VALUES (?,?,?,?)",
                (item_id, legacy_theme, identity(legacy_theme), identity(title)),
            )
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone():
            self.db.execute("DELETE FROM search_fts")
        self.db.execute("DELETE FROM search_documents")
        self.populate_library_index()

    # 手写保存不允许静默复用，失败保持旧记录；版本变化时不得覆盖别处编辑。
    @traced
    def save_note(self, params: dict) -> dict:
        title, content, _ = validate_note(params.get("title", ""), params.get("content", ""))
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            current = self.get(params["id"]) if params.get("id") else None
            if current and "version" in params and params["version"] != current["version"]:
                raise ValueError("知识已变化，请重新打开后编辑")
            path = self._note_path(params, current)
            legacy = (current or {}).get("theme", "") if "category_path" not in params else ""
            legacy = legacy if legacy != "未分类" else ""
            if self._note_collision(title, path, current["id"] if current else "", legacy):
                raise ValueError("同标题知识已存在，请更换标题或编辑已有条目")
            item_id, stamp = (current["id"] if current else str(uuid.uuid4())), now()
            digest = hashlib.sha256(content.encode()).hexdigest()
            # 编辑只更改标题正文，保留模型、引用和补充；新建不按正文去重。
            if current:
                self.db.execute(
                    "UPDATE knowledge SET title=?,content=?,digest=?,updated_at=?,edited=1 WHERE id=?",
                    (title, content, digest, stamp, item_id),
                )
            else:
                self.db.execute(
                    """INSERT INTO knowledge
                    (id,concept,title,content,digest,created_at,updated_at,generated)
                    VALUES (?,?,?,?,?,?,?,0)""",
                    (item_id, "topic:" + item_id, title, content, digest, stamp, stamp),
                )
            self._write_note_path(item_id, title, path, legacy)
        record("knowledge.committed", mode="edit" if current else "create", generated=False)
        return self.get(item_id)

    # 独立移动不上传正文；长文、引用和补充保持原样，冲突或过期整体回滚。
    @traced
    def move_note(self, params: dict) -> dict:
        if "category_path" not in params:
            raise ValueError("请求参数类型无效")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            current = self.get(params["id"])
            if params.get("version") != current["version"]:
                raise ValueError("知识已变化，请重新打开后编辑")
            path = self._note_path(params, current)
            if self._note_collision(current["title"], path, current["id"]):
                raise ValueError("同标题知识已存在，请更换标题或编辑已有条目")
            self._write_note_path(current["id"], current["title"], path)
            self.db.execute("UPDATE knowledge SET updated_at=? WHERE id=?", (now(), current["id"]))
        record("knowledge.committed", mode="move")
        return self.get(current["id"])

    # 从已保存的解析文本分页读取；任意长块拆段，单次返回不超过 12000 字符。
    @traced
    def read_source(self, params: dict) -> dict:
        row = self.db.execute("SELECT * FROM sources WHERE id=?", (params["id"],)).fetchone()
        if not row:
            raise ValueError("资料不存在或已删除")
        page = params.get("page", 0)
        blocks = json.loads(row["blocks"])
        parts = [(b, offset) for b in blocks for offset in range(0, max(1, len(b["text"])), 12000)]
        if type(page) is not int or not 0 <= page < max(1, len(parts)):
            raise ValueError("无效分页位置")
        block, offset = (
            parts[page] if parts else ({"id": "empty", "text": "", "locator": "空文档"}, 0)
        )
        return {
            "name": row["name"],
            "page": page,
            "pages": max(1, len(parts)),
            "items": [
                {
                    "id": block["id"],
                    "source_id": row["id"],
                    "name": row["name"],
                    "locator": block["locator"] + (f" · 字符 {offset + 1} 起" if offset else ""),
                    "text": block["text"][offset : offset + 12000],
                    "retained": True,
                }
            ],
        }
