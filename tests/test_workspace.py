# 文件：test_workspace.py
# 层：验证／工作保护和数据携带
# 作用：验证草稿原子写入、备份完整性与非破坏性恢复。
# 说明：只使用临时目录、合成资料和故障注入，不读取正式数据。
import asyncio
import json
import threading
from contextlib import closing
from pathlib import Path

import pytest
from knowledge_agent import diagnostics as logs
from knowledge_agent.bootstrap import create_service
from knowledge_agent.entrypoints import protocol_runtime
from knowledge_agent.entrypoints.protocol_runtime import ProtocolRuntime
from knowledge_agent.infrastructure import workspace_files
from knowledge_agent.infrastructure.portable_files import PortableData, digest
from knowledge_agent.infrastructure.sqlite_store import Store
from knowledge_agent.infrastructure.workspace_files import WorkspaceFiles
from test_diagnostics import diagnostic_session as diagnostic_fixture
from test_knowledge import Vault
from test_topics_store import draft

diagnostic_session = diagnostic_fixture


# 重启恢复只依赖成功回执；版本冲突、磁盘失败和超限必须保留上一份内容。
def test_draft_restart_atomic_failure_and_conflict(tmp_path, monkeypatch):
    drafts = WorkspaceFiles(tmp_path)
    saved = drafts.write("question", "私密草稿", 0)
    assert WorkspaceFiles(tmp_path).read("question") == saved
    with pytest.raises(ValueError, match="版本冲突"):
        drafts.write("question", "不能覆盖", 0)

    # 原子替换失败不能破坏旧文件，也不能遗留半成品作为恢复稿。
    def fail_replace(*_args):
        raise OSError("synthetic-full-disk")

    monkeypatch.setattr(workspace_files.os, "replace", fail_replace)
    with pytest.raises(OSError):
        drafts.write("question", "写入失败的新稿", 1)
    assert drafts.read("question") == saved
    assert not list((tmp_path / "drafts").glob("*.pending"))
    with pytest.raises(ValueError, match="容量"):
        drafts.write("question", "字" * 300000, 1)
    assert drafts.read("question") == saved


# 清除保留墓碑版本防止迟到写入复活；坏文件与越界槽位都不能被静默覆盖。
def test_draft_clear_corruption_and_slot_boundary(tmp_path):
    drafts = WorkspaceFiles(tmp_path)
    drafts.write("question", "旧稿", 0)
    cleared = drafts.write("question", None, 1)
    assert cleared["value"] is None and cleared["revision"] == 2
    assert WorkspaceFiles(tmp_path).read("question") == cleared
    with pytest.raises(ValueError, match="版本冲突"):
        drafts.write("question", "晚到旧稿", 1)
    damaged = tmp_path / "drafts" / "note-探索.json"
    damaged.write_text("broken-private-input", encoding="utf-8")
    with pytest.raises(ValueError, match="损坏"):
        drafts.write("note-探索", "不能覆盖", 0)
    assert damaged.read_text(encoding="utf-8") == "broken-private-input"
    with pytest.raises(ValueError, match="位置"):
        drafts.read("../knowledge.sqlite3")


# 备份必须带齐数据库、保留原件副本、草稿和登记，且不含会话和日志。
def backup_fixture(tmp_path):
    root, output = tmp_path / "data", tmp_path / "output"
    root.mkdir()
    output.mkdir()
    with closing(Store(root)) as store:
        item = store.save(
            "完整导出", "首段\n" + "正文" * 14000, classification_path=["测试", "深层"]
        )
        store.capture_topic(draft(target=item, content="补充段落", title="补充"))
        store.insert_source({"id": "src", "name": "资料", "blocks": [], "warnings": []}, "src.md")
    (root / "sources" / "src.md").write_text("保留原文", encoding="utf-8")
    WorkspaceFiles(root).write("question", "未完成问题", 0)
    (root / "project-references.json").write_text('{"fixture":true}', encoding="utf-8")
    for folder in ("logs", "sessions", "models"):
        (root / folder).mkdir()
        (root / folder / "exclude.txt").write_text("excluded-private", encoding="utf-8")
    return root, output, item


