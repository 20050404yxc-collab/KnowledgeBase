# 文件：library_preparation.py
# 层：Python application
# 作用：在结构确认后，从完整原文准备提取稿和独立模型补充。
# 说明：原文稿保留来源；模型新解释不继承引用且默认不选。
from __future__ import annotations

import difflib
import json

from knowledge_agent.domain.duplicate_rules import confirmed_map
from knowledge_agent.domain.library_rules import validate_collisions, validate_suggestion
from knowledge_agent.domain.restructure_evidence import extract_sources, source_chunks


class LibraryPreparation:
    # 确认整个映射和重复组后才准备内容；后续结构变更必须重新确认。
    def approve_structure(self, draft: dict) -> None:
        mapping, merges = confirmed_map(draft)
        targets = set(mapping.values())
        points = [dict(point) for point in draft["outline"] if point["id"] in targets]
        for group in merges:
            next(p for p in points if p["id"] == group["target_id"]).update(
                {key: group[key] for key in ("title", "category", "subcategory")}
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
            phase="preparing",
        )

    # 每个目标先形成完整来源稿，再逐原文块请求独立补充，不丢失长文尾部。
    async def prepare_one(self, draft: dict, emit) -> None:
        if draft["approved"] != draft["revision"]:
            raise ValueError("结构确认已失效，请重新确认")
        point = draft["targets"][draft["prepared"]]
        sources = [
            item for item in draft["items"] if draft["source_map"][item["id"]] == point["id"]
        ]
        target = next(item for item in sources if item["id"] == point["id"])
        state = draft["preparation"]
        if state is None:
            content, provenance, citations = extract_sources(sources)
            mode = (
                "replace"
                if target["generated"] and not target["edited"] and len(target["content"]) <= 8000
                else "append"
            )
            suggestion = make_suggestion(
                point,
                content,
                "original-extraction",
                mode,
                target["content"] if mode == "replace" else "",
            )
            suggestion.update(
                provenance=provenance, citations=citations, source_ids=[s["id"] for s in sources]
            )
            draft["suggestions"].append(suggestion)
            state = {
                "chunks": [
                    {**chunk, "source_id": item["id"]}
                    for item in sources
                    for chunk in source_chunks(item)
                ],
                "index": 0,
                "parts": [],
            }
            draft["preparation"] = state
        chunk = state["chunks"][state["index"]]
        text = await self.client.generate(
            draft["config"],
            json.dumps(
                {
                    "id": point["id"],
                    "title": point["title"],
                    "path": [point["category"], point["subcategory"]],
                    "original": chunk["text"],
                    "source_id": chunk["source_id"],
                    "locator": chunk["locator"],
                    "mode": "model-explanation",
                    "notice": "只给出可选解释，不重写原文或借用引用",
                },
                ensure_ascii=False,
            ),
            "library-content",
            emit,
        )
        value = validate_suggestion(text)
        self.ensure_active(draft)
        parts = state["parts"] + ([value["content"]] if value["content"] else [])
        content = "\n\n".join(parts)
        if len(content) > 20000:
            raise ValueError("模型补充累计超过 20000 字符；未截断，尚未准备完成")
        state.update(parts=parts, index=state["index"] + 1)
        if state["index"] == len(state["chunks"]):
            if content:
                draft["suggestions"].append(
                    make_suggestion(point, content, "model-explanation", "append", "")
                )
            draft.update(prepared=draft["prepared"] + 1, preparation=None)
            if draft["prepared"] == len(draft["targets"]):
                draft["status"] = "ready"


# 建议身份独立，模型补充和原文提取可分别选择，所有选择初始为空。
def make_suggestion(point: dict, content: str, kind: str, mode: str, original: str) -> dict:
    return {
        "id": point["id"] + (":explanation" if kind == "model-explanation" else ""),
        "target_id": point["id"],
        "title": point["title"],
        "kind": kind,
        "mode": mode,
        "original": original,
        "content": content,
        "provenance": [],
        "citations": [],
        "reason": "完整原文提取；独有信息、限定和矛盾原样保留"
        if kind == "original-extraction"
        else "模型补充解释，未独立核实，不附借用引用；可不选择",
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
