# 文件：recovery_store.py
# 层：Python infrastructure
# 作用：管理每日知识快照和显式知识库恢复。
# 说明：恢复仅替换知识关联表，资料副本、配置、凭据和用量由原所有者保留。
from __future__ import annotations

import re
import sqlite3
import uuid
from contextlib import closing
from datetime import date

from knowledge_agent.diagnostics import traced

from .recovery_schema import database_snapshot
from .recycle_store import KNOWLEDGE_TABLES, insert_rows

SNAPSHOT_NAME = re.compile(
    r"(daily-\d{4}-\d{2}-\d{2}|manual-[0-9a-f-]{36}|before-restore-[0-9a-f-]{36})\.sqlite3"
)


class RecoveryStorage:
    # 一天首次启动备份已提交数据库；只轮换每日快照，人工及恢复前快照不自动删除。
    @traced
    def daily_snapshot(self) -> None:
        folder = self.root / "recovery"
        folder.mkdir(exist_ok=True)
        target = folder / f"daily-{date.today().isoformat()}.sqlite3"
        if not target.exists():
            database_snapshot(self.db, target)
        for old in sorted(folder.glob("daily-????-??-??.sqlite3"), reverse=True)[7:]:
            old.unlink()

    # 仅枚举本程序命名的普通文件，外部路径和目录不会进入恢复入口。
    @traced
    def recovery_list(self) -> list[dict]:
        return [
            {"id": path.name, "created_at": path.stat().st_mtime, "kind": path.name.split("-")[0]}
            for path in sorted(
                (self.root / "recovery").iterdir(), key=lambda p: p.stat().st_mtime, reverse=True
            )
            if path.is_file() and not path.is_symlink() and SNAPSHOT_NAME.fullmatch(path.name)
        ][:30]

    # 人工快照和恢复前快照均使用唯一名称，不能覆盖历史内容。
    @traced
    def recovery_create(self, prefix: str = "manual") -> str:
        name = f"{prefix}-{uuid.uuid4()}.sqlite3"
        database_snapshot(self.db, self.root / "recovery" / name)
        return name

    # 先验证只读快照，再备份当前库；整套知识恢复在一个事务提交，不换活动连接。
    @traced
    def recovery_restore(self, name: str) -> dict:
        if not SNAPSHOT_NAME.fullmatch(name):
            raise ValueError("恢复点标识无效")
        path = self.root / "recovery" / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("恢复点不存在，请刷新列表")
        try:
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as snapshot:
                snapshot.row_factory = sqlite3.Row
                snapshot.execute("BEGIN")
                version = snapshot.execute("PRAGMA user_version").fetchone()[0]
                if (
                    version not in (6, 7)
                    or snapshot.execute("PRAGMA quick_check").fetchone()[0] != "ok"
                ):
                    raise ValueError("恢复点版本不兼容或已损坏；未修改当前知识库")
                if snapshot.execute("PRAGMA foreign_key_check").fetchone():
                    raise ValueError("恢复点关联不完整；未修改当前知识库")
                backup = self.recovery_create("before-restore")
                with self.db:
                    self.db.execute("BEGIN IMMEDIATE")
                    self.db.execute("DELETE FROM knowledge_merges")
                    self.db.execute("DELETE FROM knowledge")
                    for table in KNOWLEDGE_TABLES:
                        # 逐表有界读取；触发器使用当前连接分词与身份函数。
                        cursor = snapshot.execute(f"SELECT * FROM {table}")
                        while rows := cursor.fetchmany(100):
                            insert_rows(self.db, table, [dict(row) for row in rows])
                    self.rebuild_recovery_index()
                    self.semantic_reset()
        except sqlite3.DatabaseError as error:
            raise ValueError("恢复失败，当前知识库已保留；请检查恢复点及存储空间") from error
        return {"restored": True, "backup": backup}
