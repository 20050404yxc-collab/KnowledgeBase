# 文件：test_providers.py
# 层：验证
# 作用：验证对应业务和资源边界。
# 说明：使用隔离资源，不代表正式接口验收。
import asyncio
import json
import sys
import uuid

import httpx
import pytest
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.bootstrap import create_client
from knowledge_agent.domain.answer_validation import validate_answer
from knowledge_agent.domain.provider_rules import validate_provider
from knowledge_agent.infrastructure.secret_vault import SecretVault
from knowledge_agent.infrastructure.sqlite_store import Store
from test_knowledge import Vault


# 构造不指向真实供应商的模拟配置。
def parameters(protocol="responses"):
    return {
        "name": "fixture",
        "protocol": protocol,
        "base_url": "https://example.test/v1",
        "model": "fixture-model",
        "key": "secret-fixture-only",
        "currency": "USD",
        "input_price": 1.0,
        "output_price": 2.0,
    }


# 按真实 data 帧格式编码模拟事件，不访问网络。
def sse(events):
    return "".join("data: " + json.dumps(e) + "\n\n" for e in events).encode()


# 验证三种流协议、用量、价格快照和凭据隔离。
@pytest.mark.parametrize("protocol", ["responses", "chat-completions", "anthropic"])
def test_wire_adapters_stream_usage_and_price_snapshot(tmp_path, protocol):
    store, vault = Store(tmp_path), Vault()
    config = save_provider(store, vault, parameters(protocol))[0]
    captured = []

    # 模拟供应商响应并核对实际发送的请求。
    def handler(request):
        captured.append(request)
        if protocol == "responses":
            assert request.url.path == "/v1/responses"
            events = [
                {"type": "response.output_text.delta", "delta": "完整正文"},
                {
                    "type": "response.completed",
                    "response": {"usage": {"input_tokens": 100, "output_tokens": 20}},
                },
            ]
        elif protocol == "chat-completions":
            assert request.url.path == "/v1/chat/completions"
            events = [
                {"choices": [{"delta": {"content": "完整正文"}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                {"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 20}},
            ]
        else:
            assert request.url.path == "/v1/messages"
            events = [
                {"type": "message_start", "message": {"usage": {"input_tokens": 100}}},
                {"type": "content_block_delta", "delta": {"text": "完整正文"}},
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn"},
                    "usage": {"output_tokens": 20},
                },
            ]
        return httpx.Response(200, content=sse(events))

    client = create_client(store, vault, httpx.MockTransport(handler))
    events = []
    output = asyncio.run(client.generate(config, "question", "test", events.append))
    assert output == "完整正文"
    assert events[0]["delta"] == output
    attempt = dict(store.db.execute("SELECT * FROM attempts").fetchone())
    assert attempt["status"] == "success"
    assert attempt["input_tokens"] == 100 and attempt["output_tokens"] == 20
    assert attempt["cost"] == pytest.approx(0.00014)
    assert attempt["input_price"] == 1.0
    assert "secret-fixture-only" not in json.dumps(store.providers())
    assert "secret-fixture-only" not in json.dumps(attempt)
    store.close()


# 验证用量缺失保持未知且密钥不进入数据库。
def test_missing_usage_unknown_and_credential_not_in_database(tmp_path):
    store, vault = Store(tmp_path), Vault()
    config = save_provider(store, vault, parameters())[0]
    client = create_client(
        store,
        vault,
        httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                content=sse(
                    [
                        {"type": "response.output_text.delta", "delta": "OK"},
                        {"type": "response.completed", "response": {}},
                    ]
                ),
            )
        ),
    )
    asyncio.run(client.generate(config, "test", "test", lambda _: None))
    attempt = store.db.execute("SELECT * FROM attempts").fetchone()
    assert attempt["input_tokens"] is None and attempt["cost"] is None
    store.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    assert b"secret-fixture-only" not in (tmp_path / "knowledge.sqlite3").read_bytes()
    store.close()


# 验证 HTTP 失败逐次记账并隐藏供应商错误正文。
def test_failure_redacts_provider_body_and_attempt_count(tmp_path):
    store, vault = Store(tmp_path), Vault()
    config = save_provider(store, vault, parameters())[0]
    client = create_client(
        store,
        vault,
        httpx.MockTransport(
            lambda _: httpx.Response(401, text="secret-fixture-only sensitive error body")
        ),
    )
    for _ in range(2):
        with pytest.raises(ValueError, match="HTTP 401") as caught:
            asyncio.run(client.generate(config, "test", "test", lambda _: None))
        assert "secret-fixture-only" not in str(caught.value)
    assert (
        store.db.execute("SELECT COUNT(*) FROM attempts WHERE status='failed'").fetchone()[0] == 2
    )
    store.close()


# 验证截断流不得被记录为成功。
def test_truncated_response_not_success(tmp_path):
    store, vault = Store(tmp_path), Vault()
    config = save_provider(store, vault, parameters())[0]
    client = create_client(
        store,
        vault,
        httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                content=sse(
                    [
                        {"type": "response.output_text.delta", "delta": "partial"},
                        {"type": "response.incomplete"},
                    ]
                ),
            )
        ),
    )
    with pytest.raises(ValueError, match="未完整结束"):
        asyncio.run(client.generate(config, "test", "test", lambda _: None))
    assert store.db.execute("SELECT status FROM attempts").fetchone()[0] == "failed"
    store.close()


