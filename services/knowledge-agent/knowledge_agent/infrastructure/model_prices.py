# 文件：model_prices.py
# 层：Python infrastructure
# 作用：迁移并读写每个模型独立的计价配置。
# 说明：迁移先备份再事务提交，不重算历史调用费用。
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from knowledge_agent.domain.models import ModelPrice


# 每次升级恢复点独立；备份失败时不开始结构变更。
def backup_prices(db: sqlite3.Connection, root: Path) -> None:
    target = root / f"before-model-prices-v5-{uuid.uuid4()}.sqlite3"
    temporary = target.with_suffix(".pending")
    try:
        with closing(sqlite3.connect(temporary)) as destination:
            db.backup(destination)
        temporary.replace(target)
    except Exception:
        # 半成品不能冒充可恢复备份，下次启动重新尝试。
        temporary.unlink(missing_ok=True)
        raise


# 旧单价只回填原默认模型；失败撤销 DDL 与版本并阻止启动。
def migrate_prices(db: sqlite3.Connection, root: Path) -> None:
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version >= 5:
        return
    if version != 4:
        raise ValueError("模型价格迁移只接受 schema 4")
    try:
        backup_prices(db, root)
        with db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""CREATE TABLE provider_model_prices (
                provider_id TEXT NOT NULL, model TEXT NOT NULL,
                input_price REAL, output_price REAL, currency TEXT NOT NULL,
                PRIMARY KEY(provider_id,model),
                FOREIGN KEY(provider_id,model) REFERENCES provider_models(provider_id,model_id)
                    ON DELETE CASCADE)""")
            db.execute("""INSERT INTO provider_model_prices
                SELECT p.id,p.model,p.input_price,p.output_price,p.currency FROM providers p
                JOIN provider_models m ON m.provider_id=p.id AND m.model_id=p.model
                WHERE p.input_price IS NOT NULL OR p.output_price IS NOT NULL""")
            db.execute("PRAGMA user_version=5")
    except Exception as error:
        raise ValueError(
            "模型价格升级失败，已停止写入；请保留数据目录和 before-model-prices-v5 备份"
        ) from error


# 只返回无凭据的模型价格，顺序与模型目录一致。
def read_prices(db: sqlite3.Connection, provider_id: str) -> list[ModelPrice]:
    return [
        dict(row)
        for row in db.execute(
            """SELECT p.model,p.input_price,p.output_price,p.currency FROM provider_model_prices p
        JOIN provider_models m ON p.provider_id=m.provider_id AND p.model=m.model_id
        WHERE p.provider_id=? ORDER BY m.position""",
            (provider_id,),
        )
    ]
