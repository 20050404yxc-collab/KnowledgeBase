# 文件：test_knowledge.py
# 层：验证
# 作用：验证对应业务和资源边界。
# 说明：使用隔离资源，不代表正式接口验收。
import asyncio
import json
import sqlite3
from datetime import date, timedelta

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.knowledge_rules import bucket_for, identity
from knowledge_agent.infrastructure.sqlite_store import Store
from review_fixtures import approved_question


class Vault:
    # 初始化本对象拥有的状态和资源，依赖由调用方显式提供。
    def __init__(self):
        self.values = {}

    # 按稳定标识读取当前记录，缺失状态由所属适配器明确处理。
    def get(self, key):
        return self.values.get(key)

    # 保存给定标识的值，失败向调用者报告以便协调补偿。
    def set(self, key, value):
        self.values[key] = value

    # 移除指定标识的状态，重复删除允许没有记录。
    def delete(self, key):
        self.values.pop(key, None)


# 为每个测试构造隔离资源，并在测试后关闭。
@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path)
    yield value
    value.close()


# 为每个测试构造隔离资源，并在测试后关闭。
@pytest.fixture
def service(tmp_path):
    value = create_service(tmp_path / "data", vault=Vault())
    yield value
    value.close()


# 验证频率窗口的包含边界及手动覆盖。
def test_frequency_boundaries():
    today = date(2026, 10, 20)
    created = (today - timedelta(days=40)).isoformat()
    days = [(today - timedelta(days=n)).isoformat() for n in [0, 1, 13]]
    assert bucket_for(created, days, today=today) == "常用"
    assert (
        bucket_for(created, days[1:] + [(today - timedelta(days=14)).isoformat()], today=today)
        == "在学"
    )
    assert bucket_for(created, [(today - timedelta(days=29)).isoformat()], today=today) == "在学"
    assert bucket_for(created, [(today - timedelta(days=30)).isoformat()], today=today) == "归档"
    assert bucket_for(today.isoformat(), [], today=today) == "在学"
    assert bucket_for(created, days, "归档", today) == "归档"


# 验证中文检索、概念和正文去重，以及个人编辑不被生成覆盖。
def test_chinese_retrieval_edit_and_dedup(store):
    item = store.save("事务一致性", "数据库事务保证完整提交。失败时回滚数据，避免部分写入。")
    assert store.list_knowledge("数据库事务")[0]["id"] == item["id"]
    assert (
        store.save(" 事务一致性！ ", "新的生成正文", generated=True)["content"] == item["content"]
    )
    assert store.save("不同标题", item["content"])["id"] == item["id"]
    store.save(item["title"], "这是用户手动编辑过的正文。", item_id=item["id"])
    store.save(item["title"], "不应该覆盖用户编辑内容。", generated=True)
    assert store.get(item["id"])["content"] == "这是用户手动编辑过的正文。"
    assert store.get(item["id"])["edited"]


# 验证同日使用去重和手动分区优先。
def test_daily_usage_and_manual_override(store):
    item = store.save("使用频率", "主动打开计入使用日。")
    store.get(item["id"], active_use=True)
    store.get(item["id"], active_use=True)
    assert store.db.execute("SELECT COUNT(*) FROM uses").fetchone()[0] == 1
    assert store.set_bucket(item["id"], "归档")["bucket"] == "归档"
    assert store.get(item["id"], active_use=True)["bucket"] == "归档"
    assert store.set_bucket(item["id"], None)["bucket"] == "在学"


# 验证重启保留知识并将未完成调用标记中断。
def test_durable_reopen_and_interrupted_attempt(tmp_path):
    store = Store(tmp_path)
    item = store.save("持久化", "重启后笔记保留。")
    store.db.execute(
        "INSERT INTO attempts (id,purpose,provider,model,status,started_at,currency) VALUES ('a','test','p','m','running','2026-10-20','USD')"
    )
    store.db.commit()
    store.close()
    store = Store(tmp_path)
    assert store.get(item["id"])["content"] == item["content"]
    assert store.db.execute("SELECT status FROM attempts").fetchone()[0] == "interrupted"
    store.close()


