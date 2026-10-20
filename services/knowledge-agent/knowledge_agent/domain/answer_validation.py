# 文件：answer_validation.py
# 层：Python domain
# 作用：校验生成结果及证据引用，阻止残缺知识收录。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import json

from .limits import MAX_KNOWLEDGE_CHARS, MAX_TITLE_CHARS


# 验证标题正文和引用标识；引用合法不代表内容已被事实核验。
def validate_answer(text: str, evidence: list[dict], strict: bool) -> dict:
    text = text.strip()
    # 允许模型使用代码围栏包装 JSON，但不接受任意结构或不完整正文。
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("模型未返回要求的结构，未收录；可调整模型后重试") from exc
    if not isinstance(result, dict):
        raise TypeError("模型结果格式无效，未收录")
    # 标题正文限额与手工保存共用领域常量，避免两种收录路径漂移。
    for key, limit in [("title", MAX_TITLE_CHARS), ("content", MAX_KNOWLEDGE_CHARS)]:
        if (
            not isinstance(result.get(key), str)
            or not result[key].strip()
            or len(result[key]) > limit
        ):
            raise ValueError("模型标题或正文不完整，未收录")
    ids = result.get("citation_ids", [])
    # 只允许本次授权证据中的标识，严格文件回答还必须有引用或声明依据不足。
    allowed = {block["id"]: block for block in evidence}
    if not isinstance(ids, list) or any(not isinstance(i, str) or i not in allowed for i in ids):
        raise ValueError("模型引用了不存在的证据，未收录")
    if strict and not ids and not result.get("insufficient"):
        raise ValueError("严格文件回答缺少可核对引用，未收录")
    result["citations"] = [allowed[i] for i in dict.fromkeys(ids)]
    # 非核心拓展字段可过滤无效候选，不能因此降低正文与引用校验。
    result["recommendations"] = (
        [
            r
            for r in result.get("recommendations", [])
            if isinstance(r, dict)
            and all(
                isinstance(r.get(k), str) and 0 < len(r[k]) <= 500
                for k in ("title", "reason", "preview")
            )
        ][:6]
        if isinstance(result.get("recommendations", []), list)
        else []
    )
    return result
