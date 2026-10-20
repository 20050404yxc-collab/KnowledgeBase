# 文件：restructure_evidence.py
# 层：Python domain
# 作用：定义有界来源分片、覆盖证据和无损原文提取。
# 说明：只处理快照数据；不调用模型或外部存储。
from __future__ import annotations

import hashlib
import json

from .topic_rules import json_object, short_field


# 所有正文及补充均按字符偏移定位，空正文仍有一个明确覆盖片段。
def source_chunks(item: dict) -> list[dict]:
    parts = [("body", item["content"])] + [
        ("supplement:" + part["id"], part["content"]) for part in item.get("supplements", [])
    ]
    for archived in item.get("archived_evidence", []):
        original = archived["item"]
        parts.append(("original:" + archived["version"] + ":body", original["content"]))
        parts.extend(
            ("original:" + archived["version"] + ":supplement:" + part["id"], part["content"])
            for part in original.get("supplements", [])
        )
    return [
        {
            "part": part,
            "start": start,
            "end": min(start + 7000, len(text)),
            "locator": f"{part}:{start}:{min(start + 7000, len(text))}",
            "text": text[start : start + 7000],
        }
        for part, text in parts
        for start in range(0, max(1, len(text)), 7000)
    ]


# 稳定来源版本包含引用和分区，但不含自然日使用次数和临时保留状态。
def source_version(item: dict) -> str:
    data = {
        key: item.get(key)
        for key in (
            "id",
            "title",
            "content",
            "theme",
            "manual_bucket",
            "generated",
            "edited",
            "updated_at",
            "canonical_id",
            "supplements",
            "citations",
            "provenance",
            "archived_evidence",
        )
    }
    # 引用保留状态由资料删除决定，不能使已确认的知识正文变更。
    data["citations"] = clean_citations(data.get("citations") or [])
    data["supplements"] = [
        {**part, "citations": clean_citations(part.get("citations", []))}
        for part in data.get("supplements") or []
    ]
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# 引用身份和摘录完整保留，仅移除动态显示字段。
def clean_citations(values: list[dict]) -> list[dict]:
    return [{key: value for key, value in item.items() if key != "retained"} for item in values]


# 区分模型返回字段缺失、类型、空值和长度，错误由调度方附加来源上下文。
def analysis_result(text: str, allowed: set[str]) -> dict:
    value = json_object(text)
    if "summary" not in value:
        raise ValueError("缺少 summary 字段")
    summary = short_field(value["summary"], "知识要点", 1600)
    candidates = value.get("candidates", [])
    if (
        not isinstance(candidates, list)
        or len(candidates) > 20
        or any(not isinstance(key, str) or key not in allowed for key in candidates)
    ):
        raise ValueError("重复候选含未知标识或超过 20 项")
    return {"summary": summary.strip(), "candidates": list(dict.fromkeys(candidates))}


# 整理使用完整原文而非压缩摘要；只合并完全相同的片段，独有和矛盾均保留。
def extract_sources(items: list[dict]) -> tuple[str, list[dict], list[dict]]:
    sections, provenance, citations, seen = [], [], [], {}
    for item in items:
        version = source_version(item)
        for chunk in source_chunks(item):
            text = chunk["text"]
            key = hashlib.sha256(text.encode()).hexdigest()
            # 同一来源内重复片段可能承载顺序含义，不能直接当重复来源删除。
            if key in seen and seen[key][0] == item["id"]:
                key += ":" + chunk["locator"]
            provenance.append(
                {
                    "source_id": item["id"],
                    "version": version,
                    "locator": chunk["locator"],
                    "section": seen[key][1] if key in seen else len(sections),
                }
            )
            if key not in seen:
                seen[key] = (item["id"], len(sections))
                sections.append(f"### {item['title']} · {chunk['locator']}\n\n{text}")
        citations.extend(clean_citations(item.get("citations", [])))
        for part in item.get("supplements", []):
            citations.extend(clean_citations(part.get("citations", [])))
        for archived in item.get("archived_evidence", []):
            original = archived["item"]
            citations.extend(clean_citations(original.get("citations", [])))
            for part in original.get("supplements", []):
                citations.extend(clean_citations(part.get("citations", [])))
    content = "\n\n".join(sections)
    if len(content) > 20000:
        raise ValueError(
            f"完整原文整理稿 {len(content)} 字符超过单条 20000 上限；未截断，尚未准备完成"
        )
    unique = {json.dumps(value, sort_keys=True, ensure_ascii=False): value for value in citations}
    return content, provenance, list(unique.values())
