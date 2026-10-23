# 文件：test_ux_review.py
# 层：验证
# 作用：保护手写保存、分类移动、资料复用及只整理分类的边界。
# 说明：只用临时库和合成资料，不调用真实模型服务。

import asyncio
import threading

import pytest
from knowledge_agent import diagnostics as logs
from knowledge_agent.bootstrap import create_service
from test_knowledge import Vault
from test_library import call, outline
from test_library import library as library_fixture

# 复用已有隔离库夹具，不与测试参数重名导入。
library = library_fixture


# 取消资料复用时解析线程仍归快照所有，完成后临时文件必须清理。
def test_source_reuse_cancellation_cleans_copy(tmp_path, monkeypatch):
    original = tmp_path / "private-source.txt"
    original.write_text("synthetic private body", encoding="utf-8")
    service = create_service(tmp_path / "data", vault=Vault())
    item = call(service, "attachments.add", {"path": str(original)})
    call(service, "sources.retain", {"id": item["id"]})
    call(service, "attachments.remove", {"id": item["id"]})
    snapshots = service.attachment_usecase.snapshots
    entered, release = threading.Event(), threading.Event()
    read = snapshots._read

    # 只阻塞隔离文件复制，保证取消发生在实际线程结束之前。
    def paused(source, target):
        entered.set()
        assert release.wait(5)
        return read(source, target)

    monkeypatch.setattr(snapshots, "_read", paused)

    # 取消不能登记附件，也不能把仍在使用的副本清理权交给界面。
    async def run():
        task = asyncio.create_task(service.attachment_usecase.reuse(item["id"]))
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            release.set()
        await snapshots.settle()
        await asyncio.sleep(0)
        assert not service.attachment_usecase.documents
        assert not list(snapshots.session.iterdir())
        assert service.store.has_source(item["id"])

    try:
        asyncio.run(run())
    finally:
        release.set()
        service.close()


# 冲突日志关联请求和失败阶段，不写入用户新正文。
def test_manual_conflict_diagnostics_are_private(library, caplog):
    call(library, "knowledge.save", {"title": "private-title", "content": "old"})
    with caplog.at_level("INFO", logger="knowledgebase"):
        with logs.request_context("ux-save-conflict", "knowledge.save"):
            with pytest.raises(ValueError):
                call(
                    library,
                    "knowledge.save",
                    {"title": "private-title", "content": "private-new-body"},
                )
    assert "ux-save-conflict" in caplog.text and "step.failed" in caplog.text
    assert "private-new-body" not in caplog.text and "private-title" not in caplog.text


# 同名新建必须失败，正文相同但标题不同仍是独立笔记。
def test_manual_create_never_silently_reuses(library):
    first = call(library, "knowledge.save", {"title": "原笔记", "content": "最初正文"})
    with pytest.raises(ValueError, match="同标题"):
        call(library, "knowledge.save", {"title": "原笔记", "content": "用户新输入"})
    second = call(library, "knowledge.save", {"title": "独立笔记", "content": "最初正文"})
    assert first["id"] != second["id"]
    assert library.store.get(first["id"])["content"] == "最初正文"


# 旧分类记录占用历史全局身份时，不得把不同位置的手写笔记误判为同分类冲突。
def test_legacy_classified_identity_allows_unclassified_namesake(library):
    original = library.store.save("历史同名", "旧分类全文")
    value = outline(library)
    call(library, "library.restructure.apply", {**value, "directory_only": True, "selected": []})
    note = call(
        library, "knowledge.save", {"title": original["title"], "content": "新的未分类全文"}
    )
    assert note["id"] != original["id"] and note["theme"] == "未分类"
    with pytest.raises(ValueError, match="同标题"):
        call(library, "knowledge.save", {"title": original["title"], "content": "重复未分类"})
    assert library.store.get(original["id"])["content"] == "旧分类全文"


# 同分类标题冲突及过期版本回滚，分类成功后索引立即包含新路径。
def test_manual_categories_move_and_version(library):
    first = call(
        library, "knowledge.save", {"title": "边界", "content": "原文", "category_path": ["甲"]}
    )
    other = call(
        library, "knowledge.save", {"title": "边界", "content": "另一原文", "category_path": ["乙"]}
    )
    with pytest.raises(ValueError, match="同标题"):
        call(
            library,
            "knowledge.move",
            {"id": first["id"], "version": first["version"], "category_path": ["乙"]},
        )
    assert library.store.get(first["id"])["category_path"] == ["甲"]
    moved = call(
        library,
        "knowledge.move",
        {"id": first["id"], "version": first["version"], "category_path": ["丙", "深层"]},
    )
    assert moved["content"] == "原文" and moved["category_path"] == ["丙", "深层"]
    assert call(library, "knowledge.search", {"query": "深层"})["total"] == 1
    with pytest.raises(ValueError, match="知识已变化"):
        call(library, "knowledge.save", {**first, "content": "过期编辑"})
    assert library.store.get(other["id"])["content"] == "另一原文"
    unclassified = call(
        library,
        "knowledge.move",
        {"id": moved["id"], "version": moved["version"], "category_path": []},
    )
    assert unclassified["theme"] == "未分类"


