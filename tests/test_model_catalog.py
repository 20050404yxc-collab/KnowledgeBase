# 文件：test_model_catalog.py
# 层：验证
# 作用：验证模型发现的认证、分页、边界及取消。
# 说明：模拟远端响应，不访问正式服务或凭据。
import asyncio
import json

import httpx
import pytest
from knowledge_agent.application.model_catalog import discover_models
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.domain.provider_rules import validate_provider
from knowledge_agent.infrastructure.model_catalog import ModelCatalog
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault
from test_providers import parameters


# 三种协议使用草稿地址和正确认证，自动去重并追踪固定端点游标。
@pytest.mark.parametrize("protocol", ["responses", "chat-completions", "anthropic"])
def test_discovery_auth_pagination_and_no_persistence(tmp_path, protocol):
    store, vault = Store(tmp_path), Vault()
    try:
        config = save_provider(store, vault, parameters(protocol))[0]
        before = store.providers()
        requests = []

        # 响应中的任意链接不允许改变下页地址或泄漏认证。
        def handler(request):
            requests.append(request)
            assert request.method == "GET" and request.url.path == "/draft/models"
            if protocol == "anthropic":
                assert request.headers["x-api-key"] == "draft-secret"
                assert "authorization" not in request.headers
            else:
                assert request.headers["authorization"] == "Bearer draft-secret"
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "m1"}, {"id": "m2" if len(requests) > 1 else "m1"}],
                    "has_more": len(requests) == 1,
                    "last_id": "m1",
                    "next": "https://untrusted.test/steal",
                },
            )

        reader = ModelCatalog(httpx.MockTransport(handler))
        draft = {
            "id": config["id"],
            "protocol": protocol,
            "base_url": "https://example.test/draft",
            "key": "draft-secret",
        }
        result = asyncio.run(discover_models(store, vault, reader, draft))
        assert result == {"models": ["m1", "m2"], "partial": False}
        cursor_key = "after_id" if protocol == "anthropic" else "after"
        assert requests[1].url.params[cursor_key] == "m1"
        assert store.providers() == before and not store.list_attempts()
        assert vault.get(config["id"]) == parameters()["key"]
    finally:
        store.close()


# 留空复用指定配置的密钥，不接受已删除配置，也不要求草稿默认模型。
def test_discovery_saved_secret(tmp_path):
    store, vault = Store(tmp_path), Vault()
    try:
        config = save_provider(store, vault, parameters())[0]

        class Reader:
            # 只确认收到保存密钥，返回目录不写数据库。
            async def list_models(self, draft, secret):
                assert secret == parameters()["key"] and draft["model"] == ""
                return {"models": [], "partial": False}

        draft = parameters() | {"id": config["id"], "key": "", "model": None}
        assert asyncio.run(discover_models(store, vault, Reader(), draft))["models"] == []
        store.delete_provider(config["id"])
        with pytest.raises(ValueError, match="不存在"):
            asyncio.run(discover_models(store, vault, Reader(), draft))
    finally:
        store.close()


# 异常响应不展示私密正文，重定向也不允许认证跨域。
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, text="secret-sensitive-body"),
        httpx.Response(302, headers={"location": "https://untrusted.test/models"}),
        httpx.Response(200, text="secret-sensitive-body"),
        httpx.Response(200, json={"data": [{"id": None}]}),
        httpx.Response(200, json={"data": [], "has_more": "yes"}),
        httpx.Response(200, json={"data": [], "has_more": True}),
        httpx.Response(200, content=b"x" * 1_000_001),
    ],
)
def test_discovery_invalid_response_is_redacted(response):
    calls = []

    # 每种错误只能请求一次，不能跟随远端跳转。
    def handler(request):
        calls.append(request)
        return response

    reader = ModelCatalog(httpx.MockTransport(handler))
    with pytest.raises(ValueError) as caught:
        asyncio.run(reader.list_models(validate_provider(parameters()), "synthetic-secret"))
    assert "secret-sensitive-body" not in str(caught.value) and len(calls) == 1


# 十页后明确部分结果，游标重复则失败；不能陷入无限发现。
@pytest.mark.parametrize("repeat", [False, True])
def test_discovery_pagination_bound(repeat):
    count = 0

    # 每次生成不同或故意重复的游标。
    def handler(_request):
        nonlocal count
        count += 1
        model = "same" if repeat else str(count)
        return httpx.Response(200, json={"data": [{"id": model}], "has_more": True})

    reader = ModelCatalog(httpx.MockTransport(handler))
    task = reader.list_models(validate_provider(parameters()), "synthetic-secret")
    if repeat:
        with pytest.raises(ValueError, match="分页"):
            asyncio.run(task)
        assert count == 2
    else:
        result = asyncio.run(task)
        assert result["partial"] and len(result["models"]) == count == 10


# 网络发现取消能够传播并释放响应流，不把部分目录当成功。
def test_discovery_cancellation_closes_stream():
    closed = []
    started = asyncio.Event()

    class Stream(httpx.AsyncByteStream):
        # 不完整 JSON 模拟远端长等待。
        async def __aiter__(self):
            yield json.dumps({"data": []}).encode()
            started.set()
            await asyncio.Event().wait()

        # 取消必须调用关闭方法。
        async def aclose(self):
            closed.append(True)

    # 确认进入流读取后取消，避免计时依赖。
    async def scenario():
        reader = ModelCatalog(httpx.MockTransport(lambda _: httpx.Response(200, stream=Stream())))
        task = asyncio.create_task(
            reader.list_models(validate_provider(parameters()), "synthetic-secret")
        )
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert closed == [True]
