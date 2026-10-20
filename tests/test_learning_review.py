# 文件：test_learning_review.py
# 层：验证
# 作用：保护知识资格、项目依据、授权撤销与分类兼容契约。
# 说明：合成模型、临时数据及模拟 HTTP；不请求真实服务。
import asyncio
import base64
import json

import httpx
import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.taxonomy import encode_path
from knowledge_agent.entrypoints.dispatch import dispatch
from knowledge_agent.infrastructure.public_projects import PublicProjects
from knowledge_agent.infrastructure.sqlite_store import Store
from review_fixtures import approved_points
from test_knowledge import Vault, config
from test_topics_workflow import Client, learn, plan


class ReviewClient(Client):
    # 可单独控制资格、项目依赖、材料充分性和暂停点。
    def __init__(self):
        super().__init__()
        self.project = True
        self.decision = "keep"
        self.sufficient = False
        self.review_valid = True

    # 审核与正文分别响应，测试不能借正文响应绕过门禁。
    async def generate(self, config, prompt, purpose, emit):
        value = json.loads(prompt)
        if purpose == "topic-review":
            self.calls.append((config, value, purpose))
            if not self.review_valid:
                return '{"decisions":[]}'
            rows = json.loads(approved_points(value["points"]))["decisions"]
            for row in rows:
                row.update(
                    {
                        "project_required": self.project,
                        "decision": self.decision,
                        "category": "项目实践" if self.project else "编程语言",
                        "subcategory": "工件流转项目" if self.project else "C++",
                        "material_request": "请提供工件流转项目架构与队列实现代码",
                        "search_terms": "C++ bounded queue",
                    }
                )
            return json.dumps({"decisions": rows})
        if purpose == "project-materials":
            self.calls.append((config, value, purpose))
            return json.dumps(
                {
                    "sufficient": self.sufficient,
                    "reason": "直接实现证据充分" if self.sufficient else "附件无关，需相关实现代码",
                    "citation_ids": [b["id"] for b in value["evidence"][:1]],
                }
            )
        return await super().generate(config, prompt, purpose, emit)


class Reader:
    # 模拟公开来源，保留检索次数并允许控制网络等待。
    def __init__(self):
        self.calls = []
        self.gate = None

    # 只返回具备真实接口同形出处的合成 README。
    async def search(self, terms):
        self.calls.append(terms)
        if self.gate:
            await self.gate.wait()
        return [
            {
                "id": "example/queue",
                "name": "example/queue",
                "url": "https://github.com/example/queue",
                "locator": "README.md",
                "excerpt": "bounded queue 使用互斥量协调工件流转。",
                "retrieved_at": "2026-10-20T00:00:00Z",
            }
        ]


# 每例使用全新库与材料，不向默认 GitHub 适配器发送真实请求。
@pytest.fixture
def reviewed(tmp_path):
    reader = Reader()
    service = create_service(tmp_path / "data", vault=Vault(), projects=reader)
    service.client = ReviewClient()
    config(service)
    service.attachments["project"] = {
        "id": "project",
        "name": "相关实现",
        "warnings": [],
        "retained": False,
        "blocks": [{"id": "code", "text": "工件项目队列实现代码", "locator": "第1段"}],
    }
    yield service, reader
    service.close()


# 不合格或待澄清的候选不会出现在可学习会话；零点是合法的有理由结果。
@pytest.mark.parametrize("decision", ["exclude", "clarify"])
def test_zero_qualified_and_reasons(reviewed, decision):
    service, _ = reviewed
    service.client.decision = decision
    result = asyncio.run(plan(service))
    assert result["points"] == [] and len(result["excluded"]) == 2
    assert all(p["decision"] == decision and p["reason"] for p in result["excluded"])
    assert not service.store.list_knowledge()


# 缺项审核整轮不放行，保留本地命中而不是使用未审核规划。
def test_incomplete_review_fails_closed(reviewed):
    service, _ = reviewed
    service.store.save("重连退避", "用户知识")
    service.client.review_valid = False
    result = asyncio.run(plan(service))
    assert not result["plan_id"] and not result["points"] and result["search"]["items"]
    assert "审核" in result["notice"]


