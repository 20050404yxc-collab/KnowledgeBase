# 文件：validation_errors.py
# 层：Python domain
# 作用：描述文本字段校验失败的规则和有界统计。
# 说明：不保存原始字段值，不做日志或其他外部 I/O。


class FieldValidationError(ValueError):
    # 保留既有用户提示与 ValueError 兼容性，诊断仅携带规则、类型和长度。
    def __init__(self, value: object, name: str, limit: int) -> None:
        super().__init__(f"知识点{name}无效，未采用模型目录")
        self.field = name
        self.limit = limit
        self.actual_length = len(value) if isinstance(value, str) else None
        self.actual_type = type(value).__name__
        # 类型、空白和长度按原校验顺序判断，不改变接受条件。
        if not isinstance(value, str):
            self.rule = "required_text"
        elif not value.strip():
            self.rule = "non_blank"
        else:
            self.rule = "max_length"


class ReviewValidationError(ValueError):
    # 仅保存类型、计数与固定规则；不保留模型正文、业务 ID 或审核理由。
    def __init__(self, decisions: object, expected_ids: set[str], rule: str) -> None:
        super().__init__("知识点审核不完整，未放行")
        self.rule = rule
        self.actual_type = type(decisions).__name__
        self.expected_count = len(expected_ids)
        self.actual_count = len(decisions) if isinstance(decisions, list) else None
        ids = (
            [
                row["id"]
                for row in decisions
                if isinstance(row, dict) and isinstance(row.get("id"), str)
            ]
            if isinstance(decisions, list)
            else []
        )
        self.missing_count = len(expected_ids - set(ids))
        self.unknown_count = len(set(ids) - expected_ids)
        self.duplicate_count = len(ids) - len(set(ids))
