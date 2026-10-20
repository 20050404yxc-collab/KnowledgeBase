# 文件：model_prices.py
# 层：Python domain
# 作用：校验独立模型价格并按选中模型解析计价。
# 说明：空单价保留未知，零价格为用户显式配置的免费价格。
import math

from knowledge_agent.domain.models import ModelPrice


# 不接受布尔、非数值、负数及无限值；空白单价表示未知。
def price_value(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("单价须为非负有限数值")
    try:
        price = float(value)
    except (ValueError, OverflowError) as error:
        raise ValueError("单价须为非负有限数值") from error
    if not math.isfinite(price) or price < 0:
        raise ValueError("单价须为非负有限数值")
    return price


# 价格只能绑定已保存目录项，同模型禁止重复并允许仅填写一侧。
def validate_prices(value: object, models: list[str]) -> list[ModelPrice]:
    if not isinstance(value, list) or len(value) > 1000:
        raise ValueError("模型价格列表最多 1000 项")
    result: list[ModelPrice] = []
    seen: set[str] = set()
    for item in value:
        # 对象、模型归属和币种在写库前完整校验，避免隐式绑定其他模型。
        if not isinstance(item, dict) or not isinstance(item.get("model"), str):
            raise ValueError("模型价格格式无效")
        model = item["model"]
        if model not in models or model in seen:
            raise ValueError("价格模型必须属于模型列表且不能重复")
        if item.get("currency") not in ("USD", "CNY", "EUR"):
            raise ValueError("请选择 USD、CNY 或 EUR")
        seen.add(model)
        result.append(
            {
                "model": model,
                "currency": item["currency"],
                "input_price": price_value(item.get("input_price")),
                "output_price": price_value(item.get("output_price")),
            }
        )
    return result


# 旧默认字段保留兼容；新列表存在时，未定价模型不能回落到其他模型价格。
def generation_prices(config: dict, model: str) -> dict:
    if "model_prices" in config:
        price = next((p for p in config["model_prices"] if p["model"] == model), None)
        return {
            "input_price": price["input_price"] if price else None,
            "output_price": price["output_price"] if price else None,
            "currency": price["currency"] if price else config["currency"],
        }
    if model != config["model"]:
        return {"input_price": None, "output_price": None}
    return {}