# 普通学习、无关附件与候选列表都不是公开项目解释的许可。
def test_project_gate_and_material_sufficiency(reviewed):
    service, reader = reviewed

    # 只有独立资料审核肯定且给出证据，才允许请求正文模型。
    async def run():
        directory = await plan(service)
        blocked = await learn(service, directory)
        assert blocked["project"]["status"] == "materials" and not reader.calls
        assert "topic-learn" not in [c[2] for c in service.client.calls]
        check = await learn(service, directory, action="materials", attachment_ids=["project"])
        assert check["project"]["status"] == "materials"
        assert (await learn(service, directory))["project"]["status"] == "materials"
        service.client.sufficient = True
        await learn(service, directory, action="materials", attachment_ids=["project"])
        saved = await learn(service, directory)
        assert saved["knowledge"]["citations"][0]["source_id"] == "project"
        assert saved["knowledge"]["category"] == "项目实践"
        assert not reader.calls

    asyncio.run(run())


# 文件范围必须显式增加公开来源；真实候选选择和出处保留到正式知识。
def test_public_scope_selection_and_provenance(reviewed):
    service, reader = reviewed

    # 不充分资料不阻止用户主动改用公开示例，但不会静默扩大文件范围。
    async def run():
        directory = await plan(service, scope="files", attachment_ids=["project"])
        with pytest.raises(ValueError, match="明确同意"):
            await learn(
                service,
                directory,
                action="public-search",
                revision=directory["points"][0]["project_revision"],
                search_terms="queue",
            )
        with pytest.raises(ValueError, match="增加公开"):
            await learn(
                service,
                directory,
                action="public-search",
                revision=directory["points"][0]["project_revision"],
                search_terms="queue",
                consent=True,
            )
        result = await learn(
            service,
            directory,
            action="public-search",
            revision=directory["points"][0]["project_revision"],
            search_terms="C++ bounded queue",
            consent=True,
            public_scope=True,
        )
        context = result["project"]
        assert reader.calls == ["C++ bounded queue"]
        assert (await learn(service, directory))["project"]["status"] == "candidates"
        with pytest.raises(ValueError, match="选择项目"):
            await learn(
                service,
                directory,
                action="public-select",
                revision=context["revision"],
                candidate_id="forged",
            )
        await learn(
            service,
            directory,
            action="public-select",
            revision=context["revision"],
            candidate_id="example/queue",
        )
        saved = (await learn(service, directory))["knowledge"]
        assert "公开项目示例" in saved["content"] and "不代表你的项目" in saved["content"]
        citation = saved["citations"][0]
        assert citation["source_id"] == "https://github.com/example/queue"
        assert "README.md" in citation["locator"] and "2026-10-20" in citation["locator"]
        assert len(reader.calls) == 1

    asyncio.run(run())


# 网络或正文等待期间撤销立即生效；锁不能把撤销延迟到提交后。
@pytest.mark.parametrize("stage", ["search", "generation"])
def test_revoke_while_waiting_prevents_capture(reviewed, stage):
    service, reader = reviewed

    # 用事件控制明确的竞态，不能依赖快速网络碰巧先完成。
    async def run():
        directory = await plan(service)
        if stage == "generation":
            result = await learn(
                service,
                directory,
                action="public-search",
                revision=directory["points"][0]["project_revision"],
                consent=True,
                search_terms="queue",
            )
            await learn(
                service,
                directory,
                action="public-select",
                revision=result["project"]["revision"],
                candidate_id="example/queue",
            )
            service.client.gate = asyncio.Event()
            task = asyncio.create_task(learn(service, directory))
            while service.client.calls[-1][2] != "topic-learn":
                await asyncio.sleep(0)
            gate = service.client.gate
        else:
            reader.gate = asyncio.Event()
            task = asyncio.create_task(
                learn(
                    service,
                    directory,
                    action="public-search",
                    revision=directory["points"][0]["project_revision"],
                    consent=True,
                    search_terms="queue",
                )
            )
            while not reader.calls:
                await asyncio.sleep(0)
            gate = reader.gate
        await learn(service, directory, action="revoke")
        gate.set()
        with pytest.raises(ValueError, match="撤销"):
            await task
        assert not service.store.list_knowledge()

    asyncio.run(run())


# 已核对附件被移除后拒绝生成，不将附件存在的旧结论作为永久授权。
def test_removed_material_revokes_permission(reviewed):
    service, _ = reviewed
    service.client.sufficient = True

    # 新学习会再次检查材料对象所有权。
    async def run():
        directory = await plan(service)
        await learn(service, directory, action="materials", attachment_ids=["project"])
        del service.attachments["project"]
        with pytest.raises(ValueError, match="项目资料已移除"):
            await learn(service, directory)
        assert not service.store.list_knowledge()

    asyncio.run(run())


