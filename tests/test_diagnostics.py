# 文件：test_diagnostics.py
# 层：验证／日志与请求关联
# 作用：保护隐私、并发上下文、取消传播和日志文件边界。
# 说明：仅使用临时目录与合成异常，不访问正式数据或外部服务。
import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

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
        for line in Path(logs.LOGGER.handlers[0].baseFilename)
        .read_text(encoding="utf-8")
        .splitlines()
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
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert secret not in text and "private/document" not in text
    failed = next(
        json.loads(line) for line in text.splitlines() if json.loads(line)["event"] == "step.failed"
    )
    assert [error["type"] for error in failed["errors"]] == ["ValueError", "PermissionError"]
    assert failed["errors"][1]["errno"] == 13
    assert failed["errors"][0]["frames"][-1]["file"] == "test_diagnostics.py"


# 容量分段不删除十四天内的日志；每条记录恰好保留一次。
def test_rotation_is_bounded_and_keeps_latest_record(diagnostic_session):
    handler = logs.LOGGER.handlers[0]
    handler.maxBytes = 650
    for index in range(50):
        logs.record("synthetic.rotation", index=index, stage="合成阶段" * 8)
    files = list(diagnostic_session.glob("*-worker.log"))
    assert len(files) > 6
    assert sum(len(path.read_text(encoding="utf-8").splitlines()) for path in files) == 50
    for path in files:
        assert path.stat().st_size <= 650
        assert all(
            json.loads(line)["event"] == "synthetic.rotation"
            for line in path.read_text(encoding="utf-8").splitlines()
        )
    assert (
        json.loads(
            Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8").splitlines()[-1]
        )["index"]
        == 49
    )


# 当天启动延续最大序号，每次配置写入新文件，日期改变后从一开始。
def test_each_worker_start_creates_a_new_dated_log(diagnostic_session, monkeypatch):
    # 固定本地日期供跨天验证，诊断记录仍使用真实 UTC 时间。
    class Clock(datetime):
        day = 21

        # 返回可切换的本地测试日期；保留诊断 UTC 时间的调用形态。
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, cls.day, 12, tzinfo=tz)

    monkeypatch.setattr(logs, "datetime", Clock)
    previous = diagnostic_session / "2026-10-21-9-worker.log"
    previous.write_text("previous\n", encoding="utf-8")
    logs.configure(diagnostic_session.parent, "new-session")
    logs.record("new.start")
    first = Path(logs.LOGGER.handlers[0].baseFilename)
    assert first.name == "2026-10-21-10-worker.log"
    logs.configure(diagnostic_session.parent, "another-session")
    logs.record("another.start")
    assert Path(logs.LOGGER.handlers[0].baseFilename).name == "2026-10-21-11-worker.log"
    assert json.loads(first.read_text(encoding="utf-8"))["event"] == "new.start"
    assert previous.read_text(encoding="utf-8") == "previous\n"
    Clock.day = 22
    logs.configure(diagnostic_session.parent, "next-day")
    logs.record("next.day")
    assert Path(logs.LOGGER.handlers[0].baseFilename).name == "2026-10-22-1-worker.log"


# 只删除严格超过十四天的本进程日志；同龄边界、其他文件和当前日志受到保护。
def test_worker_retention_age_scope_and_daily_cleanup(diagnostic_session, monkeypatch):
    now = 1792555200.0
    monkeypatch.setattr(logs.time, "time", lambda: now)
    cutoff = now - logs.LOG_RETENTION_SECONDS
    ages = {
        "2026-10-01-1-worker.log": cutoff - 1,
        "worker.log.1": cutoff - 1,
        "2026-10-07-1-worker.log": cutoff,
        "2026-10-06-1-worker.log": cutoff + 1,
        "desktop.log": cutoff - 1,
        "notes.txt": cutoff - 1,
    }
    for name, modified in ages.items():
        path = diagnostic_session / name
        path.write_text(name, encoding="utf-8")
        os.utime(path, (modified, modified))
    (diagnostic_session / "2026-10-01-2-worker.log").mkdir()
    # 相对路径中的父目录分量也必须正确识别当前文件，避免长期运行时误删。
    monkeypatch.chdir(diagnostic_session.parent)
    logs.configure(Path("logs/.."), "retention")
    logs.record("retention.start")
    assert not (diagnostic_session / "2026-10-01-1-worker.log").exists()
    assert not (diagnostic_session / "worker.log.1").exists()
    assert all((diagnostic_session / name).exists() for name in list(ages)[2:])
    assert (diagnostic_session / "2026-10-01-2-worker.log").is_dir()
    active = Path(logs.LOGGER.handlers[0].baseFilename)
    os.utime(active, (cutoff - 1, cutoff - 1))
    now += logs.CLEANUP_INTERVAL_SECONDS
    logs.record("retention.next_day")
    assert not (diagnostic_session / "2026-10-07-1-worker.log").exists()
    assert len(active.read_text(encoding="utf-8").splitlines()) == 2


