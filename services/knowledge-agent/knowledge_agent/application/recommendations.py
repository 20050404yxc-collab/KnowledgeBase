# 文件：recommendations.py
# 层：Python application
# 作用：组合实际相关的已有知识与模型拓展。
# 说明：不以无关库存补足推荐数量。

from knowledge_agent.domain.knowledge_rules import identity

from .ports import KnowledgeRepository


class Recommendations:
    # 仓库只提供候选项，卡片组合规则由用例负责。
    def __init__(self, store: KnowledgeRepository) -> None:
        self.store = store

    # 最多组合两条相关旧知识和有效拓展，不使用无关库存凑数。
    def recommend(
        self,
        title: str,
        content: str,
        expansions: list[dict] | None = None,
        exclude: str | None = None,
    ) -> list[dict]:
        result, seen = [], {identity(title)}
        # 候选必须有实际关键词关联，无关库存不能用于补足卡片。
        candidates = self.store.list_knowledge(title, brief=False)
        if not candidates:
            candidates = self.store.list_knowledge(content[:120], brief=False)
        for item in candidates:
            # 当前条目和同概念候选去重，相关旧知识最多占两个位置。
            if item["id"] == exclude or identity(item["title"]) in seen:
                continue
            result.append(
                {
                    "title": item["title"],
                    "preview": item["content"][:100],
                    "reason": "与当前内容包含相关概念，可对照已有笔记继续阅读",
                    "knowledge_id": item["id"],
                }
            )
            seen.add(identity(item["title"]))
            if len(result) == 2:
                break
        for card in expansions or []:
            # 新拓展同样需要有效概念，并与正文及已选卡片去重。
            concept = identity(card["title"])
            if not concept or concept in seen:
                continue
            seen.add(concept)
            # 已存在的拓展概念不作为需要重新生成的新卡片。
            existing = self.store.concept_exists(concept)
            if existing:
                continue
            result.append(card)
            if len(result) == 3:
                break
        return result
