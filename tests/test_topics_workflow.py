# 文件：test_topics_workflow.py
# 层：验证
# 作用：验证知识点目录、延迟学习、范围、取消和增量核对流程。
# 说明：使用合成生成器与临时库，不访问网络或系统凭据。
import asyncio
import json

import pytest
from knowledge_agent.application.topic_context import learning_context
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.topic_rules import MAX_SESSIONS, validate_plan
from knowledge_agent.entrypoints.dispatch import dispatch
from review_fixtures import approved_points
from test_knowledge import Vault, config


class Client:
    # 生成器捕获实际请求，可在提交前制造挂起或取消边界。
    def __init__(self):
        self.calls = []
        self.target = False
        self.conflict = False
        self.cancel = False
        self.gate = None
        self.content = "指数退避通过逐步增加等待间隔缓解重连压力。"

    # 规划仅产生标签，正文调用只返回完整合法结构。
    async def generate(self, config, prompt, purpose, _emit):
        value = json.loads(prompt)
        self.calls.append((dict(config), value, purpose))
        if purpose == "topic-plan":
            target = value["candidates"][0]["id"] if self.target and value["candidates"] else ""
            return json.dumps(
                {
                    "points": [
                        {
                            "title": "重连退避",
                            "theme": "网络",
                            "facet": "重连失败后如何逐步退避",
                            "target_id": target,
                        },
                        {"title": "界面响应", "theme": "交互", "facet": "如何避免阻塞界面"},
                    ]
                }
            )
        if purpose == "topic-review":
            return approved_points(value["points"])
        if self.gate:
            await self.gate.wait()
        if self.cancel:
            asyncio.current_task().cancel()
        return json.dumps(
            {
                "title": "模型忽略的原问题标题",
                "content": self.content,
                "citation_ids": [b["id"] for b in value["evidence"][:1]],
                "conflict": self.conflict,
                "recommendations": [
                    {"title": "抖动策略", "reason": "分散重连峰值", "preview": "随机化退避间隔"}
                ],
            }
        )


# 每个服务独立拥有临时数据库、附件及合成生成器。
@pytest.fixture
def service(tmp_path):
    value = create_service(tmp_path / "data", vault=Vault())
    value.client = Client()
    yield value
    value.close()


# 通过真实入口调用，覆盖新操作的协议路由及运行时参数校验。
async def plan(service, **params):
    return await dispatch(
        service,
        "question.plan",
        {"query": "重连退避和界面响应应分别如何处理？", "scope": "knowledge", **params},
        lambda _: None,
    )


# 单点操作与目录关联，拒绝客户端绕过候选授权。
async def learn(service, directory, index=0, **params):
    return await dispatch(
        service,
        "knowledge.learn",
        {"plan_id": directory["plan_id"], "point_id": directory["points"][index]["id"], **params},
        lambda _: None,
    )


# 离线独立检索、无接口拆解均不访问生成器；已有命中和片段仍可打开。
def test_offline_keeps_local_results(service):
    note = service.store.save("重连退避", "本地手工内容")

    # 无接口返回明确的本地目录；没有伪造模型分类或正式收录。
    async def run():
        search = await dispatch(service, "knowledge.search", {"query": "重连退避"}, lambda _: None)
        assert search["items"][0]["knowledge_id"] == note["id"]
        result = await plan(service)
        assert not result["points"] and not result["plan_id"]
        assert result["search"]["items"] and "未调用模型" in result["notice"]
        assert service.client.calls == []

    asyncio.run(run())


# 规划和打开标签不收录；同一目录项并发点击只生成一次，其他点保持未生成。
def test_lazy_directory_and_concurrent_reuse(service):
    config(service)

    # 两次同时请求同一点经过用例锁，不产生重复生成和重复知识。
    async def run():
        directory = await plan(service)
        assert len(directory["points"]) == 2 and not service.store.list_knowledge()
        results = await asyncio.gather(learn(service, directory), learn(service, directory))
        assert results[0]["knowledge"]["id"] == results[1]["knowledge"]["id"]
        assert results[0]["knowledge"]["title"] == "重连退避"
        assert results[0]["recommendations"][0]["title"] == "抖动策略"
        assert len(service.store.list_knowledge()) == 1
        assert [call[2] for call in service.client.calls] == [
            "topic-plan",
            "topic-review",
            "topic-learn",
        ]
        assert service.store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 0

    asyncio.run(run())