# 旧自由主题在普通编辑时保留，避免编辑正文意外清空分类。
def test_legacy_theme_preserved_and_index_failure_rolls_back(library, monkeypatch):
    old = library.store.save("旧主题笔记", "旧正文")
    with library.store.db:
        library.store.db.execute(
            "INSERT INTO topic_links VALUES (?,?,?,?)",
            (old["id"], "自由主题", "自由主题", "旧主题笔记"),
        )
    edited = call(
        library, "knowledge.save", {"id": old["id"], "title": old["title"], "content": "新正文"}
    )
    assert edited["theme"] == "自由主题"

    # 索引重建失败用于验证分类事务没有部分提交。
    def fail():
        raise RuntimeError("synthetic index fault")

    monkeypatch.setattr(library.store, "populate_library_index", fail)
    with pytest.raises(RuntimeError):
        call(
            library,
            "knowledge.move",
            {"id": edited["id"], "version": edited["version"], "category_path": ["新位置"]},
        )
    current = library.store.get(old["id"])
    assert current["theme"] == "自由主题" and current["content"] == "新正文"


# 资料原文件删除并重新启动后，仍可分页阅读及挂载受管理副本。
def test_retained_source_read_and_reuse_after_restart(tmp_path):
    data = tmp_path / "data"
    original = tmp_path / "original.txt"
    original.write_text("资料可读" * 4000, encoding="utf-8")
    service = create_service(data, vault=Vault())
    try:
        item = call(service, "attachments.add", {"path": str(original)})
        call(service, "sources.retain", {"id": item["id"]})
    finally:
        service.close()
    original.unlink()
    service = create_service(data, vault=Vault())
    try:
        page = call(service, "sources.read", {"id": item["id"]})
        assert page["name"] == "original.txt" and page["pages"] >= 2
        assert len(page["items"][0]["text"]) <= 12000
        attached = call(service, "sources.attach", {"id": item["id"]})
        assert attached["name"] == "original.txt" and attached["retained"]
        assert len(service.attachment_usecase.documents) == 1
        call(service, "sources.attach", {"id": item["id"]})
        assert len(service.attachment_usecase.documents) == 1
        call(service, "sources.delete", {"id": item["id"]})
        with pytest.raises(ValueError, match="资料不存在"):
            call(service, "sources.read", {"id": item["id"]})
    finally:
        service.close()


# 分类确认不准备正文，保存后全文和引用保持原样，旧请求不能重复改写。
def test_directory_only_skips_body_generation(library):
    item = library.store.save("分类验收", "手工全文")
    value = outline(library)
    calls = len(library.client.calls)
    receipt = call(
        library, "library.restructure.apply", {**value, "selected": [], "directory_only": True}
    )
    current = library.store.get(item["id"])
    assert receipt["count"] == 1 and current["content"] == "手工全文"
    assert current["category_path"] == ["计算机", "基础"]
    assert len(library.client.calls) == calls
    assert (
        call(
            library, "library.restructure.apply", {**value, "selected": [], "directory_only": True}
        )
        == receipt
    )


# 分类模式仍拒绝未完成覆盖、含合并和过期库存；失败保留草案状态。
def test_directory_only_rejects_merge_and_stale_inventory(library):
    first = library.store.save("第一知识", "第一全文")
    second = library.store.save("第二知识", "第二全文")
    value = outline(library)
    draft = library.library.draft
    draft["duplicates"] = [
        {
            "id": "group",
            "sources": [first["id"], second["id"]],
            "target_id": first["id"],
            "decision": "merge",
            "kind": "pending",
            "bucket_decided": True,
            "manual_bucket": None,
            "title": first["title"],
            "category_path": ["计算机", "基础"],
        }
    ]
    with pytest.raises(ValueError, match="合并必须"):
        call(
            library, "library.restructure.apply", {**value, "selected": [], "directory_only": True}
        )
    assert draft["status"] == "outline" and draft["approved"] is None
    draft["duplicates"] = []
    library.store.save("第三知识", "新加入")
    with pytest.raises(ValueError, match="知识库已变化"):
        call(
            library, "library.restructure.apply", {**value, "selected": [], "directory_only": True}
        )
    assert draft["status"] == "outline"
