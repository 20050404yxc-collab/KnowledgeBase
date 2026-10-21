# 文件：test_restructure_memory.py
# 层：验证
# 作用：保护意见记忆、增量调整、同义知识合并和失败恢复。
# 说明：使用临时数据库与明确的合成模型，不调用外部接口。
import copy
import json

import pytest
from knowledge_agent.application.library_grouping import grouping_payload, validate_grouping
from knowledge_agent.application.restructure_memory import FEEDBACK_MEMORY_CHARS
from knowledge_agent.domain.library_rules import inventory_version
from test_library import call, outline, ready
from test_library import library as library_fixture
from test_restructure_merge import MergeClient

# pytest 通过显式别名复用隔离库夹具，避免和测试参数遮蔽。
library = library_fixture


# 批处理不漏对或重复接受对，大量概览时按序推进且不超协议预算。
def test_group_batch_budget_and_exact_decision_coverage():
    points = {
        str(i): {"id": str(i), "title": str(i), "category": "大", "subcategory": "小"}
        for i in range(20)
    }
    pairs = [("0", str(i)) for i in range(1, 20)]
    draft = {"feedback_history": ["意见" * 2500], "summaries": {key: "字" * 2400 for key in points}}
    state = {"pairs": pairs, "index": 0}
    seen = []
    while state["index"] < len(pairs):
        payload = grouping_payload(draft, state, points)
        assert len(json.dumps(payload, ensure_ascii=False)) <= 26000
        assert 0 < len(payload["pairs"]) <= 12
        values = [
            {"left": a, "right": b, "same_knowledge": False, "reason": "独立"}
            for a, b in payload["pairs"]
        ]
        assert validate_grouping(json.dumps({"decisions": values}), payload["pairs"]) == []
        with pytest.raises(ValueError):
            validate_grouping(json.dumps({"decisions": values[:-1]}), payload["pairs"])
        with pytest.raises(ValueError):
            validate_grouping(
                json.dumps({"decisions": [values[0]] * len(values)}), payload["pairs"]
            )
        seen.extend(payload["pairs"])
        state["index"] += len(payload["pairs"])
    assert seen == pairs


class SemanticClient(MergeClient):
    # 用固定语义关系模拟不同标题的同一知识，故障只影响融合阶段。
    def __init__(self):
        super().__init__()
        self.fail_fusion = False

    # 分类、语义和正文分别响应，断言必须能观察到跨来源融合输入。
    async def generate(self, config, prompt, purpose, emit):
        value = json.loads(prompt)
        if purpose == "library-group":
            self.calls.append((purpose, value))
            titles = {item["id"]: item["title"] for item in value["items"]}
            return json.dumps(
                {
                    "decisions": [
                        {
                            "left": a,
                            "right": b,
                            "same_knowledge": {titles[a], titles[b]}
                            <= {"RAII", "资源获取即初始化"},
                            "reason": "同一资源管理机制",
                        }
                        for a, b in value["pairs"]
                    ]
                }
            )
        if purpose == "library-content" and value.get("mode") == "fuse":
            self.calls.append((purpose, value))
            if self.fail_fusion:
                raise ValueError("synthetic fusion failure")
            # 合成融合模型删除重复定义，同时保留两个输入特有的限制。
            originals = "\n".join(part["content"] for part in value["sections"])
            content = "## RAII\n共同定义只出现一次"
            for fact in ("独有构造条件", "独有异常约束"):
                if fact in originals:
                    content += "\n" + fact
            return json.dumps({"content": content, "reason": "融合定义及互补限制"})
        return await super().generate(config, prompt, purpose, emit)


