# 文件：test_legacy_price_migration.py
# 层：验证／数据库迁移
# 作用：保护旧价格 v4 分支的启动兼容、原始数据与事务恢复。
# 说明：仅使用合成配置和临时库，不访问正式数据或凭据。
import json
import logging
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

import pytest
from knowledge_agent import diagnostics as logs
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.infrastructure import merge_schema
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault
from test_providers import parameters


# 比较业务表中的完整行，避免只保留条数却丢失价格、正文或历史快照。
def business_rows(db):
    return {
        name: [tuple(row) for row in db.execute(f"SELECT * FROM {name} ORDER BY rowid")]
        for name in (
            "knowledge",
            "providers",
            "provider_models",
            "provider_model_prices",
            "attempts",
            "uses",
            "generation_keys",
            "sources",
            "topic_links",
            "supplements",
            "capture_receipts",
        )
    }


# 构造实际旧价格分支：已有独立价格、缺少全部合并对象，版本标记为 v4。
def legacy_database(root, empty_prices=False):
    with closing(Store(root)) as store:
        draft = parameters() | {
            "models": ["fixture-model", "other"],
            "model_prices": []
            if empty_prices
            else [
                {"model": "fixture-model", "input_price": 9, "output_price": 0, "currency": "EUR"},
                {"model": "other", "input_price": None, "output_price": 7, "currency": "CNY"},
            ],
        }
        config = save_provider(store, Vault(), draft)[0]
        note = store.save("private-title", "private-body", capture_key="fixture-question")
        store.save("private-title", "private-edited-body", item_id=note["id"])
        store.start_attempt("fixture-attempt", config, "test")
        store.finish_attempt("fixture-attempt", "success", 1, 11, 17, 0.5)
        for name in ("knowledge_merges", "restructure_originals", "restructure_provenance"):
            store.db.execute(f"DROP TABLE {name}")
        store.db.execute("PRAGMA user_version=4")
        store.db.commit()
        expected = business_rows(store.db)
    # 清除造库期间的恢复点，后续断言只计被测迁移新建的备份。
    for pattern in ("before-knowledge-merges-v4-*", "before-model-prices-v5-*"):
        for path in root.glob(pattern):
            path.unlink()
    return expected


# 原价格和主动清空的价格均原样保留；补齐结构、备份与重复启动均须正确。
@pytest.mark.parametrize("empty_prices", [False, True])
def test_legacy_prices_startup_preserves_data_and_restart(tmp_path, empty_prices):
    expected = legacy_database(tmp_path, empty_prices)
    with closing(Store(tmp_path)) as store:
        assert store.db.execute("PRAGMA user_version").fetchone()[0] == 5
        assert business_rows(store.db) == expected
        assert store.db.execute("PRAGMA foreign_key_check").fetchall() == []
        # 真正调用合并结构的读路径，不能只改版本号骗过启动。
        assert store.db.execute("SELECT * FROM knowledge_merges").fetchall() == []
        assert store.db.execute("SELECT * FROM restructure_originals").fetchall() == []
        assert store.db.execute("SELECT * FROM restructure_provenance").fetchall() == []
    (backup,) = tmp_path.glob("before-knowledge-merges-v4-*.sqlite3")
    original_backup = backup.read_bytes()
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4
        assert business_rows(db) == expected
        assert not db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='knowledge_merges'"
        ).fetchone()
    with closing(Store(tmp_path)) as store:
        assert business_rows(store.db) == expected
    assert list(tmp_path.glob("before-knowledge-merges-v4-*.sqlite3")) == [backup]
    assert backup.read_bytes() == original_backup
    assert not list(tmp_path.glob("before-model-prices-v5-*"))


