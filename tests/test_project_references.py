# 文件：test_project_references.py
# 层：验证
# 作用：保护项目路径登记、自动复用、有界读取及撤销契约。
# 说明：合成目录和模拟模型，不读取用户工程或正式凭据。
import asyncio
import json
import logging
import os
import subprocess
import threading
from contextlib import closing
from pathlib import Path

import pytest
from docx import Document
from knowledge_agent.application.local_projects import LocalProjects
from knowledge_agent.bootstrap import create_service
from knowledge_agent.diagnostics import LOGGER, request_context
from knowledge_agent.domain.project_references import MAX_PROJECT_CHARS, match_reference
from knowledge_agent.entrypoints.dispatch import dispatch
from knowledge_agent.infrastructure.project_registry import ProjectRegistry
from test_knowledge import Vault, config


# 合成代码与文档工程不与应用数据目录混用，原件可在删除登记后复核。
def project(tmp_path):
    root = tmp_path / "original-project"
    root.mkdir()
    (root / "queue.cpp").write_text("void queue() { /* QUEUE_UNIQUE */ }", encoding="utf-8")
    (root / "README.md").write_text("# AlphaEngine\nqueue.cpp 实现有界队列。", encoding="utf-8")
    return root


# 显式绑定只属于用户登记时看到的完整分组路径。
def register(registry, root, **extra):
    return registry.save(
        {
            "label": "AlphaEngine",
            "path": str(root),
            "category_path": ["项目实践", "AlphaEngine"],
            **extra,
        }
    )[0]


# 登记不解析、不复制工程；重启保留，编辑与移除只改变路径元数据。
def test_register_restart_edit_remove_without_import(tmp_path, monkeypatch):
    root = project(tmp_path)
    data = tmp_path / "data"
    data.mkdir()
    registry = ProjectRegistry(data)
    monkeypatch.setattr(registry, "read", lambda *_: pytest.fail("登记不能读取正文"))
    row = register(registry, root)
    assert set(p.name for p in data.iterdir()) == {"project-references.json"}
    assert "QUEUE_UNIQUE" not in registry.path.read_text(encoding="utf-8")
    reopened = ProjectRegistry(data)
    assert reopened.list() == [row]
    moved = tmp_path / "moved-project"
    root.rename(moved)
    assert ProjectRegistry(data).list() == [row]
    changed = register(reopened, moved, id=row["id"], label="BetaEngine")
    assert changed["revision"] != row["revision"]
    reopened.delete(row["id"])
    assert ProjectRegistry(data).list() == []
    assert "QUEUE_UNIQUE" in (moved / "queue.cpp").read_text(encoding="utf-8")


# 无效目录、相对路径及重复标签都必须保持原登记，写入失败同样不能假成功。
def test_validation_and_atomic_write_preserve_registry(tmp_path, monkeypatch):
    root = project(tmp_path)
    registry = ProjectRegistry(tmp_path)
    row = register(registry, root)
    for path in ["relative-path", str(root / "missing"), str(root / "queue.cpp")]:
        with pytest.raises(ValueError):
            register(registry, Path(path), id=row["id"])
    with pytest.raises(ValueError, match="标签已存在"):
        register(registry, root, label="alphaengine")

    # 替换失败时旧元数据和内存保持同一版本，临时文件被回收。
    def fail_replace(_source, _target):
        raise OSError("synthetic write failure")

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(OSError):
        register(registry, root, id=row["id"], label="BetaEngine")
    assert registry.list() == ProjectRegistry(tmp_path).list() == [row]
    assert not list(tmp_path.glob("project-references-*.tmp"))


# 标签歧义不猜测，英文完整词匹配避免短项目名串入其他项目。
def test_unique_label_and_explicit_group_matching():
    rows = [
        {"label": "AlphaEngine", "category_path": ["项目", "Alpha"]},
        {"label": "BetaEngine", "category_path": ["项目", "Beta"]},
    ]
    assert match_reference(rows, "AlphaEngine 队列")["label"] == "AlphaEngine"
    assert match_reference(rows, "AlphaEngine 与 BetaEngine") is None
    assert match_reference(rows, "没有名称", ["项目", "Beta"])["label"] == "BetaEngine"
    assert match_reference([{"label": "app", "category_path": []}], "happy") is None
    assert match_reference(rows, "完全不同的项目") is None


