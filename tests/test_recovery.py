# 文件：test_recovery.py
# 层：验证
# 作用：保护删除恢复、快照恢复、升级回滚和重启后的数据完整性。
# 说明：仅使用临时数据库和故障注入，不读正式资料或访问网络。
import asyncio
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from knowledge_agent import diagnostics as logs
from knowledge_agent.entrypoints import protocol_runtime
from knowledge_agent.entrypoints.protocol_runtime import ProtocolRuntime
from knowledge_agent.infrastructure import recovery_schema
from knowledge_agent.infrastructure.sqlite_store import Store
from test_diagnostics import diagnostic_session as diagnostic_fixture
from test_library import call, ready
from test_restructure_merge import approve_merge
from test_restructure_merge import merge_case as merge_fixture
from test_topics_store import draft

# 显式复用隔离日志和合并夹具，避免访问生产资源。
diagnostic_session = diagnostic_fixture
merge_case = merge_fixture


# 回收前后正文、补充、分类、使用日和复用键必须一致，回收内容不能继续检索。
def test_recycle_survives_restart_and_restores_all_relations(tmp_path):
    store = Store(tmp_path)
    item = store.save(
        "恢复原笔记",
        "正文独有内容",
        capture_key="question-key",
        classification_path=["计算机", "深层", "恢复"],
    )
    store.capture_topic(draft("supplement-key", target=item, content="补充独有内容"))
    original = store.get(item["id"], active_use=True)
    store.delete_knowledge(item["id"])
    assert store.search({"query": "独有内容"})["total"] == 0
    assert store.list_knowledge() == []
    assert store.recycle_list({})["items"][0]["title"] == item["title"]
    trash_id = store.recycle_list({})["items"][0]["id"]
    store.close()
    with closing(Store(tmp_path)) as store:
        assert store.recycle_restore(trash_id) == {"restored": True}
        restored = store.get(item["id"])
        assert restored == original
        assert store.generation_item("question-key")["id"] == item["id"]
        assert store.db.execute("SELECT count(*) FROM capture_receipts").fetchone()[0] == 1
        assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 1
        assert store.search({"query": "补充独有内容"})["total"] >= 1
        assert store.recycle_list({})["total"] == 0


# 删除与恢复失败都须整体回滚；同标题的新笔记不能被旧回收站内容覆盖。
def test_recycle_failure_and_conflict_preserve_both_copies(tmp_path):
    with closing(Store(tmp_path)) as store:
        item = store.save("相同标题", "旧内容")

        # 删除父记录失败时回收站归档也必须撤销。
        def deny_delete(action, table, *_args):
            if action == sqlite3.SQLITE_DELETE and table == "knowledge":
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        store.db.set_authorizer(deny_delete)
        with pytest.raises(sqlite3.DatabaseError):
            store.delete_knowledge(item["id"])
        store.db.set_authorizer(None)
        assert store.get(item["id"])["content"] == "旧内容"
        assert store.recycle_list({})["total"] == 0
        store.delete_knowledge(item["id"])
        replacement = store.save("相同标题", "新手工内容")
        trash_id = store.recycle_list({})["items"][0]["id"]
        with pytest.raises(ValueError, match="恢复冲突"):
            store.recycle_restore(trash_id)
        assert store.get(replacement["id"])["content"] == "新手工内容"
        assert store.recycle_list({})["total"] == 1
        assert store.db.execute("PRAGMA foreign_key_check").fetchall() == []


