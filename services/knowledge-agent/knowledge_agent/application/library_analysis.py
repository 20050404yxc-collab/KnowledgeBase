# 文件：library_analysis.py
# 层：Python application
# 作用：调度从快照两端独占领取的两个分析代理。
# 说明：每轮最多两个片段；成功记录保留，失败暂停，不自动重试。
from __future__ import annotations

import asyncio
import json
import uuid

from knowledge_agent.diagnostics import record, step
from knowledge_agent.domain.restructure_evidence import (
    analysis_result,
    source_chunks,
    source_version,
)
from knowledge_agent.domain.validation_errors import FieldValidationError

from .generation_context import ATTEMPT_OBSERVER
from .ports import Emit, Generator


# 记录归草案所有，全部来源在任何模型调用前固定版本和分片。
def analysis_records(items: list[dict]) -> list[dict]:
    return [
        {
            "source_id": item["id"],
            "title": item["title"],
            "version": source_version(item),
            "agent": "",
            "generation": 0,
            "status": "pending",
            "summary": "",
            "candidates": [],
            "chunks": [
                {
                    **chunk,
                    "status": "pending",
                    "summary": "",
                    "attempt_ids": [],
                    "call_id": "",
                    "generation": 0,
                    "error": "",
                }
                for chunk in source_chunks(item)
            ],
        }
        for item in items
    ]


# 已领取来源由原代理完成，两个代理只从未领取集合的相反端选取。
def claim(draft: dict, agent: str) -> dict | None:
    records = draft["records"]
    current = next((r for r in records if r["agent"] == agent and r["status"] != "complete"), None)
    if current:
        return current
    values = [r for r in records if not r["agent"]]
    if not values:
        return None
    current = values[0] if agent == "A" else values[-1]
    current.update(agent=agent, status="claimed")
    return current


# 子任务结束前校验会话身份；取消即使被供应商忽略也不能写回记录。
async def analyze_chunk(owner, draft: dict, item: dict, client: Generator, emit: Emit) -> None:
    chunk = next(part for part in item["chunks"] if part["status"] != "complete")
    item["generation"] += 1
    generation = item["generation"]
    chunk.update(status="running", error="", call_id=str(uuid.uuid4()), generation=generation)
    item["status"] = "running"
    token = ATTEMPT_OBSERVER.set(chunk["attempt_ids"].append)
    try:
        emit(
            {
                "type": "progress",
                "message": f"代理 {item['agent']} · {item['title']} · {chunk['locator']}",
            }
        )
        text = await client.generate(
            draft["config"],
            json.dumps(
                {
                    "id": item["source_id"],
                    "title": item["title"],
                    "previous": item["summary"],
                    "chunk": chunk["text"],
                    "locator": chunk["locator"],
                    "part": item["chunks"].index(chunk) + 1,
                    "parts": len(item["chunks"]),
                    "known_sources": [
                        {"id": value["source_id"], "title": value["title"]}
                        for value in draft["records"]
                        if value["status"] == "complete"
                    ][-8:],
                    "agent": item["agent"],
                    "call_id": chunk["call_id"],
                },
                ensure_ascii=False,
            ),
            "library-summary",
            emit,
        )
        record(
            "library.summary_context",
            item_index=draft["records"].index(item),
            chunk_index=item["chunks"].index(chunk),
            items=len(draft["records"]),
            chunks=len(item["chunks"]),
        )
        with step("library.validate_summary"):
            value = analysis_result(text, {r["source_id"] for r in draft["records"]})
        owner.ensure_active(draft)
        if generation != item["generation"] or draft["cancelled"]:
            raise asyncio.CancelledError()
        chunk.update(status="complete", summary=value["summary"])
        item["summary"] = value["summary"]
        item["candidates"] = list(dict.fromkeys(item["candidates"] + value["candidates"]))
        item["status"] = (
            "complete" if all(c["status"] == "complete" for c in item["chunks"]) else "claimed"
        )
        draft["summaries"][item["source_id"]] = item["summary"]
    except asyncio.CancelledError:
        chunk.update(status="cancelled", error="调用已取消；可显式继续未完成片段")
        item["status"] = "cancelled"
        raise
    except Exception as error:
        detail = str(error)
        if isinstance(error, FieldValidationError):
            detail += f"；规则 {error.rule}，类型 {error.actual_type}，实际长度 {error.actual_length}，上限 {error.limit}"
        message = f"代理 {item['agent']} · {item['title']} · {chunk['locator']}：{detail}"
        chunk.update(status="failed", error=message)
        item["status"] = "failed"
        draft["errors"].append(message)
    finally:
        ATTEMPT_OBSERVER.reset(token)


# gather 等待另一当前块收束；父任务取消时显式取消并等待全部子任务。
async def analysis_round(owner, draft: dict, emit: Emit) -> None:
    tasks = []
    for agent in ("A", "B"):
        item = claim(draft, agent)
        if item:
            tasks.append(asyncio.create_task(analyze_chunk(owner, draft, item, owner.client, emit)))
    draft["children"] = tasks
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        draft["children"] = []
    if draft["errors"]:
        draft["status"] = "paused"
