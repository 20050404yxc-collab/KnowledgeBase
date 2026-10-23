# 文件：recycle_store.py
# 层：Python infrastructure
# 作用：原子归档和恢复删除知识的完整关联记录。
# 说明：回收站不进入活动索引，不自动清空，不处理合并组删除。
from __future__ import annotations

import json
import sqlite3
import uuid

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.knowledge_rules import now

# 恢复顺序先父记录后关联，列名只取本程序数据库结构，绝不来自请求。
KNOWLEDGE_TABLES = (
    "knowledge",
    "uses",
    "generation_keys",
    "topic_links",
    "supplements",
    "capture_receipts",
    "restructure_originals",
    "restructure_provenance",
    "knowledge_merges",
)


# 内部记录按当前表结构绑定写入，唯一约束和外键冲突必须由事务撤销。
def insert_rows(db: sqlite3.Connection, table: str, rows: list[dict]) -> None:
    columns = [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
    for row in rows:
        db.execute(
            f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            [row[column] for column in columns],
        )


class RecycleStorage:
    # 归档与删除在同一数据库事务提交；失败保留活动条目及全部关系。
    @traced
    def delete_knowledge(self, item_id: str) -> dict:
        self.get(item_id)
        self.require_deletable(item_id)
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            snapshot = {}
            for table in KNOWLEDGE_TABLES[:-1]:
                field = {
                    "knowledge": "id",
                    "restructure_originals": "source_id",
                    "restructure_provenance": "target_id",
                }.get(table, "knowledge_id")
                snapshot[table] = [
                    dict(row)
                    for row in self.db.execute(f"SELECT * FROM {table} WHERE {field}=?", (item_id,))
                ]
            self.db.execute(
                "INSERT INTO knowledge_trash VALUES (?,?,?,?)",
                (
                    str(uuid.uuid4()),
                    snapshot["knowledge"][0]["title"],
                    now(),
                    json.dumps(snapshot, ensure_ascii=False),
                ),
            )
            self.db.execute("DELETE FROM knowledge WHERE id=?", (item_id,))
            # 原文派生索引没有普通删除触发器，统一重建以排除已回收内容。
            self.rebuild_recovery_index()
        return {"deleted": True}

    # 分页只返回标题和时间，正文快照始终留在仓库边界内。
    @traced
    def recycle_list(self, params: dict) -> dict:
        page = params.get("page", 0)
        if type(page) is not int or page < 0:
            raise ValueError("回收站分页无效")
        total = self.db.execute("SELECT count(*) FROM knowledge_trash").fetchone()[0]
        rows = self.db.execute(
            """SELECT id,title,deleted_at FROM knowledge_trash
            ORDER BY deleted_at DESC,id LIMIT 30 OFFSET ?""",
            (page * 30,),
        )
        return {"items": [dict(row) for row in rows], "total": total, "page": page}

    # 冲突不合并、不覆盖；关联和回收站移除必须一起成功，允许失败后重试。
    @traced
    def recycle_restore(self, item_id: str) -> dict:
        row = self.db.execute(
            "SELECT snapshot FROM knowledge_trash WHERE id=?", (item_id,)
        ).fetchone()
        if not row:
            raise ValueError("回收站条目不存在或已恢复，请刷新列表")
        snapshot = json.loads(row[0])
        try:
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                for table in KNOWLEDGE_TABLES[:-1]:
                    insert_rows(self.db, table, snapshot[table])
                self.db.execute("DELETE FROM knowledge_trash WHERE id=?", (item_id,))
                self.rebuild_recovery_index()
        except sqlite3.IntegrityError as error:
            raise ValueError(
                "恢复冲突：当前已有相同标识、标题、分类或复用关联；未覆盖现有内容，回收站条目保留"
            ) from error
        return {"restored": True}

    # 索引可派生且必须与恢复事务同行，失败不能留下活动幽灵命中。
    def rebuild_recovery_index(self) -> None:
        if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone():
            self.db.execute("DELETE FROM search_fts")
        self.db.execute("DELETE FROM search_documents")
        self.populate_library_index()
