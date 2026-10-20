# 文件：test_library_questions.py
# 层：验证
# 作用：验证提问和拓展知识收录时自动分类及范围隔离。
# 说明：合成回答和临时文件证据，不请求真实模型。
import asyncio
import json

import pytest
from knowledge_agent.bootstrap import create_service
from knowledge_agent.domain.taxonomy import encode_path
from knowledge_agent.entrypoints.dispatch import dispatch
from review_fixtures import approved_question
from test_knowledge import Vault, config
from test_topics_store import draft


class ClassifiedClient:
    # 保存发送内容，分类字段可单独设为缺失或非法。
    def __init__(self, category="编程语言", subcategory="C++"):
        self.category = category
        self.subcategory = subcategory
        self.prompts = []

    # 资格审核和正文分别返回，保证分类不绕过原有门禁。
    async def generate(self, _config, prompt, purpose, _emit):
        value = json.loads(prompt)
        self.prompts.append((purpose, value))
        if purpose == "question-review":
            return approved_question()
        return json.dumps(
            {
                "title": "对象生命周期",
                "content": "可复用的对象生命周期知识",
                "citation_ids": [b["id"] for b in value["evidence"][:1]],
                "category": self.category,
                "subcategory": self.subcategory,
            }
        )


# 每个范围独立的分类收录，文件范围不能携带知识库分类或正文。
@pytest.mark.parametrize(
    "scope,purpose",
    [
        ("knowledge", "question"),
        ("mixed", "question"),
        ("files", "question"),
        ("knowledge", "expansion"),
    ],
)
def test_question_and_expansion_classification(tmp_path, scope, purpose):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.store.save(
        "私有主题", "PRIVATE_BODY", classification_path=("PRIVATE_CATEGORY", "private-sub")
    )
    service.attachments["f"] = {
        "id": "f",
        "name": "本次文件",
        "warnings": [],
        "retained": False,
        "blocks": [{"id": "b1", "locator": "第1段", "text": "对象生命周期的实现证据"}],
    }
    service.client = ClassifiedClient()
    try:
        answer = asyncio.run(
            dispatch(
                service,
                "question",
                {
                    "query": "对象生命周期",
                    "scope": scope,
                    "purpose": purpose,
                    "attachment_ids": ["f"] if scope != "knowledge" else [],
                },
                lambda _: None,
            )
        )
        saved = service.store.get(answer["knowledge"]["id"])
        assert (saved["category"], saved["subcategory"]) == ("编程语言", "C++")
        assert (
            service.store.library_tree({"path": ["编程语言", "C++"]})["nodes"][0]["id"]
            == saved["id"]
        )
        if scope == "files":
            prompt = service.client.prompts[-1][1]
            assert prompt["taxonomy"] is None
            assert "PRIVATE_" not in json.dumps(prompt)
    finally:
        service.close()


# 无效分类直接拒绝收录，不回退到不明确的隐式分类。
@pytest.mark.parametrize(
    "category,subcategory", [(None, "C++"), ("", "C++"), ("语言", []), ("x" * 81, "C++")]
)
def test_invalid_classification_not_saved(tmp_path, category, subcategory):
    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = ClassifiedClient(category, subcategory)
    try:
        with pytest.raises(ValueError):
            asyncio.run(service.question({"query": "新的独立概念"}, lambda _: None))
        assert not service.store.library_inventory()
    finally:
        service.close()


# 不同旧路径的同名知识不能在重构中被自动合并或撞掉。
def test_restructure_same_title_collision(tmp_path):
    from test_library import LibraryClient, call, outline

    service = create_service(tmp_path, vault=Vault())
    config(service)
    service.client = LibraryClient()
    service.store.capture_topic(
        draft("a", title="队列", theme=encode_path("项目实践", "项目A"), content="项目特定队列实现")
    )
    service.store.capture_topic(
        draft("b", title="队列", theme=encode_path("编程语言", "C++"), content="通用队列概念")
    )
    try:
        value = outline(service)
        assert value["groups"] == 1
        group = service.library.draft["duplicates"][0]
        value = call(
            service,
            "library.restructure.plan",
            {**value, "review": {"action": "decision", "id": group["id"], "decision": "keep"}},
        )
        with pytest.raises(ValueError, match="同名知识"):
            call(service, "library.restructure.prepare", value)
        assert len(service.store.library_inventory()) == 2
        value = service.library.summary()
        call(service, "library.restructure.discard", value)
    finally:
        service.close()
