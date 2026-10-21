# 文件：test_restructure_limits.py
# 层：验证
# 作用：保护概览字符边界、多轮分类完整性及全文准备失败恢复。
# 说明：使用合成快照和模拟模型，不访问实际知识或网络。
import json

import pytest
from knowledge_agent.application.library_planning import assignment_payload
from knowledge_agent.domain.duplicate_rules import verification_work
from knowledge_agent.domain.restructure_evidence import (
    analysis_result,
    overview_sample,
    validate_rewrite_references,
)
from test_library import LibraryClient, call, outline, ready


# 标题、首中尾及补充参与轻量取样，已读与未读范围精确划分全部输入字符。
def test_overview_sampling_ranges_partition_input():
    short = overview_sample(
        {"content": "正文" * 3000, "supplements": [{"id": "s", "content": "补充"}]}
    )
    assert short["sampled_chars"] == short["total_chars"] == 6002 and not short["omitted"]
    item = {
        "content": "开头" + "甲" * 3000 + "\n## 中部标题\n" + "乙" * 9000 + "尾部",
        "supplements": [{"id": "s", "content": "补充开头" + "丙" * 9000 + "补充尾部"}],
    }
    value = overview_sample(item)
    assert len(value["text"]) == value["sampled_chars"] == 7000
    assert all(text in value["text"] for text in ("开头", "中部标题", "尾部", "补充尾部"))
    assert value["omitted"] and value["total_chars"] > 7000
    ranges = [entry.rsplit(":", 2) for entry in value["sampled"] + value["omitted"]]
    assert sum(int(end) - int(start) for _, start, end in ranges) == value["total_chars"]


# 原引用不能因正文重组而失去链接；保留标记不表示引文事实已经被证明。
def test_rewrite_keeps_existing_citation_marker():
    validate_rewrite_references("结论 [source]", "## 重组\n结论 [source]", [{"id": "source"}])
    with pytest.raises(ValueError, match="引用标记"):
        validate_rewrite_references("结论 [source]", "结论", [{"id": "source"}])


# 空白和标点计入 2400 上限，边界内不截断，边界外不自动接受。
@pytest.mark.parametrize("size", [2399, 2400, 2401])
def test_summary_limit_counts_whitespace(size):
    summary = "字" * (size - 2) + " \n"
    if size > 2400:
        with pytest.raises(ValueError):
            analysis_result(json.dumps({"summary": summary}), set())
    else:
        assert (
            analysis_result(json.dumps({"summary": summary}), set())["summary"] == summary.strip()
        )


# 历史来源概览和超长词表全部分轮参与，不能预算超限后只留下主来源。
def test_assignment_budget_consumes_all_overviews_and_paths():
    items = [
        {"id": str(i), "canonical_id": "0", "title": "知识", "theme": "旧分类"} for i in range(40)
    ]
    draft = {
        "items": items,
        "summaries": {i["id"]: "概览" * 1200 for i in items},
        "outline": [{"category": str(i) + "大" * 60, "subcategory": "小" * 80} for i in range(200)],
        "feedback": "用户意见",
    }
    state = {"source": 0, "path": 0, "choice": None}
    sources, paths = [], []
    while state["source"] < len(items) or state["path"] < len(draft["outline"]):
        payload, source_end, path_end = assignment_payload(draft, items[0], state)
        assert len(payload) <= 26000 and (source_end, path_end) != (state["source"], state["path"])
        value = json.loads(payload)
        sources.extend(p["source_id"] for p in value["additional_overviews"])
        paths.extend(value["existing_paths"])
        state.update(source=source_end, path=path_end, choice={"category": "综合分类"})
    assert sources == [i["id"] for i in items] and len(paths) == 200


# 拟合并核验包括已有合并组的隐藏历史成员，不能用保留点正文冒充全部来源。
def test_verification_covers_prior_merged_members():
    items = [
        {"id": key, "canonical_id": canonical, "content": text}
        for key, canonical, text in [
            ("a", "a", "当前正文"),
            ("b", "a", "隐藏独有约束"),
            ("c", "c", "新来源"),
        ]
    ]
    work = verification_work({"sources": ["a", "c"]}, items)
    assert any(a["text"] == "隐藏独有约束" and b["text"] == "新来源" for a, b in work)
    assert all(a["source_id"] == "a" and b["source_id"] == "c" for a, b in work)


# 片段失败保留成功部分供显式重试；准备中间态不可应用，不产生恢复点或正式修改。
def test_preparation_failure_retries_only_failed_chunk(tmp_path):
    from knowledge_agent.bootstrap import create_service
    from test_knowledge import Vault, config

    service = create_service(tmp_path, vault=Vault())
    config(service)
    client = LibraryClient()
    service.client = client
    item = service.store.save("长知识", "完整信息" * 5000, generated=True)
    generate = client.generate

    # 只拒绝第二块，第一块由真实模拟生成器完成。
    async def fail_second(configuration, prompt, purpose, emit):
        if purpose == "library-content" and json.loads(prompt)["part"] == 2:
            raise ValueError("synthetic generation failure")
        return await generate(configuration, prompt, purpose, emit)

    try:
        value = outline(service)
        client.generate = fail_second
        value = ready(service, value)
        assert value["status"] == "paused" and not service.library.draft["suggestions"]
        assert service.library.draft["preparation"]["index"] == 1
        with pytest.raises(ValueError, match="核对"):
            call(service, "library.restructure.apply", {**value, "selected": []})
        assert service.store.get(item["id"])["content"] == item["content"]
        client.generate = generate
        value = call(service, "library.restructure.prepare", {**value, "retry": True})
        while value["status"] == "preparing":
            value = call(service, "library.restructure.prepare", value)
        assert value["status"] == "ready"
        assert sum(p == "library-content" and v["part"] == 1 for p, v in client.calls) == 1
    finally:
        service.close()
