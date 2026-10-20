# 文件：test_model_settings.py
# 层：验证
# 作用：验证接口编辑、模型覆盖与推理参数的行为边界。
# 说明：仅使用隔离数据库、内存凭据和模拟 HTTP。
import asyncio
import json

import httpx
import pytest
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.bootstrap import create_client, create_service
from knowledge_agent.domain.provider_rules import resolve_generation
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault
from test_providers import parameters, sse


# 编辑必须保留 ID、启用状态和未重新输入的凭据，默认变化使旧价格失效。
def test_edit_preserves_identity_key_and_catalog(tmp_path):
    store, vault = Store(tmp_path), Vault()
    try:
        original = save_provider(
            store, vault, parameters() | {"models": ["fixture-model", "other"]}
        )[0]
        edited = save_provider(
            store,
            vault,
            parameters() | {"id": original["id"], "name": "edited", "key": "", "model": "other"},
        )[0]
        assert edited["id"] == original["id"] and edited["active"]
        assert edited["models"] == ["fixture-model", "other"]
        assert vault.get(edited["id"]) == parameters()["key"]
        assert edited["input_price"] is None and edited["output_price"] is None
        assert parameters()["key"] not in json.dumps(edited)
        store.delete_provider(edited["id"])
        with pytest.raises(ValueError, match="删除"):
            save_provider(store, vault, parameters() | {"id": edited["id"]})
    finally:
        store.close()


# 配置允许空目录和默认值，真正需要生成时才拒绝，并保留精确知识复用。
def test_no_default_fails_before_http_and_reuse_still_works(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    try:
        config = save_provider(
            service.store, service.vault, parameters() | {"model": "", "models": []}
        )[0]
        with pytest.raises(ValueError, match="请选择模型"):
            asyncio.run(service.test_provider({"id": config["id"]}, lambda _: None))
        with pytest.raises(ValueError, match="请选择模型"):
            asyncio.run(service.question({"query": "全新问题"}, lambda _: None))
        service.store.save("已有知识", "已经手工核对的正文。")
        result = asyncio.run(service.question({"query": "已有知识"}, lambda _: None))
        assert "未调用模型" in result["notice"]
        assert not service.store.list_attempts()
    finally:
        service.close()


# 强度在 HTTP 中按协议编码；覆盖模型使用真实模型记账且不套用默认单价。
@pytest.mark.parametrize("protocol", ["responses", "chat-completions"])
@pytest.mark.parametrize("effort", ["auto", "low", "medium", "high"])
def test_override_and_effort_wire_payload(tmp_path, protocol, effort):
    store, vault = Store(tmp_path), Vault()
    try:
        config = save_provider(
            store, vault, parameters(protocol) | {"models": ["fixture-model", "other"]}
        )[0]
        captured = []

        # 检查真实序列化请求并提供最小完整流，不触网。
        def handler(request):
            captured.append(json.loads(request.content))
            if protocol == "responses":
                events = [
                    {"type": "response.output_text.delta", "delta": "OK"},
                    {
                        "type": "response.completed",
                        "response": {"usage": {"input_tokens": 10, "output_tokens": 2}},
                    },
                ]
            else:
                events = [
                    {
                        "choices": [{"delta": {"content": "OK"}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 10, "completion_tokens": 2},
                    }
                ]
            return httpx.Response(200, content=sse(events))

        resolved = resolve_generation(config, {"model": "other", "reasoning_effort": effort})
        client = create_client(store, vault, httpx.MockTransport(handler))
        asyncio.run(client.generate(resolved, "test", "connection-test", lambda _: None, test=True))
        payload = captured[0]
        assert payload["model"] == "other"
        if effort == "auto":
            assert "reasoning" not in payload and "reasoning_effort" not in payload
        elif protocol == "responses":
            assert payload["reasoning"] == {"effort": effort}
        else:
            assert payload["reasoning_effort"] == effort
        attempt = dict(store.db.execute("SELECT * FROM attempts").fetchone())
        assert attempt["model"] == "other" and attempt["input_tokens"] == 10
        assert attempt["cost"] is None and attempt["input_price"] is None
        assert store.provider()["model"] == "fixture-model"
    finally:
        store.close()


# 非目录模型、错误类型和未适配的 Anthropic 强度必须在发出请求前失败。
@pytest.mark.parametrize(
    "options",
    [
        {"model": "unknown"},
        {"model": False},
        {"reasoning_effort": "max"},
        {"reasoning_effort": "high"},
    ],
)
def test_invalid_generation_selection(options):
    config = parameters("anthropic") | {"models": ["fixture-model"]}
    with pytest.raises(ValueError):
        resolve_generation(config, options)


# 等待同问题锁时修改默认模型，不得悄悄改变已经接收的请求。
def test_waiting_question_uses_received_config_snapshot(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    config = save_provider(
        service.store, service.vault, parameters() | {"models": ["fixture-model", "other"]}
    )[0]
    captured = []

    class Client:
        # 返回完整学习内容，记录应用实际传下来的模型配置。
        async def generate(self, value, *_args):
            captured.append(value)
            return json.dumps({"title": "快照结果", "content": "完整知识正文", "citation_ids": []})

    service.client = Client()

    # 外部持锁使请求确实进入等待，再修改已保存配置。
    async def scenario():
        async with service.questions.locks.acquire("快照问题:knowledge:"):
            task = asyncio.create_task(service.question({"query": "快照问题"}, lambda _: None))
            await asyncio.sleep(0)
            save_provider(
                service.store, service.vault, parameters() | {"id": config["id"], "model": "other"}
            )
        return await task

    try:
        answer = asyncio.run(scenario())
        assert captured[0]["model"] == "fixture-model"
        assert answer["knowledge"]["model"] == "fixture-model"
        assert service.store.provider()["model"] == "other"
    finally:
        service.close()
