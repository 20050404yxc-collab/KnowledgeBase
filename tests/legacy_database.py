# 文件：legacy_database.py
# 层：验证支持
# 作用：将隔离测试库还原为真实旧版结构。
# 说明：只用于临时目录，不接触生产库或用户文件。
from knowledge_agent.infrastructure.sqlite_store import Store


# 删除本轮新增对象后再降版，避免伪造版本号却留下未来结构。
def downgrade_topics(store: Store) -> None:
    store.db.execute("DROP TABLE IF EXISTS knowledge_trash")
    store.db.execute("DROP TABLE IF EXISTS provider_model_prices")
    for backup in store.root.glob("before-model-prices-v5-*.sqlite3"):
        backup.unlink()
    triggers = store.db.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()
    for row in triggers:
        store.db.execute('DROP TRIGGER "' + row[0].replace('"', '""') + '"')
    for table in (
        "knowledge_merges",
        "restructure_provenance",
        "restructure_originals",
        "search_fts",
        "search_documents",
        "capture_receipts",
        "supplements",
        "topic_links",
    ):
        store.db.execute("DROP TABLE IF EXISTS " + table)
    store.db.execute("PRAGMA user_version=2")
    store.db.commit()
    (store.root / "before-knowledge-topics-v3.sqlite3").unlink(missing_ok=True)