# 恢复只替换知识集合，当前用量与资料不回退，并保留恢复前快照供撤销。
def test_snapshot_restore_is_scoped_and_has_reversible_backup(tmp_path):
    with closing(Store(tmp_path)) as store:
        item = store.save("快照笔记", "旧版本正文")
        snapshot = store.recovery_create()
        store.save(item["title"], "新手工版本", item_id=item["id"])
        extra = store.save("新增知识", "保留在恢复前快照")
        with store.db:
            store.db.execute(
                "INSERT INTO attempts (id,purpose,provider,model,status,started_at,currency) VALUES ('attempt','test','fixture','model','success','today','USD')"
            )
        result = store.recovery_restore(snapshot)
        assert store.get(item["id"])["content"] == "旧版本正文"
        with pytest.raises(ValueError):
            store.get(extra["id"])
        assert len(store.list_attempts()) == 1
        store.recovery_restore(result["backup"])
        assert store.get(item["id"])["content"] == "新手工版本"
        assert store.get(extra["id"])["content"] == "保留在恢复前快照"
        assert len(store.list_attempts()) == 1
    with closing(Store(tmp_path)) as store:
        assert store.get(item["id"])["content"] == "新手工版本"


# 恢复写入失败、损坏、未知版本和路径遍历都不能改变当前知识。
def test_snapshot_failure_rolls_back_and_rejects_invalid_inputs(tmp_path):
    with closing(Store(tmp_path)) as store:
        item = store.save("当前笔记", "旧正文")
        snapshot = store.recovery_create()
        store.save(item["title"], "当前手工正文", item_id=item["id"])

        # 插入恢复正文时才失败，证明前面的删除已回滚。
        def deny_insert(action, table, *_args):
            if action == sqlite3.SQLITE_INSERT and table == "knowledge":
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        store.db.set_authorizer(deny_insert)
        with pytest.raises(ValueError, match="恢复失败"):
            store.recovery_restore(snapshot)
        store.db.set_authorizer(None)
        assert store.get(item["id"])["content"] == "当前手工正文"
        with pytest.raises(ValueError, match="标识无效"):
            store.recovery_restore("../knowledge.sqlite3")
        path = tmp_path / "recovery" / snapshot
        with closing(sqlite3.connect(path)) as db:
            db.execute("PRAGMA user_version=7")
        with pytest.raises(ValueError, match="版本不兼容"):
            store.recovery_restore(snapshot)
        path.write_bytes(b"corrupt")
        with pytest.raises(ValueError, match="恢复失败"):
            store.recovery_restore(snapshot)
        assert store.get(item["id"])["content"] == "当前手工正文"


# 升级备份失败和 DDL 失败都保留五版结构；解除故障后可重开并重复启动。
@pytest.mark.parametrize("failure", ["backup", "ddl"])
def test_recovery_migration_failure_retry(tmp_path, monkeypatch, failure):
    store = Store(tmp_path)
    item = store.save("升级前正文", "不可覆盖手工内容")
    store.db.execute("DROP TABLE knowledge_trash")
    store.db.execute("PRAGMA user_version=5")
    store.close()

    # 两个故障点分开覆盖，DDL 失败发生在一致性备份成功后。
    def fail_backup(*_args):
        raise OSError("fixture")

    # 表创建故障发生在备份之后，验证事务和版本均撤销。
    def deny_create(action, table, *_args):
        if action == sqlite3.SQLITE_CREATE_TABLE and table == "knowledge_trash":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        with monkeypatch.context() as fault:
            if failure == "backup":
                fault.setattr(recovery_schema, "database_snapshot", fail_backup)
            else:
                db.set_authorizer(deny_create)
            with pytest.raises(ValueError, match="升级失败"):
                recovery_schema.migrate_recovery(db, tmp_path)
            db.set_authorizer(None)
        assert db.execute("PRAGMA user_version").fetchone()[0] == 5
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='knowledge_trash'").fetchone()
    with closing(Store(tmp_path)) as store:
        assert store.get(item["id"])["content"] == "不可覆盖手工内容"
        assert store.db.execute("PRAGMA user_version").fetchone()[0] == 6


