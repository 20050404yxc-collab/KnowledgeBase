# 文件：test_topics_wire.py
# 层：验证
# 作用：验证三种实际传输中的拆解提示、单点提示和独立记账。
# 说明：HTTP 完全模拟，不使用网络或正式凭据。
import asyncio
import json

import httpx
import pytest
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.bootstrap import create_client, create_service
from knowledge_agent.entrypoints.dispatch import dispatch
from review_fixtures import approved_points
from test_knowledge import Vault
from test_providers import parameters, sse


# 将结构化结果包成供应商协议对应的完整终态，故意不声明用量。
def response_for(protocol, text):
    if protocol == "responses":
        events = [
            {"type": "response.output_text.delta", "delta": text},
            {"type": "response.completed", "response": {}},
        ]
    elif protocol == "chat-completions":
        events = [
            {"choices": [{"delta": {"content": text}, "finish_reason": None}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        ]
    else:
        events = [
            {"type": "content_block_delta", "delta": {"text": text}},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}},
        ]
    return httpx.Response(200, content=sse(events))


# 通过用例到实际请求编码验证提示分流，计划与学习分别记账，覆盖模型不改默认配置。
@pytest.mark.parametrize("protocol", ["responses", "chat-completions", "anthropic"])
def test_topic_instructions_and_accounting(tmp_path, protocol):
    service = create_service(tmp_path, vault=Vault())
    saved = save_provider(service.store, service.vault, parameters(protocol))[0]
    bodies = []

    # 模拟依次返回知识点和正文，同时核对三个协议各自的系统提示位置。
    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        if protocol == "responses":
            instructions = body["instructions"]
        elif protocol == "anthropic":
            instructions = body["system"]
        else:
            instructions = body["messages"][0]["content"]
        if len(bodies) == 1:
            assert '"points"' in instructions
            text = json.dumps(
                {"points": [{"theme": "网络", "title": "重连退避", "facet": "失败退避"}]}
            )
        elif len(bodies) == 2:
            assert '"decisions"' in instructions
            prompt = body.get("input") or body["messages"][-1]["content"]
            text = approved_points(json.loads(prompt)["points"])
        else:
            assert "conflict" in instructions
            text = json.dumps(
                {
                    "title": "重连退避",
                    "content": "完整知识正文",
                    "citation_ids": [],
                    "conflict": False,
                }
            )
        return response_for(protocol, text)

    service.client = create_client(service.store, service.vault, httpx.MockTransport(handler))

    # 同一请求快照中有效型号独立传入模型服务，收录保留实际型号。
    async def run():
        directory = await dispatch(
            service,
            "question.plan",
            {"query": "如何进行重连退避？", "scope": "knowledge"},
            lambda _: None,
        )
        return await dispatch(
            service,
            "knowledge.learn",
            {"plan_id": directory["plan_id"], "point_id": directory["points"][0]["id"]},
            lambda _: None,
        )

    try:
        answer = asyncio.run(run())
        assert len(bodies) == 3 and all(b["model"] == saved["model"] for b in bodies)
        assert answer["knowledge"]["model"] == saved["model"]
        attempts = service.store.list_attempts()
        assert {a["purpose"] for a in attempts} == {"topic-plan", "topic-review", "topic-learn"}
        assert all(a["status"] == "success" and a["cost"] is None for a in attempts)
        assert "_instructions" not in service.store.provider()
    finally:
        service.close()
