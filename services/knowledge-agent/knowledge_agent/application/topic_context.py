# 文件：topic_context.py
# 层：Python application
# 作用：构造有界的主题上下文和授权附件的本地检索结果。
# 说明：文件命中优先分页，知识库结果只在授权范围内追加。
from knowledge_agent.domain.knowledge_rules import relevance, tokens
from knowledge_agent.domain.limits import MAX_CONTEXT_CHARS


# 只读取本次授权且仍存在的附件；稳定排序不产生模型调用。
def file_hits(documents: dict, attachment_ids: list[str], query: str) -> list[dict]:
    matches = []
    for item_id in dict.fromkeys(attachment_ids):
        document = documents.get(item_id)
        if not document:
            raise ValueError("附件已移除，请重新加入后再提问")
        for block in document["blocks"]:
            score = relevance(query, document["name"], block["text"])
            if score <= 0:
                continue
            positions = [block["text"].casefold().find(term) for term in tokens(query)]
            start = max(0, min((p for p in positions if p >= 0), default=0) - 60)
            matches.append(
                (
                    score,
                    {
                        "id": "attachment:" + item_id + ":" + block["id"],
                        "kind": "source",
                        "knowledge_id": "",
                        "theme": "本次文件",
                        "title": document["name"],
                        "excerpt": block["text"][start : start + 360],
                        "citation": {
                            **block,
                            "source_id": item_id,
                            "name": document["name"],
                            "retained": document["retained"],
                        },
                    },
                )
            )
    return [hit for _, hit in sorted(matches, key=lambda p: (-p[0], p[1]["id"]))]


# 原文上下文总量有界；哈希校验仍使用完整目标，裁剪不改变正式数据。
def existing_context(item: dict | None, limit: int = MAX_CONTEXT_CHARS) -> dict | None:
    if not item:
        return None
    remaining = limit
    parts = []
    for entry in [{"title": item["title"], "content": item["content"]}, *item["supplements"]]:
        text = entry["content"][:remaining]
        parts.append({"title": entry["title"], "content": text})
        remaining -= len(text)
        if not remaining:
            break
    length = len(item["content"]) + sum(len(s["content"]) for s in item["supplements"])
    return {
        "id": item["id"],
        "theme": item["theme"],
        "parts": parts,
        "coverage_notice": f"已有内容仅发送前 {limit} 字；不得声称已核对全部内容。"
        if length > limit
        else "已有内容完整发送。",
    }


# 补充生成在总预算内兼顾新证据和原笔记；只允许引用实际发送的完整证据块。
def learning_context(session: dict, current: dict | None) -> tuple[list[dict], dict | None, str]:
    limit = MAX_CONTEXT_CHARS // 2 if current else MAX_CONTEXT_CHARS
    evidence, size = [], 0
    for block in session["evidence"]:
        if size + len(block["text"]) > limit:
            continue
        evidence.append(block)
        size += len(block["text"])
    existing = existing_context(current, MAX_CONTEXT_CHARS - size)
    notice = session.get("coverage_notice", "")
    if len(evidence) < len(session["evidence"]):
        notice += f"补充生成使用 {len(evidence)}/{len(session['evidence'])} 个证据片段。"
    if existing:
        notice += existing["coverage_notice"]
    return evidence, existing, notice


# 临时附件快照被移除后，不允许旧目录继续据此生成或确认收录。
def require_attachments(documents: dict, session: dict) -> None:
    if any(item_id not in documents for item_id in session["attachment_ids"]):
        raise ValueError("目录使用的附件已移除，请重新加入并拆解问题")
