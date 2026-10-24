# 文件：test_direct_questions.py
# 层：验证
# 作用：验证直接问答的先检索、一次调用、偏好与有界证据。
# 说明：只调用本机模拟供应商，不读取正式凭据或用户问题。
import asyncio
import json
from contextlib import closing

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.direct_prompt import direct_prompt
from knowledge_agent.domain.memory_rules import DEFAULT_MEMORY
from knowledge_agent.entrypoints.dispatch import dispatch
from test_knowledge import Vault
from test_selection_questions import mock_model


# 普通问题具有独立会话，不伪造阅读来源；后续收录仍需显式确认。
def opened(service, query="如何保护共享数据"):
    return service.selection.open_direct(
        {"query": query, "scope": "knowledge", "attachment_ids": []}
    )


# 有命中与无命中都恰好一次生成，重复同轮不计费，不自动入库。
@pytest.mark.parametrize("has_hit", [False, True])
def test_direct_single_call_and_bounded_evidence(tmp_path, has_hit):
    with closing(create_service(tmp_path, vault=Vault())) as service:
        if has_hit:
            service.store.save_note(
                {
                    "title": "共享数据保护",
                    "content": "互斥锁保护共享数据",
                    "category_path": ["编程", "线程"],
                }
            )
        bodies = mock_model(service)
        service.store.memory_update({"detail": "简洁"})
        session = opened(service)
        params = {
            "session_id": session["id"],
            "turn_id": "same-turn",
            "action": "lookup",
            "question": "如何保护共享数据",
            "answer_mode": "direct",
        }
        result = asyncio.run(dispatch(service, "selection.ask", params, lambda _: None))
        assert result["turns"][0]["state"] == "answered"
        assert len(bodies) == 1
        payload = json.loads(bodies[0]["input"])
        assert bool(payload["evidence"]) is has_hit
        assert payload["preferences"]["detail"] == "简洁"
        assert "topics" not in payload and "reading_days" not in payload
        asyncio.run(dispatch(service, "selection.ask", params, lambda _: None))
        assert len(bodies) == 1
        assert service.store.memory_state()["topics"][0]["count"] == 1
        assert len(service.store.list_knowledge()) == int(has_hit)


# 词法存储失败不能解释成无命中并调用模型，统计也不应写成已成功检索。
def test_direct_lookup_failure_never_pays(tmp_path, monkeypatch):
    with closing(create_service(tmp_path, vault=Vault())) as service:
        bodies = mock_model(service)
        session = opened(service)

        # 注入真实查询边界故障，要求错误传播到调用者。
        def broken(_params):
            raise sqlite_error

        sqlite_error = ValueError("fixture lookup error")
        monkeypatch.setattr(service.store, "search", broken)
        with pytest.raises(ValueError, match="lookup error"):
            asyncio.run(
                dispatch(
                    service,
                    "selection.ask",
                    {
                        "session_id": session["id"],
                        "turn_id": "failure",
                        "action": "lookup",
                        "question": "私密完整问题不应持久化",
                    },
                    lambda _: None,
                )
            )
        assert bodies == [] and service.store.memory_state()["topics"] == []
        assert (
            service.selection.get({"session_id": session["id"]})["turns"][0]["state"]
            == "lookup-failed"
        )


# 严格文件范围不得读取本地知识或记录知识兴趣，证据不足需明确说明。
def test_direct_files_scope_never_reads_knowledge(tmp_path, monkeypatch):
    with closing(create_service(tmp_path / "data", vault=Vault())) as service:
        source = tmp_path / "合成文件.md"
        source.write_text("# 文件范围\n\n仅本文件允许作为本轮依据。", encoding="utf-8")
        attachment = asyncio.run(service.add_attachment({"path": str(source)}, lambda _: None))
        bodies = mock_model(
            service,
            text=json.dumps(
                {
                    "title": "依据不足",
                    "content": "本文件没有提供答案。",
                    "citation_ids": [],
                    "insufficient": True,
                }
            ),
        )
        session = service.selection.open_direct(
            {"query": "材料说明了什么", "scope": "files", "attachment_ids": [attachment["id"]]}
        )

        # 如果范围泄漏，这个边界会立即失败，不容许借语义降级掩盖。
        def forbidden(_params):
            raise AssertionError("files scope accessed knowledge")

        monkeypatch.setattr(service.store, "search", forbidden)
        result = asyncio.run(
            dispatch(
                service,
                "selection.ask",
                {
                    "session_id": session["id"],
                    "turn_id": "files",
                    "action": "lookup",
                    "question": "材料说明了什么",
                },
                lambda _: None,
            )
        )
        assert result["turns"][0]["state"] == "answered" and len(bodies) == 1
        assert service.store.memory_state()["topics"] == []
        assert json.loads(bodies[0]["input"])["scope"] == "files"


# 预算裁剪只丢最早历史和低排名证据，当前完整问题始终保留。
def test_direct_prompt_budget_preserves_question_and_limits_evidence():
    question = "当前问题" * 2000
    turn = {
        "question": question,
        "candidates": [
            {"id": str(i), "title": "资料", "excerpt": "证据" * 2000, "knowledge_id": str(i)}
            for i in range(20)
        ],
    }
    prior = [
        {"question": "旧问题" * 100, "content": "旧回答" * 100, "state": "answered"}
        for _ in range(20)
    ]
    session = {"quote": "选区" * 3000, "turns": prior + [turn]}
    prompt, notice, evidence = direct_prompt(session, turn, dict(DEFAULT_MEMORY))
    value = json.loads(prompt)
    assert value["question"] == question and len(prompt) <= 28000
    assert len(evidence) <= 5 and sum(len(e["text"]) for e in evidence) <= 6000
    assert len(json.dumps(value["history"], ensure_ascii=False)) <= 4000
    assert "兴趣统计未发送" in notice
