# 文件：library_restructure.py
# 层：Python application
# 作用：拥有双代理重构会话、结构确认及最终提交生命周期。
# 说明：会话退出释放未确认快照，正式写入交给仓库原子完成。
from __future__ import annotations

import asyncio
import uuid

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.library_rules import inventory_version
from knowledge_agent.domain.provider_rules import resolve_generation
from knowledge_agent.domain.topic_rules import short_field

from .library_analysis import analysis_records, analysis_round
from .library_planning import LibraryPlanning
from .library_preparation import LibraryPreparation
from .ports import Emit, Generator, Repository


class LibraryRestructure(LibraryPlanning, LibraryPreparation):
    # 草案和子任务只归当前后台会话，不由界面生命周期释放。
    def __init__(self, store: Repository, client: Generator) -> None:
        self.store = store
        self.client = client
        self.draft: dict | None = None

    # 已有草案只能明确重规划，不能替换仍在执行或未识别的草案。
    @traced
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
            "records": analysis_records(items),
            "outline": [],
            "duplicates": [],
            "suggestions": [],
            "prepared": 0,
            "receipt": None,
            "busy": False,
            "errors": [],
            "phase": "analysis",
            "children": [],
            "cancelled": False,
            "source_map": {},
            "merges": [],
            "targets": [],
            "approved": None,
            "preparation": None,
            "feedback": short_field(
                params.get("feedback") or "按知识要点细分，优先沿用合适分类", "调整意见", 2000
            ),
        }
        return self.summary()

    # 每轮最多两块；失败保留当前轮成功结果并暂停，只有显式继续会重试。
    @traced
    async def advance(self, params: dict, emit: Emit, prepare: bool = False) -> dict:
        draft = self.require(params)
        if draft["busy"]:
            raise ValueError("该重构阶段仍在执行")
        if draft["status"] == "paused":
            if params.get("retry") is not True:
                return self.summary()
            draft.update(
                errors=[], status="preparing" if draft["phase"] == "preparing" else "planning"
            )
        if prepare and draft["status"] == "outline":
            self.approve_structure(draft)
        if draft["status"] not in ("planning", "preparing"):
            return self.summary()
        draft["busy"] = True
        try:
            if draft["status"] == "preparing":
                await self.prepare_one(draft, emit)
            elif any(r["status"] != "complete" for r in draft["records"]):
                await analysis_round(self, draft, emit)
            elif draft["phase"] == "duplicates":
                await self.verify_one(draft, emit)
            else:
                draft["phase"] = "classification"
                await self.assign_batch(draft, emit)
            return self.summary()
        except asyncio.CancelledError:
            draft.update(
                status="paused", errors=["当前阶段已取消；成功记录保留，可显式继续未完成阶段"]
            )
            raise
        except Exception as error:
            draft.update(status="paused", errors=[str(error)])
            return self.summary()
        finally:
            draft["busy"] = False

    # 合并稿必须整体接受，模型解释的选择不能代替原文稿。
    @traced
    async def apply(self, params: dict) -> dict:
        draft = self.require(params)
        if draft["receipt"]:
            return draft["receipt"]
        selected = params.get("selected", [])
        allowed = {s["id"] for s in draft["suggestions"]}
        if (
            draft["busy"]
            or draft["status"] != "ready"
            or draft["approved"] != draft["revision"]
            or not isinstance(selected, list)
            or any(not isinstance(key, str) or key not in allowed for key in selected)
            or len(set(selected)) != len(selected)
        ):
            raise ValueError("请完成当前结构和内容差异核对后确认")
        if any(group["target_id"] not in selected for group in draft["merges"]):
            raise ValueError("合并必须整体接受完整原文整理稿，不能仅应用含合并的目录")
        await asyncio.sleep(0)
        self.ensure_active(draft)
        result = self.store.apply_library(draft, selected)
        draft.update(receipt=result, status="applied")
        return result

    # 成功或失败后均可重新获取真实状态，不会启动模型。
    @traced
    def preview(self, params: dict) -> dict:
        draft = self.require(params)
        kind, page = params.get("kind", "outline"), params.get("page", 0)
        sizes = {
            "outline": 30,
            "suggestions": 1,
            "records": 1,
            "duplicates": 1,
            "sources": 1,
            "summary": 1,
        }
        if not isinstance(kind, str) or kind not in sizes or type(page) is not int or page < 0:
            raise ValueError("重构预览分页无效")
        values = preview_values(draft, kind)
        if kind == "duplicates":
            evidence_page = params.get("evidence_page", 0)
            if type(evidence_page) is not int or evidence_page < 0:
                raise ValueError("证据分页无效")
            for value in values:
                group = next(g for g in draft["duplicates"] if g["id"] == value["id"])
                value.update(
                    evidence=group["evidence"][evidence_page : evidence_page + 1],
                    evidence_page=evidence_page,
                )
        result = {
            "outline": [],
            "suggestions": [],
            "records": [],
            "duplicates": [],
            "sources": [],
            "kind": kind,
            "total": len(values),
            "page": page,
            "summary": self.summary(),
        }
        if kind != "summary":
            result[kind] = values[page * sizes[kind] : (page + 1) * sizes[kind]]
        return result

    # 每次读写绑定草案及修订，防止旧界面提交过期决定。
    def require(self, params: dict) -> dict:
        draft = self.draft
        if (
            not draft
            or draft["id"] != params.get("draft_id")
            or draft["revision"] != params.get("revision")
        ):
            raise ValueError("重构草案已失效，请重新打开")
        return draft

    # 先失效，再取消并等待两路，忽略取消的输出不能复活。
    @traced
    async def discard(self, params: dict) -> dict:
        draft = self.require(params)
        draft["cancelled"] = True
        self.draft = None
        tasks = list(draft["children"])
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        return {"discarded": True}

    # 模型返回和写入前验证草案所有权及取消状态。
    def ensure_active(self, draft: dict) -> None:
        if self.draft is not draft or draft["cancelled"]:
            raise ValueError("重构已取消，未修改知识库")

    # 计数区分来源、目标及两路覆盖，不发送完整正文。
    def summary(self) -> dict:
        draft = self.draft
        if not draft:
            raise ValueError("没有重构草案")
        return {
            "draft_id": draft["id"],
            "revision": draft["revision"],
            "status": draft["status"],
            "total": len(draft["items"]),
            "covered": sum(r["status"] == "complete" for r in draft["records"]),
            "classified": len(draft["outline"]),
            "prepared": draft["prepared"],
            "suggestions": len(draft["suggestions"]),
            "phase": draft["phase"],
            "errors": draft["errors"],
            "target_count": len(draft["targets"])
            or len({i["canonical_id"] for i in draft["items"]}),
            "groups": len(draft["duplicates"]),
            "undecided": sum(g["decision"] == "undecided" for g in draft["duplicates"]),
            "workers": [
                {
                    "agent": agent,
                    "covered": sum(
                        r["status"] == "complete" and r["agent"] == agent for r in draft["records"]
                    ),
                }
                for agent in ("A", "B")
            ],
        }


