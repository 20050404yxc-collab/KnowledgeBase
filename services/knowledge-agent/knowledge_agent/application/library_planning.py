# 文件：library_planning.py
# 层：Python application
# 作用：统一分类、完整原文重复核验和当前修订的人工纠正。
# 说明：只改变会话草案，正式存储须通过最终应用。
from __future__ import annotations

import itertools
import json
import uuid

from knowledge_agent.domain.duplicate_rules import (
    duplicate_candidates,
    new_group,
    validate_duplicate,
    verification_work,
)
from knowledge_agent.domain.library_rules import display_path, validate_assignments
from knowledge_agent.domain.topic_rules import short_field


class LibraryPlanning:
    # 统一词表逐批提供；全部来源先有成功覆盖，才进入全局分类阶段。
    async def assign_batch(self, draft: dict, emit) -> None:
        active = [item for item in draft["items"] if item["id"] == item["canonical_id"]]
        start = len(draft["outline"])
        items = active[start : start + 8]
        payload = json.dumps(
            {
                "items": [
                    {
                        "id": item["id"],
                        "title": item["title"],
                        "old_path": display_path(item),
                        "summary": "\n".join(
                            draft["summaries"][source["id"]]
                            for source in draft["items"]
                            if source["canonical_id"] == item["id"]
                        ),
                    }
                    for item in items
                ],
                "existing_paths": sorted(
                    {(p["category"], p["subcategory"]) for p in draft["outline"]}
                ),
                "feedback": draft["feedback"],
            },
            ensure_ascii=False,
        )
        if len(payload) > 26000:
            raise ValueError("全局分类输入超过 26000 字符，未截断；请缩小目录词表后重新规划")
        text = await self.client.generate(draft["config"], payload, "library-outline", emit)
        values = validate_assignments(text, items)
        self.ensure_active(draft)
        draft["outline"].extend(
            {**value, "title": item["title"], "old_path": display_path(item)}
            for value in values
            for item in items
            if value["id"] == item["id"]
        )
        if len(draft["outline"]) == len(active):
            draft["duplicates"] = duplicate_candidates(draft)
            draft["phase"] = "duplicates"
            if not draft["duplicates"]:
                draft["status"] = "outline"

    # 一次只验证一个有界原文块对，全部对完成后才产生组级判定。
    async def verify_one(self, draft: dict, emit) -> None:
        group = next((g for g in draft["duplicates"] if g["kind"] == "pending"), None)
        if not group:
            draft["status"] = "outline"
            return
        work = verification_work(group, draft["items"])
        pair = work[group["checked"]]
        text = await self.client.generate(
            draft["config"],
            json.dumps(
                {
                    "left": pair[0],
                    "right": pair[1],
                    "notice": "只核验当前原文块对，不把相似关系传递到其他来源",
                },
                ensure_ascii=False,
            ),
            "library-duplicates",
            emit,
        )
        evidence = validate_duplicate(text, pair)
        self.ensure_active(draft)
        group["evidence"].append(
            {**evidence, "left": pair[0]["source_id"], "right": pair[1]["source_id"]}
        )
        group["checked"] += 1
        if group["checked"] == len(work):
            self.finish_verification(group, draft)
        if all(g["kind"] != "pending" for g in draft["duplicates"]):
            draft["status"] = "outline"

    # 必须每个来源对都出现真实重叠，且整组没有冲突；不构建相似连通分量。
    def finish_verification(self, group: dict, draft: dict) -> None:
        evidence = group["evidence"]
        pairs = {tuple(sorted((e["left"], e["right"]))) for e in evidence if e["overlap"]}
        required = {tuple(sorted(pair)) for pair in itertools.combinations(group["sources"], 2)}
        contents = {item["content"] for item in draft["items"] if item["id"] in group["sources"]}
        if any(e["kind"] == "conflict" for e in evidence):
            kind = "conflict"
        elif required <= pairs:
            kind = "equivalent" if len(contents) == 1 else "partial-overlap"
        else:
            kind = "related"
        group.update(
            kind=kind, reason="完整原文块对核验完成；独有内容和限定条件将在整理稿中完整保留"
        )

    # 每次结构编辑生成新修订并作废准备和选择，分析成功记录可以复用。
    def review(self, params: dict) -> dict:
        draft = self.require(params)
        if draft["busy"] or draft["status"] not in ("outline", "ready", "paused"):
            raise ValueError("请等待当前阶段收束后再修改结构")
        value = params.get("review")
        if not isinstance(value, dict):
            raise ValueError("缺少结构修改")
        action = value.get("action")
        if action == "point":
            point = next((p for p in draft["outline"] if p["id"] == value.get("id")), None)
            if not point:
                raise ValueError("目录知识不存在")
            changes = {
                key: short_field(value.get(key), key, limit)
                for key, limit in (("title", 200), ("category", 80), ("subcategory", 80))
            }
            point.update(changes)
        elif action == "candidate":
            self.add_candidate(draft, value)
        elif action == "decision":
            self.decide_group(draft, value)
        else:
            raise ValueError("不支持的结构修改")
        draft.update(
            revision=str(uuid.uuid4()),
            suggestions=[],
            prepared=0,
            preparation=None,
            source_map={},
            merges=[],
            approved=None,
            errors=[],
            phase="duplicates" if action == "candidate" else "review",
            status="planning" if action == "candidate" else "outline",
        )
        return self.summary()

    # 人工候选也经过同样的原文核验；重新添加已有组会清除旧决定和证据。
    def add_candidate(self, draft: dict, value: dict) -> None:
        sources = value.get("sources")
        allowed = {p["id"] for p in draft["outline"]}
        if (
            not isinstance(sources, list)
            or not 2 <= len(sources) <= 8
            or any(not isinstance(key, str) or key not in allowed for key in sources)
            or len(set(sources)) != len(sources)
        ):
            raise ValueError("请选择 2 至 8 个不同的当前知识标识")
        draft["duplicates"] = [g for g in draft["duplicates"] if set(g["sources"]) != set(sources)]
        draft["duplicates"].append(new_group(sources))

    # 合并保留点必须组内选择，相关／冲突组仅可保留；分区必须明确选择。
    def decide_group(self, draft: dict, value: dict) -> None:
        group = next((g for g in draft["duplicates"] if g["id"] == value.get("id")), None)
        decision = value.get("decision")
        if (
            not group
            or group["kind"] == "pending"
            or decision not in ("merge", "keep", "undecided")
        ):
            raise ValueError("重复组或决定无效")
        changes = {"decision": decision}
        if decision == "merge":
            if (
                group["kind"] not in ("equivalent", "partial-overlap")
                or value.get("target_id") not in group["sources"]
            ):
                raise ValueError("该组不能合并或保留标识不属于本组")
            if "manual_bucket" not in value or value["manual_bucket"] not in (
                None,
                "常用",
                "在学",
                "归档",
            ):
                raise ValueError("请明确选择合并后的分区")
            changes.update(
                target_id=value["target_id"],
                manual_bucket=value["manual_bucket"],
                bucket_decided=True,
            )
            changes.update(
                {
                    key: short_field(value.get(key), key, limit)
                    for key, limit in (("title", 200), ("category", 80), ("subcategory", 80))
                }
            )
        group.update(changes)
