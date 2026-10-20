import asyncio
import json
import sqlite3
from datetime import date, timedelta

import pytest
from service import KnowledgeService
from store import Store, bucket_for, identity


class Vault:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value):
        self.values[key] = value

    def delete(self, key):
        self.values.pop(key, None)


@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path)
    yield value
    value.close()


@pytest.fixture
def service(tmp_path):
    value = KnowledgeService(tmp_path / "data", vault=Vault())
    yield value
    value.close()


def test_frequency_boundaries():
    today = date(2026, 10, 20)
    created = (today - timedelta(days=40)).isoformat()
    days = [(today - timedelta(days=n)).isoformat() for n in [0, 1, 13]]
    assert bucket_for(created, days, today=today) == "常用"
    assert bucket_for(created, days[1:] + [(today - timedelta(days=14)).isoformat()], today=today) == "在学"
    assert bucket_for(created, [(today - timedelta(days=29)).isoformat()], today=today) == "在学"
    assert bucket_for(created, [(today - timedelta(days=30)).isoformat()], today=today) == "归档"
    assert bucket_for(today.isoformat(), [], today=today) == "在学"
    assert bucket_for(created, days, "归档", today) == "归档"


def test_chinese_retrieval_edit_and_dedup(store):
    item = store.save("事务一致性", "数据库事务保证完整提交。失败时回滚数据，避免部分写入。")
    assert store.list_knowledge("数据库事务")[0]["id"] == item["id"]
    assert store.save(" 事务一致性！ ", "新的生成正文", generated=True)["content"] == item["content"]
    assert store.save("不同标题", item["content"])["id"] == item["id"]
    store.save(item["title"], "这是用户手动编辑过的正文。", item_id=item["id"])
    store.save(item["title"], "不应该覆盖用户编辑内容。", generated=True)
    assert store.get(item["id"])["content"] == "这是用户手动编辑过的正文。"
    assert store.get(item["id"])["edited"]


def test_daily_usage_and_manual_override(store):
    item = store.save("使用频率", "主动打开计入使用日。")
    store.get(item["id"], active_use=True)
    store.get(item["id"], active_use=True)
    assert store.db.execute("SELECT COUNT(*) FROM uses").fetchone()[0] == 1
    assert store.set_bucket(item["id"], "归档")["bucket"] == "归档"
    assert store.get(item["id"], active_use=True)["bucket"] == "归档"
    assert store.set_bucket(item["id"], None)["bucket"] == "在学"


def test_durable_reopen_and_interrupted_attempt(tmp_path):
    store = Store(tmp_path)
    item = store.save("持久化", "重启后笔记保留。")
    store.db.execute("INSERT INTO attempts (id,purpose,provider,model,status,started_at,currency) VALUES ('a','test','p','m','running','2026-10-20','USD')")
    store.db.commit()
    store.close()
    store = Store(tmp_path)
    assert store.get(item["id"])["content"] == item["content"]
    assert store.db.execute("SELECT status FROM attempts").fetchone()[0] == "interrupted"
    store.close()


def test_temporary_retention_deletion_and_original_safety(service, tmp_path):
    original = tmp_path / "原始笔记.md"
    original.write_text("# 事务\n\n数据库事务用于一致性。\n", encoding="utf-8")
    before = original.read_bytes()
    doc = asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    assert service.store.list_sources() == []
    citation = service.attachments[doc["id"]]["blocks"][0] | {"source_id": doc["id"], "name": doc["name"]}
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


def test_snapshot_cleanup_does_not_delete_original(tmp_path):
    original = tmp_path / "input.txt"
    original.write_text("hello", "utf-8")
    service = KnowledgeService(tmp_path / "data", vault=Vault())
    asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    snapshot = service.session
    service.close()
    assert original.exists()
    assert not snapshot.exists()


@pytest.mark.parametrize("inventory", [0, 1, 2])
def test_recommendation_inventory_composition(service, inventory):
    for index in range(inventory):
        service.store.save(f"数据库事务{index}", f"这是相关的数据库知识 {index}。")
    service.store.save("无关的天文学", "遥远的恒星、星系和宇宙。")
    expansions = [{"title": f"拓展概念{i}", "reason": "解释相关原理", "preview": "介绍"} for i in range(3)]
    cards = service.recommendations("数据库", "数据库基础", expansions)
    assert len(cards) == 3
    assert sum("knowledge_id" in card for card in cards) == inventory
    assert all(card["title"] != "无关的天文学" for card in cards)


def config(service):
    from providers import save_provider
    save_provider(service.store, service.vault, {"name": "test", "protocol": "responses", "base_url": "https://example.test/v1",
                                               "model": "test-model", "key": "fixture-key", "currency": "USD"})


