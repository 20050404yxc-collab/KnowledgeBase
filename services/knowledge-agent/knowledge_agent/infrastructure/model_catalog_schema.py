# 文件：model_catalog_schema.py
# 层：Python infrastructure
# 作用：增量创建模型目录并备份旧数据库。
# 说明：迁移失败回滚并阻止使用，保留凭据引用及原始知识。
import sqlite3
from contextlib import closing
from pathlib import Path


# SQLite backup 生成一致性快照；固定版本文件存在时不覆盖历史恢复点。
def backup_legacy(db: sqlite3.Connection, root: Path) -> None:
    target = root / "before-model-catalog-v2.sqlite3"
    if target.exists():
        return
    temporary = root / "before-model-catalog-v2.pending"
    try:
        with closing(sqlite3.connect(temporary)) as backup:
            db.backup(backup)
        temporary.replace(target)
    except Exception:
        # 半写入备份不能冒充恢复点，后续启动仍会重试备份。
        temporary.unlink(missing_ok=True)
        raise


# 建表、旧默认模型回填与版本提交处于同一事务；重开不会回填已被用户清空的目录。
def migrate_catalog(db: sqlite3.Connection, root: Path, version: int) -> None:
    if version >= 2:
        return
    try:
        backup_legacy(db, root)
        with db:
            db.execute("BEGIN")
            db.execute("""CREATE TABLE provider_models (
                provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                model_id TEXT NOT NULL, position INTEGER NOT NULL,
                PRIMARY KEY(provider_id, model_id)
            )""")
            db.execute("""INSERT INTO provider_models SELECT id, model, 0
                FROM providers WHERE model != ''""")
            db.execute("PRAGMA user_version=2")
    except Exception as exc:
        raise ValueError(
            "模型目录升级失败，已停止写入；请保留数据目录及 before-model-catalog-v2 备份后重试"
        ) from exc
