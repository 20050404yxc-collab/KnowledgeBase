# 文件：library_preparation.py
# 层：Python application
# 作用：在结构确认后，按完整来源分片生成重组正文。
# 说明：保留原件、版本与引用；全部完成后才允许选择应用。
from __future__ import annotations

import difflib
import json

from knowledge_agent.domain.duplicate_rules import confirmed_map
from knowledge_agent.domain.library_rules import validate_collisions, validate_suggestion
from knowledge_agent.domain.restructure_evidence import (
    source_chunks,
    source_citations,
    source_version,
    validate_rewrite_references,
)
from knowledge_agent.domain.taxonomy import parent_path, path_fields

from .library_fusion import LibraryFusion
from .restructure_memory import preparation_key


class LibraryPreparation(LibraryFusion):
    # 确认整个映射和重复组后才准备内容；后续结构变更必须重新确认。
    def approve_structure(self, draft: dict) -> None:
        mapping, merges = confirmed_map(draft, provisional=True)
        targets = set(mapping.values())
        points = [dict(point) for point in draft["outline"] if point["id"] in targets]
        for group in merges:
            next(p for p in points if p["id"] == group["target_id"]).update(
                {"title": group["title"], **path_fields(group)}
            )
        if set(p["id"] for p in points) != targets:
            raise ValueError("结构未完整覆盖所有来源")
        validate_collisions(points, [{"id": p["id"], "title": p["title"]} for p in points])
        if any(r["status"] != "complete" for r in draft["records"]):
            raise ValueError("来源覆盖尚未完成")
        draft.update(
            source_map=mapping,
            merges=merges,
            targets=points,
            approved=draft["revision"],
            status="preparing",
            phase="duplicates" if any(g["kind"] == "pending" for g in merges) else "preparing",
            suggestions=[],
            prepared=0,
            preparation=None,
        )

    # 结构确认后逐块重组全文；中途失败保留成功片段，全部完成才发布建议。
    async def prepare_one(self, draft: dict, emit) -> None:
        if draft["approved"] != draft["revision"]:
            raise ValueError("结构确认已失效，请重新确认")
        point = draft["targets"][draft["prepared"]]
        cached = draft["prepared_cache"].get(preparation_key(draft, point))
        if cached:
            self.publish_suggestion(draft, cached)
            return
        sources = [
            item for item in draft["items"] if draft["source_map"][item["id"]] == point["id"]
        ]
        target = next(item for item in sources if item["id"] == point["id"])
        state = draft["preparation"]
        if state is None:
            state = {
                "chunks": [
                    {**chunk, "source_id": item["id"]}
                    for item in sources
                    for chunk in source_chunks(item)
                ],
                "index": 0,
                "parts": [],
                "citations": source_citations(sources),
            }
            draft["preparation"] = state
        if state["index"] < len(state["chunks"]):
            await self.rewrite_one(draft, state, point, emit)
            if state["index"] < len(state["chunks"]):
                return
        # 合并目标必须再融合不同来源；单来源长文保持完整分片组织方式。
        if len(sources) > 1:
            if not await self.fuse_one(draft, state, point, emit):
                return
            parts, provenance = state["fusion"]["parts"], state["fusion"]["provenance"]
        else:
            parts = state["parts"]
            provenance = [{**c, "section": i} for i, c in enumerate(state["chunks"])]
        mode = "replace" if target["generated"] and not target["edited"] else "append"
        suggestion = make_suggestion(
            point,
            "\n\n".join(parts),
            "original-extraction",
            mode,
            target["content"] if mode == "replace" else "",
        )
        versions = {item["id"]: source_version(item) for item in sources}
        suggestion.update(
            citations=state["citations"],
            source_ids=[item["id"] for item in sources],
            provenance=[
                {
                    "source_id": c["source_id"],
                    "version": versions[c["source_id"]],
                    "locator": c["locator"],
                    "section": c["section"],
                }
                for c in provenance
            ],
        )
        self.publish_suggestion(draft, suggestion)

    # 每次只整理一个输入片段，成功后才推进覆盖位置。
    async def rewrite_one(self, draft: dict, state: dict, point: dict, emit) -> None:
        chunk = state["chunks"][state["index"]]
        text = await self.client.generate(
            draft["config"],
            json.dumps(
                {
                    "id": point["id"],
                    "title": point["title"],
                    "path": parent_path(point),
                    "original": chunk["text"],
                    "source_id": chunk["source_id"],
                    "locator": chunk["locator"],
                    "mode": "rewrite",
                    "feedback_history": draft["feedback_history"],
                    "part": state["index"] + 1,
                    "parts": len(state["chunks"]),
                    "section_titles": [
                        (part.splitlines() or [""])[0][:200] for part in state["parts"][-12:]
                    ],
                },
                ensure_ascii=False,
            ),
            "library-content",
            emit,
        )
        value = validate_suggestion(text)
        if chunk["text"].strip() and not value["content"]:
            raise ValueError("完整正文整理返回空内容；未发布不完整建议")
        validate_rewrite_references(chunk["text"], value["content"], state["citations"])
        self.ensure_active(draft)
        state["parts"].append(value["content"])
        state["index"] += 1

    # 整个目标完成后才发布；失败中间态不能成为可提交建议。
    def publish_suggestion(self, draft: dict, suggestion: dict) -> None:
        draft["suggestions"].append(suggestion)
        draft.update(prepared=draft["prepared"] + 1, preparation=None)
        if draft["prepared"] == len(draft["targets"]):
            draft["status"] = "ready"


# 默认不选任何更新；正文与差异在预览边界按同一修订分页。
def make_suggestion(point: dict, content: str, kind: str, mode: str, original: str) -> dict:
    return {
        "id": point["id"],
        "target_id": point["id"],
        "title": point["title"],
        "kind": kind,
        "mode": mode,
        "original": original,
        "content": content,
        "provenance": [],
        "citations": [],
        "reason": "按已确认结构重组完整正文；保留来源，手工正文另附整理稿",
        "diff": "\n".join(
            difflib.unified_diff(
                original.splitlines(),
                content.splitlines(),
                fromfile="原文",
                tofile="建议",
                lineterm="",
            )
        ),
    }
