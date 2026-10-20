# 文件：test_diagnostics.py
# 层：验证／日志与请求关联
# 作用：保护隐私、并发上下文、取消传播和日志文件边界。
# 说明：仅使用临时目录与合成异常，不访问正式数据或外部服务。
import asyncio
import json

import pytest
from knowledge_agent import diagnostics as logs


# 每个测试独占日志句柄和上下文，结束后恢复其他测试的日志环境。
@pytest.fixture
def diagnostic_session(tmp_path):
    previous_handlers = logs.LOGGER.handlers[:]
    previous_level = logs.LOGGER.level
    previous_context = logs.CONTEXT.get()
    logs.LOGGER.handlers = []
    logs.configure(tmp_path, "test-session")
    try:
        yield tmp_path / "logs"
    finally:
        for handler in logs.LOGGER.handlers:
            handler.close()
        logs.LOGGER.handlers = previous_handlers
        logs.LOGGER.setLevel(previous_level)
        logs.CONTEXT.set(previous_context)


# 相互交错的异步请求与解析线程保持独立关联，返回值及取消语义保持原样。
def test_concurrent_requests_threads_and_cancellation_keep_context(diagnostic_session):
    # 线程不读取业务参数；仅产生可定位的合成步骤。
    @logs.traced
    def parsing():
        logs.record("synthetic.thread")
        return 7

    # 每个请求在创建任务之后进入上下文，避免继承另一个请求的标识。
    async def request(request_id):
        with logs.request_context(request_id, "question"):
            with logs.step("synthetic.request"):
                await asyncio.sleep(0)
                return await asyncio.to_thread(parsing)

    # 取消必须穿透步骤记录器，不能转为成功或影响后一个请求的上下文。
    async def run():
        assert await asyncio.gather(request("one"), request("two")) == [7, 7]
        with logs.request_context("cancelled", "question"):
            with pytest.raises(asyncio.CancelledError):
                with logs.step("synthetic.cancel"):
                    raise asyncio.CancelledError()
        logs.record("synthetic.after")

    asyncio.run(run())
    rows = [
        json.loads(line)
        for line in (diagnostic_session / "worker.log").read_text(encoding="utf-8").splitlines()
    ]
    threads = [row for row in rows if row["event"] == "synthetic.thread"]
    assert {row["request_id"] for row in threads} == {"one", "two"}
    assert all(row["session_id"] == "test-session" and row["parent_span"] for row in threads)
    assert any(
        row["event"] == "step.cancelled" and row["request_id"] == "cancelled" for row in rows
    )
    assert "request_id" not in rows[-1]


# 密钥、认证头、私密正文、路径和 SQL 参数不得通过异常链或原始消息写入日志。
def test_private_errors_keep_codes_and_frames_without_messages(diagnostic_session):
    secret = "sk-private-token Authorization Bearer private-question private-response"
    with pytest.raises(ValueError):
        with logs.request_context("safe-id", "question"):
            with logs.step("synthetic.failure"):
                try:
                    raise PermissionError(13, secret, "C:/private/document.txt")
                except PermissionError as error:
                    raise ValueError(secret) from error
    text = (diagnostic_session / "worker.log").read_text(encoding="utf-8")
    assert secret not in text and "private/document" not in text
    failed = next(
        json.loads(line) for line in text.splitlines() if json.loads(line)["event"] == "step.failed"
    )
    assert [error["type"] for error in failed["errors"]] == ["ValueError", "PermissionError"]
    assert failed["errors"][1]["errno"] == 13
    assert failed["errors"][0]["frames"][-1]["file"] == "test_diagnostics.py"


# 滚动只保留当前日志和五份备份；每一条保留记录仍是独立合法 JSON。
def test_rotation_is_bounded_and_keeps_latest_record(diagnostic_session):
    handler = logs.LOGGER.handlers[0]
    handler.maxBytes = 650
    for index in range(50):
        logs.record("synthetic.rotation", index=index)
    files = list(diagnostic_session.glob("worker.log*"))
    assert len(files) == 6
    for path in files:
        assert path.stat().st_size <= 650
        assert all(
            json.loads(line)["event"] == "synthetic.rotation"
            for line in path.read_text(encoding="utf-8").splitlines()
        )
    assert (
        json.loads(
            (diagnostic_session / "worker.log").read_text(encoding="utf-8").splitlines()[-1]
        )["index"]
        == 49
    )


# 写日志失败不得替换业务主错误，也不能把原始错误体写到 stderr 或 stdout。
def test_logging_failure_preserves_original_error(diagnostic_session, monkeypatch, capsys):
    # 模拟磁盘写入失败，验证上下文退出仍然抛出同一个业务错误对象。
    def broken_emit(_record):
        raise OSError("private-disk-details")

    monkeypatch.setattr(logs.LOGGER.handlers[0], "emit", broken_emit)
    primary = ValueError("private-primary")
    with pytest.raises(ValueError) as caught:
        with logs.step("synthetic.disk_failure"):
            raise primary
    assert caught.value is primary
    output = capsys.readouterr()
    assert output.out == "" and "private" not in output.err


# 不可信用量对象和未知操作名不能借诊断字段写入响应体或用户正文。
def test_untrusted_metadata_is_not_serialized(diagnostic_session):
    with logs.request_context("safe-id", "private-operation-body"):
        logs.record("synthetic.usage", input_tokens={"body": "private-token"})
    text = (diagnostic_session / "worker.log").read_text(encoding="utf-8")
    row = json.loads(text)
    assert "private" not in text
    assert row["operation"] == "unknown" and row["input_tokens"] is None