# 预览不读正文，按需读取同时排除密钥、依赖、构建、二进制和超大文件。
def test_bounded_mixed_project_and_tree_only(tmp_path, monkeypatch):
    root = project(tmp_path)
    for name in ["node_modules", "build", ".git"]:
        (root / name).mkdir()
        (root / name / "hidden.txt").write_text("NEVER_SEND_DEPENDENCY", encoding="utf-8")
    (root / ".env").write_text("NEVER_SEND_SECRET", encoding="utf-8")
    (root / "credentials.json").write_text("NEVER_SEND_SECRET", encoding="utf-8")
    (root / "queue_binary.py").write_bytes(b"\x00binary")
    (root / "queue_large.cpp").write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    document = Document()
    document.add_paragraph("queue 文档中的独立约束 DOCX_UNIQUE")
    document.save(root / "queue.docx")
    registry = ProjectRegistry(tmp_path)
    row = register(registry, root)
    preview = registry.read(row, "queue", threading.Event(), True)
    assert preview["evidence"] == []
    assert "queue.cpp" in preview["entries"]
    result = registry.read(row, "queue", threading.Event(), False)
    value = json.dumps(result, ensure_ascii=False)
    assert "QUEUE_UNIQUE" in value and "DOCX_UNIQUE" in value
    assert "NEVER_SEND" not in value and str(root) not in value
    assert "2 MiB" in result["notice"] and "未分析整个项目" in result["notice"]
    assert sum(len(b["text"]) for b in result["evidence"]) <= MAX_PROJECT_CHARS
    assert not list(root.glob("*.tmp"))


# 巨量目录有可见截断说明，不能因只读前缀而宣称已覆盖全部工程。
def test_directory_budget_is_visible(tmp_path, monkeypatch):
    from knowledge_agent.infrastructure import project_reader

    root = project(tmp_path)
    for index in range(8):
        (root / f"entry{index}.txt").write_text("fixture", encoding="utf-8")
    monkeypatch.setattr(project_reader, "MAX_ENTRIES", 4)
    registry = ProjectRegistry(tmp_path)
    result = registry.read(register(registry, root), "queue", threading.Event(), True)
    assert len(result["entries"]) <= 4
    assert "未覆盖整个项目" in result["notice"]


# Windows junction 和文件链接不能将读取扩展到登记根之外。
def test_external_links_are_not_followed(tmp_path):
    root = project(tmp_path)
    outside = tmp_path / "private.txt"
    outside.write_text("EXTERNAL_PRIVATE_TEXT", encoding="utf-8")
    try:
        (root / "linked.txt").symlink_to(outside)
    except OSError:
        pytest.skip("本环境不允许创建符号链接")
    registry = ProjectRegistry(tmp_path)
    result = registry.read(register(registry, root), "linked", threading.Event(), False)
    assert "linked.txt" not in result["entries"]
    assert "EXTERNAL_PRIVATE_TEXT" not in json.dumps(result)


# 不需要符号链接特权的 Windows junction 同样不得穿透项目目录边界。
@pytest.mark.skipif(os.name != "nt", reason="Windows junction 专项")
def test_windows_junction_is_not_followed(tmp_path):
    root = project(tmp_path)
    outside = tmp_path / "external-directory"
    outside.mkdir()
    (outside / "private.txt").write_text("JUNCTION_PRIVATE_TEXT", encoding="utf-8")
    junction = root / "external-link"
    created = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True, check=False
    )
    assert created.returncode == 0
    try:
        registry = ProjectRegistry(tmp_path)
        result = registry.read(register(registry, root), "private", threading.Event(), False)
        assert "external-link/" not in result["entries"]
        assert "JUNCTION_PRIVATE_TEXT" not in json.dumps(result)
    finally:
        # rmdir 只移除本测试创建的 junction，本地外部目标仍保留。
        junction.rmdir()
    assert (outside / "private.txt").is_file()


# 取消真正通知文件线程结束，读槽直到实际工作完成后才释放。
def test_cancelled_read_settles_actual_thread(tmp_path, monkeypatch):
    root = project(tmp_path)
    registry = ProjectRegistry(tmp_path)
    row = register(registry, root)
    entered, finished = threading.Event(), threading.Event()

    # 在受控等待中模拟文件线程，取消后不再产生有效证据。
    def read(_reference, _query, stop, _tree):
        entered.set()
        assert stop.wait(5)
        finished.set()
        raise ValueError("项目读取已取消")

    monkeypatch.setattr(registry, "read", read)

    # 结束前确认退出收束仍拥有线程，而非只取消 asyncio 等待。
    async def run():
        projects = LocalProjects(registry)
        task = asyncio.create_task(projects.read(row, "queue"))
        await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await projects.settle()
        await asyncio.sleep(0)
        assert finished.is_set() and not projects.work

    asyncio.run(run())


