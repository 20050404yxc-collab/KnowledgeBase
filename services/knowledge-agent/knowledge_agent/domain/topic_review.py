# 文件：topic_review.py
# 层：Python domain
# 作用：验证独立审核的完整判定和完整分类路径。
# 说明：缺项、重复或越权引用均使整轮审核失效，不能降级放行。
from .knowledge_rules import identity
from .taxonomy import encode_path, parent_path, path_fields
from .topic_rules import json_object, short_field


# 所有候选必须恰好审核一次，排除与待澄清项不进入可学习会话。
def review_points(text: str, points: list[dict]) -> tuple[list[dict], list[dict]]:
    decisions = json_object(text).get("decisions")
    allowed = {p["id"]: p for p in points}
    if not isinstance(decisions, list) or len(decisions) != len(points):
        raise ValueError("知识点审核不完整，未放行")
    accepted, rejected, seen = [], [], set()
    for raw in decisions:
        if not isinstance(raw, dict):
            raise ValueError("审核结构无效")
        item_id = raw.get("id")
        if not isinstance(item_id, str) or item_id not in allowed or item_id in seen:
            raise ValueError("审核标识无效")
        seen.add(item_id)
        decision = raw.get("decision")
        reason = short_field(raw.get("reason"), "审核理由", 500)
        if decision not in ("keep", "exclude", "clarify"):
            raise ValueError("审核结论无效")
        if decision != "keep":
            rejected.append(
                {"title": allowed[item_id]["title"], "decision": decision, "reason": reason}
            )
            continue
        fields = path_fields(raw)
        if type(raw.get("project_required")) is not bool:
            raise ValueError("项目依赖审核缺失")
        project = raw["project_required"]
        point = {
            **allowed[item_id],
            **fields,
            "theme": "／".join(fields["category_path"]),
            "reason": reason,
            "storage_theme": encode_path(fields["category_path"]),
            "project_required": project,
        }
        if project:
            point.update(
                {
                    "material_request": short_field(
                        raw.get("material_request"), "项目资料要求", 500
                    ),
                    "search_terms": short_field(raw.get("search_terms"), "公开检索词", 120),
                    "status": "待项目资料",
                }
            )
        accepted.append(point)
    keys = [(identity(encode_path(parent_path(p))), identity(p["title"])) for p in accepted]
    if len(keys) != len(set(keys)):
        raise ValueError("审核分类后出现重复知识点，请重新拆解")
    return accepted, rejected


# 直接回答通道也须审核，失败保持不收录且不解释项目事实。
def review_question(text: str) -> dict:
    raw = json_object(text)
    if type(raw.get("eligible")) is not bool or type(raw.get("project_required")) is not bool:
        raise ValueError("问题审核无效，请使用拆解并学习重新审核")
    return {
        "eligible": raw["eligible"],
        "project_required": raw["project_required"],
        "reason": short_field(raw.get("reason"), "审核理由", 500),
    }
