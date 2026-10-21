# 文件：merge_schema.py
# 层：Python infrastructure
# 作用：将 schema 3 增量迁移为可追溯合并的 schema 4。
# 说明：一致性备份成功后才建表；失败事务回滚并停止打开。
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from knowledge_agent.diagnostics import record, traced


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


# 仅识别旧价格分支的完整 v4，不把部分合并结构或损坏的价格表当作可修复库。
@traced
def legacy_price_schema(db: sqlite3.Connection) -> bool:
    if not db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_model_prices'"
    ).fetchone():
        # 当前合并分支的 v4 仍由后续价格迁移负责建表和回填。
        return False
    columns = [
        (row[1], row[2], row[3], row[5])
        for row in db.execute("PRAGMA table_info(provider_model_prices)")
    ]
    expected_columns = [
        ("provider_id", "TEXT", 1, 1),
        ("model", "TEXT", 1, 2),
        ("input_price", "REAL", 0, 0),
        ("output_price", "REAL", 0, 0),
        ("currency", "TEXT", 1, 0),
    ]
    foreign_keys = [
        tuple(row)[1:] for row in db.execute("PRAGMA foreign_key_list(provider_model_prices)")
    ]
    expected_keys = [
        (0, "provider_models", "provider_id", "provider_id", "NO ACTION", "CASCADE", "NONE"),
        (1, "provider_models", "model", "model_id", "NO ACTION", "CASCADE", "NONE"),
    ]
    merge_objects = db.execute(
        """SELECT 1 FROM sqlite_master WHERE name IN (
        'knowledge_merges','merge_target','merge_root',
        'restructure_originals','restructure_provenance')"""
    ).fetchone()
    # 只记录固定原因，不把 SQL、配置、路径或价格数据写入诊断。
    if columns != expected_columns or foreign_keys != expected_keys:
        record("storage.migration_rejected", reason="legacy_price_shape")
        raise ValueError("旧模型价格库结构不兼容，请保留数据目录")
    if merge_objects:
        record("storage.migration_rejected", reason="legacy_merge_objects")
        raise ValueError("旧模型价格库包含非预期合并结构，请保留数据目录")
    if db.execute("PRAGMA foreign_key_check(provider_model_prices)").fetchone():
        record("storage.migration_rejected", reason="legacy_price_foreign_keys")
        raise ValueError("旧模型价格库关联不完整，请保留数据目录")
    return True


# 兼容两个 v4 分支；旧价格分支补齐合并结构后直达 v5，不重建或回填已有价格。
@traced
def migrate_merges(db: sqlite3.Connection, root: Path) -> None:
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version == 5:
        return
    if version not in (3, 4):
        raise ValueError("可追溯合并迁移只接受 schema 3")
    try:
        # 正常 v4 保持原迁移路径；旧价格 v4 必须通过结构和关联校验。
        if version == 4 and not legacy_price_schema(db):
            return
        target_version = 5 if version == 4 else 4
        backup_merges(db, root)
        with db:
            db.execute("BEGIN IMMEDIATE")
            create_merge_tables(db)
            db.execute(f"PRAGMA user_version={target_version}")
        # 事务完成后才报告成功；启动阶段沿用 session，已有请求上下文原样保留。
        record("storage.merge_migrated", source_schema=version, schema_version=target_version)
    except Exception as error:
        raise ValueError(
            "合并存储升级失败，已回滚并停止写入；请保留数据目录和 before-knowledge-merges-v4 恢复点"
        ) from error