# 后续提问即使文字完全相同也能带来补充，先预览后确认，手工原文始终不变。
def test_supplement_review_and_repeat_question(service):
    config(service)
    original = service.store.save("重连退避", "用户写的连接说明")
    service.client.target = True

    # 确认同一预览多次不重复，下一次新问题不会被旧的问题映射挡住。
    async def run():
        directory = await plan(service)
        assert directory["points"][0]["target_id"] == original["id"]
        preview = await learn(service, directory, action="supplement", target_id=original["id"])
        assert preview["review"] and preview["knowledge"] is None
        assert service.store.get(original["id"])["supplements"] == []
        saved = await learn(service, directory, action="confirm")
        assert saved["knowledge"]["id"] == original["id"]
        assert saved["knowledge"]["content"] == original["content"]
        assert len(saved["knowledge"]["supplements"]) == 1
        assert (
            len((await learn(service, directory, action="confirm"))["knowledge"]["supplements"])
            == 1
        )
        service.client.content = "新证据提出随机抖动，避免重连尖峰。"
        later = await plan(service)
        await learn(service, later, action="supplement", target_id=original["id"])
        enriched = await learn(service, later, action="confirm")
        assert len(enriched["knowledge"]["supplements"]) == 2
        assert service.store.search({"query": "随机抖动"})["total"] == 1

    asyncio.run(run())


# 预览后目标发生编辑或删除均拒绝提交，不能覆盖或重建该目标。
@pytest.mark.parametrize("delete", [False, True])
def test_stale_preview_does_not_write(service, delete):
    config(service)
    note = service.store.save("重连退避", "手工旧版本")
    service.client.target = True

    # 乐观版本在确认提交边界重新读取，而非相信生成开始时的状态。
    async def run():
        directory = await plan(service)
        await learn(service, directory, action="supplement", target_id=note["id"])
        if delete:
            service.store.delete_knowledge(note["id"])
        else:
            service.store.save("重连退避", "用户手工新版本", item_id=note["id"])
        with pytest.raises(ValueError, match="已被修改|不存在"):
            await learn(service, directory, action="confirm")
        assert service.store.db.execute("SELECT count(*) FROM supplements").fetchone()[0] == 0
        if not delete:
            assert service.store.get(note["id"])["content"] == "用户手工新版本"

    asyncio.run(run())


# 冲突结果必须停留在预览，明确选择独立保存后才会收录。
def test_conflict_requires_review_and_separate_capture(service):
    config(service)
    service.client.conflict = True

    # 独立保存不带旧目标，也不允许无目标执行补充确认。
    async def run():
        directory = await plan(service)
        assert (await learn(service, directory))["review"]
        assert not service.store.list_knowledge()
        with pytest.raises(ValueError, match="无补充目标"):
            await learn(service, directory, action="confirm")
        saved = await learn(service, directory, action="separate")
        assert saved["knowledge"]["theme"] == "网络／通用方法"

    asyncio.run(run())


# 取消发生在网络等待或最终提交让出点，都不收录第二点，第一点保持已提交。
@pytest.mark.parametrize("boundary", [False, True])
def test_cancellation_preserves_prior_commits(service, boundary):
    config(service)

    # 精确控制第二次生成，验证取消未被吞掉并且没有残缺事务。
    async def run():
        directory = await plan(service)
        first = await learn(service, directory)
        service.client.cancel = boundary
        if not boundary:
            service.client.gate = asyncio.Event()
        task = asyncio.create_task(learn(service, directory, index=1))
        while len(service.client.calls) < 4:
            await asyncio.sleep(0)
        if not boundary:
            task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(service.store.list_knowledge()) == 1
        assert service.store.get(first["knowledge"]["id"])["title"] == "重连退避"

    asyncio.run(run())


