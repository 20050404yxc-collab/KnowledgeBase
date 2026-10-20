# 文件：topic_rules.py
# 层：Python domain
# 作用：规范化问题并验证有界知识点目录。
# 说明：模型只提出建议，目标与证据权限由程序确认。
import json
import re
import uuid

from .knowledge_rules import identity
from .validation_errors import FieldValidationError

MAX_POINTS = 16
MAX_SESSIONS = 24


# 只清理空白和显式列表，不假装离线规则具有语义理解能力。
def question_points(query: str) -> list[str]:
    parts = re.split(r"[\n；;]+|(?:^|\s)\d+[.、]\s*", query)
    return [re.sub(r"\s+", " ", part).strip() for part in parts if part.strip()]


# 接受完整 JSON 或单层围栏，拒绝部分结果与不可信任的字段类型。
def json_object(text: str) -> dict:
    text = text.strip()
    if text.startswith("```") and text.endswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        result = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("模型结构无效，本地结果保留；请重试或更换模型") from error
    if not isinstance(result, dict):
        raise ValueError("模型必须返回结构化对象")
    return result


# 标题必须描述一个具体侧面，拒绝将较长原问题截短或整句回填。
def short_field(value: object, name: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise FieldValidationError(value, name, limit)
    return value.strip()


# 候选关联只能来自授权本地召回，标签不是已经收录的知识。
def validate_plan(
    text: str, query: str, candidates: list[dict], evidence: list[dict]
) -> list[dict]:
    raw = json_object(text).get("points")
    if not isinstance(raw, list) or not 0 <= len(raw) <= MAX_POINTS:
        raise ValueError("目录须有 0–16 个候选；请缩小问题，未静默截断")
    allowed = {item["id"]: item for item in candidates}
    citations = {item["id"] for item in evidence}
    result, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("知识点结构无效")
        title = short_field(item.get("title"), "标题", 80)
        theme = short_field(item.get("theme"), "主题", 120)
        facet = short_field(item.get("facet"), "学习侧面", 500)
        key = (identity(theme), identity(title))
        question = len(query) > 12 or re.search(r"[?？]|如何|怎么|什么|为什么|请问|是否", query)
        if not all(key) or key in seen or (question and identity(title) == identity(query)):
            raise ValueError("目录包含重复点或原问题标题，请重试拆解")
        ids = item.get("citation_ids", [])
        target = item.get("target_id", "")
        if not isinstance(target, str) or (target and target not in allowed):
            raise ValueError("模型建议了范围之外的知识目标")
        if not isinstance(ids, list) or any(
            not isinstance(i, str) or i not in citations for i in ids
        ):
            raise ValueError("目录包含不可用的引用")
        seen.add(key)
        # 只有同一主题且同名的目标可标已有，其余候选都须核对。
        status = "待学习"
        if target:
            same = (
                identity(allowed[target]["title"]) == identity(title)
                and allowed[target].get("theme") == theme
            )
            status = "待补充" if same else "待核对"
        result.append(
            {
                "id": str(uuid.uuid4()),
                "title": title,
                "theme": theme,
                "facet": facet,
                "target_id": target,
                "status": status,
                "citation_ids": ids,
                "candidates": [
                    {"id": c["id"], "title": c["title"], "theme": c.get("theme", "未分类")}
                    for c in candidates[:6]
                ],
            }
        )
    return result
