# 文件：test_topic_review_contract.py
# 层：验证
# 作用：保护逐项审核完整性、输入隔离、失败回退和取消边界。
# 说明：合成模型及临时库，不访问网络、正式知识或系统凭据。
import asyncio
import json

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.topic_review import review_points
from knowledge_agent.domain.validation_errors import ReviewValidationError
from review_fixtures import approved_points
from test_knowledge import Vault, config
from test_topics_workflow import Client, plan


# 本文件独占临时服务及生成器，失败或取消后也关闭数据库和资料副本。
@pytest.fixture
def service(tmp_path):
    value = create_service(tmp_path, vault=Vault())
    value.client = Client()
    try:
        yield value
    finally:
        value.close()


# 漏项或标识不匹配均不能创建会话，不可自动补判为保留或排除。
@pytest.mark.parametrize(
    ("fault", "message"),
    [
        ("missing", "未返回要求的逐项审核列表"),
        ("type", "未返回要求的逐项审核列表"),
        ("short", "应有 2 项，返回 1 项"),
        ("extra", "应有 2 项，返回 3 项"),
        ("duplicate", "缺少 1 项、重复 1 项、范围外 0 项"),
        ("foreign", "缺少 1 项、重复 0 项、范围外 1 项"),
    ],
)
def test_invalid_review_preserves_local_results_without_retry(service, fault, message):
    config(service)
    note = service.store.save("重连退避", "本地手工内容")
    original = service.client.generate

    # 模拟传输成功但结构错误，审核次数保持一次并检查目标不与库内候选混淆。
    async def generate(settings, prompt, purpose, emit):
        text = await original(settings, prompt, purpose, emit)
        if purpose != "topic-review":
            return text
        payload = json.loads(prompt)
        assert "candidates" not in payload and "explicit_points" not in payload
        assert note["id"] not in payload["expected_ids"]
        assert payload["expected_count"] == len(payload["points"]) == 2
        rows = json.loads(text)["decisions"]
        if fault == "missing":
            return "{}"
        if fault == "type":
            return '{"decisions":{}}'
        if fault == "short":
            rows.pop()
        elif fault == "extra":
            rows.append(dict(rows[0]))
        elif fault == "duplicate":
            rows[1]["id"] = rows[0]["id"]
        else:
            rows[1]["id"] = note["id"]
        return json.dumps({"decisions": rows})

    service.client.generate = generate
    result = asyncio.run(plan(service))
    assert message in result["notice"] and "本地结果保留" in result["notice"]
    assert not result["plan_id"] and not result["points"] and not service.topics.sessions
    assert result["search"]["items"][0]["knowledge_id"] == note["id"]
    assert len(service.store.list_knowledge()) == 1
    assert [call[2] for call in service.client.calls] == ["topic-plan", "topic-review"]


# 保留、排除、待澄清必须都返回，响应顺序改变不影响完整覆盖和分类结果。
def test_mixed_review_decisions_cover_all_targets():
    points = [
        {"id": str(i), "title": f"知识{i}", "theme": "网络", "facet": "方法"} for i in range(3)
    ]
    rows = json.loads(approved_points(points))["decisions"]
    rows[1]["decision"], rows[2]["decision"] = "exclude", "clarify"
    accepted, rejected = review_points(json.dumps({"decisions": rows[::-1]}), points)
    assert [p["id"] for p in accepted] == ["0"]
    assert {p["decision"] for p in rejected} == {"exclude", "clarify"}
    assert accepted[0]["category_path"] == ["网络", "通用方法"]


# 连续拆解的输出格式必须跟随新的目录 ID，不能复用上一次的枚举或污染持久配置。
def test_review_schema_tracks_each_request_snapshot(service):
    config(service)
    first = asyncio.run(plan(service))
    second = asyncio.run(plan(service))
    calls = [call for call in service.client.calls if call[2] == "topic-review"]
    for result, (settings, payload, _) in zip((first, second), calls, strict=True):
        rows = settings["_output_schema"]["properties"]["decisions"]
        ids = [point["id"] for point in result["points"]]
        assert rows["minItems"] == rows["maxItems"] == len(ids) == 2
        assert rows["items"]["properties"]["id"]["enum"] == payload["expected_ids"] == ids
    assert set(calls[0][1]["expected_ids"]).isdisjoint(calls[1][1]["expected_ids"])
    assert "_output_schema" not in service.store.provider()


# 同数量的错误 ID 不能以数量相等绕过校验，统计只含总数不含原始标识。
def test_id_mismatch_keeps_only_safe_diagnostic_counts():
    points = [{"id": "private-target", "theme": "网络", "title": "退避"}]
    rows = json.loads(approved_points(points))["decisions"]
    rows[0]["id"] = "private-foreign-id"
    with pytest.raises(ReviewValidationError) as caught:
        review_points(json.dumps({"decisions": rows}), points)
    assert caught.value.rule == "id_mismatch"
    assert caught.value.missing_count == caught.value.unknown_count == 1
    assert "private-" not in str(vars(caught.value))


# 没有候选时不产生第二次模型调用，合法空目录不能被空枚举结构误拦截。
def test_empty_plan_skips_review_call(service):
    config(service)
    calls = []

    # 零候选应直接结束，若仍调用审核则立即暴露回归。
    async def generate(_settings, _prompt, purpose, _emit):
        calls.append(purpose)
        assert purpose == "topic-plan"
        return '{"points":[]}'

    service.client.generate = generate
    result = asyncio.run(plan(service))
    assert result["plan_id"] and not result["points"]
    assert result["notice"].startswith("没有合格的可学习知识点")
    assert calls == ["topic-plan"]


# 审核网络等待取消必须传播，不能变成普通回退或留下可以学习的会话。
def test_cancel_review_does_not_create_session(service):
    config(service)
    original = Client().generate

    # 用事件精确定位审核阶段，不依赖真实网络速度或固定等待。
    async def run():
        reviewing = asyncio.Event()

        # 只有审核等待挂起，规划仍使用正常目录生成以经过真实校验。
        async def generate(settings, prompt, purpose, emit):
            if purpose == "topic-review":
                reviewing.set()
                await asyncio.Event().wait()
            return await original(settings, prompt, purpose, emit)

        service.client.generate = generate
        task = asyncio.create_task(plan(service))
        await reviewing.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not service.topics.sessions and not service.store.list_knowledge()

    asyncio.run(run())