# 建表、版本推进或备份失败时保持旧结构与数据，可解除故障后重试；日志保留关联。
@pytest.mark.parametrize("failure", ["ddl", "version", "backup"])
def test_legacy_price_migration_rollback_and_retry(tmp_path, monkeypatch, caplog, failure):
    expected = legacy_database(tmp_path)
    monkeypatch.setattr(logs.LOGGER, "handlers", [caplog.handler])
    monkeypatch.setattr(logs.LOGGER, "level", logging.INFO)
    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        # 在第二张合并表或版本提交时拒绝，验证先前 DDL 也会回滚。
        def authorize(action, name, argument, *_args):
            if (
                failure == "ddl"
                and action == sqlite3.SQLITE_CREATE_TABLE
                and name == "restructure_originals"
            ):
                return sqlite3.SQLITE_DENY
            if (
                failure == "version"
                and action == sqlite3.SQLITE_PRAGMA
                and name == "user_version"
                and argument
            ):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        # 模拟备份介质失败；异常中的私密字符串不得进入诊断。
        def broken_backup(*_args):
            raise OSError("private-backup-path")

        with monkeypatch.context() as fault:
            if failure == "backup":
                fault.setattr(merge_schema, "backup_merges", broken_backup)
            db.set_authorizer(authorize)
            with logs.request_context("legacy-retry", "bootstrap"):
                with pytest.raises(ValueError, match="已回滚"):
                    merge_schema.migrate_merges(db, tmp_path)
            db.set_authorizer(None)
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4
        assert business_rows(db) == expected
        assert not db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='knowledge_merges'"
        ).fetchone()
    with closing(Store(tmp_path)) as store:
        assert business_rows(store.db) == expected
        assert store.db.execute("PRAGMA user_version").fetchone()[0] == 5
    failed = [row.msg for row in caplog.records if row.msg.get("event") == "step.failed"]
    assert any(
        row["request_id"] == "legacy-retry" and row["step"].endswith("migrate_merges")
        for row in failed
    )
    assert "private-" not in json.dumps([row.msg for row in caplog.records])


# 非完整历史布局拒绝自动修复，不删已有表，也不把异常库直接标记为 v5。
@pytest.mark.parametrize("damage", ["partial_merge", "price_shape", "foreign_key"])
def test_unrecognized_legacy_layout_stops_without_writing(tmp_path, damage):
    legacy_database(tmp_path)
    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        if damage == "partial_merge":
            db.execute("CREATE TABLE restructure_originals (fixture TEXT)")
        elif damage == "price_shape":
            db.execute("ALTER TABLE provider_model_prices ADD COLUMN unexpected TEXT")
        else:
            db.execute("UPDATE provider_model_prices SET model='orphan-model' WHERE model='other'")
        db.commit()
        before = business_rows(db)
        with pytest.raises(ValueError, match="已回滚"):
            merge_schema.migrate_merges(db, tmp_path)
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4
        assert business_rows(db) == before
    assert not list(tmp_path.glob("before-knowledge-merges-v4-*"))


# 使用真实入口验证旧库能发出 ready、完成关联 bootstrap 并正常退出，日志不泄漏正文。
def test_legacy_price_worker_handshake_and_bootstrap(tmp_path):
    expected = legacy_database(tmp_path)
    script = Path(__file__).resolve().parents[1] / "services/knowledge-agent/worker.py"
    with (
        subprocess.Popen(
            [sys.executable, "-u", str(script), "--data-dir", str(tmp_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        ) as process,
        ThreadPoolExecutor(max_workers=1) as reader,
    ):
        try:
            # Windows 管道用读线程加有限等待；失败先结束拥有的进程，解除线程读取。
            assert (
                json.loads(reader.submit(process.stdout.readline).result(timeout=15))["type"]
                == "ready"
            )
            message = {"id": "legacy-bootstrap", "operation": "bootstrap", "params": {}}
            process.stdin.write(json.dumps(message) + "\n")
            process.stdin.flush()
            response = json.loads(reader.submit(process.stdout.readline).result(timeout=15))
            assert response["id"] == "legacy-bootstrap" and response["type"] == "result"
            process.communicate(timeout=15)
            assert process.returncode == 0
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=15)
    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 5
        assert business_rows(db) == expected
    text = (tmp_path / "logs/worker.log").read_text(encoding="utf-8")
    rows = [json.loads(line) for line in text.splitlines()]
    assert "private-" not in text and "secret-fixture-only" not in text
    assert any(
        row["event"] == "storage.merge_migrated" and row["schema_version"] == 5 for row in rows
    )
    assert any(
        row["event"] == "request.result_sent" and row.get("request_id") == "legacy-bootstrap"
        for row in rows
    )
    assert any(row["event"] == "worker.ready" for row in rows)
