# 文件：merge_schema.py
# 层：Python infrastructure
# 作用：将 schema 3 增量迁移为可追溯合并的 schema 4。
# 说明：一致性备份成功后才建表；失败事务回滚并停止打开。
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path


# 恢复点名称唯一且通过原子改名公开，不能覆盖先前版本备份。
def backup_merges(db: sqlite3.Connection, root: Path) -> str:
    target = root / f"before-knowledge-merges-v4-{uuid.uuid4()}.sqlite3"
    temporary = target.with_suffix(".pending")
    try:
        with closing(sqlite3.connect(temporary)) as destination:
            db.backup(destination)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return target.name


# 所有映射指向根保留点，不允许自映射、链式映射或循环。
def create_merge_tables(db: sqlite3.Connection) -> None:
    db.execute("""CREATE TABLE knowledge_merges (
        source_id TEXT PRIMARY KEY REFERENCES knowledge(id) ON DELETE RESTRICT,
        target_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE RESTRICT,
        CHECK(source_id != target_id))""")
    db.execute("CREATE INDEX merge_target ON knowledge_merges(target_id)")
    db.execute("""CREATE TRIGGER merge_root BEFORE INSERT ON knowledge_merges BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM knowledge_merges WHERE source_id=new.target_id)
          OR EXISTS(SELECT 1 FROM knowledge_merges WHERE target_id=new.source_id)
        THEN RAISE(ABORT,'merge target must be canonical') END; END""")
    db.execute("""CREATE TABLE restructure_originals (
        source_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
        version TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,
        PRIMARY KEY(source_id,version))""")
    db.execute("""CREATE TABLE restructure_provenance (
        target_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
        suggestion_id TEXT NOT NULL,kind TEXT NOT NULL,sources TEXT NOT NULL,
        created_at TEXT NOT NULL,PRIMARY KEY(target_id,suggestion_id,created_at))""")


# 不创建空库绕过迁移失败，高版本由 Store 在基础结构操作前拒绝。
def migrate_merges(db: sqlite3.Connection, root: Path) -> None:
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version == 4:
        return
    if version != 3:
        raise ValueError("可追溯合并迁移只接受 schema 3")
    try:
        backup_merges(db, root)
        with db:
            db.execute("BEGIN IMMEDIATE")
            create_merge_tables(db)
            db.execute("PRAGMA user_version=4")
    except Exception as error:
        raise ValueError(
            "合并存储升级失败，已回滚并停止写入；请保留数据目录和 before-knowledge-merges-v4 恢复点"
        ) from error
