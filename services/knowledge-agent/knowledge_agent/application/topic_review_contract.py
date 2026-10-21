# 文件：topic_review_contract.py
# 层：Python application
# 作用：隔离待审核目录并为模型声明完整审核输出契约。
# 说明：既有知识候选不是审核目标；不增加调用、重试或资料授权。
import json

from knowledge_agent.diagnostics import request_reference
from knowledge_agent.domain.validation_errors import ReviewValidationError

from .ports import Emit, Generator


# 只发送本轮知识点及原授权上下文，移除容易与审核目标混淆的已有知识 ID。
def review_payload(prompt: dict, points: list[dict]) -> dict:
    return {
        **{
            key: prompt[key]
            for key in ("question", "scope", "evidence", "coverage_notice", "taxonomy")
        },
        "expected_count": len(points),
        "expected_ids": [point["id"] for point in points],
        "points": [
            {key: point[key] for key in ("id", "title", "theme", "facet")} for point in points
        ],
    }


# 响应结构约束数量和合法 ID；恰好覆盖一次及语义资格仍由领域校验决定。
def review_schema(points: list[dict]) -> dict:
    fields = {
        "id": {"type": "string", "enum": [point["id"] for point in points]},
        "decision": {"type": "string", "enum": ["keep", "exclude", "clarify"]},
        "reason": {"type": "string"},
        "category_path": {"type": "array", "items": {"type": "string"}},
        "project_required": {"type": "boolean"},
        "material_request": {"type": "string"},
        "search_terms": {"type": "string"},
    }
    return {
        "type": "object",
        "properties": {
            "decisions": {
                "type": "array",
                "minItems": len(points),
                "maxItems": len(points),
                "items": {
                    "type": "object",
                    "properties": fields,
                    "required": list(fields),
                    "additionalProperties": False,
                },
            }
        },
        "required": ["decisions"],
        "additionalProperties": False,
    }


# 空目录不必请求审核；非空目录仅调用一次，所有协议共用明确目标的提示。
async def request_review(
    client: Generator, config: dict, prompt: dict, points: list[dict], emit: Emit
) -> str:
    if not points:
        # 没有待审项时直接提供合法空结果，不产生模型费用。
        return '{"decisions":[]}'
    review_config = dict(config)
    if config["protocol"] == "responses":
        # 只在 Responses 协议发送其原生格式，不向其他供应商添加不支持的字段。
        review_config["_output_schema"] = review_schema(points)
    return await client.generate(
        review_config,
        json.dumps(review_payload(prompt, points), ensure_ascii=False),
        "topic-review",
        emit,
    )


# 失败原因来自固定模板与安全计数，不把异常消息或模型正文直接展示给用户。
def failure_notice(error: Exception, stage: str) -> str:
    reason = "知识点拆解失败" if stage == "plan" else "知识点审核失败"
    if isinstance(error, ReviewValidationError):
        # 区分响应结构、数量与 ID 覆盖，保留整批拒绝的实际行为。
        if error.rule == "required_list":
            reason = "模型未返回要求的逐项审核列表"
        elif error.rule == "count_mismatch":
            reason = f"模型审核数量不一致（应有 {error.expected_count} 项，返回 {error.actual_count} 项）"
        else:
            reason = (
                f"模型审核对象不匹配（缺少 {error.missing_count} 项、"
                f"重复 {error.duplicate_count} 项、范围外 {error.unknown_count} 项）"
            )
    return (
        reason
        + "，本次未生成学习目录；本地结果保留。请缩小问题或更换模型后重试。"
        + request_reference()
    )
