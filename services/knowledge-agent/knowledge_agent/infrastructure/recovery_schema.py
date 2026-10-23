# 文件：recovery_schema.py
# 层：Python infrastructure
# 作用：迁移可持久恢复的回收站并创建一致性快照。
# 说明：结构升级先备份，备份和 DDL 失败均阻止继续写入。
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path


# SQLite backup 包含 WAL 已提交数据；临时文件不作为可用恢复点。
def database_snapshot(db: sqlite3.Connection, target: Path) -> None:
    temporary = target.with_suffix(".pending")
    try:
        with closing(sqlite3.connect(temporary)) as destination:
            db.backup(destination)
        temporary.replace(target)
    except Exception:
        # 半成品只属于本次快照，不删除已有可用恢复点。
        temporary.unlink(missing_ok=True)
        raise


# 新增独立回收站，不改已有知识身份、资料位置或接口配置。
def migrate_recovery(db: sqlite3.Connection, root: Path) -> None:
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version == 6:
        return
    if version != 5:
        raise ValueError("回收站迁移只接受 schema 5")
    try:
        database_snapshot(db, root / f"before-recovery-v6-{uuid.uuid4()}.sqlite3")
        with db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""CREATE TABLE knowledge_trash (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, deleted_at TEXT NOT NULL,
                snapshot TEXT NOT NULL)""")
            db.execute("PRAGMA user_version=6")
    except Exception as error:
        raise ValueError(
            "回收站升级失败，已停止写入；请保留数据目录及 before-recovery-v6 备份"
        ) from error
