# 文件：test_selection_questions.py
# 层：验证
# 作用：保护选区问答的本地优先、显式付费、取消和原子入库契约。
# 说明：只使用临时数据库、内存凭据及本机模拟传输。
import asyncio
import json

import httpx
import pytest
from knowledge_agent.application.provider_settings import save_provider
from knowledge_agent.bootstrap import create_client, create_service
from knowledge_agent.entrypoints.dispatch import dispatch
from test_knowledge import Vault
from test_providers import parameters
from test_topics_wire import response_for


# 所有会话绑定真实已保存正文，测试不能绕过来源版本检查。
@pytest.fixture
def setup_selection(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    note = service.store.save("锁的阅读背景", "互斥锁保护共享状态。")
    opened = service.selection.open(
        {
            "source": {"kind": "knowledge", "id": note["id"], "version": note["version"]},
            "quote": note["content"],
        }
    )
    yield service, note, opened
    service.close()


# 模拟真实三协议传输，观察实际请求和持久化用量，不触碰正式凭据。
def mock_model(service, protocol="responses", text=None):
    save_provider(service.store, service.vault, parameters(protocol))
    bodies = []

    # 返回完整终态但不谎报用量，失败样例仍经过实际记账。
    def handler(request):
        bodies.append(json.loads(request.content))
        return response_for(
            protocol,
            text
            or json.dumps(
                {
                    "title": "锁与调度的关系",
                    "content": "公平调度避免线程长期等待。",
                    "citation_ids": [],
                }
            ),
        )

    service.client = create_client(service.store, service.vault, httpx.MockTransport(handler))
    service.selection.client = service.client
    return bodies


# 问题每次使用稳定标识，显式生成和翻页沿用同一轮，不增加隐藏调用。
def ask(service, opened, action="lookup", turn="turn-one", **kwargs):
    return asyncio.run(
        dispatch(
            service,
            "selection.ask",
            {
                "session_id": opened["id"],
                "turn_id": turn,
                "action": action,
                "question": "公平调度为什么有效",
                **kwargs,
            },
            lambda _: None,
        )
    )


# 本地命中零调用；用户不满意后一次显式生成，重试相同成功轮次不重复计费。
@pytest.mark.parametrize("protocol", ["responses", "chat-completions", "anthropic"])
def test_local_first_and_explicit_single_generation(setup_selection, protocol):
    service, _, opened = setup_selection
    local = service.store.save("公平调度知识", "公平调度用队列保证等待者轮流执行。")
    bodies = mock_model(service, protocol)
    result = ask(service, opened)
    assert result["turns"][0]["state"] == "local"
    assert local["id"] in {i["knowledge_id"] for i in result["turns"][0]["candidates"]}
    assert bodies == [] and service.store.list_attempts() == []
    result = ask(service, opened, "generate")
    turn = result["turns"][0]
    assert turn["state"] == "answered" and len(bodies) == 1
    assert len(turn["attempts"]) == 1 and turn["attempts"][0]["purpose"] == "selection-answer"
    assert turn["attempts"][0]["input_tokens"] is None
    assert turn["citations"] == []
    ask(service, opened, "generate")
    assert len(bodies) == 1


# 来源正文只重复选区不能冒充答案；未配置时保留问题，有配置才自动回退。
def test_no_hit_and_unconfigured_are_distinct(setup_selection):
    service, _, opened = setup_selection
    result = ask(service, opened)
    assert result["turns"][0]["total"] == 0
    assert result["turns"][0]["state"] == "unconfigured"
    assert service.store.list_attempts() == []
    bodies = mock_model(service)
    result = ask(service, opened, turn="next")
    assert result["turns"][-1]["state"] == "answered" and len(bodies) == 1
    assert len(service.store.list_attempts()) == 1


# 检索异常不能等同无命中，更不能偷偷计费；修复后可对原问题重新检索。
def test_lookup_failure_does_not_generate(setup_selection, monkeypatch):
    service, _, opened = setup_selection
    bodies = mock_model(service)
    original = service.store.selection_search

    # 模拟索引读取失败，阻止自动回退。
    def broken(_):
        raise RuntimeError("isolated search failure")

    monkeypatch.setattr(service.store, "selection_search", broken)
    with pytest.raises(RuntimeError):
        ask(service, opened)
    assert (
        service.selection.get({"session_id": opened["id"]})["turns"][0]["state"] == "lookup-failed"
    )
    assert bodies == []
    monkeypatch.setattr(service.store, "selection_search", original)
    assert ask(service, opened)["turns"][0]["state"] == "answered"
    assert len(bodies) == 1


# 本地检索全库分页且覆盖补充；无 FTS 时仍完整回退，不受近期列表限制。
@pytest.mark.parametrize("fallback", [False, True])
def test_complete_library_candidates_and_supplement(setup_selection, fallback):
    service, note, opened = setup_selection
    for index in range(35):
        service.store.save(f"公平调度资料 {index}", f"公平调度解释，唯一示例 {index}。")
    service.store.capture_topic(
        {
            "title": "公平调度补充",
            "content": "互斥锁也应考虑公平调度。",
            "theme": "并发",
            "target_id": note["id"],
            "version": note["version"],
            "capture_key": "fixture-supplement",
            "citations": [],
            "model": "fixture",
            "provider_name": "fixture",
        }
    )
    if fallback:
        service.store.db.execute("DROP TABLE search_fts")
    result = ask(service, opened)
    assert result["turns"][0]["total"] == 36
    ids = set()
    kinds = set()
    for page in range(4):
        result = ask(service, opened, "page", page=page)
        candidates = result["turns"][0]["candidates"]
        assert len(candidates) <= 10
        ids.update(i["id"] for i in candidates)
        kinds.update(i["kind"] for i in candidates)
    assert len(ids) == 36 and "supplement" in kinds


# 确认入库复用原子幂等提交，必要上下文可独立阅读，重启只保留知识。
def test_capture_idempotent_and_runtime_only(setup_selection, tmp_path):
    service, note, opened = setup_selection
    mock_model(service)
    ask(service, opened)
    preview = service.selection.preview({"session_id": opened["id"], "turn_id": "turn-one"})
    assert note["content"] in preview["content"] and "公平调度为什么有效" in preview["content"]
    params = {
        "session_id": opened["id"],
        "turn_id": "turn-one",
        **preview,
        "category_path": ["并发"],
    }
    result = service.selection.capture(params)
    saved = result["turns"][0]["saved_id"]
    assert service.selection.capture(params)["turns"][0]["saved_id"] == saved
    assert service.store.get(saved)["model"] == "fixture-model"
    assert service.store.get(note["id"])["content"] == note["content"]
    assert (
        service.store.selection_search(
            {"query": "公平调度", "question": "公平调度", "quote": "", "source_id": "", "page": 0}
        )["total"]
        >= 1
    )
    reopened = create_service(tmp_path, vault=Vault())
    try:
        assert reopened.selection.sessions == {}
        assert reopened.store.get(saved)["content"] == preview["content"]
    finally:
        reopened.close()


# 追加必须使用当前版本，冲突不改原文；成功后重复提交不新增补充。
def test_capture_supplement_conflict_and_retry(setup_selection):
    service, note, opened = setup_selection
    mock_model(service)
    ask(service, opened)
    preview = service.selection.preview({"session_id": opened["id"], "turn_id": "turn-one"})
    params = {
        "session_id": opened["id"],
        "turn_id": "turn-one",
        **preview,
        "category_path": [],
        "target_id": note["id"],
        "version": note["version"],
    }
    changed = service.store.save(note["title"], "手工新正文必须保留。", item_id=note["id"])
    with pytest.raises(ValueError, match="已被修改"):
        service.selection.capture(params)
    assert service.store.get(note["id"])["supplements"] == []
    params["version"] = changed["version"]
    service.selection.capture(params)
    service.selection.capture(params)
    current = service.store.get(note["id"])
    assert current["content"] == changed["content"] and len(current["supplements"]) == 1


# 无效来源、旧版本、跨文本选择及空格式不能建立可信来源。
@pytest.mark.parametrize(
    "delta",
    [
        {"quote": "来源没有这段文字"},
        {"quote": "**"},
        {"quote": "字" * 6001},
        {"source": {"kind": "knowledge", "id": "missing", "version": "old"}},
        {"source": {"kind": "source", "id": "missing", "page": True}},
    ],
)
def test_selection_source_validation(setup_selection, delta):
    service, _, opened = setup_selection
    with pytest.raises((ValueError, KeyError)):
        service.selection.open({"source": opened["source"], "quote": opened["quote"], **delta})
    assert len(service.selection.sessions) == 1


# 残缺输出和伪引用不进入可保存状态，实际已发出的调用仍记账。
@pytest.mark.parametrize(
    "text", ["{", json.dumps({"title": "伪证据", "content": "回答", "citation_ids": ["fake"]})]
)
def test_invalid_output_is_not_capturable(setup_selection, text):
    service, _, opened = setup_selection
    mock_model(service, text=text)
    with pytest.raises(ValueError):
        ask(service, opened)
    turn = service.selection.get({"session_id": opened["id"]})["turns"][0]
    assert turn["state"] == "failed" and turn["content"] == ""
    assert len(turn["attempts"]) == 1
    with pytest.raises(ValueError):
        service.selection.preview({"session_id": opened["id"], "turn_id": turn["id"]})


# 取消和关闭使在途答案不可保存，任务最终释放锁，不阻塞后续使用。
def test_cancel_and_close_discard_inflight_answer(setup_selection):
    service, _, opened = setup_selection
    save_provider(service.store, service.vault, parameters())

    # 可控挂起模拟模型；取消通过真实用例 finally 清理。
    class Waiting:
        # 保持请求在途，供测试主动取消并核对 finally 清理。
        async def generate(self, config, prompt, purpose, emit):
            await asyncio.Event().wait()

    service.selection.client = Waiting()

    # 取消后会话保留终态，关闭后旧标识不得恢复。
    async def run():
        task = asyncio.create_task(
            service.selection.ask(
                {
                    "session_id": opened["id"],
                    "turn_id": "t",
                    "action": "lookup",
                    "question": "公平调度",
                },
                lambda _: None,
            )
        )
        await asyncio.sleep(0)
        assert service.selection.generating
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not service.selection.generating
        assert (
            service.selection.get({"session_id": opened["id"]})["turns"][0]["state"] == "cancelled"
        )
        service.selection.close({"session_id": opened["id"]})
        with pytest.raises(ValueError):
            service.selection.get({"session_id": opened["id"]})

    asyncio.run(run())


# 关闭后晚到的完整响应也无权恢复会话，生成锁必须在失败终态释放。
def test_close_rejects_late_success(setup_selection):
    service, _, opened = setup_selection
    save_provider(service.store, service.vault, parameters())

    # 控制返回时间以模拟取消信号晚于模型完成，不能只依赖前端丢弃。
    async def run():
        release = asyncio.Event()

        class Late:
            # 忽略前端关闭，返回完整 JSON 以检验后台会话所有权。
            async def generate(self, config, prompt, purpose, emit):
                await release.wait()
                return json.dumps({"title": "晚到回答", "content": "不应保存", "citation_ids": []})

        service.selection.client = Late()
        task = asyncio.create_task(
            service.selection.ask(
                {
                    "session_id": opened["id"],
                    "turn_id": "late",
                    "action": "lookup",
                    "question": "公平调度",
                },
                lambda _: None,
            )
        )
        await asyncio.sleep(0)
        service.selection.close({"session_id": opened["id"]})
        release.set()
        with pytest.raises(ValueError, match="已关闭"):
            await task
        assert not service.selection.generating and service.selection.sessions == {}

    asyncio.run(run())


# 每次生成只携带预算内完整历史，不额外付费摘要；保存预览保留实际必要前文。
def test_bounded_history_and_session_caps(setup_selection):
    service, _, opened = setup_selection
    bodies = mock_model(
        service,
        text=json.dumps({"title": "长解释", "content": "公平调度" * 2500, "citation_ids": []}),
    )
    for index in range(5):
        result = ask(service, opened, turn=f"history-{index}")
        payload = json.loads(bodies[-1]["input"])
        assert len(bodies[-1]["input"]) <= 28000
        assert len(payload["history"]) <= 2
    last = result["turns"][-1]
    preview = service.selection.preview({"session_id": opened["id"], "turn_id": last["id"]})
    assert "必要前文" in preview["content"] and "2/4" in last["notice"]
    assert len(bodies) == 5
    for _ in range(7):
        service.selection.open({"source": opened["source"], "quote": opened["quote"]})
    with pytest.raises(ValueError, match="8 个"):
        service.selection.open({"source": opened["source"], "quote": opened["quote"]})
    assert len(service.selection.sessions) == 8


# 轮数上限在模型调用前拒绝；历史和已成功的回答完整保留。
def test_turn_cap_retains_previous_results(setup_selection):
    service, _, opened = setup_selection
    bodies = mock_model(service)
    for index in range(24):
        ask(service, opened, turn=f"round-{index}")
    with pytest.raises(ValueError, match="24 轮"):
        ask(service, opened, turn="overflow")
    assert len(bodies) == 24
    assert len(service.selection.get({"session_id": opened["id"]})["turns"]) == 24


# 索引提交失败须回滚正文和幂等收据；恢复后仍可按原草稿保存一次。
def test_capture_transaction_failure_preserves_retry(setup_selection):
    service, _, opened = setup_selection
    mock_model(service)
    ask(service, opened)
    preview = service.selection.preview({"session_id": opened["id"], "turn_id": "turn-one"})
    params = {"session_id": opened["id"], "turn_id": "turn-one", **preview, "category_path": []}
    before = service.store.db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0]
    service.store.db.execute(
        "CREATE TRIGGER fail_selection_capture BEFORE INSERT ON capture_receipts BEGIN SELECT RAISE(ABORT,'isolated rollback'); END"
    )
    with pytest.raises(Exception, match="isolated rollback"):
        service.selection.capture(params)
    assert service.store.db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0] == before
    assert service.selection.get({"session_id": opened["id"]})["turns"][0]["saved_id"] is None
    service.store.db.execute("DROP TRIGGER fail_selection_capture")
    assert service.selection.capture(params)["turns"][0]["saved_id"]


