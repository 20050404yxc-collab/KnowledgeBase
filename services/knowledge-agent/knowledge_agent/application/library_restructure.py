# 文件：library_restructure.py
# 层：Python application
# 作用：协调全库概览、目录确认、内容差异和最终原子提交。
# 说明：草案限一个会话，由 service 关闭时释放；每阶段可取消并独立记账。
from __future__ import annotations

import asyncio
import difflib
import json
import uuid

from knowledge_agent.domain.library_rules import (
    display_path,
    inventory_version,
    validate_assignments,
    validate_collisions,
    validate_suggestion,
)
from knowledge_agent.domain.provider_rules import resolve_generation
from knowledge_agent.domain.topic_rules import json_object, short_field

from .ports import Emit, Generator, Repository


class LibraryRestructure:
    # 草案仅归当前后台会话，关闭后不保留用户正文副本。
    def __init__(self, store: Repository, client: Generator) -> None:
        self.store = store
        self.client = client
        self.draft: dict | None = None

    # 有草案时须明确重规划／丢弃，不静默替换待核对内容。
    def begin(self, params: dict) -> dict:
        previous = self.draft
        if previous and (
            params.get("draft_id") != previous["id"]
            or params.get("revision") != previous["revision"]
            or previous["busy"]
        ):
            raise ValueError("已有重构草案，请先查看或取消")
        config = self.store.provider(params.get("provider_id"))
        if not config:
            raise ValueError("请先配置并选择生成接口")
        items = self.store.library_inventory()
        if not items:
            raise ValueError("知识库为空，无需重构")
        self.draft = {
            "id": str(uuid.uuid4()),
            "revision": str(uuid.uuid4()),
            "status": "planning",
            "snapshot": inventory_version(items),
            "items": items,
            "config": resolve_generation(config, params),
            "summaries": {},
            "item_index": 0,
            "chunk_index": 0,
            "outline": [],
            "suggestions": [],
            "prepared": 0,
            "receipt": None,
            "busy": False,
            "feedback": short_field(
                params.get("feedback") or "按知识要点细分，优先沿用合适分类", "调整意见", 2000
            ),
        }
        return self.summary()

    # 任一模型阶段绑定同一草案，禁止重复并发推进或已丢弃结果回写。
    async def advance(self, params: dict, emit: Emit, prepare: bool = False) -> dict:
        draft = self.require(params)
        if draft["busy"]:
            raise ValueError("该重构阶段仍在执行")
        expected = "preparing" if prepare else "planning"
        if prepare and draft["status"] == "outline":
            draft["status"] = "preparing"
        if draft["status"] != expected:
            return self.summary()
        draft["busy"] = True
        try:
            # 每次仅推进一个有界模型阶段；没有持有数据库写事务。
            if prepare:
                await self.prepare_one(draft, emit)
            elif draft["item_index"] < len(draft["items"]):
                await self.summarize_one(draft, emit)
            else:
                await self.assign_batch(draft, emit)
            return self.summary()
        finally:
            draft["busy"] = False

    # 全文和每个补充都以有界块参与摘要，不只读取正文头部。
    async def summarize_one(self, draft: dict, emit: Emit) -> None:
        item = draft["items"][draft["item_index"]]
        parts = [
            item["content"],
            *[s["title"] + "\n" + s["content"] for s in item.get("supplements", [])],
        ]
        chunks = [
            part[start : start + 7000] for part in parts for start in range(0, len(part), 7000)
        ]
        index = draft["chunk_index"]
        emit(
            {
                "type": "progress",
                "message": f"概览 {draft['item_index'] + 1}/{len(draft['items'])}：{item['title']} · 片段 {index + 1}/{len(chunks)}",
            }
        )
        text = await self.client.generate(
            draft["config"],
            json.dumps(
                {
                    "title": item["title"],
                    "previous": draft["summaries"].get(item["id"], ""),
                    "chunk": chunks[index],
                    "part": index + 1,
                    "parts": len(chunks),
                },
                ensure_ascii=False,
            ),
            "library-summary",
            emit,
        )
        summary = short_field(json_object(text).get("summary"), "知识要点", 1600)
        self.ensure_active(draft)
        draft["summaries"][item["id"]] = summary
        draft["chunk_index"] += 1
        if draft["chunk_index"] == len(chunks):
            draft["item_index"] += 1
            draft["chunk_index"] = 0

    # 前批路径作为后一批分类词表；全局碰撞检查通过后才允许确认目录。
    async def assign_batch(self, draft: dict, emit: Emit) -> None:
        start = len(draft["outline"])
        items = draft["items"][start : start + 8]
        paths = sorted({(p["category"], p["subcategory"]) for p in draft["outline"]})
        prompt = {
            "items": [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "old_path": display_path(item),
                    "summary": draft["summaries"][item["id"]],
                }
                for item in items
            ],
            "existing_paths": paths,
            "feedback": draft["feedback"],
        }
        payload = json.dumps(prompt, ensure_ascii=False)
        if len(payload) > 26000:
            raise ValueError("分类词表超出本阶段上限，请调整目录减少重复分类后重试")
        emit({"type": "progress", "message": f"规划目录 {start}/{len(draft['items'])}"})
        text = await self.client.generate(draft["config"], payload, "library-outline", emit)
        values = validate_assignments(text, items)
        self.ensure_active(draft)
        combined = draft["outline"] + [
            {**value, "title": item["title"], "old_path": display_path(item)}
            for value in values
            for item in items
            if value["id"] == item["id"]
        ]
        validate_collisions(combined, draft["items"])
        draft["outline"] = combined
        if len(combined) == len(draft["items"]):
            draft["status"] = "outline"

    # 目录确认后逐项生成必要整理建议，手工或长正文只允许追加要点。
    async def prepare_one(self, draft: dict, emit: Emit) -> None:
        item = draft["items"][draft["prepared"]]
        mode = (
            "replace"
            if item["generated"] and not item["edited"] and len(item["content"]) <= 8000
            else "append"
        )
        emit(
            {
                "type": "progress",
                "message": f"准备内容差异 {draft['prepared'] + 1}/{len(draft['items'])}：{item['title']}",
            }
        )
        text = await self.client.generate(
            draft["config"],
            json.dumps(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "mode": mode,
                    "original": item["content"]
                    if mode == "replace"
                    else "原文受保护，仅据要点另附整理建议",
                    "summary": draft["summaries"][item["id"]],
                    "path": next(
                        [p["category"], p["subcategory"]]
                        for p in draft["outline"]
                        if p["id"] == item["id"]
                    ),
                },
                ensure_ascii=False,
            ),
            "library-content",
            emit,
        )
        suggestion = validate_suggestion(text)
        self.ensure_active(draft)
        if suggestion["content"] and suggestion["content"] != item["content"]:
            original = item["content"] if mode == "replace" else ""
            diff = "\n".join(
                difflib.unified_diff(
                    original.splitlines(),
                    suggestion["content"].splitlines(),
                    fromfile="原文" if mode == "replace" else "原文保留",
                    tofile="建议",
                    lineterm="",
                )
            )
            draft["suggestions"].append(
                {
                    **suggestion,
                    "id": item["id"],
                    "title": item["title"],
                    "mode": mode,
                    "original": original,
                    "diff": diff,
                }
            )
        draft["prepared"] += 1
        if draft["prepared"] == len(draft["items"]):
            draft["status"] = "ready"

    # 最终确认只应用用户勾选项；重复确认返回同一收据而非重做写入。
    async def apply(self, params: dict) -> dict:
        draft = self.require(params)
        if draft["receipt"]:
            return draft["receipt"]
        selected = params.get("selected", [])
        allowed = {s["id"] for s in draft["suggestions"]}
        if (
            draft["busy"]
            or draft["status"] != "ready"
            or not isinstance(selected, list)
            or any(not isinstance(i, str) or i not in allowed for i in selected)
            or len(set(selected)) != len(selected)
        ):
            raise ValueError("请完成当前目录和正文差异核对后确认")
        await asyncio.sleep(0)
        self.ensure_active(draft)
        result = self.store.apply_library(draft, selected)
        draft["receipt"] = result
        draft["status"] = "applied"
        # 完成后释放正文快照，仅保留有限收据及分页预览。
        draft["items"] = []
        draft["summaries"] = {}
        return result

    # 分页预览最多一个完整正文差异，严格控制协议帧。
    def preview(self, params: dict) -> dict:
        draft = self.require(params)
        kind, page = params.get("kind", "outline"), params.get("page", 0)
        if kind not in ("outline", "suggestions") or type(page) is not int or page < 0:
            raise ValueError("重构预览分页无效")
        values = draft[kind]
        size = 30 if kind == "outline" else 1
        return {
            "outline": values[page * size : (page + 1) * size] if kind == "outline" else [],
            "suggestions": values[page : page + 1] if kind == "suggestions" else [],
            "total": len(values),
            "page": page,
        }

    # 每次跨进程确认都验证草案与目录修订，不接受旧方案回写。
    def require(self, params: dict) -> dict:
        draft = self.draft
        if (
            not draft
            or draft["id"] != params.get("draft_id")
            or draft["revision"] != params.get("revision")
        ):
            raise ValueError("重构草案已失效，请重新打开")
        return draft

    # 丢弃可打断正在等待模型的草案，返回后的旧模型结果不能复活它。
    def discard(self, params: dict) -> dict:
        self.require(params)
        self.draft = None
        return {"discarded": True}

    # 模型返回后、进入任何草案提交前验证会话所有权。
    def ensure_active(self, draft: dict) -> None:
        if self.draft is not draft:
            raise ValueError("重构已取消，未修改知识库")

    # 摘要不携带原知识正文；客户端逐阶段推进以保留取消点。
    def summary(self) -> dict:
        draft = self.draft
        if not draft:
            raise ValueError("没有重构草案")
        return {
            "draft_id": draft["id"],
            "revision": draft["revision"],
            "status": draft["status"],
            "total": len(draft["items"]) or len(draft["outline"]),
            "covered": draft["item_index"],
            "classified": len(draft["outline"]),
            "prepared": draft["prepared"],
            "suggestions": len(draft["suggestions"]),
        }
