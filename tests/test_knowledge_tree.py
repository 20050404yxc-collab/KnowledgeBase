# 文件：test_knowledge_tree.py
# 层：验证
# 作用：保护多层路径、父节点正文、旧库兼容和重构确认边界。
# 说明：仅使用临时数据与合成模型，正式库及付费接口不参与。
import asyncio
import json

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.library_rules import inventory_version, validate_collisions
from knowledge_agent.domain.taxonomy import classification, encode_path
from knowledge_agent.domain.topic_review import review_points
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault, config
from test_library import LibraryClient, call, outline, ready
from test_library_questions import ClassifiedClient
from test_topics_store import draft
from test_topics_workflow import Client, learn, plan

PARENTS = ["编程语言", "C++", "STL", "容器", "vector"]


# 标点和路径分段参与分类身份，不能把 C++ 与 C# 或含分隔符的路径混为一类。
def test_path_identity_and_versions(tmp_path):
    items = [{"id": "a", "title": "基础"}, {"id": "b", "title": "基础"}]
    assignments = [
        {"id": "a", "category_path": ["编程语言", "C++"]},
        {"id": "b", "category_path": ["编程语言", "C#"]},
    ]
    validate_collisions(assignments, items)
    decisions = [
        {**a, "decision": "keep", "reason": "独立语言", "project_required": False}
        for a in assignments
    ]
    assert len(review_points(json.dumps({"decisions": decisions}), items)[0]) == 2
    store = Store(tmp_path)
    try:
        a = {
            "id": "a",
            "title": "知识",
            "content": "正文",
            "theme": "a／b／c",
            "category_path": ["a／b", "c"],
        }
        b = {**a, "category_path": ["a", "b／c"]}
        assert inventory_version([a]) != inventory_version([b])
        assert store.topic_version(a) != store.topic_version(b)
    finally:
        store.close()


# 旧主题显示别名重合时，两个同名正文以及共同后代都必须可达。
def test_legacy_display_alias_does_not_hide_bodies(tmp_path):
    store = Store(tmp_path)
    try:
        a = store.capture_topic(draft("a", title="概览", theme="未分类", content="旧正文甲"))
        b = store.capture_topic(draft("b", title="概览", theme="未细分", content="旧正文乙"))
        path = ["未分类／待整理", "未细分"]
        store.save("后代", "后代正文", classification_path=path + ["概览"])
        result = store.library_tree({"path": path})
        assert {n["id"] for n in result["nodes"] if n["id"]} == {a["id"], b["id"]}
        assert sum(n["count"] for n in result["nodes"]) == result["total"] == 3
        current = store.library_tree({"path": path + ["概览"]})
        assert not current["content_id"]
        assert len(current["nodes"]) == 3
    finally:
        store.close()


# 同一标题在不同完整位置独立保存，重启保留旧编码、深层正文与补充。
def test_deep_identity_restart_and_legacy(tmp_path):
    store = Store(tmp_path)
    old = store.save("旧分类", "旧正文", classification_path=("编程语言", "C++"))
    a = store.save("扩容机制", "正文甲", classification_path=PARENTS)
    b = store.save("扩容机制", "正文乙", classification_path=PARENTS[:-1] + ["deque"])
    assert a["id"] != b["id"]
    assert {hit["knowledge_id"] for hit in store.search({"query": "容器"})["items"]} == {
        a["id"],
        b["id"],
    }
    store.capture_topic(draft(target=a, content="独立补充"))
    assert store.save("扩容机制", "不能覆盖", classification_path=PARENTS)["id"] == a["id"]
    old_theme = store.db.execute(
        "SELECT theme FROM topic_links WHERE knowledge_id=?", (old["id"],)
    ).fetchone()[0]
    assert old_theme == encode_path("编程语言", "C++")
    store.close()
    store = Store(tmp_path)
    try:
        saved = store.get(a["id"])
        assert saved["category_path"] == PARENTS and saved["content"] == "正文甲"
        assert saved["supplements"][0]["content"] == "独立补充"
        assert {hit["knowledge_id"] for hit in store.search({"query": "容器"})["items"]} == {
            a["id"],
            b["id"],
        }
        store.rebuild_search_index()
        assert {hit["knowledge_id"] for hit in store.search({"query": "容器"})["items"]} == {
            a["id"],
            b["id"],
        }
        assert store.search({"query": "扩容机制"})["items"][0]["category_path"] in [
            PARENTS,
            PARENTS[:-1] + ["deque"],
        ]
        assert store.get(old["id"])["category_path"] == ["编程语言", "C++"]
        assert classification("语言/C++/旧主题") == {"theme": "语言/C++/旧主题"}
    finally:
        store.close()


# 同层正文、可读分支、深层后代和频率过滤必须同时正确，查询目录不计使用日。
def test_tree_internal_body_mixed_nodes_and_filtering(tmp_path):
    store = Store(tmp_path)
    try:
        overview = store.save("STL", "STL概述", classification_path=PARENTS[:2])
        container = store.save("容器", "容器概述", classification_path=PARENTS[:3])
        leaf = store.save("STL注意事项", "普通知识", classification_path=PARENTS[:3])
        deep = store.save("扩容机制", "尾部稀有标记", classification_path=PARENTS)
        store.set_bucket(overview["id"], "常用")
        store.set_bucket(deep["id"], "归档")
        branch = store.library_tree({"path": PARENTS[:3]})
        assert branch["content_id"] == overview["id"] and branch["total"] == 4
        nodes = {n["label"]: n for n in branch["nodes"]}
        assert nodes["容器"]["id"] == container["id"] and nodes["容器"]["children"]
        assert nodes["STL注意事项"]["id"] == leaf["id"] and not nodes["STL注意事项"]["children"]
        assert sum(n["count"] for n in nodes.values()) + 1 == branch["total"]
        for depth in range(len(PARENTS) + 1):
            result = store.library_tree({"path": PARENTS[:depth], "bucket": "归档"})
            assert result["total"] == 1 and result["content_id"] == ""
        only_body = store.library_tree({"path": PARENTS[:3], "bucket": "常用"})
        assert only_body["content_id"] == overview["id"] and not only_body["nodes"]
        searched = store.library_tree({"query": "尾部稀有标记", "path": PARENTS[:3]})
        assert searched["content_id"] == "" and searched["total"] == 1
        assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 0
    finally:
        store.close()