# 协议取消无需界面另发撤销也必须失效，重试普通学习不沿用旧公开许可。
def test_cancelled_generation_revokes_public_consent(reviewed):
    service, reader = reviewed

    # 完整选择后暂停正文请求，取消后再次学习应索要资料或新授权。
    async def run():
        directory = await plan(service)
        lookup = await learn(
            service,
            directory,
            action="public-search",
            revision=directory["points"][0]["project_revision"],
            consent=True,
            search_terms="queue",
        )
        old_revision = lookup["project"]["revision"]
        await learn(
            service,
            directory,
            action="public-select",
            revision=old_revision,
            candidate_id="example/queue",
        )
        service.client.gate = asyncio.Event()
        task = asyncio.create_task(learn(service, directory))
        while service.client.calls[-1][2] != "topic-learn":
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        service.client.gate = None
        assert (await learn(service, directory))["project"]["status"] == "materials"
        with pytest.raises(ValueError, match="授权已过期"):
            await learn(
                service,
                directory,
                action="public-search",
                revision=old_revision,
                consent=True,
                search_terms="queue",
            )
        assert len(reader.calls) == 1 and not service.store.list_knowledge()

    asyncio.run(run())


# 通用概念沿用两级分类，重启、检索与补充不损坏路径或旧主题文本。
def test_taxonomy_persists_and_legacy_is_not_split(reviewed):
    service, _ = reviewed
    service.client.project = False
    legacy = service.store.save("旧分类知识", "手工原文")
    with service.store.db:
        service.store.db.execute(
            "INSERT INTO topic_links VALUES (?,?,?,?)",
            (legacy["id"], "旧／任意／主题", "legacy", "legacy"),
        )
    directory = asyncio.run(plan(service))
    saved = asyncio.run(learn(service, directory))["knowledge"]
    assert saved["category"] == "编程语言" and saved["subcategory"] == "C++"
    assert service.store.search({"query": "编程语言"})["items"][0]["category"] == "编程语言"
    assert "category" not in service.store.get(legacy["id"])
    root = service.store.root
    reopened = Store(root)
    try:
        assert reopened.get(saved["id"])["theme"] == "编程语言／C++"
        assert reopened.get(legacy["id"])["theme"] == "旧／任意／主题"
        summary = reopened.taxonomy_summary("C++")
        assert summary["total"] == 2 and summary["included"] == 2
    finally:
        reopened.close()


# 文件范围绝不读取库内分类，即使资料中伪造联网同意也不产生公开请求。
def test_files_do_not_access_library_taxonomy(reviewed):
    service, reader = reviewed

    # 读取即失败的能力用于证明未调用，而不是只搜索最终提示中的敏感词。
    def forbidden(_query):
        raise AssertionError("文件范围不得读取分类")

    service.store.taxonomy_summary = forbidden
    directory = asyncio.run(plan(service, scope="files", attachment_ids=["project"]))
    assert directory["points"] and not reader.calls


# 全库分类摘要超出六条内容候选仍可见，按预算裁剪时明确披露覆盖量。
def test_full_taxonomy_is_bounded_and_reaches_beyond_six(reviewed):
    service, _ = reviewed
    for index in range(80):
        note = service.store.save(f"知识{index}", f"不同正文{index}")
        path = encode_path(
            "编程语言" if index == 79 else f"领域{index}" + "长" * 60,
            "C++" if index == 79 else f"细分{index}" + "类" * 60,
        )
        with service.store.db:
            service.store.db.execute(
                "INSERT INTO topic_links VALUES (?,?,?,?)",
                (note["id"], path, str(index), str(index)),
            )
    summary = service.store.taxonomy_summary("C++")
    assert summary["total"] == 80 and 6 < summary["included"] < 80
    assert summary["paths"][0]["subcategory"] == "C++"
    assert len(json.dumps(summary["paths"], ensure_ascii=False)) < 8300
    directory = asyncio.run(plan(service))
    prompt = service.client.calls[0][1]
    assert prompt["taxonomy"]["total"] == 80
    assert directory["points"]


