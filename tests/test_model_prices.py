# 文件：test_model_prices.py
# 层：验证
# 作用：保护独立模型价格、旧数据迁移、未知费用及历史快照。
# 说明：隔离 SQLite 和合成凭据，不调用真实模型接口。
import sqlite3
from contextlib import closing

import pytest
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.domain.generation import GenerationState
from knowledge_agent.domain.provider_rules import resolve_generation, validate_provider
from knowledge_agent.infrastructure.model_prices import migrate_prices
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault
from test_providers import parameters


# 两模型可有不同币种，无默认值也能定价；切换默认不影响其他模型。
def test_independent_prices_restart_and_attempt_snapshot(tmp_path):
    store, vault = Store(tmp_path), Vault()
    prices = [
        {"model": "a", "input_price": 1, "output_price": 2, "currency": "USD"},
        {"model": "b", "input_price": 3, "output_price": 4, "currency": "CNY"},
    ]
    draft = parameters() | {"model": "", "models": ["a", "b", "c"], "model_prices": prices}
    saved = save_provider(store, vault, draft)[0]
    config = resolve_generation(saved, {"model": "b"})
    assert config["currency"] == "CNY" and config["input_price"] == 3
    state = GenerationState(input_tokens=100, output_tokens=20)
    store.start_attempt("old", config, "test")
    store.finish_attempt("old", "success", 1, 100, 20, state.cost(config))
    save_provider(store, vault, draft | {"id": saved["id"], "model": "a", "model_prices": []})
    assert store.list_attempts()[0]["cost"] == pytest.approx(0.00038)
    assert store.list_attempts()[0]["input_price"] == 3
    save_provider(store, vault, draft | {"id": saved["id"], "model": "a"})
    store.close()
    store = Store(tmp_path)
    try:
        config = store.provider()
        assert config["model_prices"] == prices
        assert resolve_generation(config, {"model": "a"})["input_price"] == 1
        assert resolve_generation(config, {"model": "b"})["input_price"] == 3
        assert state.cost(resolve_generation(config, {"model": "c"})) is None
    finally:
        store.close()


# 空白或单边价格不估算；显式零价格可以得到零费用，异常价格写入前拒绝。
@pytest.mark.parametrize(
    "input_price,output_price,expected", [(None, None, None), (1, "", None), (0, 0, 0)]
)
def test_optional_prices(input_price, output_price, expected):
    draft = parameters() | {
        "model_prices": [
            {
                "model": "fixture-model",
                "input_price": input_price,
                "output_price": output_price,
                "currency": "USD",
            }
        ]
    }
    config = resolve_generation(validate_provider(draft), {})
    assert GenerationState(input_tokens=10, output_tokens=20).cost(config) == expected
    assert GenerationState(input_tokens=None, output_tokens=20).cost(config) is None


# 不让布尔、非有限、负数、非目录模型、重复项或无效币种进入数据库。
@pytest.mark.parametrize(
    "override",
    [
        {"input_price": True},
        {"input_price": "nan"},
        {"input_price": -1},
        {"output_price": {}},
        {"model": "other"},
        {"currency": "BAD"},
    ],
)
def test_invalid_model_prices(override):
    price = {"model": "fixture-model", "input_price": 1, "output_price": 2, "currency": "USD"}
    with pytest.raises(ValueError):
        validate_provider(parameters() | {"model_prices": [price | override]})
    with pytest.raises(ValueError, match="重复"):
        validate_provider(parameters() | {"model_prices": [price, price]})


# 用真实 v4 结构验证默认单价仅迁移一次，备份保留原正文和旧结构。
def legacy_prices(root):
    store = Store(root)
    config = save_provider(store, Vault(), parameters())[0]
    note = store.save("价格迁移", "手工正文不得改变")
    store.db.execute("DROP TABLE provider_model_prices")
    store.db.execute("PRAGMA user_version=4")
    store.db.commit()
    store.close()
    for backup in root.glob("before-model-prices-v5-*.sqlite3"):
        backup.unlink()
    return config, note


# 重开不回填用户已删除的价格；恢复点不是迁移后的数据库。
def test_price_migration_backup_and_idempotence(tmp_path):
    config, note = legacy_prices(tmp_path)
    store = Store(tmp_path)
    saved = store.provider()
    assert saved["id"] == config["id"] and saved["active"]
    assert saved["model_prices"][0]["input_price"] == 1
    assert store.get(note["id"])["content"] == note["content"]
    save_provider(store, Vault(), parameters() | {"id": config["id"], "model_prices": []})
    store.close()
    (backup,) = tmp_path.glob("before-model-prices-v5-*.sqlite3")
    before = backup.read_bytes()
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4
        assert not db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='provider_model_prices'"
        ).fetchone()
    store = Store(tmp_path)
    assert store.provider()["model_prices"] == []
    assert backup.read_bytes() == before
    store.close()


# 回填失败撤销建表、保持版本、知识及旧价格，修复原因后可正常重试。
def test_price_migration_failure_rolls_back(tmp_path):
    _config, note = legacy_prices(tmp_path)
    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        # 在建表后阻止数据回填，确保 DDL 也真正回滚。
        def authorize(action, table, *_args):
            if action == sqlite3.SQLITE_INSERT and table == "provider_model_prices":
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        db.set_authorizer(authorize)
        with pytest.raises(ValueError, match="升级失败"):
            migrate_prices(db, tmp_path)
        db.set_authorizer(None)
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4
        assert not db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='provider_model_prices'"
        ).fetchone()
        assert (
            db.execute("SELECT content FROM knowledge WHERE id=?", (note["id"],)).fetchone()[0]
            == note["content"]
        )
    store = Store(tmp_path)
    store.close()


# 价格写入故障必须同时回滚目录、默认值和凭据，不能半保存。
def test_price_save_failure_restores_configuration_and_secret(tmp_path):
    store, vault = Store(tmp_path), Vault()
    saved = save_provider(store, vault, parameters())[0]
    store.db.execute(
        "CREATE TRIGGER reject_price BEFORE INSERT ON provider_model_prices BEGIN SELECT RAISE(ABORT,'fixture'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        save_provider(store, vault, parameters() | {"id": saved["id"], "key": "new-synthetic"})
    assert store.provider() == saved
    assert vault.get(saved["id"]) == parameters()["key"]
    store.close()
