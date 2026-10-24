# 文件：test_memory_semantic.py
# 层：验证
# 作用：保护长期记忆、全库精选、派生向量失效与取消所有权。
# 说明：使用隔离数据库和可控编码器，不访问网络或正式资料。
import asyncio
import sqlite3
import struct
import threading
from contextlib import closing

import pytest
from knowledge_agent.application.semantic_retrieval import SemanticRetrieval
from knowledge_agent.domain.memory_rules import semantic_chunks
from knowledge_agent.infrastructure.memory_schema import migrate_memory
from knowledge_agent.infrastructure.sqlite_store import Store
from legacy_database import downgrade_memory


# 编码与查询均返回确定性单位向量，网络准备绝不能隐式发生。
class Encoder:
    model_id = "fixture-v1"

    # 就绪状态仅由合成资源控制。
    def ready(self):
        return True

    # 普通检索不允许走下载分支。
    def prepare(self, _cancel):
        raise AssertionError("unexpected download")

    # 有效维度与归一化保持真实存储格式。
    def encode(self, texts, query=False):
        return [struct.pack("<512f", 1, *([0] * 511)) for _ in texts]


# 六版迁移必须先备份，失败后无残留 DDL，重启保留偏好与正式知识。
def test_memory_migration_backup_rollback_reopen(tmp_path):
    store = Store(tmp_path)
    note = store.save("迁移原件", "用户手工正文")
    baseline = set(tmp_path.glob("before-memory-v7-*.sqlite3"))
    downgrade_memory(store)
    store.db.execute("PRAGMA user_version=6")
    store.db.commit()

    # 后段建表失败，前段记忆表与版本也必须回滚。
    def deny(action, table, *_args):
        return (
            sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_CREATE_TABLE and table == "semantic_state"
            else sqlite3.SQLITE_OK
        )

    store.db.set_authorizer(deny)
    with pytest.raises(ValueError, match="升级失败"):
        migrate_memory(store.db, tmp_path)
    store.db.set_authorizer(None)
    assert store.db.execute("PRAGMA user_version").fetchone()[0] == 6
    assert not store.db.execute(
        "SELECT 1 FROM sqlite_master WHERE name='memory_settings'"
    ).fetchone()
    migrate_memory(store.db, tmp_path)
    store.memory_update({"detail": "详细"})
    store.close()
    with closing(Store(tmp_path)) as reopened:
        assert reopened.get(note["id"])["content"] == "用户手工正文"
        assert reopened.memory_state()["settings"]["detail"] == "详细"
        assert reopened.db.execute("PRAGMA user_version").fetchone()[0] == 7
    for backup in tmp_path.glob("before-memory-v7-*.sqlite3"):
        if backup in baseline:
            continue
        with closing(sqlite3.connect(backup)) as db:
            assert db.execute("PRAGMA user_version").fetchone()[0] == 6
            assert db.execute("SELECT content FROM knowledge").fetchone()[0] == "用户手工正文"


# 清空不从旧 uses 回灌；幂等轮次、关闭开关和同日重开都不重复记忆。
def test_memory_clear_disable_and_idempotence(tmp_path):
    with closing(Store(tmp_path)) as store:
        note = store.save("阅读测试", "阅读本身不生成调用")
        store.remember_question("turn-one", "编程／Python", "步骤")
        store.remember_question("turn-one", "编程／Python", "步骤")
        store.get(note["id"], active_use=True)
        store.get(note["id"], active_use=True)
        assert store.memory_state()["topics"][0]["count"] == 1
        assert store.memory_state()["reading_days"] == 1
        store.memory_clear("all")
        store.get(note["id"], active_use=True)
        store.remember_question("turn-one", "编程／Python", "步骤")
        assert store.memory_state()["topics"] == []
        assert store.memory_state()["reading_days"] == 0
        store.memory_update({"questions_enabled": False})
        store.remember_question("disabled", "编程／Python", "步骤")
        store.memory_update({"questions_enabled": True})
        store.remember_question("disabled", "编程／Python", "步骤")
        assert store.memory_state()["topics"] == []
        assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 1


# 热门旧知识必须从全库候选进入精选，不被最近 200 条窗口吞掉。
def test_exploration_full_library_rank_and_nine_limit(tmp_path):
    with closing(Store(tmp_path)) as store:
        old = store.save_note(
            {"title": "旧版线程说明", "content": "互斥锁", "category_path": ["编程", "线程"]}
        )
        store.db.execute("UPDATE knowledge SET updated_at='2000-01-01' WHERE id=?", (old["id"],))
        store.db.commit()
        for number in range(205):
            store.save_note(
                {"title": f"其他主题{number}", "content": "太阳系", "category_path": ["天文"]}
            )
        store.remember_question("interest", "编程／线程", "概念")
        store.save("未分类笔记", "没有分类也需要正常参与推荐")
        first = store.exploration_list()
        assert len(first) == 9 and first[0]["id"] == old["id"]
        assert [x["id"] for x in first] == [x["id"] for x in store.exploration_list()]
        store.memory_update({"questions_enabled": False, "reading_enabled": False})
        assert old["id"] not in {x["id"] for x in store.exploration_list()}
        assert store.exploration_list("旧版线程")[0]["id"] == old["id"]