# 文件范围规划与学习没有库内候选/证据，离线片段也可分页打开；移除附件撤销旧目录。
def test_file_scope_and_attachment_revocation(service):
    service.store.save("重连退避", "library-secret 不得发往文件范围")
    service.attachments["doc"] = {
        "id": "doc",
        "name": "附件",
        "retained": False,
        "warnings": [],
        "blocks": [
            {"id": f"b{i}", "locator": f"第{i}段", "text": f"退避原文{i}"} for i in range(35)
        ],
    }

    # 先验证无模型，再验证模型实际收到的范围及附件移除边界。
    async def run():
        offline = await plan(service, query="退避", scope="files", attachment_ids=["doc"])
        assert offline["search"]["total"] == 35
        page = await dispatch(
            service,
            "knowledge.search",
            {"query": "退避", "scope": "files", "attachment_ids": ["doc"], "page": 1},
            lambda _: None,
        )
        assert len(page["items"]) == 5 and page["items"][0]["citation"]["source_id"] == "doc"
        config(service)
        directory = await plan(service, query="退避", scope="files", attachment_ids=["doc"])
        assert "library-secret" not in json.dumps(service.client.calls, ensure_ascii=False)
        assert directory["points"][0]["candidates"] == []
        with pytest.raises(ValueError, match="范围|候选"):
            await learn(service, directory, action="supplement", target_id="forged")
        captured = await learn(service, directory)
        assert captured["knowledge"]["citations"][0]["source_id"] == "doc"
        del service.attachments["doc"]
        with pytest.raises(ValueError, match="附件已移除"):
            await learn(service, directory, index=1)

    asyncio.run(run())


# 会话淘汰后旧目录拒绝写入，损坏规划失败时仍能取得本地结果。
def test_expired_directory_and_invalid_plan(service):
    config(service)
    service.store.save("重连退避", "可离线读取")

    # 超过明确会话上限淘汰最早目录，不允许旧响应恢复被释放的权限。
    async def run():
        first = await plan(service)
        for _ in range(MAX_SESSIONS):
            await plan(service)
        with pytest.raises(ValueError, match="目录已过期"):
            await learn(service, first)
        assert not service.store.get(service.store.list_knowledge()[0]["id"])["supplements"]

    asyncio.run(run())


# 规划结构错误不会抹掉已经查到的本地知识，更不会把目录或文章误收录。
def test_invalid_generation_preserves_local_search(service):
    config(service)
    note = service.store.save("重连退避", "离线仍可使用")

    # 此生成器故意返回不完整 JSON，模拟供应商没有遵守结构约束。
    async def invalid(*_args):
        return '{"points":'

    service.client.generate = invalid
    result = asyncio.run(plan(service))
    assert not result["plan_id"] and not result["points"]
    assert "拆解失败" in result["notice"]
    assert result["search"]["items"][0]["knowledge_id"] == note["id"]
    assert len(service.store.list_knowledge()) == 1


# 补充上下文与证据共用总预算，裁剪明确披露，引用白名单只含实际发送的证据。
def test_supplement_context_budget():
    session = {"evidence": [{"id": str(i), "text": "证据" * 2000} for i in range(7)]}
    current = {
        "id": "target",
        "theme": "网络",
        "title": "重连",
        "content": "原文" * 60000,
        "supplements": [{"title": "旧补充", "content": "旧内容" * 30000}],
    }
    evidence, existing, notice = learning_context(session, current)
    total = sum(len(b["text"]) for b in evidence) + sum(
        len(p["content"]) for p in existing["parts"]
    )
    assert total <= 28000 and len(evidence) == 3
    assert "3/7" in notice and "不得声称已核对全部" in notice
    assert len(current["content"]) == 120000


# 不合法目录、原问题标题、越权引用和目标必须整体拒绝而非截断采用。
@pytest.mark.parametrize("change", ["duplicate", "raw", "limit", "citation", "target", "title"])
def test_plan_validation(change):
    query = "如何完成相机接入、界面响应以及设备重连处理？"
    point = {"theme": "设备", "title": "相机接入", "facet": "如何接入设备"}
    points = [dict(point)]
    if change == "duplicate":
        points.append(dict(point))
    elif change == "raw":
        points[0]["title"] = query
    elif change == "limit":
        points *= 17
    elif change == "citation":
        points[0]["citation_ids"] = ["unknown"]
    elif change == "target":
        points[0]["target_id"] = "unknown"
    else:
        points[0]["title"] = "标题" * 50
    with pytest.raises(ValueError):
        validate_plan(json.dumps({"points": points}), query, [], [])
