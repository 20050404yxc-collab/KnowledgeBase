# 文件：restructure_evidence.py
# 层：Python domain
# 作用：定义来源抽样、全文分片、引用保留及覆盖证据。
# 说明：只处理快照数据；不调用模型或外部存储。
from __future__ import annotations

import hashlib
import json
import re

from .topic_rules import json_object, short_field

SUMMARY_MAX_CHARS = 2400
OVERVIEW_SAMPLE_CHARS = 7000


# 短文完整展示，长文按正文及补充的首中尾取样，并明确未覆盖的位置。
def overview_sample(item: dict) -> dict:
    chunks = source_chunks(item)
    total = sum(len(c["text"]) for c in chunks)
    budget = OVERVIEW_SAMPLE_CHARS
    sampled, omitted, texts = [], [], []
    for index, chunk in enumerate(chunks):
        size = (
            len(chunk["text"])
            if total <= OVERVIEW_SAMPLE_CHARS
            else min(len(chunk["text"]), budget // (len(chunks) - index))
        )
        spans = sample_spans(chunk["text"], size)
        cursor = 0
        for start, end in spans:
            if start > cursor:
                omitted.append(
                    f"{chunk['part']}:{chunk['start'] + cursor}:{chunk['start'] + start}"
                )
            if end > start:
                sampled.append(f"{chunk['part']}:{chunk['start'] + start}:{chunk['start'] + end}")
                texts.append(chunk["text"][start:end])
            cursor = end
        if cursor < len(chunk["text"]):
            omitted.append(f"{chunk['part']}:{chunk['start'] + cursor}:{chunk['end']}")
        budget -= size
    return {
        "part": "overview",
        "start": 0,
        "end": total,
        "locator": "overview",
        "text": "".join(texts),
        "sampled": sampled,
        "omitted": omitted,
        "total_chars": total,
        "sampled_chars": OVERVIEW_SAMPLE_CHARS - budget,
    }


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
    summary = short_field(value["summary"], "知识要点", SUMMARY_MAX_CHARS)
    candidates = value.get("candidates", [])
    if (
        not isinstance(candidates, list)
        or len(candidates) > 20
        or any(not isinstance(key, str) or key not in allowed for key in candidates)
    ):
        raise ValueError("重复候选含未知标识或超过 20 项")
    return {"summary": summary.strip(), "candidates": list(dict.fromkeys(candidates))}


# 原文与补充及历史快照的引用全部保留，按完整引用字段去重。
def source_citations(items: list[dict]) -> list[dict]:
    citations = []
    for item in items:
        originals = [item] + [archived["item"] for archived in item.get("archived_evidence", [])]
        for original in originals:
            citations.extend(clean_citations(original.get("citations", [])))
            for part in original.get("supplements", []):
                citations.extend(clean_citations(part.get("citations", [])))
    unique = {json.dumps(value, sort_keys=True, ensure_ascii=False): value for value in citations}
    return list(unique.values())


# 输入中已经存在且可解析的来源标记必须延续到对应重组段，禁止静默丢掉引文链接。
def validate_rewrite_references(original: str, content: str, citations: list[dict]) -> None:
    for citation in citations:
        marker = "[" + citation["id"] + "]"
        if marker in original and marker not in content:
            raise ValueError("重组段遗漏原引用标记，未发布不完整建议")


# 标题优先使用少量预算，其余覆盖首中尾；范围合并后仍不超过本块预算。
def sample_spans(text: str, size: int) -> list[tuple[int, int]]:
    if size == len(text):
        return [(0, size)]
    selected = set()
    quota = size // 4
    for match in re.finditer(r"(?m)^#{1,6}[ \t]+[^\r\n]+", text):
        if len(selected) >= quota:
            break
        selected.update(
            range(match.start(), min(match.end(), match.start() + quota - len(selected)))
        )
    remaining = size - len(selected)
    third = remaining // 3
    for start, end in [
        (0, third),
        ((len(text) - third) // 2, (len(text) - third) // 2 + third),
        (len(text) - (remaining - 2 * third), len(text)),
    ]:
        selected.update(range(start, end))
    # 标题与首中尾有重合时，按原顺序补足预算，不重复计算字符。
    index = 0
    while len(selected) < size:
        selected.add(index)
        index += 1
    spans = []
    for position in sorted(selected):
        if spans and spans[-1][1] == position:
            spans[-1] = (spans[-1][0], position + 1)
        else:
            spans.append((position, position + 1))
    return spans
