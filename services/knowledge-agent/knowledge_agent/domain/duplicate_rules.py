# 文件：duplicate_rules.py
# 层：Python domain
# 作用：跨代理召回候选并核验原文引用与逐组映射。
# 说明：相似不是传递关系；任何候选默认未决定。
from __future__ import annotations

import itertools
import uuid

from .knowledge_rules import BUCKETS, identity, tokens
from .restructure_evidence import source_chunks
from .topic_rules import json_object, short_field


# 所有记录共同参与召回，标题、原文词项和代理候选取并集，不宣称语义完备。
def duplicate_candidates(draft: dict) -> list[dict]:
    active = [item for item in draft["items"] if item["id"] == item["canonical_id"]]
    records = {r["source_id"]: r for r in draft["records"]}
    result = []
    for left, right in itertools.combinations(active, 2):
        a, b = left["id"], right["id"]
        first, second = tokens(records[a]["summary"]), tokens(records[b]["summary"])
        common = len(first & second) / max(1, len(first | second))
        suggested = b in records[a]["candidates"] or a in records[b]["candidates"]
        if (
            suggested
            or identity(left["title"]) == identity(right["title"])
            or common >= 0.65
            and len(first & second) >= 6
        ):
            result.append(new_group([a, b]))
    return result


# 候选组只描述待核验关系，没有隐式接受、保留点或手工分区选择。
def new_group(sources: list[str]) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "sources": sources,
        "decision": "undecided",
        "kind": "pending",
        "reason": "概览候选；默认独立保留，拟合并时在结构确认后核验全文",
        "evidence": [],
        "checked": 0,
        "target_id": "",
        "title": "",
        "category": "",
        "subcategory": "",
        "bucket_decided": False,
        "manual_bucket": None,
    }


# 每个来源的每个块和另一来源的每个块均进入核验，不用摘要替代证据。
def verification_work(group: dict, items: list[dict]) -> list[tuple[dict, dict]]:
    # 已合并来源仍属于当前保留点，完整核验必须覆盖这些历史成员，不能只看当前正文。
    selected = [
        {
            "id": key,
            "chunks": [
                dict(chunk, source_id=key, locator=f"source:{item['id']}:{chunk['locator']}")
                for item in items
                if item["canonical_id"] == key
                for chunk in source_chunks(item)
            ],
        }
        for key in group["sources"]
    ]
    return [
        (a, b)
        for left, right in itertools.combinations(selected, 2)
        for a in left["chunks"]
        for b in right["chunks"]
    ]


# 模型必须给出原文可定位引文；不能用相似分数或无来源结论批准合并。
def validate_duplicate(text: str, pair: tuple[dict, dict]) -> dict:
    raw = json_object(text)
    kind = raw.get("kind")
    if kind not in ("equivalent", "partial-overlap", "related", "conflict"):
        raise ValueError("重复核验类型无效")
    result = {"kind": kind, "reason": short_field(raw.get("reason"), "核验理由", 500)}
    for key in ("overlap", "unique", "conflict"):
        values = raw.get(key, [])
        if not isinstance(values, list) or len(values) > 8:
            raise ValueError("原文核验证据格式无效")
        result[key] = []
        for value in values:
            if not isinstance(value, dict):
                raise ValueError("原文证据格式无效")
            source = next(
                (
                    part
                    for part in pair
                    if part["source_id"] == value.get("source_id")
                    and part["locator"] == value.get("locator")
                ),
                None,
            )
            quote = value.get("quote")
            if (
                not source
                or not isinstance(quote, str)
                or not quote
                or len(quote) > 2000
                or quote not in source["text"]
            ):
                raise ValueError("重复核验引文不在对应原文片段中")
            result[key].append(
                {"source_id": source["source_id"], "locator": source["locator"], "quote": quote}
            )
    if kind in ("equivalent", "partial-overlap") and not result["overlap"]:
        raise ValueError("可合并候选缺少原文重叠证据")
    if kind == "conflict" and not result["conflict"]:
        raise ValueError("冲突判定缺少原文证据")
    return result


# 所有来源恰好映射一次；已合并来源先沿现有映射，新增组不得交叉或形成循环。
def confirmed_map(draft: dict, provisional: bool = False) -> tuple[dict[str, str], list[dict]]:
    mapping = {item["id"]: item["canonical_id"] for item in draft["items"]}
    active = set(mapping.values())
    used, merges = set(), []
    for group in draft["duplicates"]:
        if group["decision"] in ("keep", "undecided"):
            continue
        sources = set(group["sources"])
        if (
            group["kind"]
            not in (
                ("pending", "equivalent", "partial-overlap")
                if provisional
                else ("equivalent", "partial-overlap")
            )
            or sources & used
            or not sources <= active
            or group["target_id"] not in sources
        ):
            raise ValueError("合并组冲突、交叉或保留点无效；相关和矛盾知识不能合并")
        if not group["bucket_decided"] or group["manual_bucket"] not in (*BUCKETS, None):
            raise ValueError("请明确选择合并后的手工分区或自动分区")
        used.update(sources)
        merges.append(group)
        for source, target in list(mapping.items()):
            if target in sources:
                mapping[source] = group["target_id"]
    return mapping, merges
