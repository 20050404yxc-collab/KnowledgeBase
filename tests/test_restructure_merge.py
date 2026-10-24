# 文件：test_restructure_merge.py
# 层：验证
# 作用：保护逐组合并、来源可追溯、事务回滚和旧标识解析。
# 说明：完整走真实协议与 SQLite，仅模型响应为合成数据。
import json
import sqlite3

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.library_rules import inventory_version
from knowledge_agent.infrastructure.sqlite_store import Store
from legacy_database import downgrade_memory
from test_knowledge import Vault, config
from test_library import LibraryClient, call, outline, ready
from test_topics_store import draft as supplement_draft


class MergeClient(LibraryClient):
    # 每对引文逐字取自当前输入；可切换为冲突，验证不能合并的组类型。
    def __init__(self):
        super().__init__()
        self.kind = "partial-overlap"

    # 双路摘要、目录及模型补充沿用隔离模拟，重复核验返回可验证定位。
    async def generate(self, config, prompt, purpose, emit):
        if purpose != "library-duplicates":
            return await super().generate(config, prompt, purpose, emit)
        value = json.loads(prompt)
        self.calls.append((purpose, value))
        quotes = [
            {"source_id": part["source_id"], "locator": part["locator"], "quote": part["text"][:30]}
            for part in (value["left"], value["right"])
        ]
        return json.dumps(
            {
                "kind": self.kind,
                "reason": "逐字引文核验",
                "overlap": quotes if self.kind != "conflict" else [],
                "unique": quotes,
                "conflict": quotes if self.kind == "conflict" else [],
            }
        )