# Markdown 可见文字可以跨链接和列表选择，选中的补充自身也不能只因引用命中。
def test_rendered_selection_and_supplement_self_hit(setup_selection):
    service, note, _ = setup_selection
    changed = service.store.save(
        note["title"],
        "1. **公平调度**与[等待队列](https://example.test)一起使用。",
        item_id=note["id"],
    )
    result = service.selection.open(
        {
            "source": {"kind": "knowledge", "id": changed["id"], "version": changed["version"]},
            "quote": "公平调度与等待队列一起使用。",
        }
    )
    assert result["quote"] == "公平调度与等待队列一起使用。"
    current = service.store.capture_topic(
        {
            "title": "补充来源",
            "content": "内存屏障约束指令次序。",
            "theme": "并发",
            "target_id": changed["id"],
            "version": changed["version"],
            "capture_key": "selected-supplement",
            "citations": [],
            "model": "fixture",
            "provider_name": "fixture",
        }
    )
    supplement = current["supplements"][0]
    opened = service.selection.open(
        {
            "source": {
                "kind": "supplement",
                "id": current["id"],
                "version": current["version"],
                "supplement_id": supplement["id"],
            },
            "quote": supplement["content"],
        }
    )
    turn = ask(service, opened, question="为什么这样")["turns"][0]
    assert turn["total"] == 0 and turn["state"] == "unconfigured"


