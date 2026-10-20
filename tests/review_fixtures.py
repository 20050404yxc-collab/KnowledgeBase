# 文件：review_fixtures.py
# 层：验证
# 作用：提供显式的合成审核结果。
# 说明：仅由选择认可候选的测试生成器调用，不替换生产审核。
import json


# 测试按候选稳定 ID 回复完整审核，具体边界测试可覆写各项结论。
def approved_points(points: list[dict]) -> str:
    return json.dumps(
        {
            "decisions": [
                {
                    "id": p["id"],
                    "decision": "keep",
                    "reason": "可复用的技术方法",
                    "category": p["theme"],
                    "subcategory": "通用方法",
                    "project_required": False,
                }
                for p in points
            ]
        }
    )


# 直接回答的合成概念经独立审核，可继续验证原有提交与取消契约。
def approved_question() -> str:
    return json.dumps({"eligible": True, "project_required": False, "reason": "可复用的技术概念"})
