# 文件：library_fusion.py
# 层：Python application
# 作用：将完整分片整理稿按同一知识融合，避免逐来源拼接。
# 说明：融合失败不发布建议；长稿以有界章节逐批处理并保留来源覆盖。
from __future__ import annotations

import json

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.library_rules import validate_suggestion
from knowledge_agent.domain.restructure_evidence import validate_rewrite_references

# 原文分片整理后的正文按此预算融合；不是最终正文总长度上限。
FUSION_INPUT_CHARS = 18000


# 交替取各来源的对应片段，使同一主题的不同表述能够在同批内融合。
def fusion_batches(state: dict) -> list[list[dict]]:
    sources: dict[str, list[dict]] = {}
    for index, (chunk, text) in enumerate(zip(state["chunks"], state["parts"], strict=True)):
        sources.setdefault(chunk["source_id"], []).append(
            {
                "source_id": chunk["source_id"],
                "locator": chunk["locator"],
                "section": index,
                "content": text,
            }
        )
    ordered = [
        parts[index]
        for index in range(max(map(len, sources.values())))
        for parts in sources.values()
        if index < len(parts)
    ]
    batches, batch, size = [], [], 0
    for part in ordered:
        # 超大单段也按位置完整传入，不截掉正文尾部。
        for start in range(0, max(1, len(part["content"])), 7000):
            piece = {**part, "content": part["content"][start : start + 7000]}
            if batch and size + len(piece["content"]) > FUSION_INPUT_CHARS:
                batches.append(batch)
                batch, size = [], 0
            batch.append(piece)
            size += len(piece["content"])
    if batch:
        batches.append(batch)
    return batches


class LibraryFusion:
    # 成功批次留在准备状态，取消或失败只需显式重试尚未完成的批次。
    @traced
    async def fuse_one(self, draft: dict, state: dict, point: dict, emit) -> bool:
        if "fusion" not in state:
            state["fusion"] = {"batches": fusion_batches(state), "parts": [], "provenance": []}
        fusion = state["fusion"]
        batch = fusion["batches"][len(fusion["parts"])]
        payload = {
            "mode": "fuse",
            "id": point["id"],
            "title": point["title"],
            "path": [point["category"], point["subcategory"]],
            "sections": batch,
            "feedback_history": draft["feedback_history"],
            "previous_headings": [
                (part.splitlines() or [""])[0][:200] for part in fusion["parts"][-12:]
            ],
        }
        text = await self.client.generate(
            draft["config"], json.dumps(payload, ensure_ascii=False), "library-content", emit
        )
        value = validate_suggestion(text)
        if not value["content"]:
            raise ValueError("完整正文整理返回空内容；未发布不完整建议")
        original = "\n\n".join(part["content"] for part in batch)
        validate_rewrite_references(original, value["content"], state["citations"])
        self.ensure_active(draft)
        fusion["parts"].append(value["content"])
        fusion["provenance"].extend(
            {
                "source_id": part["source_id"],
                "locator": part["locator"],
                "section": len(fusion["parts"]) - 1,
            }
            for part in batch
        )
        return len(fusion["parts"]) == len(fusion["batches"])
