# 文件：test_topics_migration.py
# 层：验证
# 作用：验证主题目录迁移的备份一致性、失败回滚和重启幂等。
# 说明：只在临时 SQLite 文件中注入故障。
import shutil
import sqlite3
from contextlib import closing

import pytest
from knowledge_agent.infrastructure.merge_schema import migrate_merges
from knowledge_agent.infrastructure.model_prices import migrate_prices
from knowledge_agent.infrastructure.sqlite_store import Store
from knowledge_agent.infrastructure.topic_schema import migrate_topics
from legacy_database import downgrade_topics
from test_providers import parameters


# 生成真实二版结构，保留编辑、引用、使用日、接口和旧问题映射。
def version_two(root):
    store = Store(root)
    note = store.save(
        "旧笔记",
        "原始正文",
        generated=True,
        capture_key="old-question",
        citations=[
            {"id": "b", "source_id": "s", "name": "来源", "locator": "第1段", "text": "保留摘录"}
        ],
    )
    store.save("旧笔记", "用户手工编辑不覆盖", item_id=note["id"])
    store.get(note["id"], active_use=True)
    store.set_bucket(note["id"], "常用")
    store.save_provider_config("provider", parameters() | {"models": ["fixture-model"]})
    store.insert_source(
        {
            "id": "s",
            "name": "来源",
            "blocks": [{"id": "b", "locator": "第1段", "text": "保留摘录"}],
            "warnings": [],
        },
        "s.txt",
    )
    downgrade_topics(store)
    return store, note["id"]


# 正式数据及 ID 均原样保留；备份含完整二版状态且重启不会被重写。
def test_migration_preserves_data_and_consistent_backup(tmp_path):
    old, item_id = version_two(tmp_path)
    old.close()
    store = Store(tmp_path)
    current = store.get(item_id)
    assert current["content"] == "用户手工编辑不覆盖" and current["edited"]
    assert current["bucket"] == "常用" and current["theme"] == "未分类"
    assert current["supplements"] == [] and current["citations"][0]["text"] == "保留摘录"
    assert store.provider()["id"] == "provider" and store.provider()["models"] == ["fixture-model"]
    assert store.generation_item("old-question")["id"] == item_id
    assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 1
    assert store.search({"query": "保留摘录"})["items"][0]["kind"] == "source"
    store.close()
    backup = tmp_path / "before-knowledge-topics-v3.sqlite3"
    before = backup.read_bytes()
    with closing(sqlite3.connect(backup)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 2
        assert db.execute("SELECT content FROM knowledge").fetchone()[0] == current["content"]
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='topic_links'").fetchone()
        assert db.execute("SELECT count(*) FROM uses").fetchone()[0] == 1
    reopened = Store(tmp_path)
    assert reopened.get(item_id)["version"] == current["version"]
    assert backup.read_bytes() == before
    reopened.close()
    recovery = tmp_path / "recovered-copy"
    recovery.mkdir()
    shutil.copy2(backup, recovery / "knowledge.sqlite3")
    restored = Store(recovery)
    try:
        assert restored.get(item_id)["content"] == current["content"]
        assert restored.provider()["id"] == "provider"
        assert restored.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 1
    finally:
        restored.close()


# 回填失败须撤销所有新增表与版本；解除故障可从原二版安全重试。
def test_failure_rolls_back_and_retries(tmp_path):
    store, item_id = version_two(tmp_path)

    # 只拒绝索引回填，让故障发生在结构和触发器已创建之后。
    def authorize(action, table, *_args):
        if action == sqlite3.SQLITE_INSERT and table == "search_documents":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    store.db.set_authorizer(authorize)
    with pytest.raises(ValueError, match="升级失败"):
        migrate_topics(store.db, tmp_path)
    store.db.set_authorizer(None)
    assert store.db.execute("PRAGMA user_version").fetchone()[0] == 2
    assert not store.db.execute("SELECT 1 FROM sqlite_master WHERE name='topic_links'").fetchone()
    assert (
        store.db.execute("SELECT content FROM knowledge WHERE id=?", (item_id,)).fetchone()[0]
        == "用户手工编辑不覆盖"
    )
    migrate_topics(store.db, tmp_path)
    migrate_merges(store.db, tmp_path)
    migrate_prices(store.db, tmp_path)
    assert store.get(item_id)["content"] == "用户手工编辑不覆盖"
    store.close()


# 高版本数据库直接拒绝，不能为了启动清空、改版或覆盖正式内容。
def test_newer_schema_rejected(tmp_path):
    store = Store(tmp_path)
    store.db.execute("PRAGMA user_version=8")
    store.close()
    with pytest.raises(ValueError, match="版本高于"):
        Store(tmp_path)
    with closing(sqlite3.connect(tmp_path / "knowledge.sqlite3")) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 8
