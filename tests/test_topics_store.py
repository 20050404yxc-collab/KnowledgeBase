# 文件：test_topics_store.py
# 层：验证
# 作用：验证全库索引、补充维护及主题身份的原子持久化。
# 说明：全部数据为隔离生成，不调用模型或正式凭据。
import sqlite3

import pytest
from knowledge_agent.infrastructure.sqlite_store import Store


# 每个测试独立拥有连接，保证故障注入不会影响其他案例。
@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path)
    yield value
    value.close()


# 构造正式收录命令，目标版本总是取调用前的当前状态。
def draft(
    key="capture", *, target=None, content="指数退避缓解重连压力。", theme="网络", title="重连退避"
):
    return {
        "capture_key": key,
        "title": title,
        "theme": theme,
        "content": content,
        "model": "fixture",
        "provider_name": "合成接口",
        "citations": [],
        "target_id": target["id"] if target else "",
        "version": target["version"] if target else "",
    }


# 旧于五千条的正文和补充、保留资料均可被独立搜索，分页稳定且没有计数副作用。
def test_complete_index_and_paging(store):
    old = store.save("最早的重连笔记", "最早正文保留倒序以外的稀有检索词。")
    store.capture_topic(draft(target=old, content="星河退避是后来补充的稀有内容。"))
    with store.db:
        store.db.executemany(
            """INSERT INTO knowledge (id,concept,title,content,digest,created_at,updated_at,generated)
            VALUES (?,?,?,?,?,'2026-10-21','2026-10-21',0)""",
            [
                (f"bulk-{i:05}", f"bulk{i}", f"分页记录{i}", "普通测试内容", f"digest{i}")
                for i in range(5020)
            ],
        )
    store.insert_source(
        {
            "id": "source",
            "name": "保留资料",
            "blocks": [{"id": "block", "locator": "第1段", "text": "星河退避原文依据"}],
            "warnings": [],
        },
        "source.txt",
    )
    assert store.search({"query": "稀有检索词"})["items"][0]["knowledge_id"] == old["id"]
    found = store.search({"query": "星河退避"})
    assert {hit["kind"] for hit in found["items"]} == {"supplement", "source"}
    assert (
        next(h for h in found["items"] if h["kind"] == "source")["citation"]["text"]
        == "星河退避原文依据"
    )
    first = store.search({"query": "分页记录", "page": 0})
    second = store.search({"query": "分页记录", "page": 1})
    assert first["total"] == 5020 and len(first["items"]) == len(second["items"]) == 30
    assert first == store.search({"query": "分页记录", "page": 0})
    assert not {h["id"] for h in first["items"]} & {h["id"] for h in second["items"]}
    assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 0
    assert store.db.execute("SELECT count(*) FROM attempts").fetchone()[0] == 0


# 正文和补充每次编辑删除都更新索引，重建与重启不改变原件或引用。
def test_supplement_lifecycle_and_index(store):
    original = store.save("重连", "obsoleteword 手工原文不变。")
    citation = {
        "id": "b",
        "source_id": "missing",
        "name": "文件",
        "locator": "第2段",
        "text": "原文快照",
    }
    command = draft(target=original)
    command["citations"] = [citation]
    captured = store.capture_topic(command)
    assert captured["id"] == original["id"] and captured["content"] == original["content"]
    supplement = captured["supplements"][0]
    assert store.list_knowledge()[0]["supplements"] == []
    assert store.get(original["id"])["supplements"]
    assert supplement["model"] == "fixture" and supplement["created_at"]
    assert not supplement["citations"][0]["retained"]
    assert len(store.capture_topic(command)["supplements"]) == 1
    assert len(store.capture_topic(draft("second", target=captured))["supplements"]) == 1
    saved = store.maintain_supplement(
        {
            "knowledge_id": original["id"],
            "id": supplement["id"],
            "version": captured["version"],
            "title": "修订",
            "content": "修订后的全新星光策略",
        }
    )
    assert saved["supplements"][0]["edited"]
    assert store.search({"query": "指数退避"})["total"] == 0
    assert store.search({"query": "全新星光"})["total"] == 1
    store.save("修订笔记", "新的手工原文", item_id=original["id"])
    assert store.search({"query": "obsoleteword"})["total"] == 0
    with store.db:
        store.db.execute("DELETE FROM search_documents")
    store.rebuild_search_index()
    assert store.search({"query": "全新星光"})["total"] == 1
    root = store.root
    store.close()
    reopened = Store(root)
    try:
        current = reopened.get(original["id"])
        assert current["supplements"][0]["citations"][0]["text"] == "原文快照"
        reopened.maintain_supplement(
            {"knowledge_id": original["id"], "id": supplement["id"], "version": current["version"]},
            True,
        )
        assert reopened.search({"query": "全新星光"})["total"] == 0
        assert reopened.get(original["id"])["content"] == "新的手工原文"
    finally:
        reopened.close()


