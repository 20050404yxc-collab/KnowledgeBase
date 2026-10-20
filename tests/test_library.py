# 文件：test_library.py
# 层：验证
# 作用：保护全库分层、重构快照、确认边界及原子保存。
# 说明：临时 SQLite 和合成模型，不读取正式数据或凭据。
import asyncio
import json
import shutil
import sqlite3

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.library_rules import inventory_version, validate_assignments
from knowledge_agent.entrypoints.dispatch import dispatch
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault, config
from test_topics_store import draft as supplement_draft


class LibraryClient:
    # 每次调用保存实际发送的数据，便于检查片段和权限覆盖。
    def __init__(self):
        self.calls = []
        self.invalid = False
        self.gate = None

    # 三种生成目的独立响应，模拟暂停不会修改已有知识。
    async def generate(self, _config, prompt, purpose, _emit):
        value = json.loads(prompt)
        self.calls.append((purpose, value))
        if self.gate:
            await self.gate.wait()
        if purpose == "library-summary":
            return json.dumps({"summary": "概念与限定条件"})
        if purpose == "library-outline":
            return json.dumps(
                {
                    "assignments": []
                    if self.invalid
                    else [
                        {
                            "id": item["id"],
                            "category": "计算机",
                            "subcategory": "基础",
                            "reason": "根据概念分类",
                        }
                        for item in value["items"]
                    ]
                }
            )
        if purpose == "library-duplicates":
            return json.dumps(
                {
                    "kind": "related",
                    "reason": "不同主题，不合并",
                    "overlap": [],
                    "unique": [],
                    "conflict": [],
                }
            )
        return json.dumps({"content": "整理后的知识 " + value["id"], "reason": "整理结构"})


# 每个流程只持有自己的模型、目录草案和数据库连接。
@pytest.fixture
def library(tmp_path):
    service = create_service(tmp_path / "data", vault=Vault())
    config(service)
    service.client = LibraryClient()
    yield service
    service.close()


# 使用真实路由验证新参数没有被旧字符串 path 校验误拒绝。
def call(service, operation, params=None):
    return asyncio.run(dispatch(service, operation, params or {}, lambda _: None))


# 逐阶段推进，在界面确认目录前不触发内容整理。
def outline(service):
    value = call(service, "library.restructure.plan")
    while value["status"] == "planning":
        value = call(service, "library.restructure.plan", {**value, "advance": True})
    return value


# 模拟用户确认目录，全部建议仍是草案，没有正式保存。
def ready(service, value):
    while value["status"] in ("outline", "preparing"):
        value = call(service, "library.restructure.prepare", value)
    return value