class ProjectClient:
    # 模拟生成器保存实际上下文，支持在核对或回答前挂起以测试撤销。
    def __init__(self):
        self.calls = []
        self.sufficient = True
        self.wait = None
        self.started = None

    # 所有引用只来自本次实际发送证据，不读取后台文件或正式服务。
    async def generate(self, _config, prompt, purpose, _emit):
        value = json.loads(prompt)
        self.calls.append((purpose, value))
        if purpose == "topic-plan":
            return json.dumps(
                {
                    "points": [
                        {
                            "title": "队列调度",
                            "theme": "项目实践",
                            "facet": "AlphaEngine queue 实现",
                        }
                    ]
                }
            )
        if purpose == "topic-review":
            return json.dumps(
                {
                    "decisions": [
                        {
                            "id": value["points"][0]["id"],
                            "decision": "keep",
                            "reason": "项目队列机制",
                            "category": "项目实践",
                            "subcategory": "AlphaEngine",
                            "project_required": True,
                            "material_request": "请提供 queue 相关实现",
                            "search_terms": "AlphaEngine queue",
                        }
                    ]
                }
            )
        if self.started:
            self.started.set()
        if self.wait:
            await self.wait.wait()
        ids = [value["evidence"][0]["id"]] if value["evidence"] else []
        if purpose == "project-materials":
            return json.dumps(
                {
                    "sufficient": self.sufficient,
                    "reason": "合成材料核对",
                    "citation_ids": ids if self.sufficient else [],
                }
            )
        return json.dumps(
            {
                "title": "队列调度",
                "content": "由项目中的 queue 实现协调任务。",
                "citation_ids": ids,
                "recommendations": [],
                "conflict": False,
            }
        )


# 通过真实路由登记与规划，自动复用时无须创建任何临时附件。
async def directory(service):
    return await dispatch(
        service,
        "question.plan",
        {"query": "AlphaEngine queue 如何实现", "scope": "knowledge"},
        lambda _: None,
    )


# 重启后的项目学习自动核对已登记目录，证据不足仍不能通过项目门禁。
@pytest.mark.parametrize("sufficient", [True, False])
def test_restarted_topic_reuses_project_with_existing_gate(tmp_path, sufficient):
    root = project(tmp_path)
    data = tmp_path / "data"
    with closing(create_service(data, vault=Vault())) as initial:
        register(initial.local_projects.files, root)
        config(initial)
    with closing(create_service(data, vault=Vault())) as service:
        client = ProjectClient()
        client.sufficient = sufficient
        service.client = client

        # 自动核对后才生成；整个流程不创建项目副本或登记正文。
        async def run():
            plan = await directory(service)
            result = await dispatch(
                service,
                "knowledge.learn",
                {
                    "plan_id": plan["plan_id"],
                    "point_id": plan["points"][0]["id"],
                    "action": "learn",
                },
                lambda _: None,
            )
            assert bool(result.get("knowledge")) is sufficient
            if not sufficient:
                assert result["project"]["status"] == "materials"
            assert not service.attachments
            assert "QUEUE_UNIQUE" in json.dumps(client.calls)
            assert str(root) not in json.dumps(client.calls)
            assert not list(service.snapshots.session.iterdir())

        asyncio.run(run())


# 直接问题自动关联标签，但显式仅文件范围不得暗中读取已登记项目。
@pytest.mark.parametrize("file_only", [False, True])
def test_direct_question_scope_and_automatic_reuse(tmp_path, file_only):
    root = project(tmp_path)
    with closing(create_service(tmp_path / "data", vault=Vault())) as service:
        register(service.local_projects.files, root)
        config(service)
        client = ProjectClient()
        service.client = client
        attachment_ids = []
        if file_only:
            service.attachments["fixture"] = {
                "id": "fixture",
                "name": "指定文件",
                "warnings": [],
                "retained": False,
                "blocks": [
                    {
                        "id": "file-only",
                        "text": "AlphaEngine queue 只准用 FILE_ONLY",
                        "locator": "第 1 行",
                    }
                ],
            }
            attachment_ids = ["fixture"]
        session = service.selection.open_direct(
            {
                "query": "AlphaEngine queue 如何实现",
                "scope": "files" if file_only else "knowledge",
                "attachment_ids": attachment_ids,
            }
        )

        # 所有模型调用都使用真实生成上下文，检查未越过显式范围。
        async def run():
            result = await dispatch(
                service,
                "selection.ask",
                {
                    "session_id": session["id"],
                    "turn_id": "turn-1",
                    "question": "AlphaEngine queue 如何实现",
                    "action": "lookup",
                    "answer_mode": "direct",
                },
                lambda _: None,
            )
            assert result["turns"][0]["state"] == "answered"
            prompt = json.dumps(client.calls, ensure_ascii=False)
            assert ("QUEUE_UNIQUE" in prompt) is not file_only
            assert ("FILE_ONLY" in prompt) is file_only
            assert str(root) not in prompt
            assert not service.store.list_knowledge()

        asyncio.run(run())