# 连续意见在同一草案内累积；已有成功分析不重复计费，当前目录进入下一轮输入。
def test_feedback_keeps_draft_analysis_and_previous_outline(library):
    library.store.save("RAII", "完整定义及约束")
    first = outline(library)
    records = copy.deepcopy(library.library.draft["records"])
    old_points = copy.deepcopy(library.library.draft["outline"])
    value = call(library, "library.restructure.plan", {**first, "feedback": "大类使用编程语言"})
    assert value["draft_id"] == first["draft_id"] and value["revision"] != first["revision"]
    assert library.library.draft["outline"] == old_points
    with pytest.raises(ValueError, match="失效"):
        call(library, "library.restructure.prepare", first)
    while value["status"] == "planning":
        value = call(library, "library.restructure.plan", {**value, "advance": True})
    value = call(library, "library.restructure.plan", {**value, "feedback": "小类按语言划分"})
    while value["status"] == "planning":
        value = call(library, "library.restructure.plan", {**value, "advance": True})
    assert library.library.draft["records"] == records
    assert sum(p == "library-summary" for p, _ in library.client.calls) == 1
    payload = next(v for p, v in reversed(library.client.calls) if p == "library-outline")
    assert payload["previous_assignment"] == old_points[0]
    assert payload["feedback_history"][-2:] == ["大类使用编程语言", "小类按语言划分"]
    assert value["feedback_history"] == payload["feedback_history"]


# 模型响应的意见修订实际替换目录，后续小类意见仍携带先前大类要求。
def test_feedback_updates_visible_classification_without_forgetting_prior_opinion(library):
    library.store.save("RAII", "资源与生命周期机制")
    value = outline(library)
    generate = library.client.generate

    # 合成模型明确依据意见修改路径，用于保护输入到预览的完整链路。
    async def apply_feedback(configuration, prompt, purpose, emit):
        if purpose != "library-outline":
            return await generate(configuration, prompt, purpose, emit)
        payload = json.loads(prompt)
        history = payload["feedback_history"]
        return json.dumps(
            {
                "assignments": [
                    {
                        "id": payload["items"][0]["id"],
                        "category": "编程语言" if "大类改成编程语言" in history else "原分类",
                        "subcategory": "C++" if "小类使用C++" in history else "待细分",
                        "reason": "应用当前意见并保留之前意见",
                    }
                ]
            }
        )

    library.client.generate = apply_feedback
    for opinion in ("大类改成编程语言", "小类使用C++"):
        value = call(library, "library.restructure.plan", {**value, "feedback": opinion})
        while value["status"] == "planning":
            value = call(library, "library.restructure.plan", {**value, "advance": True})
    preview = call(library, "library.restructure.preview", {**value, "kind": "outline"})
    assert preview["outline"][0]["category"] == "编程语言"
    assert preview["outline"][0]["subcategory"] == "C++"


# 意见导致的目录修订失败时仍可查看原方案，显式恢复不重复读取来源。
def test_failed_revision_preserves_visible_outline(library):
    library.store.save("知识", "完整内容")
    first = outline(library)
    original = copy.deepcopy(library.library.draft["outline"])
    value = call(library, "library.restructure.plan", {**first, "feedback": "调整分类"})
    library.client.invalid = True
    paused = call(library, "library.restructure.plan", {**value, "advance": True})
    assert paused["status"] == "paused" and paused["covered"] == 1
    preview = call(library, "library.restructure.preview", {**paused, "kind": "outline"})
    assert preview["outline"] == original
    library.client.invalid = False
    value = call(library, "library.restructure.plan", {**paused, "advance": True, "retry": True})
    while value["status"] == "planning":
        value = call(library, "library.restructure.plan", {**value, "advance": True})
    assert value["status"] == "outline"
    assert sum(p == "library-summary" for p, _ in library.client.calls) == 1


# 不同标题的同义知识主动提出合并；同小类的异常处理独立，保存后只剩一个同义保留点。
def test_semantic_merge_fuses_content_and_keeps_related_point(library):
    library.client = SemanticClient()
    first = library.store.save("RAII", "重复定义\n独有构造条件", generated=True)
    second = library.store.save("资源获取即初始化", "重复定义\n独有异常约束", generated=True)
    unrelated = library.store.save("异常处理", "不同的异常处理机制", generated=True)
    before = inventory_version(library.store.library_inventory())
    value = outline(library)
    groups = [g for g in library.library.draft["duplicates"] if g["decision"] == "merge"]
    assert len(groups) == 1 and set(groups[0]["sources"]) == {first["id"], second["id"]}
    assert not any(p == "library-duplicates" for p, _ in library.client.calls)
    value = ready(library, value)
    target = groups[0]["target_id"]
    suggestion = next(s for s in library.library.draft["suggestions"] if s["id"] == target)
    assert suggestion["content"].count("共同定义只出现一次") == 1
    assert all(fact in suggestion["content"] for fact in ("独有构造条件", "独有异常约束"))
    batch = next(
        v for p, v in library.client.calls if p == "library-content" and v["mode"] == "fuse"
    )
    assert {p["source_id"] for p in batch["sections"]} == {first["id"], second["id"]}
    assert inventory_version(library.store.library_inventory()) == before
    call(library, "library.restructure.apply", {**value, "selected": [target]})
    assert library.store.get(second["id"])["id"] == target
    assert library.store.get(unrelated["id"])["id"] == unrelated["id"]
    assert len(library.store.list_knowledge()) == 2