# 旧手工条目、超过 200 条的分区和全部叶子分页都必须完整，目录读取不计使用。
def test_tree_complete_filter_paging_and_legacy(library):
    store = library.store
    ids = []
    for i in range(215):
        item = store.save(
            f"事务{i:03}", f"各自的完整内容{i}", classification_path=("计算机", "数据库")
        )
        store.set_bucket(item["id"], "常用" if i < 210 else "归档")
        ids.append(item["id"])
    manual = store.save("旧手工条目", "旧笔记保留")
    store.set_bucket(manual["id"], "在学")
    store.capture_topic(supplement_draft(target=manual, content="稀有补充星河"))
    assert call(library, "knowledge.tree")["total"] == 216
    for bucket, count in [("常用", 210), ("归档", 5), ("在学", 1)]:
        result = call(library, "knowledge.tree", {"bucket": bucket})
        assert result["total"] == sum(n["count"] for n in result["nodes"]) == count
    assert call(library, "knowledge.tree", {"query": "星河"})["total"] == 1
    assert call(library, "knowledge.tree", {"query": "数据库"})["total"] == 215
    assert (
        call(library, "knowledge.tree", {"bucket": "在学"})["nodes"][0]["label"] == "未分类／待整理"
    )
    found, cursor = [], ""
    while True:
        page = call(
            library,
            "knowledge.tree",
            {"path": ["计算机", "数据库"], "bucket": "常用", "cursor": cursor},
        )
        assert page["total"] == 210 and len(page["nodes"]) <= 50
        found.extend(node["id"] for node in page["nodes"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(found) == len(set(found)) == 210
    assert set(found) == set(ids[:210])
    assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 0
    first = call(library, "knowledge.tree", {"path": ["计算机", "数据库"]})
    store.save("新插入", "新插入内容", classification_path=("计算机", "数据库"))
    with pytest.raises(ValueError, match="目录已变化"):
        call(
            library,
            "knowledge.tree",
            {"path": ["计算机", "数据库"], "cursor": first["next_cursor"]},
        )


# 拒绝非法路径、分区和游标，不把错误筛选静默当成全库查询。
@pytest.mark.parametrize(
    "params",
    [
        {"path": "a"},
        {"path": ["a", "b", "c"]},
        {"path": [3]},
        {"bucket": "other"},
        {"query": 3},
        {"cursor": False},
        {"cursor": "old:50"},
    ],
)
def test_tree_invalid_params(library, params):
    with pytest.raises(ValueError):
        call(library, "knowledge.tree", params)


# 全部正文片段和独立补充参与概览；目录覆盖完整，拒绝确认前的应用。
def test_overview_all_chunks_supplements_and_confirmation(library):
    store = library.store
    first = store.save("长笔记", "正文" * 7500 + "最后限定条件")
    store.capture_topic(supplement_draft(target=first, content="补充尾部约束"))
    for i in range(10):
        store.save(f"概念{i}", f"可复用知识{i}")
    before = inventory_version(store.library_inventory())
    value = outline(library)
    assert value["covered"] == value["classified"] == value["total"] == 11
    chunks = [v["chunk"] for purpose, v in library.client.calls if purpose == "library-summary"]
    assert any("最后限定条件" in chunk for chunk in chunks)
    assert any("补充尾部约束" in chunk for chunk in chunks)
    assert all(len(chunk) <= 7000 for chunk in chunks)
    assert not any(p == "library-content" for p, _ in library.client.calls)
    preview = call(library, "library.restructure.preview", {**value, "kind": "outline"})
    assert {p["id"] for p in preview["outline"]} == {i["id"] for i in store.library_inventory()}
    assert inventory_version(store.library_inventory()) == before
    with pytest.raises(ValueError, match="核对"):
        call(library, "library.restructure.apply", {**value, "selected": []})
    ready(library, value)
    assert inventory_version(store.library_inventory()) == before
    assert not list(store.root.glob("before-restructure-*"))


# 最后确认按勾选更新，手工和已编辑正文、全部原引用、使用日和手工分区必须保留。
def test_apply_selected_manual_protection_backup_and_idempotency(library, tmp_path):
    store = library.store
    citation = {
        "id": "b",
        "source_id": "gone",
        "name": "原文",
        "locator": "第1段",
        "text": "引用摘录",
    }
    manual = store.save("手工", "手工原文", citations=[citation])
    generated = store.save("生成", "未编辑正文", generated=True, citations=[citation])
    edited = store.save("编辑过", "最初正文", generated=True)
    store.save("编辑过", "用户修改的正文", item_id=edited["id"])
    untouched = store.save("不勾选", "保持原样", generated=True)
    store.set_bucket(manual["id"], "归档")
    store.get(manual["id"], active_use=True)
    before = store.library_inventory()
    value = ready(library, outline(library))
    suggestions = library.library.draft["suggestions"]
    assert {s["mode"] for s in suggestions if s["id"] in (manual["id"], edited["id"])} == {"append"}
    params = {**value, "selected": [manual["id"], generated["id"], edited["id"]]}
    receipt = call(library, "library.restructure.apply", params)
    assert call(library, "library.restructure.apply", params) == receipt
    assert store.get(manual["id"])["content"] == "手工原文"
    assert store.get(edited["id"])["content"] == "用户修改的正文"
    assert store.get(untouched["id"])["content"] == "保持原样"
    updated = store.get(generated["id"])
    assert generated["content"] in updated["content"]
    assert "整理后的知识" not in updated["content"]
    assert updated["citations"][0]["text"] == "引用摘录"
    current = store.get(manual["id"])
    assert current["bucket"] == "归档" and len(current["supplements"]) == 1
    assert current["supplements"][0]["citations"][0]["text"] == "引用摘录"
    assert len(store.library_inventory()) == receipt["count"] == 4
    assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 1
    assert all("整理后的知识" not in part["content"] for part in current["supplements"])
    restored_dir = tmp_path / "restored"
    restored_dir.mkdir()
    shutil.copyfile(store.root / receipt["backup"], restored_dir / "knowledge.sqlite3")
    with sqlite3.connect(store.root / receipt["backup"]) as backup:
        assert (
            backup.execute("SELECT content FROM knowledge WHERE id=?", (manual["id"],)).fetchone()[
                0
            ]
            == "手工原文"
        )
        assert backup.execute("SELECT count(*) FROM topic_links").fetchone()[0] == 0
    restored = Store(restored_dir)
    try:
        assert inventory_version(restored.library_inventory()) == inventory_version(before)
        assert restored.search({"query": "手工原文"})["total"] == 1
    finally:
        restored.close()
    assert len(before) == 4


# 草案期间的新增、正文编辑、删除和补充变化必须阻止旧快照覆盖新内容。
@pytest.mark.parametrize("change", ["new", "edit", "delete", "supplement"])
def test_stale_snapshot_rejected(library, change):
    store = library.store
    item = store.save("原知识", "原内容")
    value = ready(library, outline(library))
    if change == "new":
        store.save("新增", "新内容")
    elif change == "edit":
        store.save(item["title"], "新编辑", item_id=item["id"])
    elif change == "delete":
        store.delete_knowledge(item["id"])
    else:
        store.capture_topic(supplement_draft(target=item))
    snapshot = inventory_version(store.library_inventory())
    with pytest.raises(ValueError, match="已变化"):
        call(library, "library.restructure.apply", {**value, "selected": []})
    assert inventory_version(store.library_inventory()) == snapshot


# 分类或索引写入失败必须整体回滚，备份可读且没有部分分类或正文更新。
def test_transaction_failure_rolls_back(library, monkeypatch):
    store = library.store
    item = store.save("原知识", "原内容", generated=True)
    value = ready(library, outline(library))
    before = inventory_version(store.library_inventory())

    # 注入索引阶段失败，验证前面的分类和正文写入同样撤回。
    def fail():
        raise sqlite3.OperationalError("synthetic index failure")

    monkeypatch.setattr(store, "populate_library_index", fail)
    with pytest.raises(sqlite3.OperationalError):
        call(library, "library.restructure.apply", {**value, "selected": [item["id"]]})
    assert inventory_version(store.library_inventory()) == before
    assert store.search({"query": "原内容"})["total"] == 1
    assert store.db.execute("SELECT count(*) FROM topic_links").fetchone()[0] == 0
    assert len(list(store.root.glob("before-restructure-*.sqlite3"))) == 1


# 模型取消不提交当前阶段；丢弃或旧修订不允许迟到结果复活草案。
def test_cancel_stage_discard_and_revision(library):
    library.store.save("知识", "完整原内容")
    value = call(library, "library.restructure.plan")
    before = inventory_version(library.store.library_inventory())

    # 只取消合成等待，不向真实模型发送请求。
    async def scenario():
        library.client.gate = asyncio.Event()
        task = asyncio.create_task(
            dispatch(
                library, "library.restructure.plan", {**value, "advance": True}, lambda _: None
            )
        )
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert library.library.summary()["covered"] == 0
        library.client.gate = None

    asyncio.run(scenario())
    with pytest.raises(ValueError, match="失效"):
        call(library, "library.restructure.prepare", {**value, "revision": "stale"})
    call(library, "library.restructure.discard", value)
    assert library.library.draft is None
    assert inventory_version(library.store.library_inventory()) == before


# 缺失、重复、伪造 ID 的目录不能变成部分重构。
@pytest.mark.parametrize("ids", [[], ["a", "a"], ["a", "unknown"]])
def test_outline_exact_id_coverage(ids):
    text = json.dumps(
        {
            "assignments": [
                {"id": i, "category": "大", "subcategory": "小", "reason": "归类"} for i in ids
            ]
        }
    )
    with pytest.raises(ValueError):
        validate_assignments(text, [{"id": "a"}, {"id": "b"}])


# 三个分区各自超过旧列表上限时仍有完整聚合和全部叶子，不能只修总库。
@pytest.mark.parametrize("bucket", ["常用", "在学", "归档"])
def test_each_large_bucket_complete(library, bucket):
    store = library.store
    for i in range(205):
        item = store.save(
            f"{bucket}知识{i}", f"{bucket}正文{i}", classification_path=("大类", "小类")
        )
        store.set_bucket(item["id"], bucket)
    assert store.library_tree({"bucket": bucket})["total"] == 205
    cursor, ids = "", []
    while True:
        result = store.library_tree({"bucket": bucket, "path": ["大类", "小类"], "cursor": cursor})
        ids.extend(row["id"] for row in result["nodes"])
        cursor = result["next_cursor"]
        if not cursor:
            break
    assert len(set(ids)) == 205
    assert all(store.get(item_id)["bucket"] == bucket for item_id in ids)


# 重规划必须使旧确认失效；仅目录提交不能顺带接受正文建议。
def test_replan_and_directory_only(library):
    original = library.store.save("原题", "原始完整正文", generated=True)
    first = outline(library)
    second = call(library, "library.restructure.plan", {**first, "feedback": "重新核对目录"})
    assert second["revision"] != first["revision"]
    with pytest.raises(ValueError, match="失效"):
        call(library, "library.restructure.prepare", first)
    while second["status"] == "planning":
        second = call(library, "library.restructure.plan", {**second, "advance": True})
    value = ready(library, second)
    call(library, "library.restructure.apply", {**value, "selected": []})
    current = library.store.get(original["id"])
    assert current["content"] == original["content"]
    assert not current["supplements"] and current["category"] == "计算机"


# 丢弃发生在模型等待中时，迟到结果不能复活旧草案或触碰正式库。
def test_discard_inflight_result(library):
    library.store.save("知识", "完整原内容")
    value = call(library, "library.restructure.plan")
    before = inventory_version(library.store.library_inventory())

    # 有界事件控制模型返回顺序，不使用真实网络。
    async def scenario():
        library.client.gate = asyncio.Event()
        task = asyncio.create_task(
            dispatch(
                library, "library.restructure.plan", {**value, "advance": True}, lambda _: None
            )
        )
        await asyncio.sleep(0)
        await library.library.discard(value)
        library.client.gate.set()
        with pytest.raises((ValueError, asyncio.CancelledError)):
            await task

    asyncio.run(scenario())
    assert library.library.draft is None
    assert inventory_version(library.store.library_inventory()) == before


# 最后写事务前收到取消时不生成恢复点或正式分类，避免动画停了但仍写库。
def test_apply_checkpoint_cancellation(library):
    library.store.save("知识", "完整原内容")
    value = ready(library, outline(library))
    before = inventory_version(library.store.library_inventory())

    # 在 apply 首个让出点取消真正的执行协程。
    async def scenario():
        task = asyncio.create_task(library.library.apply({**value, "selected": []}))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert inventory_version(library.store.library_inventory()) == before
    assert not list(library.store.root.glob("before-restructure-*"))