# 验证资料保留、引用状态和用户原件保护。
def test_temporary_retention_deletion_and_original_safety(service, tmp_path):
    original = tmp_path / "原始笔记.md"
    original.write_text("# 事务\n\n数据库事务用于一致性。\n", encoding="utf-8")
    before = original.read_bytes()
    doc = asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    assert service.store.list_sources() == []
    citation = service.attachments[doc["id"]]["blocks"][0] | {
        "source_id": doc["id"],
        "name": doc["name"],
    }
    item = service.store.save("事务", "完整知识", citations=[citation])
    service.retain(doc["id"])
    assert service.store.get(item["id"])["citations"][0]["retained"]
    original.write_text("原文件后来被修改。", encoding="utf-8")
    retained = next(service.store.sources_dir.iterdir())
    assert retained.read_bytes() == before
    service.delete_source(doc["id"])
    assert original.read_text("utf-8") == "原文件后来被修改。"
    assert service.store.list_sources() == []
    assert service.store.get(item["id"])["citations"][0]["text"]
    assert not service.store.get(item["id"])["citations"][0]["retained"]


# 验证关闭会话只清理应用快照。
def test_snapshot_cleanup_does_not_delete_original(tmp_path):
    original = tmp_path / "input.txt"
    original.write_text("hello", "utf-8")
    service = create_service(tmp_path / "data", vault=Vault())
    asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    snapshot = service.snapshots.session
    service.close()
    assert original.exists()
    assert not snapshot.exists()


# 验证不同旧知识数量下推荐组成，不混入无关库存。
@pytest.mark.parametrize("inventory", [0, 1, 2])
def test_recommendation_inventory_composition(service, inventory):
    for index in range(inventory):
        service.store.save(f"数据库事务{index}", f"这是相关的数据库知识 {index}。")
    service.store.save("无关的天文学", "遥远的恒星、星系和宇宙。")
    expansions = [
        {"title": f"拓展概念{i}", "reason": "解释相关原理", "preview": "介绍"} for i in range(3)
    ]
    cards = service.recommendations("数据库", "数据库基础", expansions)
    assert len(cards) == 3
    assert sum("knowledge_id" in card for card in cards) == inventory
    assert all(card["title"] != "无关的天文学" for card in cards)


# 为隔离服务保存合成配置，不读取用户正式凭据。
def config(service):
    from knowledge_agent.application.provider_settings import save_provider

    save_provider(
        service.store,
        service.vault,
        {
            "name": "test",
            "protocol": "responses",
            "base_url": "https://example.test/v1",
            "model": "test-model",
            "key": "fixture-key",
            "currency": "USD",
        },
    )


# 验证生成期间取消不收录残缺知识。
def test_cancelled_generation_does_not_capture(service):
    config(service)

    class Client:
        # 仅使用选定证据生成，提交前响应取消并校验完整结果。
        async def generate(self, *_args):
            if _args[2] == "question-review":
                return approved_question()
            await asyncio.sleep(30)

    service.client = Client()

    # 执行可取消的异步测试场景并验证终态。
    async def scenario():
        task = asyncio.create_task(
            service.question({"query": "学习事务", "scope": "knowledge"}, lambda _: None)
        )
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert service.store.list_knowledge() == []


# 验证并发同问题只调用一次并复用已保存知识。
def test_duplicate_concurrent_generation_reuses_and_preserves_user_edits(service):
    config(service)

    class Client:
        calls = 0

        # 仅使用选定证据生成，提交前响应取消并校验完整结果。
        async def generate(self, *_args):
            if _args[2] == "question-review":
                return approved_question()
            self.calls += 1
            await asyncio.sleep(0.01)
            return json.dumps(
                {
                    "category": "计算机基础",
                    "subcategory": "数据库",
                    "title": "数据库事务",
                    "content": "完整的学习正文与示例。",
                    "citation_ids": [],
                    "recommendations": [],
                }
            )

    service.client = Client()

    # 执行可取消的异步测试场景并验证终态。
    async def scenario():
        return await asyncio.gather(
            *(
                service.question({"query": "事务是什么", "scope": "knowledge"}, lambda _: None)
                for _ in range(2)
            )
        )

    answers = asyncio.run(scenario())
    assert service.client.calls == 1
    assert len(service.store.list_knowledge()) == 1
    assert answers[0]["knowledge"]["id"] == answers[1]["knowledge"]["id"]
    assert identity(answers[0]["knowledge"]["title"]) == "数据库事务"


