# 文件：memory_rules.py
# 层：Python domain
# 作用：定义明确偏好、题型、兴趣衰减和向量片段的确定性规则。
# 说明：不执行 I/O；统计不持久化问题或聊天正文。
import hashlib
import math
from datetime import date

from .knowledge_rules import tokens

DEFAULT_MEMORY = {
    "preferences_enabled": True,
    "questions_enabled": True,
    "reading_enabled": True,
    "language": "中文",
    "detail": "适中",
    "examples": "按需",
}


# 仅接受固定字段与可见选项，避免隐式学习一句临时指令。
def validate_memory(params: dict) -> dict:
    result = {}
    options = {
        "language": ("中文", "English", "跟随问题"),
        "detail": ("简洁", "适中", "详细"),
        "examples": ("按需", "多举例", "少举例"),
    }
    for key, value in params.items():
        if key not in DEFAULT_MEMORY:
            raise ValueError("未知记忆设置")
        if key in options:
            if value not in options[key]:
                raise ValueError("偏好选项无效")
        elif type(value) is not bool:
            raise ValueError("记忆开关须为布尔值")
        result[key] = value
    return result


# 本地题型分类不请求模型；未知问法明确保留未分类。
def question_kind(query: str) -> str:
    for kind, words in (
        ("排错", ("报错", "错误", "异常", "失败", "bug", "error")),
        ("示例", ("举例", "例子", "示例", "example")),
        ("比较", ("区别", "比较", "对比", "哪个好", "difference")),
        ("步骤", ("怎么", "如何", "实现", "步骤", "how")),
        ("概念", ("是什么", "解释", "原理", "为什么", "what", "why")),
    ):
        if any(word in query.lower() for word in words):
            return kind
    return "未分类"


# 仅从可靠命中已有分类推断主题，不持久化问题文字。
def question_topic(hits: list[dict]) -> str:
    for hit in hits:
        path = hit.get("category_path", [])
        if path:
            return "／".join(path[:2])
    return "未分类"


# 近期汇总以本地日期计算，超出窗口不影响当前排序，累计值另行保存。
def interest_weight(rows: list[dict], today: date) -> float:
    value = 0.0
    for row in rows:
        age = (today - date.fromisoformat(row["day"])).days
        if 0 <= age < 90:
            value += row["count"] * 2 ** (-age / 30)
    return math.log1p(value)


# 题型兴趣只关联相同完整主题前缀，未知分类不把全库误排成相关。
def topic_matches(topic: str, path: list[str]) -> bool:
    parts = topic.split("／")
    return topic != "未分类" and path[: len(parts)] == parts


# 内容变化使所有旧片段失效；标题与分类也参与指纹。
def document_hash(row: dict) -> str:
    return hashlib.sha256(
        (row["title"] + "\n" + row["body"] + "\n" + row["theme"]).encode()
    ).hexdigest()


# 小模型最多 512 token；保守按 360 字符切块并重叠，避免中文正文整体截断。
def semantic_chunks(row: dict) -> list[dict]:
    text = row["body"]
    return [
        {"offset": offset, "text": text[offset : offset + 360]}
        for offset in range(0, len(text), 300)
    ]


# 筛选相关性优先于画像，保持无语义模型时中文关键词可用。
def lexical_interest(query: str, title: str, body: str) -> int:
    words = tokens(query)
    return len(words & tokens(title)) * 3 + len(words & tokens(body)) if words else 0