# 深层分支分页不能漏掉同层知识，游标不得跨筛选或路径重用。
def test_deep_paging_and_cursor_scope(tmp_path):
    store = Store(tmp_path)
    try:
        for i in range(53):
            store.save(f"知识{i:02}", f"正文{i}", classification_path=PARENTS)
        first = store.library_tree({"path": PARENTS})
        second = store.library_tree({"path": PARENTS, "cursor": first["next_cursor"]})
        ids = [n["id"] for n in first["nodes"] + second["nodes"]]
        assert len(ids) == len(set(ids)) == 53
        with pytest.raises(ValueError, match="目录已变化"):
            store.library_tree({"path": PARENTS[:-1], "cursor": first["next_cursor"]})
    finally:
        store.close()


# 非法显式路径必须拒绝，不能因旧两级字段有效而悄悄截断保存。
@pytest.mark.parametrize("path", [None, [], [""], [" "], [3], ["a"] * 65, ["a" * 81]])
def test_invalid_explicit_path_no_commit(tmp_path, path):
    store = Store(tmp_path)
    try:
        point = {"id": "p", "title": "知识", "theme": "主题"}
        raw = {
            "id": "p",
            "decision": "keep",
            "reason": "可复用",
            "project_required": False,
            "category": "语言",
            "subcategory": "C++",
            "category_path": path,
        }
        with pytest.raises(ValueError):
            review_points(json.dumps({"decisions": [raw]}), [point])
        assert not store.library_inventory()
    finally:
        store.close()


class DeepQuestionClient(ClassifiedClient):
    # 直接问答仅替换分类输出，资格和证据检查沿用真实流程。
    async def generate(self, config, prompt, purpose, emit):
        raw = json.loads(await super().generate(config, prompt, purpose, emit))
        if purpose != "question-review":
            raw["category_path"] = PARENTS
        return json.dumps(raw)


# 普通问答及推荐拓展都保存完整路径，不只在探索目录中支持深层。
@pytest.mark.parametrize("purpose", ["question", "expansion"])
def test_question_full_path(tmp_path, purpose):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = DeepQuestionClient()
    try:
        answer = asyncio.run(
            service.question({"query": "对象生命周期", "purpose": purpose}, lambda _: None)
        )
        assert answer["knowledge"]["category_path"] == PARENTS
    finally:
        service.close()


class DeepTopicClient(Client):
    # 只改独立审核的路径，验证后续单点生成使用审核后的完整归属。
    async def generate(self, config, prompt, purpose, emit):
        raw = json.loads(await super().generate(config, prompt, purpose, emit))
        if purpose == "topic-review":
            for decision in raw["decisions"]:
                decision["category_path"] = PARENTS
        return json.dumps(raw)


# 规划、独立审核和单点收录贯通，不将深层字段遗失在会话或主题编码处。
def test_exploration_full_path(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = DeepTopicClient()
    try:
        directory = asyncio.run(plan(service))
        assert directory["points"][0]["category_path"] == PARENTS
        answer = asyncio.run(learn(service, directory))
        assert answer["knowledge"]["category_path"] == PARENTS
    finally:
        service.close()


class DeepLibraryClient(LibraryClient):
    # 不同目标的末级分类不同，不能只按前两级发起语义合并。
    async def generate(self, config, prompt, purpose, emit):
        raw = json.loads(await super().generate(config, prompt, purpose, emit))
        if purpose == "library-outline":
            for item in raw["assignments"]:
                item["category_path"] = PARENTS + [item["id"][:8]]
        return json.dumps(raw)


# 整理预览、人工路径修订、正文准备和原子应用均保留完整位置及原文。
def test_restructure_deep_review_prepare_apply(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = DeepLibraryClient()
    a = service.store.save("知识甲", "手工原文甲")
    service.store.save("知识乙", "手工原文乙")
    try:
        value = outline(service)
        assert not any(p == "library-group" for p, _ in service.client.calls)
        preview = call(service, "library.restructure.preview", {**value, "kind": "outline"})
        assert all(p["category_path"][:5] == PARENTS for p in preview["outline"])
        review = {
            "action": "point",
            "id": a["id"],
            "title": a["title"],
            "category_path": ["编程语言"],
        }
        value = call(service, "library.restructure.plan", {**value, "review": review})
        old_revision = value["revision"]
        with pytest.raises(ValueError):
            call(
                service,
                "library.restructure.plan",
                {**value, "review": {**review, "category_path": []}},
            )
        assert service.library.summary()["revision"] == old_revision
        value = ready(service, value)
        call(service, "library.restructure.apply", {**value, "selected": []})
        assert service.store.get(a["id"])["category_path"] == ["编程语言"]
        assert service.store.get(a["id"])["content"] == "手工原文甲"
        b = next(item for item in service.store.library_inventory() if item["id"] != a["id"])
        assert b["category_path"][:5] == PARENTS
    finally:
        service.close()
