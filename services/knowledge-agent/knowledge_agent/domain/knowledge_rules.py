# 文件：knowledge_rules.py
# 层：Python domain
# 作用：计算知识标识、关键词相关度和使用频率分区。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta

from .limits import MAX_KNOWLEDGE_CHARS, MAX_TITLE_CHARS

BUCKETS = {"常用", "在学", "归档"}


# 返回带本地时区的持久化时间，不用于单调超时计算。
def now() -> str:
    return datetime.now().astimezone().isoformat()


# 规范化标题以复用同一概念，保留既有中文标识规则。
def identity(title: str) -> str:
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", title).casefold())


# 提取英文词与中文相邻双字，供确定性的关键词检索使用。
def tokens(text: str) -> set[str]:
    text = unicodedata.normalize("NFKC", text).casefold()
    result = set(re.findall(r"[a-z0-9_]+", text))
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        result.update(run[i : i + 2] for i in range(max(1, len(run) - 1)))
    return result


# 标题匹配权重高于正文，空查询词不产生相关结果。
def relevance(query: str, title: str, content: str) -> float:
    terms = tokens(query)
    if not terms:
        return 0
    title_terms, body_terms = tokens(title), tokens(content)
    score = len(terms & title_terms) * 3 + len(terms & body_terms)
    if query.strip().casefold() in (title + "\n" + content).casefold():
        score += 5
    return score / len(terms)


# 手动分区优先；自动分区按去重使用日和自然日边界计算。
def bucket_for(
    created_at: str, use_days: list[str], manual: str | None = None, today: date | None = None
) -> str:
    # 手动分区优先于自动规则，避免活跃度计算覆盖用户选择。
    if manual in BUCKETS:
        return manual
    today = today or date.today()
    days = {date.fromisoformat(day) for day in use_days}
    # 近十四自然日至少三个使用日属于常用，边界当天计入。
    if sum(today - timedelta(days=13) <= day <= today for day in days) >= 3:
        return "常用"
    created = datetime.fromisoformat(created_at).date()
    # 已建满三十天且近三十天未用才归档，其余保持在学。
    if (today - created).days >= 30 and not any(day > today - timedelta(days=30) for day in days):
        return "归档"
    return "在学"


# 保存标题和正文前验证领域限额；无文字的标题不能成为概念标识。
def validate_note(title: str, content: str) -> tuple[str, str, str]:
    title, content = title.strip(), content.strip()
    concept = identity(title)
    if (
        not concept
        or len(title) > MAX_TITLE_CHARS
        or not content
        or len(content) > MAX_KNOWLEDGE_CHARS
    ):
        raise ValueError("标题须为 1–160 字且包含文字，正文须为 1–120000 字")
    return title, content, concept