# 真实 HTTP 失败保留状态码、尝试 ID 和请求关联，同时不落密钥、请求体或错误体。
def test_model_http_failure_is_diagnosable_without_private_content(diagnostic_session):
    import httpx
    from knowledge_agent.application.provider_settings import save_provider
    from knowledge_agent.bootstrap import create_client
    from knowledge_agent.infrastructure.sqlite_store import Store
    from test_knowledge import Vault
    from test_providers import parameters

    store = Store(diagnostic_session.parent)
    vault = Vault()
    config = save_provider(store, vault, parameters())[0]

    # 模拟远端拒绝，不发生外部请求或真实扣费。
    def response(_request):
        return httpx.Response(401, text="private-provider-error-body")

    client = create_client(store, vault, httpx.MockTransport(response))
    try:
        with logs.request_context("model-failure", "providers.test"):
            with pytest.raises(ValueError, match="HTTP 401"):
                asyncio.run(
                    client.generate(config, "private-question", "connection-test", lambda _: None)
                )
        assert store.list_attempts()[0]["status"] == "failed"
    finally:
        store.close()
    text = (diagnostic_session / "worker.log").read_text(encoding="utf-8")
    rows = [json.loads(line) for line in text.splitlines()]
    assert "private" not in text and "secret-fixture-only" not in text
    assert any(
        row["event"] == "model.http_response"
        and row["http_status"] == 401
        and row["request_id"] == "model-failure"
        for row in rows
    )
    assert any(
        row["event"] == "model.attempt_finished" and row["status"] == "failed" and row["attempt_id"]
        for row in rows
    )


# 截图中的摘要错误必须区分缺项／错误类型、空白和超长，同时不推进草案或更改原文。
@pytest.mark.parametrize(
    ("summary", "rule", "actual_type", "length"),
    [
        (None, "required_text", "NoneType", None),
        (["private-model-body"], "required_text", "list", None),
        ("   ", "non_blank", "str", 3),
        ("x" * 1601, "max_length", "str", 1601),
    ],
)
def test_red_summary_error_preserves_state_and_records_rule(
    diagnostic_session, summary, rule, actual_type, length
):
    from knowledge_agent.bootstrap import create_service
    from test_knowledge import Vault, config
    from test_library import LibraryClient, call

    service = create_service(diagnostic_session.parent / "data", vault=Vault())
    config(service)
    service.client = LibraryClient()

    # 只注入合成模型响应，不调用网络、凭据或真实供应商。
    async def invalid(*_args):
        return json.dumps({"summary": summary})

    service.client.generate = invalid
    try:
        item = service.store.save("private-note-title", "private-note-body")
        value = call(service, "library.restructure.plan")
        with logs.request_context("summary-failure", "library.restructure.plan"):
            with pytest.raises(ValueError, match="知识点知识要点无效，未采用模型目录"):
                call(service, "library.restructure.plan", {**value, "advance": True})
        assert service.library.summary()["covered"] == 0
        assert service.library.draft["busy"] is False
        assert service.library.draft["summaries"] == {}
        assert service.store.get(item["id"])["content"] == "private-note-body"
    finally:
        service.close()
    text = (diagnostic_session / "worker.log").read_text(encoding="utf-8")
    assert "private-" not in text and "x" * 1601 not in text
    rows = [json.loads(line) for line in text.splitlines()]
    failure = next(
        row
        for row in rows
        if row["event"] == "step.failed" and row["step"] == "library.validate_summary"
    )
    assert failure["request_id"] == "summary-failure"
    assert failure["errors"][0]["reason"] == "知识点知识要点无效，未采用模型目录"
    assert failure["errors"][0]["validation"] == {
        "field": "知识要点",
        "rule": rule,
        "actual_type": actual_type,
        "actual_length": length,
        "limit": 1600,
    }
    assert any(
        row["event"] == "library.summary_context"
        and row["item_index"] == row["chunk_index"] == 0
        and row["request_id"] == "summary-failure"
        for row in rows
    )


# 成功返回本地回退结果时仍需保存失败步骤和固定原因，不能只留下请求成功日志。
def test_controlled_plan_fallback_retains_actionable_reason(diagnostic_session):
    from knowledge_agent.bootstrap import create_service
    from knowledge_agent.entrypoints.dispatch import dispatch
    from test_knowledge import Vault, config

    service = create_service(diagnostic_session.parent / "data", vault=Vault())
    config(service)

    # 返回缺失知识点字段的合成响应，触发已捕获的校验失败。
    async def invalid(*_args):
        return json.dumps({"points": [{"title": "private-model-title"}]})

    service.client.generate = invalid
    try:
        item = service.store.save("合成检索词", "private-note-body")
        with logs.request_context("plan-fallback", "question.plan"):
            result = asyncio.run(
                dispatch(
                    service,
                    "question.plan",
                    {"query": "合成检索词", "scope": "knowledge"},
                    lambda _: None,
                )
            )
        assert result["plan_id"] == "" and "本地结果保留" in result["notice"]
        assert result["search"]["items"][0]["knowledge_id"] == item["id"]
    finally:
        service.close()
    text = (diagnostic_session / "worker.log").read_text(encoding="utf-8")
    assert "private-" not in text
    rows = [json.loads(line) for line in text.splitlines()]
    fallback = next(row for row in rows if row["event"] == "topic.plan_fallback")
    assert fallback["request_id"] == "plan-fallback"
    assert fallback["errors"][0]["validation"]["field"] == "主题"
    assert fallback["errors"][0]["validation"]["rule"] == "required_text"
    assert any(
        row["event"] == "step.failed" and row["step"] == "topic.validate_plan" for row in rows
    )