# 编辑、删除和索引代次变化都拒绝旧编码结果，索引为可重建派生物。
def test_semantic_stale_results_and_lexical_fallback(tmp_path):
    with closing(Store(tmp_path)) as store:
        note = store.save("线程锁", "互斥保护共享数据")
        row = store.semantic_documents()[0]
        chunks = semantic_chunks(row)
        encoder = Encoder()
        epoch = store.semantic_epoch()
        assert store.semantic_put(
            row, chunks, encoder.encode([c["text"] for c in chunks]), encoder.model_id, epoch
        )
        assert store.semantic_counts(encoder.model_id)["indexed"] == 1
        retrieval = SemanticRetrieval(store, encoder)
        result = asyncio.run(retrieval.search("并发控制"))
        assert result["items"][0]["knowledge_id"] == note["id"]
        assert "语义" in result["notice"]
        store.save(note["title"], "更新后的共享状态", item_id=note["id"])
        assert not store.semantic_put(row, chunks, encoder.encode(["old"]), encoder.model_id, epoch)
        assert store.semantic_counts(encoder.model_id)["vectors"] == 0
        assert "仅关键词" in asyncio.run(retrieval.search("共享状态"))["notice"]
        current = store.semantic_documents()[0]
        store.semantic_reset()
        assert not store.semantic_put(
            current, semantic_chunks(current), encoder.encode(["new"]), encoder.model_id, epoch
        )
        store.delete_knowledge(note["id"])
        assert store.semantic_documents() == []


# 知识恢复不回退偏好与兴趣，派生向量必须清空后重新计算。
def test_restore_preserves_current_memory_and_invalidates_vectors(tmp_path):
    with closing(Store(tmp_path)) as store:
        note = store.save("恢复语义", "旧版本知识正文")
        snapshot = store.recovery_create()
        store.memory_update({"detail": "详细"})
        store.remember_question("after-snapshot", "计算机", "概念")
        store.save(note["title"], "新版本知识正文", item_id=note["id"])
        retrieval = SemanticRetrieval(store, Encoder())
        asyncio.run(retrieval.build(False, lambda _event: None))
        assert store.semantic_counts(Encoder.model_id)["vectors"] > 0
        epoch = store.semantic_epoch()
        store.recovery_restore(snapshot)
        assert store.get(note["id"])["content"] == "旧版本知识正文"
        assert store.memory_state()["settings"]["detail"] == "详细"
        assert store.memory_state()["topics"][0]["count"] == 1
        assert store.semantic_epoch() > epoch
        assert store.semantic_counts(Encoder.model_id)["vectors"] == 0


# 超过一批的长文不会漏检；向量损坏必须明确降级而非当作相关证据。
def test_semantic_multibatch_and_corrupt_vector_degradation(tmp_path):
    with closing(Store(tmp_path)) as store:
        note = store.save("长文向量", "甲乙丙丁" * 25000)
        other = store.save("第二长文", "戊己庚辛" * 25000)
        retrieval = SemanticRetrieval(store, Encoder())
        asyncio.run(retrieval.build(False, lambda _event: None))
        assert store.semantic_counts(Encoder.model_id)["vectors"] > 512
        first = store.semantic_rows(Encoder.model_id)
        assert len(first) == 512 and first[0]["body"] is first[1]["body"]
        second = store.semantic_rows(
            Encoder.model_id, first[-1]["document_id"], first[-1]["offset"]
        )
        assert second and (second[0]["document_id"], second[0]["offset"]) > (
            first[-1]["document_id"],
            first[-1]["offset"],
        )
        result = asyncio.run(retrieval.search("无词法重合的问法"))
        assert {hit["knowledge_id"] for hit in result["items"]} == {note["id"], other["id"]}
        with store.db:
            store.db.execute("UPDATE semantic_vectors SET vector=x'0000' WHERE offset=0")
        result = asyncio.run(retrieval.search("长文向量"))
        assert "降级关键词" in result["notice"]
        assert result["items"][0]["knowledge_id"] == note["id"]


# 取消等待之后仍持有实际线程，退出必须等待释放而不是遗留后台工作。
def test_semantic_cancellation_waits_actual_thread(tmp_path):
    with closing(Store(tmp_path)) as store:
        retrieval = SemanticRetrieval(store, Encoder())
        started, release, ended = threading.Event(), threading.Event(), threading.Event()

        # 用事件精确控制不可中断的 CPU 阶段，避免依赖计时猜测线程完成。
        def work():
            started.set()
            release.wait(5)
            ended.set()

        # 主动取消后，任务仍须等待真实编码器结束才释放所有权。
        async def scenario():
            task = asyncio.create_task(retrieval.run(work))
            await asyncio.to_thread(started.wait, 5)
            task.cancel()
            await asyncio.sleep(0)
            assert retrieval.workers and not ended.is_set()
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert ended.is_set() and not retrieval.workers
            await retrieval.settle()

        asyncio.run(scenario())