# 完整导出不得使用界面的第一页，恢复只创建隔离目录且当前库逐字不变。
def test_export_backup_restore_full_content_and_isolation(tmp_path):
    root, output, item = backup_fixture(tmp_path)
    files = PortableData(root)
    with closing(Store(root)) as store:
        full = store.get(item["id"])
    full["citations"] = [{"name": "来源", "locator": "第1段", "text": "原始引用摘录"}]
    exported = files.export(full, str(output))
    text = Path(exported["path"]).read_text(encoding="utf-8")
    assert full["content"] in text and "补充段落" in text and "原始引用摘录" in text
    backup = files.backup(str(output))
    folder = Path(backup["path"])
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    names = {entry["path"] for entry in manifest["entries"]}
    assert names == {
        "knowledge.sqlite3",
        "sources/src.md",
        "drafts/question.json",
        "project-references.json",
    }
    original = digest(root / "knowledge.sqlite3")
    restored = Path(files.restore(str(folder), str(output))["path"])
    assert restored != folder and restored != root
    assert digest(root / "knowledge.sqlite3") == original
    assert (restored / "sources" / "src.md").read_text(encoding="utf-8") == "保留原文"
    with closing(Store(restored)) as store:
        assert store.get(item["id"])["content"] == full["content"]
        assert store.get(item["id"])["supplements"][0]["content"] == "补充段落"
    assert WorkspaceFiles(restored).read("question")["value"] == "未完成问题"


# 篡改正文、清单路径和资料缺失必须全部拒绝，不能生成看似成功的恢复目录。
@pytest.mark.parametrize(
    "damage", ["checksum", "missing-source", "traversal", "absolute", "alias", "duplicate"]
)
def test_backup_rejects_corruption_and_unsafe_manifest(tmp_path, damage):
    root, output, _item = backup_fixture(tmp_path)
    files = PortableData(root)
    folder = Path(files.backup(str(output))["path"])
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = next(row for row in manifest["entries"] if row["path"] == "sources/src.md")
    if damage == "checksum":
        (folder / "sources" / "src.md").write_text("被篡改", encoding="utf-8")
    elif damage == "missing-source":
        (folder / "sources" / "src.md").unlink()
        manifest["entries"].remove(entry)
    elif damage == "duplicate":
        manifest["entries"].append(entry.copy())
    else:
        entry["path"] = {
            "traversal": "sources/../src.md",
            "absolute": "/sources/src.md",
            "alias": "sources/./src.md",
        }[damage]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError):
        files.restore(str(folder), str(output))
    assert not list(output.glob("知序恢复-*"))


# 故障不能留下半成品备份，也不能删除用户已有文件或当前资料。
def test_backup_failure_cleans_only_owned_output(tmp_path, monkeypatch):
    root, output, _item = backup_fixture(tmp_path)
    sentinel = output / "用户原件.txt"
    sentinel.write_text("保留", encoding="utf-8")

    # 复制失败模拟磁盘和权限错误，验证新建目录补偿范围。
    def denied(*_args):
        raise PermissionError("synthetic-copy-denied")

    monkeypatch.setattr("knowledge_agent.infrastructure.portable_files.shutil.copyfile", denied)
    with pytest.raises(PermissionError):
        PortableData(root).backup(str(output))
    assert list(output.iterdir()) == [sentinel]
    assert (root / "sources" / "src.md").exists()
    with pytest.raises(ValueError, match="以外"):
        PortableData(root).backup(str(root))


# 取消等待仍须收束写线程，不能提前释放独占锁或把已完成文件报为撤销。
def test_cancelled_backup_settles_thread_before_unlocking(tmp_path, monkeypatch):
    service = create_service(tmp_path / "data", vault=Vault())
    entered, release = threading.Event(), threading.Event()
    frames = []

    # 文件任务暂停在模拟写入阶段，释放后代表已真实完成。
    def backup(_directory):
        entered.set()
        release.wait(5)
        return {"path": "fixture", "files": 1, "bytes": 1, "verified": True}

    monkeypatch.setattr(service.workspace.files, "backup", backup)
    monkeypatch.setattr(protocol_runtime, "send", frames.append)

    # 验证停写贯穿取消到实际工作完成，随后普通请求可重新执行。
    async def run():
        runtime = ProtocolRuntime(service)
        runtime.accept({"id": "backup", "operation": "data.backup", "params": {}})
        task = runtime.tasks["backup"]
        assert await asyncio.to_thread(entered.wait, 3)
        runtime.accept({"id": "busy", "operation": "workspace.write", "params": {}})
        runtime.accept({"id": "cancel", "operation": "cancel", "params": {"target": "backup"}})
        await asyncio.sleep(0)
        assert runtime.exclusive == "backup" and not task.done()
        runtime.accept(
            {"id": "cancel-again", "operation": "cancel", "params": {"target": "backup"}}
        )
        await asyncio.sleep(0)
        assert runtime.exclusive == "backup" and not task.done()
        release.set()
        await task
        assert runtime.exclusive is None and not runtime.tasks

    try:
        asyncio.run(run())
    finally:
        release.set()
        service.close()
    assert any(frame["id"] == "busy" and frame["type"] == "error" for frame in frames)
    assert next(frame for frame in frames if frame["id"] == "backup")["type"] == "result"


