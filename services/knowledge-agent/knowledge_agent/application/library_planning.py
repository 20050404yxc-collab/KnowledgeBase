# 文件：library_planning.py
# 层：Python application
# 作用：统一分类、完整原文重复核验和当前修订的人工纠正。
# 说明：只改变会话草案，正式存储须通过最终应用。
from __future__ import annotations

import itertools
import json
import uuid

from knowledge_agent.domain.duplicate_rules import (
    new_group,
    validate_duplicate,
    verification_work,
)
from knowledge_agent.domain.library_rules import display_path, validate_assignments
from knowledge_agent.domain.topic_rules import short_field

from .library_grouping import LibraryGrouping
from .restructure_memory import remember_preparation


class LibraryPlanning(LibraryGrouping):
    # 统一词表逐批提供；全部来源先有成功覆盖，才进入全局分类阶段。
    async def assign_batch(self, draft: dict, emit) -> None:
        active = [item for item in draft["items"] if item["id"] == item["canonical_id"]]
        outline = draft.get("revised_outline", draft["outline"])
        start = len(outline)
        item = active[start]
        state = draft.get("assignment") or {
            "source": 0,
            "path": 0,
            "choice": None,
            "paths": sorted(assignment_paths(draft)),
        }
        payload, source_end, path_end = assignment_payload(draft, item, state)
        text = await self.client.generate(draft["config"], payload, "library-outline", emit)
        value = validate_assignments(text, [item])[0]
        self.ensure_active(draft)
        sources = [source for source in draft["items"] if source["canonical_id"] == item["id"]]
        paths = state["paths"]
        # 未消费的概览或分类词表留到下一轮，不能静默删掉历史来源。
        if source_end < len(sources) or path_end < len(paths):
            draft["assignment"] = {
                "source": source_end,
                "path": path_end,
                "choice": value,
                "paths": paths,
            }
            return
        draft["assignment"] = None
        previous = next((p for p in draft["outline"] if p["id"] == item["id"]), None)
        outline.append(
            {
                **value,
                "title": previous["title"] if previous else item["title"],
                "old_path": display_path(item),
            }
        )
        if len(outline) == len(active):
            draft["outline"] = draft.pop("revised_outline", outline)
            draft.update(phase="grouping", grouping=None)

    # 一次只验证一个有界原文块对，全部对完成后才产生组级判定。
    async def verify_one(self, draft: dict, emit) -> None:
        group = next((g for g in draft["merges"] if g["kind"] == "pending"), None)
        if not group:
            draft["phase"] = "preparing"
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
            if group["kind"] not in ("equivalent", "partial-overlap"):
                draft.update(
                    status="outline",
                    phase="review",
                    approved=None,
                    errors=["拟合并组全文核验未通过，请修改结构后重新确认"],
                )
                return
        if all(g["kind"] != "pending" for g in draft["merges"]):
            draft["phase"] = "preparing"

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
        remember_preparation(draft)
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
            targets=[],
            errors=[],
            phase="review",
            status="outline",
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
        if not group or decision not in ("merge", "keep", "undecided"):
            raise ValueError("重复组或决定无效")
        changes = {"decision": decision}
        if decision == "merge":
            if (
                group["kind"] not in ("pending", "equivalent", "partial-overlap")
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
        group["proposed"] = False


# 按真实序列化字符预算分轮消费全部概览及分类；上一轮的建议继续参与决策。
def assignment_payload(draft: dict, item: dict, state: dict) -> tuple[str, int, int]:
    sources = [source for source in draft["items"] if source["canonical_id"] == item["id"]]
    paths = state.get("paths", sorted(assignment_paths(draft)))
    source_end, path_end = state["source"], state["path"]
    data = {
        "items": [
            {
                "id": item["id"],
                "title": item["title"],
                "old_path": display_path(item),
                "summary": draft["summaries"][item["id"]],
            }
        ],
        "additional_overviews": [],
        "existing_paths": [],
        "previous_assignment": state["choice"]
        or next((p for p in draft["outline"] if p.get("id") == item["id"]), None),
        "feedback": draft["feedback"],
        "feedback_history": draft.get("feedback_history", [draft["feedback"]]),
        "notice": "概览和分类按预算分轮传入，结合上一轮建议持续修正；不是全文重构",
    }
    # 分配独立预算，保证来源与分类两条队列均能推进。
    budget = (26000 - len(json.dumps(data, ensure_ascii=False)) - 1000) // 2
    used = 0
    while source_end < len(sources):
        source = sources[source_end]
        value = {"source_id": source["id"], "summary": draft["summaries"][source["id"]]}
        size = len(json.dumps(value, ensure_ascii=False))
        if used + size > budget:
            break
        data["additional_overviews"].append(value)
        used += size
        source_end += 1
    used = 0
    while path_end < len(paths):
        value = paths[path_end]
        size = len(json.dumps(value, ensure_ascii=False))
        if used + size > budget:
            break
        data["existing_paths"].append(value)
        used += size
        path_end += 1
    payload = json.dumps(data, ensure_ascii=False)
    if len(payload) > 26000 or (
        (source_end, path_end) == (state["source"], state["path"])
        and (source_end < len(sources) or path_end < len(paths))
    ):
        raise ValueError("分类请求预算无效，未省略未处理概览")
    return payload, source_end, path_end


# 已有和修订中的路径共同作为词表，避免每次从空目录重新猜测。
def assignment_paths(draft: dict) -> set[tuple[str, str]]:
    return {
        (point["category"], point["subcategory"])
        for point in draft["outline"] + draft.get("revised_outline", [])
    }
