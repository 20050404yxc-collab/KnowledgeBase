# 文件：test_refactor_boundaries.py
# 层：验证／应用与资源边界
# 作用：验证重构后的取消提交、线程清理、协议和凭据补偿。
# 说明：只使用隔离目录、模拟模型和合成凭据。
import asyncio
import json
import sqlite3
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from knowledge_agent.application.generation import ProviderClient
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.application.question_locks import QuestionLocks
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.generation import GenerationState
from knowledge_agent.entrypoints.dispatch import dispatch
from knowledge_agent.entrypoints.protocol_runtime import parse_message
from test_knowledge import Vault, config


# 模型已返回但尚未同步提交时的取消，必须阻止知识和映射入库。
def test_cancel_at_final_commit_checkpoint(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    config(service)

    class Client:
        # 将取消排入当前任务，模拟完整文本到达时用户同时点击取消。
        async def generate(self, *_args):
            asyncio.current_task().cancel()
            return json.dumps({"title": "提交边界", "content": "完整正文", "citation_ids": []})

    service.client = Client()
    try:
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(service.question({"query": "提交竞态"}, lambda _: None))
        assert service.store.list_knowledge() == []
        assert service.store.db.execute("SELECT COUNT(*) FROM generation_keys").fetchone()[0] == 0
    finally:
        service.close()


# 取消等待不能删除尚被解析线程使用的快照，也不能留下后台异常。
def test_cancelled_parser_settles_before_session_cleanup(tmp_path, monkeypatch):
    original = tmp_path / "original.txt"
    original.write_text("原件和解析线程均须安全。", encoding="utf-8")
    service = create_service(tmp_path / "data", vault=Vault())
    entered, release = threading.Event(), threading.Event()
    read = service.snapshots._read

    # 完成复制后暂停，确保取消发生在真实的在途线程期间。
    def blocked(source, target):
        document = read(source, target)
        entered.set()
        assert release.wait(timeout=5)
        return document

    monkeypatch.setattr(service.snapshots, "_read", blocked)

    # 取消后先观察副本仍在，再释放线程并验证延迟回收。
    async def scenario():
        task = asyncio.create_task(service.add_attachment({"path": str(original)}, lambda _: None))
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert list(service.snapshots.session.iterdir())
        release.set()
        await service.settle()
        assert not list(service.snapshots.session.iterdir())

    try:
        asyncio.run(scenario())
        assert service.attachments == {}
        assert original.read_text(encoding="utf-8") == "原件和解析线程均须安全。"
    finally:
        release.set()
        service.close()


# 普通 JSON 标量和数组也可能来自协议，非法帧后仍应处理合法请求。
def test_malformed_frames_do_not_crash_worker(tmp_path):
    script = Path(__file__).resolve().parents[1] / "services/knowledge-agent/worker.py"
    invalid = [
        None,
        [],
        42,
        {"id": "bad", "operation": []},
        {"id": "", "operation": "bootstrap"},
        {"id": "bad", "operation": "bootstrap", "params": []},
    ]
    messages = invalid + [{"id": "ok", "operation": "bootstrap", "params": {}}]
    result = subprocess.run(
        [sys.executable, "-u", str(script), "--data-dir", str(tmp_path)],
        input="".join(json.dumps(value) + "\n" for value in messages),
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=15,
        check=True,
    )
    frames = [json.loads(line) for line in result.stdout.splitlines()]
    assert len([frame for frame in frames if frame.get("error") == "无效协议消息"]) == len(invalid)
    assert any(frame.get("id") == "ok" and frame["type"] == "result" for frame in frames)
    assert not list((tmp_path / "sessions").iterdir())


# 配置 SQL 失败时必须还原旧凭据，而不是悄悄替换已生效的密钥。
def test_provider_update_failure_restores_previous_secret(tmp_path):
    vault = Vault()
    service = create_service(tmp_path, vault=vault)
    params = {
        "name": "fixture",
        "protocol": "responses",
        "base_url": "https://example.test/v1",
        "model": "model",
        "key": "old-synthetic-key",
        "currency": "USD",
    }
    try:
        provider = save_provider(service.store, vault, params)[0]
        service.store.db.execute(
            "CREATE TRIGGER reject_provider BEFORE UPDATE ON providers "
            "BEGIN SELECT RAISE(ABORT, 'fault fixture'); END"
        )
        with pytest.raises(sqlite3.IntegrityError):
            save_provider(
                service.store, vault, {**params, "id": provider["id"], "key": "new-synthetic-key"}
            )
        assert vault.get(provider["id"]) == "old-synthetic-key"
        assert service.store.providers() == [provider]
    finally:
        service.close()


# 布尔值虽然是 Python 的整数子类，但不能被当作模型 token 数计费。
def test_invalid_usage_keeps_cost_unknown():
    state = GenerationState(input_tokens=True, output_tokens=10)
    assert state.cost({"input_price": 1, "output_price": 2}) is None
    assert state.input_tokens is None and state.output_tokens is None


# 排队取消不移除正在使用的锁，最后一位完成后回收问题关联。
def test_question_lock_releases_after_waiter_cancellation():
    locks = QuestionLocks()
    entered, release = asyncio.Event(), asyncio.Event()

    # 首个任务持有问题锁，其他任务只能等待，不能另建同名锁并发。
    async def first():
        async with locks.acquire("same"):
            entered.set()
            await release.wait()

    # 等待者取消后必须释放计数，但不能删除首任务仍持有的条目。
    async def waiter():
        async with locks.acquire("same"):
            pytest.fail("等待者不应在释放前获得锁")

    # 明确调度顺序，核对持有、等待取消和全部完成三个边界。
    async def scenario():
        owner = asyncio.create_task(first())
        await entered.wait()
        waiting = asyncio.create_task(waiter())
        await asyncio.sleep(0)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        assert locks.entries["same"].users == 1
        release.set()
        await owner
        assert locks.entries == {}

    asyncio.run(scenario())


# 两端读取同一份样例，后台真实用例输出必须与公开契约保持一致。
def test_shared_protocol_samples(tmp_path):
    samples_path = Path(__file__).resolve().parents[1] / "contracts/protocol_samples.json"
    samples = json.loads(samples_path.read_text(encoding="utf-8"))
    service = create_service(tmp_path, vault=Vault())

    # 除临时数据目录外不改写结果，确保离线问答和空值语义没有漂移。
    async def scenario():
        for sample in samples["scenarios"]:
            request = parse_message(json.dumps(sample["request"]).encode("utf-8"))
            actual = await dispatch(
                service, request["operation"], request["params"], lambda _: None
            )
            if request["operation"] == "bootstrap":
                assert actual["data_dir"] == str(tmp_path.resolve())
                actual["data_dir"] = "<temporary>"
            assert actual == sample["response"]["result"]

    try:
        asyncio.run(scenario())
        for invalid in samples["invalid_requests"]:
            with pytest.raises(ValueError):
                parse_message(json.dumps(invalid).encode("utf-8"))
    finally:
        service.close()


# 凭据补偿也失败时，调用者仍能识别原始数据库错误而非误判为成功。
def test_provider_compensation_preserves_primary_error(tmp_path, monkeypatch):
    vault = Vault()
    service = create_service(tmp_path, vault=vault)
    config(service)
    provider = service.store.provider()
    service.store.db.execute(
        "CREATE TRIGGER reject_provider BEFORE UPDATE ON providers "
        "BEGIN SELECT RAISE(ABORT, 'primary storage failure'); END"
    )

    # 第一次新密钥写入成功，模拟第二次恢复旧密钥时系统凭据服务失败。
    def fail_restore(item_id, secret):
        if secret != "replacement-fixture":
            raise OSError("compensation failure")

    monkeypatch.setattr(vault, "set", fail_restore)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="primary storage failure") as failure:
            save_provider(service.store, vault, {**provider, "key": "replacement-fixture"})
        assert "凭据恢复失败" in failure.value.__notes__[0]
    finally:
        service.close()


# 终态记账故障不能把模型失败或取消替换成另一个异常，取消仍可传播到入口。
@pytest.mark.parametrize("cancelled", [False, True])
def test_accounting_failure_preserves_generation_error(tmp_path, monkeypatch, cancelled):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    original = asyncio.CancelledError() if cancelled else ValueError("primary model failure")

    class Transport:
        # 模型调用发生主错误，后续收尾将同时遇到数据库故障。
        async def generate(self, *_args, **_kwargs):
            raise original

    # 只替换收尾写入，不绕过真实的开始记录和凭据读取。
    def fail_finish(*_args):
        raise sqlite3.OperationalError("accounting failure")

    monkeypatch.setattr(service.store, "finish_attempt", fail_finish)
    client = ProviderClient(service.store, service.vault, Transport())
    try:
        with pytest.raises(type(original)) as failure:
            asyncio.run(
                client.generate(service.store.provider(), "fixture", "test", lambda _: None)
            )
        assert failure.value is original
        assert "记账失败" in original.__notes__[0]
    finally:
        service.close()