# 同名不同主题并存，规范化主题去重；目标变更、删除与事务故障都不能半套写入。
def test_identity_stale_target_and_rollback(store):
    item = store.capture_topic(draft(theme="API", title="连接"))
    other = store.capture_topic(draft("other", theme="电路", title="连接"))
    assert item["id"] != other["id"]
    same = store.capture_topic(draft("normalized", theme="ＡＰＩ", title="连 接"))
    assert same["id"] == item["id"]
    stale = draft("stale", target=item, content="新补充")
    store.save("连接", "手工编辑后版本已变", item_id=item["id"])
    with pytest.raises(ValueError, match="已被修改"):
        store.capture_topic(stale)
    fresh = draft("failure", target=store.get(item["id"]), content="故障补充")
    store.db.execute("""CREATE TRIGGER fail_receipt BEFORE INSERT ON capture_receipts
        BEGIN SELECT RAISE(ABORT,'fixture failure'); END""")
    with pytest.raises(sqlite3.IntegrityError, match="fixture failure"):
        store.capture_topic(fresh)
    assert store.get(item["id"])["supplements"] == []
    assert store.search({"query": "故障补充"})["total"] == 0
    store.db.execute("DROP TRIGGER fail_receipt")
    store.delete_knowledge(item["id"])
    with pytest.raises(ValueError, match="不存在"):
        store.capture_topic(fresh)
    assert store.get(other["id"])["id"] == other["id"]


# 无 FTS5 时仍扫描完整普通索引，更新后不返回旧词；资料删除清理源命中。
def test_scan_fallback_and_source_deletion(store):
    item = store.save("本地索引", "fallbacktoken 全文回退词")
    if store.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone():
        for event in ("insert", "update", "delete"):
            store.db.execute("DROP TRIGGER search_" + event)
        store.db.execute("DROP TABLE search_fts")
    assert store.search({"query": "fallbacktoken"})["items"][0]["knowledge_id"] == item["id"]
    store.save("本地索引", "freshword 已编辑正文", item_id=item["id"])
    assert not store.search({"query": "fallbacktoken"})["items"]
    store.insert_source(
        {
            "id": "s",
            "name": "来源",
            "blocks": [{"id": "b", "locator": "第1段", "text": "freshword"}],
            "warnings": [],
        },
        "s.txt",
    )
    assert store.search({"query": "freshword"})["total"] == 2
    store.remove_source("s")
    assert store.search({"query": "freshword"})["total"] == 1
    store.delete_knowledge(item["id"])
    assert store.search({"query": "freshword"})["total"] == 0


# 拒绝无效类型和范围，SQL 和 FTS 特殊字符不能改变查询语义。
@pytest.mark.parametrize(
    "params",
    [
        {"query": None},
        {"query": []},
        {"query": ""},
        {"query": "test", "page": True},
        {"query": "test", "page": -1},
    ],
)
def test_search_validation(store, params):
    with pytest.raises(ValueError):
        store.search(params)