# 融合失败保留全部分片整理结果，重试只融合，不把拼接稿当完成结果。
def test_fusion_failure_resume_keeps_rewrite_results(library):
    library.client = SemanticClient()
    library.store.save("RAII", "重复定义\n独有构造条件", generated=True)
    library.store.save("资源获取即初始化", "重复定义\n独有异常约束", generated=True)
    value = outline(library)
    library.client.fail_fusion = True
    value = ready(library, value)
    assert value["status"] == "paused" and value["suggestions"] == 0
    count = sum(p == "library-content" and v["mode"] == "rewrite" for p, v in library.client.calls)
    library.client.fail_fusion = False
    value = call(library, "library.restructure.prepare", {**value, "retry": True})
    assert value["status"] == "ready"
    assert (
        sum(p == "library-content" and v["mode"] == "rewrite" for p, v in library.client.calls)
        == count
    )


# 只改一条的结构后，另一个已完成目标不重复生成；旧修订仍不得提交。
def test_point_edit_reuses_unaffected_prepared_target(library):
    first = library.store.save("甲", "内容甲", generated=True)
    second = library.store.save("乙", "内容乙", generated=True)
    value = ready(library, outline(library))
    value = call(
        library,
        "library.restructure.plan",
        {
            **value,
            "review": {
                "action": "point",
                "id": first["id"],
                "title": "新甲",
                "category": "新大类",
                "subcategory": "新小类",
            },
        },
    )
    value = ready(library, value)
    assert value["status"] == "ready" and value["suggestions"] == 2
    calls = [v for p, v in library.client.calls if p == "library-content"]
    assert sum(v["id"] == second["id"] for v in calls) == 1
    assert sum(v["id"] == first["id"] for v in calls) == 2


# 意见容量和来源变化在修改修订前拒绝，不能损坏仍可读的草案。
def test_memory_budget_and_changed_library_leave_draft_untouched(library):
    library.store.save("知识", "完整正文")
    value = outline(library)
    draft = library.library.draft
    draft["feedback_history"] = ["字" * FEEDBACK_MEMORY_CHARS]
    before = copy.deepcopy(draft)
    with pytest.raises(ValueError, match="记忆已满"):
        call(library, "library.restructure.plan", {**value, "feedback": "新意见"})
    assert draft == before
    library.store.save("新知识", "完整新正文")
    with pytest.raises(ValueError, match="知识库已变化"):
        call(library, "library.restructure.plan", {**value, "feedback": "新意见"})
    assert draft == before


# 手工明确保留的知识对不能在下一轮意见调整时被自动合并。
def test_explicit_keep_survives_feedback_revision(library):
    library.client = SemanticClient()
    library.store.save("RAII", "定义和构造条件")
    library.store.save("资源获取即初始化", "定义和异常约束")
    value = outline(library)
    group = library.library.draft["duplicates"][0]
    value = call(
        library,
        "library.restructure.plan",
        {**value, "review": {"action": "decision", "id": group["id"], "decision": "keep"}},
    )
    value = call(library, "library.restructure.plan", {**value, "feedback": "目录更简洁"})
    while value["status"] == "planning":
        value = call(library, "library.restructure.plan", {**value, "advance": True})
    assert not any(g["decision"] == "merge" for g in library.library.draft["duplicates"])
    assert library.library.draft["duplicates"][0]["id"] == group["id"]