# 单个过期文件删除失败不会阻止其他文件清理或本次新日志写入。
def test_worker_cleanup_failure_preserves_logging(diagnostic_session, monkeypatch, capsys):
    expired = diagnostic_session / "worker.log.5"
    expired.write_text("old", encoding="utf-8")
    os.utime(expired, (0, 0))
    original = Path.unlink

    # 只阻塞合成旧日志，其他目录与文件继续走真实文件系统。
    def fail_one(path, *args, **kwargs):
        if path == expired:
            raise PermissionError("private-cleanup-error")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_one)
    logs.configure(diagnostic_session.parent, "cleanup-failure")
    logs.record("still.writes")
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert json.loads(text)["event"] == "still.writes"
    assert "diagnostic cleanup failed" in capsys.readouterr().err


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
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
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
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
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
        ("x" * 2401, "max_length", "str", 2401),
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
            result = call(service, "library.restructure.plan", {**value, "advance": True})
            assert result["status"] == "paused"
            assert "知识要点无效" in result["errors"][0]
        assert service.library.summary()["covered"] == 0
        assert service.library.draft["busy"] is False
        assert service.library.draft["summaries"] == {}
        assert service.store.get(item["id"])["content"] == "private-note-body"
    finally:
        service.close()
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert "private-" not in text and "x" * 2401 not in text
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
        "limit": 2400,
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
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert "private-" not in text
    rows = [json.loads(line) for line in text.splitlines()]
    fallback = next(row for row in rows if row["event"] == "topic.plan_fallback")
    assert fallback["request_id"] == "plan-fallback"
    assert fallback["errors"][0]["validation"]["field"] == "主题"
    assert fallback["errors"][0]["validation"]["rule"] == "required_text"
    assert any(
        row["event"] == "step.failed" and row["step"] == "topic.validate_plan" for row in rows
    )


# 深层路径错误保留固定原因和请求标识，模型路径和正文不能泄漏或收录。
def test_invalid_deep_path_logs_safe_reason_without_capture(diagnostic_session):
    from knowledge_agent.bootstrap import create_service
    from test_knowledge import Vault, config
    from test_library_questions import ClassifiedClient

    service = create_service(diagnostic_session.parent / "data", vault=Vault())
    config(service)
    client = ClassifiedClient()
    service.client = client
    generate = client.generate

    # 资格审核正常，仅正文返回非法路径，不发起真实模型请求。
    async def invalid_path(configuration, prompt, purpose, emit):
        raw = json.loads(await generate(configuration, prompt, purpose, emit))
        if purpose != "question-review":
            raw.update(category_path=["private-path", None], content="private-model-content")
        return json.dumps(raw)

    client.generate = invalid_path
    try:
        with logs.request_context("deep-path-failure", "question"):
            with pytest.raises(ValueError):
                asyncio.run(service.question({"query": "新的独立概念"}, lambda _: None))
        assert not service.store.library_inventory()
    finally:
        service.close()
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert "private-" not in text
    assert any(
        row["event"] == "step.failed"
        and row["request_id"] == "deep-path-failure"
        and row["errors"][0].get("reason") == "分类路径无效：需要 1 至 64 层，每层 1 至 80 字"
        for row in map(json.loads, text.splitlines())
    )


# 同类比较失败可按请求和固定阶段检索，意见、概览及模型正文不能进入日志。
def test_grouping_failure_preserves_private_draft_and_request_context(diagnostic_session):
    from knowledge_agent.bootstrap import create_service
    from test_knowledge import Vault, config
    from test_library import LibraryClient, call

    service = create_service(diagnostic_session.parent / "data", vault=Vault())
    config(service)
    client = LibraryClient()
    service.client = client
    generate = client.generate

    # 只在语义比较返回缺失决策，其他阶段使用正常合成结果。
    async def invalid_group(configuration, prompt, purpose, emit):
        if purpose == "library-group":
            return json.dumps({"private-model-body": "private-feedback"})
        return await generate(configuration, prompt, purpose, emit)

    client.generate = invalid_group
    try:
        service.store.save("private-title-a", "private-source-a")
        service.store.save("private-title-b", "private-source-b")
        value = call(service, "library.restructure.plan", {"feedback": "private-feedback"})
        with logs.request_context("same-knowledge-failure", "library.restructure.plan"):
            while value["status"] == "planning":
                value = call(service, "library.restructure.plan", {**value, "advance": True})
        assert value["status"] == "paused" and value["classified"] == value["covered"] == 2
        assert not service.library.draft["suggestions"]
    finally:
        service.close()
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    assert "private-" not in text
    failures = [row for row in map(json.loads, text.splitlines()) if row["event"] == "step.failed"]
    assert any(
        row["request_id"] == "same-knowledge-failure"
        and row["step"].endswith("LibraryGrouping.group_one")
        and row["errors"][0]["reason"] == "同类知识判断格式无效，已有目录与分析保留"
        for row in failures
    )
