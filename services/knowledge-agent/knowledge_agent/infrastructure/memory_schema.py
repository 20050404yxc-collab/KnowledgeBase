# 文件：memory_schema.py
# 层：Python infrastructure
# 作用：一致性备份后升级长期记忆与可重建语义索引。
# 说明：升级失败回滚，旧知识、配置、凭据和频率表不变。
import sqlite3
import uuid
from pathlib import Path

from knowledge_agent.diagnostics import step

from .recovery_schema import database_snapshot


# DDL 与版本原子提交，重启不会覆盖用户偏好或已清空的统计。
def migrate_memory(db: sqlite3.Connection, root: Path) -> None:
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version == 7:
        return
    if version != 6:
        raise ValueError("长期记忆迁移只接受 schema 6")
    with step("memory.migrate"):
        try:
            database_snapshot(db, root / f"before-memory-v7-{uuid.uuid4()}.sqlite3")
            with db:
                db.execute("BEGIN IMMEDIATE")
                create_memory_tables(db)
                create_semantic_tables(db)
                db.execute("PRAGMA user_version=7")
        except Exception as error:
            raise ValueError(
                "长期记忆升级失败，已停止写入；请保留 before-memory-v7 备份"
            ) from error


# 独立画像不引用 uses；清空后不从旧记录回灌，也不影响原频率分区。
def create_memory_tables(db: sqlite3.Connection) -> None:
    db.execute("CREATE TABLE memory_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execute("""CREATE TABLE memory_questions (
        identity TEXT PRIMARY KEY, topic TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL)""")
    db.execute("""CREATE TABLE memory_daily (
        topic TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY(topic,kind,day))""")
    db.execute("""CREATE TABLE memory_totals (
        topic TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, last_used TEXT NOT NULL,
        PRIMARY KEY(topic,kind))""")
    db.execute("""CREATE TABLE memory_reading (
        knowledge_id TEXT NOT NULL, day TEXT NOT NULL, counted INTEGER NOT NULL,
        PRIMARY KEY(knowledge_id,day))""")
    db.execute("""CREATE TABLE memory_reading_totals (
        knowledge_id TEXT PRIMARY KEY, count INTEGER NOT NULL, last_used TEXT NOT NULL)""")


# 索引触发器仅失效旧向量，生成在受控后台任务执行，不在写入中跑模型。
def create_semantic_tables(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE semantic_vectors (
        document_id TEXT NOT NULL, offset INTEGER NOT NULL, fingerprint TEXT NOT NULL,
        model TEXT NOT NULL, excerpt TEXT NOT NULL, vector BLOB NOT NULL,
        PRIMARY KEY(document_id,offset))""")
    db.execute("CREATE TABLE semantic_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execute("INSERT INTO semantic_state VALUES ('epoch','0')")
    for event, ref in (("UPDATE", "new"), ("DELETE", "old")):
        db.execute(
            f"CREATE TRIGGER semantic_{event.lower()} AFTER {event} ON search_documents "
            f"BEGIN DELETE FROM semantic_vectors WHERE document_id={ref}.id; END"
        )
