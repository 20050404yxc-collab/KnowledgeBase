# 文件：test_model_catalog_migration.py
# 层：验证
# 作用：验证模型目录增量迁移和失败回滚。
# 说明：只构造临时旧版数据库，不读取用户数据。
import sqlite3
from contextlib import closing

import pytest
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.infrastructure.model_catalog_schema import migrate_catalog
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault
from test_providers import parameters


# 构造与上一版本同结构的配置、知识及调用记录。
def legacy_fixture(root):
    store = Store(root)
    provider = save_provider(store, Vault(), parameters())[0]
    note = store.save("旧版知识", "迁移必须保留手工正文。")
    store.db.execute(
        "INSERT INTO attempts (id,purpose,provider,model,status,started_at,currency) VALUES ('old','test','p','m','success','2026-10-20','USD')"
    )
    store.db.execute("DROP TABLE provider_models")
    store.db.execute("PRAGMA user_version=1")
    store.db.commit()
    store.close()
    (root / "before-model-catalog-v2.sqlite3").unlink()
    return provider, note


# 默认模型自动回填；备份不含新表，清空目录后重启不再次回填。
def test_legacy_migration_backup_and_idempotence(tmp_path):
    provider, note = legacy_fixture(tmp_path)
    store = Store(tmp_path)
    try:
        assert store.provider()["models"] == [provider["model"]]
        assert store.provider()["id"] == provider["id"] and store.provider()["active"]
        assert store.get(note["id"])["content"] == note["content"]
        assert store.list_attempts()[0]["status"] == "success"
        store.save_provider_config(provider["id"], parameters() | {"model": "", "models": []})
    finally:
        store.close()
    backup = tmp_path / "before-model-catalog-v2.sqlite3"
    before = backup.read_bytes()
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='provider_models'").fetchone()
        assert db.execute("SELECT content FROM knowledge").fetchone()[0] == note["content"]
    store = Store(tmp_path)
    try:
        assert store.provider()["models"] == [] and store.provider()["model"] == ""
        assert backup.read_bytes() == before
    finally:
        store.close()


# 回填阶段失败必须撤销建表、保持版本与数据，同时保留可恢复备份。
def test_migration_failure_rolls_back_ddl_and_version(tmp_path):
    provider, _note = legacy_fixture(tmp_path)
    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        # 仅拒绝新表插入，让建表成功后触发故障。
        def authorize(action, table, *_args):
            if action == sqlite3.SQLITE_INSERT and table == "provider_models":
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        db.set_authorizer(authorize)
        with pytest.raises(ValueError, match="升级失败"):
            migrate_catalog(db, tmp_path, 1)
        db.set_authorizer(None)
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='provider_models'").fetchone()
        assert db.execute("SELECT id FROM providers").fetchone()[0] == provider["id"]
    assert (tmp_path / "before-model-catalog-v2.sqlite3").is_file()
    recovered = Store(tmp_path)
    recovered.close()
