# 文件：generation.py
# 层：Python domain
# 作用：表达模型流状态及调用费用规则。
# 说明：不依赖 HTTP 或数据库，用量缺失时保持未知。

from dataclasses import dataclass

from knowledge_agent.domain.models import ProviderConfig


@dataclass
class GenerationState:
    input_tokens: int | None = None
    output_tokens: int | None = None
    completed: bool = False

    # 非整数或负用量不能参与费用估算，布尔值也不是 token 数。
    def normalize_usage(self) -> None:
        # 任一用量无效则整组标记未知，不把布尔值或负数用于费用估算。
        for value in (self.input_tokens, self.output_tokens):
            if value is not None and (type(value) is not int or value < 0):
                self.input_tokens = self.output_tokens = None

    # 单价单位为每百万 token；任何必要值缺失时不猜测费用。
    def cost(self, config: ProviderConfig) -> float | None:
        self.normalize_usage()
        # 用量或任一单价缺失均保持未知，已知零值仍可正常计算为零费用。
        if self.input_tokens is None or self.output_tokens is None:
            return None
        if config["input_price"] is None or config["output_price"] is None:
            return None
        return (
            self.input_tokens * config["input_price"] + self.output_tokens * config["output_price"]
        ) / 1_000_000