# 读取后、模型返回前移除登记，应阻止旧项目结果被保存。
def test_removal_during_project_verification_invalidates_result(tmp_path):
    root = project(tmp_path)
    with closing(create_service(tmp_path / "data", vault=Vault())) as service:
        row = register(service.local_projects.files, root)
        config(service)
        client = ProjectClient()
        service.client = client

        # 精确停在充分性核对期间，删除后不能把旧证据转为可生成许可。
        async def run():
            plan = await directory(service)
            client.wait, client.started = asyncio.Event(), asyncio.Event()
            task = asyncio.create_task(
                dispatch(
                    service,
                    "knowledge.learn",
                    {
                        "plan_id": plan["plan_id"],
                        "point_id": plan["points"][0]["id"],
                        "action": "learn",
                    },
                    lambda _: None,
                )
            )
            await client.started.wait()
            service.local_projects.delete(row["id"])
            client.wait.set()
            with pytest.raises(ValueError, match="已修改／移除"):
                await task
            assert not service.store.list_knowledge()

        asyncio.run(run())


# 直接问答在模型返回与人工保存两个边界都拒绝已撤销的项目依据。
@pytest.mark.parametrize("during_generation", [True, False])
def test_direct_result_and_capture_recheck_registration(tmp_path, during_generation):
    root = project(tmp_path)
    with closing(create_service(tmp_path / "data", vault=Vault())) as service:
        row = register(service.local_projects.files, root)
        config(service)
        client = ProjectClient()
        service.client = client
        session = service.selection.open_direct(
            {"query": "AlphaEngine queue", "scope": "knowledge"}
        )

        # 挂起生成或先完成回答，再修改登记；两种情况下都不能收录旧版本。
        async def run():
            params = {
                "session_id": session["id"],
                "turn_id": "stale-project",
                "question": "AlphaEngine queue",
                "action": "lookup",
                "answer_mode": "direct",
            }
            if during_generation:
                client.wait, client.started = asyncio.Event(), asyncio.Event()
                task = asyncio.create_task(
                    dispatch(service, "selection.ask", params, lambda _: None)
                )
                await client.started.wait()
                service.local_projects.delete(row["id"])
                client.wait.set()
                with pytest.raises(ValueError, match="已修改／移除"):
                    await task
            else:
                await dispatch(service, "selection.ask", params, lambda _: None)
                register(service.local_projects.files, root, id=row["id"], label="UpdatedEngine")
                with pytest.raises(ValueError, match="已修改／移除"):
                    await dispatch(
                        service,
                        "selection.capture",
                        {
                            "session_id": session["id"],
                            "turn_id": "stale-project",
                            "title": "旧回答",
                            "content": "旧片段",
                            "category_path": [],
                        },
                        lambda _: None,
                    )
            assert not service.store.list_knowledge()

        asyncio.run(run())


# 失败日志带请求和固定阶段，绝对路径、标签与正文都不能进入诊断记录。
def test_failed_path_diagnostics_are_correlated_and_private(tmp_path):
    captured = []

    class Capture(logging.Handler):
        # 只在测试内捕获脱敏诊断的结构化记录。
        def emit(self, record):
            captured.append(record.msg)

    handler = Capture()
    LOGGER.addHandler(handler)
    previous = LOGGER.level
    LOGGER.setLevel(logging.INFO)
    try:
        registry = ProjectRegistry(tmp_path)
        with request_context("project-failure-1", "projects.save"):
            with pytest.raises(ValueError):
                registry.save(
                    {
                        "label": "PRIVATE_PROJECT_LABEL",
                        "path": str(tmp_path / "private-missing"),
                        "category_path": [],
                    }
                )
        text = json.dumps(captured)
        assert "PRIVATE_PROJECT_LABEL" not in text and "private-missing" not in text
        assert any(
            r.get("request_id") == "project-failure-1"
            and r["event"] == "step.failed"
            and "ProjectRegistry.save" in r.get("step", "")
            for r in captured
        )
    finally:
        LOGGER.removeHandler(handler)
        LOGGER.setLevel(previous)