# 验证网络取消也结算调用记录。
def test_cancelled_network_attempt_is_recorded(tmp_path):
    store, vault = Store(tmp_path), Vault()
    config = save_provider(store, vault, parameters())[0]

    class BlockingStream(httpx.AsyncByteStream):
        # 先发送片段再等待取消，模拟未结束的网络流。
        async def __aiter__(self):
            yield sse([{"type": "response.output_text.delta", "delta": "partial"}])
            await asyncio.sleep(30)

    client = create_client(
        store, vault, httpx.MockTransport(lambda _: httpx.Response(200, stream=BlockingStream()))
    )

    # 执行可取消的异步测试场景并验证终态。
    async def scenario():
        task = asyncio.create_task(client.generate(config, "test", "test", lambda _: None))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    row = store.db.execute("SELECT * FROM attempts").fetchone()
    assert row["status"] == "cancelled" and row["input_tokens"] is None and row["cost"] is None
    store.close()


# 验证非 HTTPS 远程地址和携带凭据的 URL 被拒绝。
@pytest.mark.parametrize(
    "url",
    [
        "http://remote.example/v1",
        "https://user:pass@example.com",
        "https://example.com?key=secret",
        "ftp://example.com",
    ],
)
def test_invalid_endpoints(url):
    with pytest.raises(ValueError):
        validate_provider(parameters() | {"base_url": url})


# 验证严格范围缺失引用和未知引用均失败。
def test_strict_missing_or_unknown_citations():
    with pytest.raises(ValueError, match="缺少"):
        validate_answer(
            json.dumps({"title": "标题", "content": "完整内容", "citation_ids": []}), [], True
        )
    with pytest.raises(ValueError, match="不存在"):
        validate_answer(
            json.dumps({"title": "标题", "content": "完整内容", "citation_ids": ["fake"]}),
            [],
            False,
        )


# 使用唯一合成凭据验证 Windows 写读删，不读取正式配置。
@pytest.mark.skipif(sys.platform != "win32", reason="Windows Credential Manager is required")
def test_actual_windows_credential_roundtrip():
    vault, config_id = SecretVault(), "fixture-" + str(uuid.uuid4())
    try:
        vault.set(config_id, "synthetic-key-not-a-real-credential")
        assert vault.get(config_id) == "synthetic-key-not-a-real-credential"
    finally:
        vault.delete(config_id)
    assert vault.get(config_id) is None
