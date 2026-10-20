# 文件：test_restructure_analysis.py
# 层：验证
# 作用：保护双代理独占覆盖、失败保留、取消等待和有界预览。
# 说明：只使用临时库和可控模型，不访问正式凭据。
import asyncio
import json

import pytest
from knowledge_agent.application.generation_context import ATTEMPT_OBSERVER
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.library_rules import inventory_version
from test_knowledge import Vault, config
from test_library import LibraryClient, call


class AnalysisClient(LibraryClient):
    # 记录最大在途数和开始／完成，故障只发生在明确的一路。
    def __init__(self):
        super().__init__()
        self.running = 0
        self.maximum = 0
        self.fail_agent = None
        self.entered = []
        self.exited = []

    # 人工调度交错证明成功片段保存，取消 finally 真正结束两路。
    async def generate(self, config, prompt, purpose, emit):
        value = json.loads(prompt)
        if purpose != "library-summary":
            return await super().generate(config, prompt, purpose, emit)
        self.calls.append((purpose, value))
        self.running += 1
        self.maximum = max(self.maximum, self.running)
        self.entered.append(value["id"])
        observer = ATTEMPT_OBSERVER.get()
        if observer:
            observer("attempt:" + value["call_id"])
        try:
            await asyncio.sleep(0)
            if self.gate:
                await self.gate.wait()
            if value["agent"] == self.fail_agent:
                return json.dumps({"summary": "x" * 1601})
            return json.dumps({"summary": f"片段{value['part']}的限定条件"})
        finally:
            self.running -= 1
            self.exited.append(value["id"])


# 每个测试使用独立模型和会话，不共享成功覆盖记录。
@pytest.fixture
def analysis(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = AnalysisClient()
    yield service
    service.close()


# 奇数库存、长文和补充必须被两端代理恰好一次覆盖；不能重复领取中心来源。
def test_two_workers_odd_inventory_complete_chunks(analysis):
    for index in range(13):
        analysis.store.save(f"来源{index}", str(index) + "独有" * (4000 if index % 2 else 10))
    value = call(analysis, "library.restructure.plan")
    while value["status"] == "planning":
        value = call(analysis, "library.restructure.plan", {**value, "advance": True})
    assert value["status"] == "outline" and value["covered"] == 13
    assert analysis.client.maximum == 2 and analysis.client.running == 0
    records = analysis.library.draft["records"]
    assert records[0]["agent"] == "A" and records[-1]["agent"] == "B"
    calls = [body for purpose, body in analysis.client.calls if purpose == "library-summary"]
    keys = [(value["id"], value["locator"]) for value in calls]
    assert len(keys) == len(set(keys)) == sum(len(record["chunks"]) for record in records)
    assert max(len(value["chunk"]) for value in calls) <= 7000
    for record in records:
        assert record["status"] == "complete"
        assert all(part["attempt_ids"] for part in record["chunks"])


# 一路超长输出不能抹掉另一路成功块，显式重试只处理失败和未完成来源。
def test_failure_preserves_other_worker_and_retry_only_incomplete(analysis):
    for index in range(3):
        analysis.store.save(f"知识{index}", f"完整原文{index}")
    value = call(analysis, "library.restructure.plan")
    analysis.client.fail_agent = "A"
    paused = call(analysis, "library.restructure.plan", {**value, "advance": True})
    assert paused["status"] == "paused" and paused["covered"] == 1
    assert "1600" in paused["errors"][0]
    successful = next(
        record for record in analysis.library.draft["records"] if record["status"] == "complete"
    )
    count = len(analysis.client.calls)
    assert call(analysis, "library.restructure.plan", {**paused, "advance": True}) == paused
    assert len(analysis.client.calls) == count
    analysis.client.fail_agent = None
    value = call(analysis, "library.restructure.plan", {**paused, "advance": True, "retry": True})
    while value["status"] == "planning":
        value = call(analysis, "library.restructure.plan", {**value, "advance": True})
    assert value["covered"] == 3
    assert sum(body.get("id") == successful["source_id"] for _, body in analysis.client.calls) == 1
    preview = call(analysis, "library.restructure.preview", {**value, "kind": "records"})
    assert len(preview["records"]) == 1 and preview["summary"]["covered"] == 3


# 丢弃必须等待两路 finally 收束，不能残留任务或由迟到输出复活。
def test_discard_joins_both_workers(analysis):
    for index in range(2):
        analysis.store.save(f"取消知识{index}", f"不会修改{index}")
    value = call(analysis, "library.restructure.plan")
    before = inventory_version(analysis.store.library_inventory())

    # 事件精准卡住两路模型，避免靠固定时间推测进入状态。
    async def scenario():
        analysis.client.gate = asyncio.Event()
        task = asyncio.create_task(analysis.library.advance(value, lambda _: None))
        for _ in range(10):
            if len(analysis.client.entered) == 2:
                break
            await asyncio.sleep(0)
        assert analysis.client.running == 2
        await analysis.library.discard(value)
        assert analysis.client.running == 0 and len(analysis.client.exited) == 2
        with pytest.raises((asyncio.CancelledError, ValueError)):
            await task
        assert analysis.library.draft is None

    asyncio.run(scenario())
    assert inventory_version(analysis.store.library_inventory()) == before


# 完整来源稿超过边界必须保持未完成，不可静默裁剪尾部后显示 ready。
def test_oversize_extraction_remains_incomplete(analysis):
    analysis.store.save("长文", "x" * 21000)
    value = call(analysis, "library.restructure.plan")
    while value["status"] == "planning":
        value = call(analysis, "library.restructure.plan", {**value, "advance": True})
    value = call(analysis, "library.restructure.prepare", value)
    assert value["status"] == "paused" and value["prepared"] == 0
    assert "未截断" in value["errors"][0]
    assert not analysis.library.draft["suggestions"]