# 已保留资料从应用副本定位，原文件移走后仍能选择；失效块不允许伪造来源。
def test_retained_source_selection_snapshot(setup_selection, tmp_path):
    service, _, _ = setup_selection
    original = tmp_path / "选区资料.md"
    original.write_text("# 公平调度\n\n等待队列允许线程轮流执行。", encoding="utf-8")
    document = asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    service.retain(document["id"])
    original.unlink()
    page = service.store.read_source({"id": document["id"], "page": 0})
    block = page["items"][0]
    source = {"kind": "source", "id": document["id"], "page": 0, "block_id": block["id"]}
    opened = service.selection.open({"source": source, "quote": block["text"]})
    assert opened["locator"] == block["locator"]
    assert opened["source_title"] == page["name"]
    with pytest.raises(ValueError, match="不存在"):
        service.selection.open(
            {"source": {**source, "block_id": "missing"}, "quote": block["text"]}
        )


# 有限会话内存校验发生在新轮次之前；超限不发请求，也不移除已有内容。
def test_memory_budget_rejects_before_paid_request(setup_selection):
    service, _, opened = setup_selection
    bodies = mock_model(service)
    internal = service.selection.sessions[opened["id"]]
    internal["notice"] = "界" * 180000
    with pytest.raises(ValueError, match="接近上限"):
        ask(service, opened)
    assert internal["turns"] == [] and bodies == []