# 分片证据逐条分页，防止长来源或大重复组超过一帧。
def preview_values(draft: dict, kind: str) -> list[dict]:
    if kind == "records":
        return [
            {
                "draft_id": draft["id"],
                "revision": draft["revision"],
                "candidates": record["candidates"],
                "path": next(
                    (
                        [p["category"], p["subcategory"]]
                        for p in draft["outline"]
                        if p["id"]
                        == next(
                            item["canonical_id"]
                            for item in draft["items"]
                            if item["id"] == record["source_id"]
                        )
                    ),
                    [],
                ),
                **{
                    key: record[key]
                    for key in ("source_id", "title", "version", "agent", "generation", "status")
                },
                **{
                    key: chunk[key]
                    for key in (
                        "locator",
                        "status",
                        "summary",
                        "error",
                        "attempt_ids",
                        "call_id",
                        "generation",
                    )
                },
            }
            for record in draft["records"]
            for chunk in record["chunks"]
        ]
    if kind == "sources":
        return [
            {
                "source_id": r["source_id"],
                "title": r["title"],
                "version": r["version"],
                "target_id": draft["source_map"].get(
                    r["source_id"],
                    next(i["canonical_id"] for i in draft["items"] if i["id"] == r["source_id"]),
                ),
                "locator": c["locator"],
                "content": c["text"],
            }
            for r in draft["records"]
            for c in r["chunks"]
        ]
    if kind == "duplicates":
        return [
            {
                **{key: value for key, value in g.items() if key != "evidence"},
                "evidence": g["evidence"][:1],
                "evidence_total": len(g["evidence"]),
            }
            for g in draft["duplicates"]
        ]
    return draft.get(kind, [])
