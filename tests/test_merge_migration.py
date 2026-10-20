# 文件：test_merge_migration.py
# 层：验证
# 作用：验证 schema 3 到 4 的一致性备份、DDL 回滚及重启幂等。
# 说明：只在隔离 SQLite 注入故障，不迁移正式数据库。
import sqlite3
from contextlib import closing

import pytest
from knowledge_agent.infrastructure.merge_schema import migrate_merges
from knowledge_agent.infrastructure.sqlite_store import Store


# 回退新增表形成真实 schema 3，避免仅改版本号伪造迁移用例。
def version_three(root):
    store = Store(root)
    item = store.save("迁移前手工知识", "原始内容不可丢失")
    store.db.execute("DROP TRIGGER merge_root")
    for table in ("knowledge_merges", "restructure_provenance", "restructure_originals"):
        store.db.execute("DROP TABLE " + table)
    store.db.execute("PRAGMA user_version=3")
    store.db.commit()
    return store, item


# 迁移失败撤销所有 DDL，保留真正的三版恢复点，解除故障后可重试。
def test_merge_migration_failure_backup_retry_and_idempotence(tmp_path):
    store, item = version_three(tmp_path)

    # 第二张表建表时故障，验证第一张表和触发器也一起撤销。
    def authorize(action, table, *_args):
        if action == sqlite3.SQLITE_CREATE_TABLE and table == "restructure_originals":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    store.db.set_authorizer(authorize)
    with pytest.raises(ValueError, match="已回滚"):
        migrate_merges(store.db, tmp_path)
    store.db.set_authorizer(None)
    assert store.db.execute("PRAGMA user_version").fetchone()[0] == 3
    assert not store.db.execute(
        "SELECT 1 FROM sqlite_master WHERE name='knowledge_merges'"
    ).fetchone()
    backups = list(tmp_path.glob("before-knowledge-merges-v4-*.sqlite3"))
    assert len(backups) == 2
    for backup in backups:
        with closing(sqlite3.connect(backup)) as db:
            assert db.execute("PRAGMA user_version").fetchone()[0] == 3
    migrate_merges(store.db, tmp_path)
    assert store.get(item["id"])["content"] == item["content"]
    assert store.db.execute("PRAGMA user_version").fetchone()[0] == 4
    count = len(list(tmp_path.glob("before-knowledge-merges-v4-*.sqlite3")))
    store.close()
    reopened = Store(tmp_path)
    reopened.close()
    assert len(list(tmp_path.glob("before-knowledge-merges-v4-*.sqlite3"))) == count