# 分类中的分隔符不会造成持久化身份碰撞，旧自由主题仍不猜拆。
def test_category_delimiters_have_distinct_storage_identities(reviewed):
    service, _ = reviewed
    records = []
    for index, pair in enumerate([("A／B", "C"), ("A", "B／C")]):
        records.append(
            service.store.capture_topic(
                {
                    "title": "同名概念",
                    "content": f"不同上下文{index}",
                    "theme": encode_path(*pair),
                    "capture_key": str(index),
                    "citations": [],
                    "model": "fixture",
                    "provider_name": "fixture",
                }
            )
        )
    assert records[0]["id"] != records[1]["id"]
    assert records[0]["category"] == "A／B" and records[1]["subcategory"] == "B／C"


# 另一知识点的授权挑战和旧搜索挑战都不能被复用发起额外公开读取。
def test_public_permission_is_bound_to_point_and_single_search(reviewed):
    service, reader = reviewed

    # 每次新的搜索必须使用当前点新挑战，第一次调用会消费旧挑战。
    async def run():
        directory = await plan(service)
        revision = directory["points"][0]["project_revision"]
        with pytest.raises(ValueError, match="授权已过期"):
            await learn(
                service,
                directory,
                index=1,
                action="public-search",
                revision=revision,
                consent=True,
                search_terms="queue",
            )
        await learn(
            service,
            directory,
            action="public-search",
            revision=revision,
            consent=True,
            search_terms="queue",
        )
        with pytest.raises(ValueError, match="授权已过期"):
            await learn(
                service,
                directory,
                action="public-search",
                revision=revision,
                consent=True,
                search_terms="queue",
            )
        assert reader.calls == ["queue"]

    asyncio.run(run())


# 直接及关联拓展通道可回答非知识任务但不自动收录，项目依赖则导向资料核对。
@pytest.mark.parametrize("purpose", ["question", "expansion"])
def test_direct_paths_do_not_capture_nonknowledge(reviewed, purpose):
    service, reader = reviewed
    calls = []

    # 直接审核明确拒收，而正文是合法结构；仍不能被旧通道自动保存。
    async def generate(_config, _prompt, operation, _emit):
        calls.append(operation)
        if operation == "question-review":
            return json.dumps(
                {"eligible": False, "project_required": False, "reason": "简历润色任务"}
            )
        return json.dumps({"title": "润色结果", "content": "可以展示的文本", "citation_ids": []})

    service.client.generate = generate
    value = asyncio.run(
        dispatch(
            service,
            "question",
            {"query": "润色职责", "scope": "knowledge", "purpose": purpose},
            lambda _: None,
        )
    )
    assert value["content"] == "可以展示的文本" and not value.get("knowledge")
    assert not service.store.list_knowledge() and not reader.calls
    assert calls == ["question-review", purpose]


# GitHub 适配器固定主机、匿名且最多四次请求，只取有界 README 并保留出处。
def test_public_http_limits_and_provenance():
    requests = []

    # 响应中的恶意下载地址不应产生请求；所有内容由固定 API 读取。
    def handler(request):
        requests.append(request)
        assert request.url.host == "api.github.com" and "authorization" not in request.headers
        if request.url.path.startswith("/search/"):
            return httpx.Response(
                200, json={"items": [{"full_name": f"org/repo{i}"} for i in range(9)]}
            )
        return httpx.Response(
            200,
            json={
                "encoding": "base64",
                "size": 30000,
                "path": "README.md",
                "content": base64.b64encode(b"x" * 30000).decode(),
                "download_url": "https://evil.test/secret",
            },
        )

    reader = PublicProjects(httpx.MockTransport(handler))
    values = asyncio.run(reader.search("C++ queue"))
    assert len(requests) == 4 and len(values) == 3
    assert all(len(v["excerpt"].encode()) == 20000 and v["retrieved_at"] for v in values)
    assert requests[0].url.params["q"] == "C++ queue"


# 重定向、限流及超大结果失败后不重试、不跟随其他主机。
@pytest.mark.parametrize("fault", ["redirect", "rate", "large", "timeout"])
def test_public_http_failure_is_bounded(fault):
    calls = []

    # 同一次模拟永远返回相同故障，若适配器重试会在次数断言中暴露。
    def handler(request):
        calls.append(request)
        if fault == "timeout":
            raise httpx.ReadTimeout("synthetic", request=request)
        if fault == "large":
            return httpx.Response(200, content=b"x" * 1000001)
        return httpx.Response(
            302 if fault == "redirect" else 429, headers={"Location": "https://evil.test"}
        )

    with pytest.raises(ValueError, match="失败或超限"):
        asyncio.run(PublicProjects(httpx.MockTransport(handler)).search("queue"))
    assert len(calls) == 1