# 每日快照仅保留最近七份且不覆盖当天内容，不清理人工快照或用户文件。
def test_daily_snapshot_rotation_and_idempotence(tmp_path):
    with closing(Store(tmp_path)) as store:
        folder = tmp_path / "recovery"
        manual = store.recovery_create()
        before = {path.name: path.read_bytes() for path in folder.glob("daily-*")}
        for day in range(1, 10):
            (folder / f"daily-2020-01-{day:02}.sqlite3").write_bytes(b"old fixture")
        store.daily_snapshot()
        assert len(list(folder.glob("daily-*"))) == 7
        assert (folder / manual).exists()
        assert all((folder / name).read_bytes() == data for name, data in before.items())


# 已合并知识恢复包含旧链接、原件、来源映射及索引，不能仅恢复保留点正文。
def test_snapshot_restores_merge_graph_and_repeat_delete_events(merge_case):
    service, first, second = merge_case
    store = service.store
    before_merge = store.recovery_create()
    value = ready(service, approve_merge(service, first, second))
    call(service, "library.restructure.apply", {**value, "selected": [first["id"]]})
    merged = store.get(first["id"])
    snapshot = store.recovery_create()
    store.recovery_restore(before_merge)
    assert store.get(second["id"])["canonical_id"] == second["id"]
    store.delete_knowledge(first["id"])
    store.recovery_restore(before_merge)
    store.delete_knowledge(first["id"])
    # 同一知识在恢复快照后再次删除，不能与旧删除事件主键碰撞。
    assert store.recycle_list({})["total"] == 2
    store.recovery_restore(snapshot)
    assert store.get(second["id"])["id"] == first["id"]
    assert store.get(first["id"]) == merged
    original = next(
        item for item in merged["original_sources"] if item["source_id"] == second["id"]
    )
    assert store.get_original(first["id"], original)["content"]
    assert store.db.execute("PRAGMA foreign_key_check").fetchall() == []
    assert store.recycle_list({})["total"] == 2
    with pytest.raises(ValueError, match="已合并组"):
        store.delete_knowledge(first["id"])


# 恢复拒绝与在途任务并行，失败和成功均保留协议关联；成功后旧会话失效。
def test_restore_request_exclusion_sessions_and_private_logs(
    tmp_path, diagnostic_session, monkeypatch
):
    from knowledge_agent.bootstrap import create_service
    from test_knowledge import Vault

    with closing(create_service(tmp_path / "data", vault=Vault())) as service:
        item = service.store.save("private-recovery-title", "private-recovery-body")
        snapshot = service.store.recovery_create()
        service.store.save(item["title"], "private-current-body", item_id=item["id"])
        runtime = ProtocolRuntime(service)
        frames = []
        monkeypatch.setattr(protocol_runtime, "send", frames.append)

        # 当前实际事件循环任务作为占位，入口不得取消或删除其他任务。
        async def exercise():
            runtime.tasks["other"] = asyncio.current_task()
            runtime.tasks["restore-busy"] = asyncio.current_task()
            await runtime.execute(
                {"id": "restore-busy", "operation": "recovery.restore", "params": {"id": snapshot}}
            )
            assert frames[-1]["type"] == "error" and frames[-1]["id"] == "restore-busy"
            assert service.store.get(item["id"])["content"] == "private-current-body"
            runtime.tasks.clear()
            service.library.draft = {"stale": True}
            service.text.edits["stale"] = {}
            service.topics.sessions["stale"] = {}
            await runtime.execute(
                {"id": "restore-alone", "operation": "recovery.restore", "params": {"id": snapshot}}
            )

        asyncio.run(exercise())
        assert frames[-1]["type"] == "result" and frames[-1]["id"] == "restore-alone"
        assert (
            service.library.draft is None and not service.text.edits and not service.topics.sessions
        )
        assert service.store.get(item["id"])["content"] == "private-recovery-body"
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert "private-" not in text
    rows = [json.loads(line) for line in text.splitlines()]
    assert any(
        row["event"] == "step.failed" and row.get("request_id") == "restore-busy" for row in rows
    )
    assert any(
        row["event"] == "request.result_sent" and row.get("request_id") == "restore-alone"
        for row in rows
    )