# 创建两条相同标题不同来源，含不同尾段及编辑补充，不靠相同正文自动复用。
@pytest.fixture
def merge_case(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = MergeClient()
    store = service.store
    first = store.capture_topic(
        supplement_draft(
            "a",
            title="重复主题",
            content="共同概念\n" + "甲" * 7050 + "\n仅限甲条件",
            theme="甲领域",
        )
    )
    second = store.capture_topic(
        supplement_draft(
            "b",
            title="重复主题",
            content="共同概念\n" + "乙" * 7050 + "\n仅限乙条件",
            theme="乙领域",
        )
    )
    store.capture_topic(
        supplement_draft("s", target=first, title="手工补充", content="补充中独有的限制")
    )
    supplement = store.get(first["id"])["supplements"][0]
    store.maintain_supplement(
        {
            "knowledge_id": first["id"],
            "id": supplement["id"],
            "version": store.get(first["id"])["version"],
            "title": "手工补充",
            "content": "编辑过的补充限制",
        }
    )
    yield service, first, second
    service.close()


# 结构决定显式包含保留点、位置和分区，与内容接受分开。
def approve_merge(service, first, second):
    value = outline(service)
    assert value["covered"] == 2 and value["undecided"] == 1
    group = service.library.draft["duplicates"][0]
    return call(
        service,
        "library.restructure.plan",
        {
            **value,
            "review": {
                "action": "decision",
                "id": group["id"],
                "decision": "merge",
                "target_id": first["id"],
                "title": "合并后主题",
                "category": "全局",
                "subcategory": "概念",
                "manual_bucket": "在学",
            },
        },
    )


# 合并整体接受，独有尾段／编辑补充／引用保留，旧链接和全文检索解析为保留点。
def test_merge_preserves_sources_restart_old_ids_search_and_uses(merge_case):
    service, first, second = merge_case
    store = service.store
    store.get(first["id"], active_use=True)
    store.get(second["id"], active_use=True)
    value = ready(service, approve_merge(service, first, second))
    assert value["status"] == "ready" and value["target_count"] == 1
    proposals = service.library.draft["suggestions"]
    extraction = next(p for p in proposals if p["id"] == first["id"])
    assert all(
        text in extraction["content"] for text in ("仅限甲条件", "仅限乙条件", "编辑过的补充限制")
    )
    assert extraction["provenance"] and "## 重新组织" in extraction["content"]
    with pytest.raises(ValueError, match="完整原文整理稿"):
        call(service, "library.restructure.apply", {**value, "selected": []})
    receipt = call(service, "library.restructure.apply", {**value, "selected": [first["id"]]})
    assert receipt["source_count"] == 2 and receipt["target_count"] == receipt["groups"] == 1
    assert (
        call(service, "library.restructure.apply", {**value, "selected": [first["id"]]}) == receipt
    )
    assert store.get(second["id"])["id"] == first["id"]
    assert len(store.list_knowledge()) == store.library_tree({})["total"] == 1
    assert store.search({"query": "仅限乙条件"})["items"][0]["knowledge_id"] == first["id"]
    assert store.search({"query": "仅限乙条件"})["total"] == 1
    assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 2
    with pytest.raises(ValueError, match="已合并组"):
        store.delete_knowledge(second["id"])
    reopened = Store(store.root)
    try:
        current = reopened.get(second["id"])
        assert current["id"] == first["id"] and current["manual_bucket"] == "在学"
        assert reopened.raw_knowledge(second["id"])["content"] == second["content"]
        original = next(s for s in current["original_sources"] if s["source_id"] == second["id"])
        parts = [
            reopened.get_original(first["id"], {**original, "page": page})
            for page in range(original["chunks"])
        ]
        assert all(part["read_only"] for part in parts)
        assert "仅限乙条件" in "".join(part["content"] for part in parts)
        assert len(reopened.library_inventory()) == 2
        assert any(item["archived_evidence"] for item in reopened.library_inventory())
        reopened.rebuild_search_index()
        assert reopened.search({"query": "仅限乙条件"})["total"] == 1
    finally:
        reopened.close()


# 索引失败必须同时回滚映射、原文快照、补充、目录和正文，不能留下半组合并。
def test_merge_transaction_fault_rolls_back_all_state(merge_case, monkeypatch):
    service, first, second = merge_case
    value = ready(service, approve_merge(service, first, second))
    before = inventory_version(service.store.library_inventory())

    # 在最后派生索引阶段拒绝写入，覆盖所有先前合并写入的回滚。
    def fail():
        raise sqlite3.OperationalError("isolated index failure")

    monkeypatch.setattr(service.store, "populate_library_index", fail)
    with pytest.raises(sqlite3.OperationalError):
        call(service, "library.restructure.apply", {**value, "selected": [first["id"]]})
    assert inventory_version(service.store.library_inventory()) == before
    for table in ("knowledge_merges", "restructure_originals", "restructure_provenance"):
        assert service.store.db.execute("SELECT count(*) FROM " + table).fetchone()[0] == 0
    assert service.store.get(second["id"])["id"] == second["id"]


# 确认前不核验全文；确认后的冲突退回结构审核，不能自动重确认或写库。
def test_decisions_conflict_and_revision_invalidation(merge_case):
    service, first, second = merge_case
    service.client.kind = "conflict"
    value = approve_merge(service, first, second)
    assert not any(p == "library-duplicates" for p, _ in service.client.calls)
    value = ready(service, value)
    assert value["status"] == "outline" and value["prepared"] == 0
    assert service.library.draft["approved"] is None
    assert not any(p == "library-content" for p, _ in service.client.calls)
    assert service.store.get(second["id"])["id"] == second["id"]
    group = service.library.draft["duplicates"][0]
    assert group["kind"] == "conflict"
    with pytest.raises(ValueError, match="不能合并"):
        call(
            service,
            "library.restructure.plan",
            {
                **value,
                "review": {
                    "action": "decision",
                    "id": group["id"],
                    "decision": "merge",
                    "target_id": first["id"],
                },
            },
        )
    kept = call(
        service,
        "library.restructure.plan",
        {**value, "review": {"action": "decision", "id": group["id"], "decision": "keep"}},
    )
    with pytest.raises(ValueError, match="失效"):
        call(service, "library.restructure.prepare", value)
    changed = call(
        service,
        "library.restructure.plan",
        {
            **kept,
            "review": {
                "action": "point",
                "id": second["id"],
                "title": "保留不同主题",
                "category": "其他",
                "subcategory": "独立",
            },
        },
    )
    prepared = ready(service, changed)
    assert prepared["status"] == "ready" and prepared["target_count"] == 2
    revision = call(
        service,
        "library.restructure.plan",
        {
            **prepared,
            "review": {
                "action": "point",
                "id": first["id"],
                "title": "独立甲",
                "category": "甲",
                "subcategory": "类",
            },
        },
    )
    assert revision["suggestions"] == revision["prepared"] == 0 and revision["status"] == "outline"
    with pytest.raises(ValueError, match="失效"):
        call(service, "library.restructure.apply", {**prepared, "selected": []})


# 手工分区变更使内容决策快照过期，而单纯使用日变化不使其过期。
def test_snapshot_tracks_bucket_but_not_use_days(merge_case):
    service, first, second = merge_case
    value = ready(service, approve_merge(service, first, second))
    service.store.get(first["id"], active_use=True)
    assert inventory_version(service.store.library_inventory()) == service.library.draft["snapshot"]
    service.store.set_bucket(second["id"], "归档")
    with pytest.raises(ValueError, match="已变化"):
        call(service, "library.restructure.apply", {**value, "selected": [first["id"]]})


# 后续模型价格升级不能覆盖已提交的合并映射、只读原文或知识索引。
def test_price_upgrade_retains_existing_merge_group(merge_case):
    service, first, second = merge_case
    value = ready(service, approve_merge(service, first, second))
    call(service, "library.restructure.apply", {**value, "selected": [first["id"]]})
    store = service.store
    store.db.execute("DROP TABLE provider_model_prices")
    store.db.execute("DROP TABLE knowledge_trash")
    downgrade_memory(store)
    store.db.execute("PRAGMA user_version=4")
    store.db.commit()
    reopened = Store(store.root)
    try:
        assert reopened.db.execute("PRAGMA user_version").fetchone()[0] == 7
        current = reopened.get(second["id"])
        assert current["id"] == first["id"] and current["original_sources"]
        assert reopened.search({"query": "仅限乙条件"})["total"] == 1
        assert reopened.provider()["model_prices"] == []
    finally:
        reopened.close()
