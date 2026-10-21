# 文件：library_rules.py
# 层：Python domain
# 作用：验证全库目录、重构映射与正文建议。
# 说明：保持原知识身份，不合并同名项，不执行外部 I/O。
from __future__ import annotations

import hashlib
import json

from .knowledge_rules import identity
from .restructure_evidence import source_version
from .taxonomy import encode_path, parent_path, path_fields
from .topic_rules import json_object, short_field


# 没有规范分类的旧主题原样作为小类，不能猜测文本分隔符。
def display_path(item: dict) -> list[str]:
    if "category_path" in item or item.get("category") and item.get("subcategory"):
        return parent_path(item)
    theme = item.get("theme", "未分类")
    return ["未分类／待整理", theme if theme != "未分类" else "未细分"]


# 版本仅跟踪会改变重构结果的数据，不将使用日和当前资料保留状态作为内容变化。
def inventory_version(items: list[dict]) -> str:
    data = [source_version(item) for item in sorted(items, key=lambda value: value["id"])]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


# 每批映射必须恰好覆盖提供的 ID；重名冲突在整库映射完成后继续核验。
def validate_assignments(text: str, items: list[dict]) -> list[dict]:
    values = json_object(text).get("assignments")
    allowed = {item["id"] for item in items}
    if not isinstance(values, list) or len(values) != len(allowed):
        raise ValueError("重构目录覆盖不完整，未修改知识库")
    result, seen = [], set()
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("重构分类格式无效")
        item_id = value.get("id")
        if not isinstance(item_id, str) or item_id not in allowed or item_id in seen:
            raise ValueError("重构分类含未知或重复知识标识")
        seen.add(item_id)
        result.append(
            {
                "id": item_id,
                **path_fields(value),
                "reason": short_field(value.get("reason"), "归类理由", 500),
            }
        )
    return result


# 不能把同名不同知识自动合并，用户须调整目录解决目标路径碰撞。
def validate_collisions(assignments: list[dict], items: list[dict]) -> None:
    titles = {item["id"]: item["title"] for item in items}
    keys = [(identity(encode_path(parent_path(a))), identity(titles[a["id"]])) for a in assignments]
    if len(keys) != len(set(keys)):
        raise ValueError("重构后同一小类存在同名知识，请填写调整意见重新规划；未合并内容")


# 这里只校验字段类型和理由；完整正文不设总长度门槛，分段完整性由应用流程检查。
def validate_suggestion(text: str) -> dict:
    raw = json_object(text)
    content = raw.get("content")
    if not isinstance(content, str):
        raise ValueError("整理建议格式无效，未修改知识库")
    return {"content": content.strip(), "reason": short_field(raw.get("reason"), "整理理由", 500)}
