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