# 独占请求首次运行前取消也必须释放锁，后续请求不得永久被拒绝。
def test_cancel_before_exclusive_coroutine_starts(tmp_path, monkeypatch):
    service = create_service(tmp_path / "data", vault=Vault())
    frames = []
    monkeypatch.setattr(protocol_runtime, "send", frames.append)

    # 首次调度之前取消，仍须得到唯一终态并允许下一次请求。
    async def run():
        runtime = ProtocolRuntime(service)
        runtime.accept({"id": "early", "operation": "data.backup", "params": {}})
        task = runtime.tasks["early"]
        runtime.accept({"id": "cancel", "operation": "cancel", "params": {"target": "early"}})
        await asyncio.gather(task, return_exceptions=True)
        assert runtime.exclusive is None and not runtime.tasks
        runtime.accept(
            {"id": "next", "operation": "workspace.read", "params": {"slot": "question"}}
        )
        await runtime.tasks["next"]

    try:
        asyncio.run(run())
    finally:
        service.close()
    assert [frame["type"] for frame in frames if frame["id"] == "early"] == ["error"]
    assert next(frame for frame in frames if frame["id"] == "next")["type"] == "result"


# 直接导入只释放本次临时副本；已有问答附件仍由原会话持有。
@pytest.mark.parametrize("shared", [False, True])
def test_retained_import_preserves_attachment_ownership(tmp_path, shared):
    service = create_service(tmp_path / "data", vault=Vault())
    original = tmp_path / "input.md"
    original.write_text("# 合成资料\n\n完整保留原件。", encoding="utf-8")
    try:
        if shared:
            asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
        result = asyncio.run(
            service.add_attachment({"path": str(original), "retain": True}, lambda _: None)
        )
        assert result["retained"] and service.store.has_source(result["id"])
        assert (result["id"] in service.attachments) is shared
        assert len(list(service.snapshots.session.iterdir())) == int(shared)
        assert original.read_text(encoding="utf-8") == "# 合成资料\n\n完整保留原件。"
    finally:
        service.close()


# 保留元数据失败补偿新资料副本，同时清理导入自己拥有的临时文件。
def test_retained_import_failure_cleans_owned_copies(tmp_path, monkeypatch):
    service = create_service(tmp_path / "data", vault=Vault())
    original = tmp_path / "input.md"
    original.write_text("合成失败资料", encoding="utf-8")

    # 模拟数据库拒绝提交，不能误报成功或遗留有主记录之外的资料副本。
    def denied(*_args):
        raise OSError("synthetic-metadata-denied")

    monkeypatch.setattr(service.store, "insert_source", denied)
    try:
        with pytest.raises(OSError, match="synthetic-metadata-denied"):
            asyncio.run(
                service.add_attachment({"path": str(original), "retain": True}, lambda _: None)
            )
        assert not service.attachments and not service.store.list_sources()
        assert not list(service.snapshots.session.iterdir())
        assert not list(service.store.sources_dir.iterdir())
        assert original.read_text(encoding="utf-8") == "合成失败资料"
    finally:
        service.close()


# 草稿失败日志包含请求与失败阶段，但私密输入不得进入日志。
def test_draft_failure_diagnostics_are_correlated_and_private(tmp_path, diagnostic_session):
    drafts = WorkspaceFiles(tmp_path)
    drafts.write("question", "private-draft-content", 0)
    with logs.request_context("draft-failure", "workspace.write"):
        with pytest.raises(ValueError):
            drafts.write("question", "private-new-content", 0)
    text = Path(logs.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")
    rows = [json.loads(line) for line in text.splitlines()]
    assert any(
        row.get("request_id") == "draft-failure" and row["event"] == "step.failed" for row in rows
    )
    assert "private-draft-content" not in text and "private-new-content" not in text


# 筛选先于分页，完整长文命中返回正确页，不产生模型费用或阅读计数。
def test_search_filters_and_long_content_position(tmp_path):
    with closing(Store(tmp_path)) as store:
        item = store.save(
            "长文", "无关内容" * 7000 + "末页独有词", classification_path=["测试", "长文"]
        )
        store.capture_topic(draft(target=item, content="末页独有词补充"))
        hit = store.search({"query": "末页独有词", "kind": "knowledge", "category": "长文"})
        assert hit["total"] == 1 and hit["items"][0]["text_page"] == 2
        assert store.search({"query": "末页独有词", "kind": "supplement"})["total"] == 1
        assert store.search({"query": "末页独有词", "category": "不存在"})["total"] == 0
        assert store.list_attempts() == []