# 验证超限全文总结在模型调用前失败。
def test_long_summary_fails_before_model_call(service):
    doc_id = "fixture"
    service.attachments[doc_id] = {
        "id": doc_id,
        "name": "大文件",
        "retained": False,
        "warnings": [],
        "blocks": [{"id": str(i), "text": "长" * 1600, "locator": str(i)} for i in range(30)],
    }
    with pytest.raises(ValueError, match="全文超过"):
        asyncio.run(
            service.question(
                {"query": "全文总结", "scope": "files", "attachment_ids": [doc_id]}, lambda _: None
            )
        )
    assert service.store.db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0] == 0


# 验证严格文件范围不会泄漏知识库私有正文。
def test_files_only_never_uses_library_notes(service):
    service.store.save("不能泄漏的知识", "属于库里的私人补充。")
    service.attachments["f"] = {
        "id": "f",
        "name": "file",
        "retained": False,
        "warnings": [],
        "blocks": [{"id": "b1", "text": "文件独有内容", "locator": "第 1 页"}],
    }
    answer = asyncio.run(
        service.question(
            {"query": "知识是什么", "scope": "files", "attachment_ids": ["f"]}, lambda _: None
        )
    )
    assert "不能泄漏" not in answer["content"]
    assert "私人补充" not in answer["content"]
    assert all(c["source_id"] == "f" for c in answer["citations"])


# 验证未知引用标识不能通过收录校验。
def test_invalid_citations_never_capture(service):
    config(service)

    class Client:
        # 仅使用选定证据生成，提交前响应取消并校验完整结果。
        async def generate(self, *_args):
            if _args[2] == "question-review":
                return approved_question()
            return json.dumps(
                {"title": "假的引用", "content": "正文", "citation_ids": ["not-real"]}
            )

    service.client = Client()
    with pytest.raises(ValueError, match="不存在的证据"):
        asyncio.run(service.question({"query": "生成新知识", "scope": "knowledge"}, lambda _: None))
    assert service.store.list_knowledge() == []


# 注入数据库失败，验证知识与问题映射共同回滚。
def test_capture_mapping_and_note_are_one_transaction(store):
    store.db.execute(
        "CREATE TRIGGER reject_mapping BEFORE INSERT ON generation_keys BEGIN SELECT RAISE(ABORT, 'disk fault fixture'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        store.save("未提交的知识", "正文", generated=True, capture_key="fixture")
    assert store.list_knowledge() == []


# 注入资料写入失败，验证副本补偿且原件保留。
def test_failed_retention_rolls_back_managed_copy(service, tmp_path):
    original = tmp_path / "source.txt"
    original.write_text("原件不能被删除。", "utf-8")
    doc = asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    service.store.db.execute(
        "CREATE TRIGGER reject_source BEFORE INSERT ON sources BEGIN SELECT RAISE(ABORT, 'disk fault fixture'); END"
    )
    with pytest.raises(sqlite3.IntegrityError):
        service.retain(doc["id"])
    assert not list(service.store.sources_dir.iterdir())
    assert service.store.list_sources() == []
    assert original.read_text("utf-8") == "原件不能被删除。"


# 验证同标题新回答既不覆盖原笔记，也不谎报保存。
def test_same_title_different_answer_does_not_claim_new_content_saved(service):
    config(service)
    original = service.store.save("事务", "这是已有的个人笔记。")
    service.attachments["f"] = {
        "id": "f",
        "name": "file",
        "retained": False,
        "warnings": [],
        "blocks": [{"id": "b1", "text": "新的文档证据", "locator": "第 1 页"}],
    }

    class Client:
        # 仅使用选定证据生成，提交前响应取消并校验完整结果。
        async def generate(self, *_args):
            if _args[2] == "question-review":
                return approved_question()
            return json.dumps(
                {
                    "title": "事务",
                    "category": "计算机基础",
                    "subcategory": "数据库",
                    "content": "这是根据新文档生成的不同内容。",
                    "citation_ids": ["b1"],
                }
            )

    service.client = Client()
    answer = asyncio.run(
        service.question(
            {"query": "解释文档", "scope": "files", "attachment_ids": ["f"]}, lambda _: None
        )
    )
    assert answer["knowledge"] is None
    assert "未新建" in answer["notice"]
    assert "根据新文档" in answer["content"]
    assert answer["citations"][0]["source_id"] == "f"
    assert service.store.get(original["id"])["content"] == original["content"]
