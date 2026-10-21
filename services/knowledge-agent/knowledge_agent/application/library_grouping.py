# 文件：library_grouping.py
# 层：Python application
# 作用：在已归类的完整父级路径内逐对比较知识语义并提出合并结构。
# 说明：概览仅提出方案，全文核验与正式保存仍在用户确认之后。
from __future__ import annotations

import itertools
import json

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.duplicate_rules import duplicate_candidates, new_group
from knowledge_agent.domain.taxonomy import parent_path, path_fields
from knowledge_agent.domain.topic_rules import json_object, short_field


class LibraryGrouping:
    # 比较当前完整父级路径内的全部知识对，不依赖标题或关键词相同才进入语义判断。
    @traced
    async def group_one(self, draft: dict, emit) -> None:
        state = draft.get("grouping")
        if state is None:
            state = {"pairs": category_pairs(draft), "index": 0, "matches": []}
            draft["grouping"] = state
        if state["index"] == len(state["pairs"]):
            finish_groups(draft, state)
            return
        points = {point["id"]: point for point in draft["outline"]}
        payload = grouping_payload(draft, state, points)
        text = await self.client.generate(
            draft["config"], json.dumps(payload, ensure_ascii=False), "library-group", emit
        )
        matches = validate_grouping(text, payload["pairs"])
        self.ensure_active(draft)
        state["matches"].extend(matches)
        state["index"] += len(payload["pairs"])


# 一批覆盖多个待比较对；按真实序列化预算控制输入，避免每个知识对单独调用。
def grouping_payload(draft: dict, state: dict, points: dict) -> dict:
    data = {
        "mode": "same-knowledge",
        "items": [],
        "pairs": [],
        "feedback_history": draft["feedback_history"],
    }
    included = set()
    for pair in state["pairs"][state["index"] : state["index"] + 12]:
        additions = [
            {
                "id": key,
                "title": points[key]["title"],
                **path_fields(points[key]),
                "summary": draft["summaries"][key],
            }
            for key in pair
            if key not in included
        ]
        candidate = {**data, "items": data["items"] + additions, "pairs": data["pairs"] + [pair]}
        if len(json.dumps(candidate, ensure_ascii=False)) > 26000:
            break
        data = candidate
        included.update(pair)
    if not data["pairs"]:
        raise ValueError("同类知识判断格式无效，已有目录与分析保留")
    return data


# 每个请求对恰好回答一次，未知、重复或缺失不能造成静默漏检。
def validate_grouping(text: str, pairs: list) -> list:
    values = json_object(text).get("decisions")
    expected = {tuple(pair) for pair in pairs}
    if not isinstance(values, list) or len(values) != len(expected):
        raise ValueError("同类知识判断格式无效，已有目录与分析保留")
    seen, matches = set(), []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("同类知识判断格式无效，已有目录与分析保留")
        pair = (value.get("left"), value.get("right"))
        if (
            any(not isinstance(key, str) for key in pair)
            or pair not in expected
            or pair in seen
            or type(value.get("same_knowledge")) is not bool
        ):
            raise ValueError("同类知识判断格式无效，已有目录与分析保留")
        reason = short_field(value.get("reason"), "合并理由", 500)
        seen.add(pair)
        if value["same_knowledge"]:
            matches.append((pair, reason))
    return matches


# 类别相同仅代表需要比较；不代表知识可以合并。
def category_pairs(draft: dict) -> list[tuple[str, str]]:
    return [
        (a["id"], b["id"])
        for a, b in itertools.combinations(draft["outline"], 2)
        if parent_path(a) == parent_path(b)
    ]


# 仅两两都判为同一知识的组可提出合并，人工明确决定优先于后续模型建议。
def finish_groups(draft: dict, state: dict) -> None:
    previous = draft["duplicates"]
    points = {point["id"]: point for point in draft["outline"]}
    edges = {frozenset(pair) for pair, _ in state["matches"]}
    # 原有显式决定保留，不因一次意见调整重新要求用户填写。
    decided = [
        group
        for group in previous
        if group["decision"] != "undecided" and not group.get("proposed")
    ]
    used = {key for group in decided for key in group["sources"]}
    groups = list(decided)
    for key in points:
        if key in used:
            continue
        members = [key]
        for candidate in points:
            if candidate not in used and candidate not in members and len(members) < 8:
                if all(frozenset((candidate, member)) in edges for member in members):
                    members.append(candidate)
        if len(members) > 1:
            point = points[key]
            buckets = {i["manual_bucket"] for i in draft["items"] if i["id"] in members}
            group = new_group(members)
            group.update(
                decision="merge",
                proposed=True,
                target_id=key,
                title=point["title"],
                **path_fields(point),
                bucket_decided=True,
                manual_bucket=next(iter(buckets)) if len(buckets) == 1 else None,
                reason="同一父级路径内语义比较建议合并同一知识；确认结构后仍须核验全文",
            )
            groups.append(group)
            used.update(members)
    # 保留原先的弱候选入口，人工仍可补充漏检项；不制造交叉的默认合并。
    known = {frozenset(group["sources"]) for group in groups}
    for group in duplicate_candidates(draft):
        if frozenset(group["sources"]) not in known:
            old = next((g for g in previous if set(g["sources"]) == set(group["sources"])), None)
            groups.append(old if old and not old.get("proposed") else group)
    draft.update(duplicates=groups, grouping=None, status="outline", phase="review")