def test_cancelled_generation_does_not_capture(service):
    config(service)

    class Client:
        async def generate(self, *_args):
            await asyncio.sleep(30)

    service.client = Client()

    async def scenario():
        task = asyncio.create_task(service.question({"query": "学习事务", "scope": "knowledge"}, lambda _: None))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert service.store.list_knowledge() == []


def test_duplicate_concurrent_generation_reuses_and_preserves_user_edits(service):
    config(service)

    class Client:
        calls = 0

        async def generate(self, *_args):
            self.calls += 1
            await asyncio.sleep(0.01)
            return json.dumps({"title": "数据库事务", "content": "完整的学习正文与示例。", "citation_ids": [], "recommendations": []})

    service.client = Client()

    async def scenario():
        return await asyncio.gather(*(service.question({"query": "事务是什么", "scope": "knowledge"}, lambda _: None) for _ in range(2)))

    answers = asyncio.run(scenario())
    assert service.client.calls == 1
    assert len(service.store.list_knowledge()) == 1
    assert answers[0]["knowledge"]["id"] == answers[1]["knowledge"]["id"]
    assert identity(answers[0]["knowledge"]["title"]) == "数据库事务"


def test_long_summary_fails_before_model_call(service):
    doc_id = "fixture"
    service.attachments[doc_id] = {"id": doc_id, "name": "大文件", "retained": False, "warnings": [],
                                    "blocks": [{"id": str(i), "text": "长" * 1600, "locator": str(i)} for i in range(30)]}
    with pytest.raises(ValueError, match="全文超过"):
        asyncio.run(service.question({"query": "全文总结", "scope": "files", "attachment_ids": [doc_id]}, lambda _: None))
    assert service.store.db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0] == 0


def test_files_only_never_uses_library_notes(service):
    service.store.save("不能泄漏的知识", "属于库里的私人补充。")
    service.attachments["f"] = {"id": "f", "name": "file", "retained": False, "warnings": [],
                                 "blocks": [{"id": "b1", "text": "文件独有内容", "locator": "第 1 页"}]}
    answer = asyncio.run(service.question({"query": "知识是什么", "scope": "files", "attachment_ids": ["f"]}, lambda _: None))
    assert "不能泄漏" not in answer["content"]
    assert "私人补充" not in answer["content"]
    assert all(c["source_id"] == "f" for c in answer["citations"])


def test_invalid_citations_never_capture(service):
    config(service)

    class Client:
        async def generate(self, *_args):
            return json.dumps({"title": "假的引用", "content": "正文", "citation_ids": ["not-real"]})

    service.client = Client()
    with pytest.raises(ValueError, match="不存在的证据"):
        asyncio.run(service.question({"query": "生成新知识", "scope": "knowledge"}, lambda _: None))
    assert service.store.list_knowledge() == []


def test_capture_mapping_and_note_are_one_transaction(store):
    store.db.execute("CREATE TRIGGER reject_mapping BEFORE INSERT ON generation_keys BEGIN SELECT RAISE(ABORT, 'disk fault fixture'); END")
    with pytest.raises(sqlite3.IntegrityError):
        store.save("未提交的知识", "正文", generated=True, capture_key="fixture")
    assert store.list_knowledge() == []


def test_failed_retention_rolls_back_managed_copy(service, tmp_path):
    original = tmp_path / "source.txt"
    original.write_text("原件不能被删除。", "utf-8")
    doc = asyncio.run(service.add_attachment({"path": str(original)}, lambda _: None))
    service.store.db.execute("CREATE TRIGGER reject_source BEFORE INSERT ON sources BEGIN SELECT RAISE(ABORT, 'disk fault fixture'); END")
    with pytest.raises(sqlite3.IntegrityError):
        service.retain(doc["id"])
    assert not list(service.store.sources_dir.iterdir())
    assert service.store.list_sources() == []
    assert original.read_text("utf-8") == "原件不能被删除。"


def test_same_title_different_answer_does_not_claim_new_content_saved(service):
    config(service)
    original = service.store.save("事务", "这是已有的个人笔记。")
    service.attachments["f"] = {"id": "f", "name": "file", "retained": False, "warnings": [],
                                 "blocks": [{"id": "b1", "text": "新的文档证据", "locator": "第 1 页"}]}

    class Client:
        async def generate(self, *_args):
            return json.dumps({"title": "事务", "content": "这是根据新文档生成的不同内容。", "citation_ids": ["b1"]})

    service.client = Client()
    answer = asyncio.run(service.question({"query": "解释文档", "scope": "files", "attachment_ids": ["f"]}, lambda _: None))
    assert answer["knowledge"] is None
    assert "未新建" in answer["notice"]
    assert "根据新文档" in answer["content"]
    assert answer["citations"][0]["source_id"] == "f"
    assert service.store.get(original["id"])["content"] == original["content"]
