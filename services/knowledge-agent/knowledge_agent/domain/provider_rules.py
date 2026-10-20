# 文件：provider_rules.py
# 层：Python domain
# 作用：验证接口地址、协议和价格。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import math
from urllib.parse import urlsplit

from knowledge_agent.domain.models import ProviderDraft

PROTOCOLS = {"responses", "chat-completions", "anthropic"}
MAX_MODELS = 1000


# 校验协议、地址、币种与有限非负单价，不推断供应商能力。
def validate_provider(params: dict) -> ProviderDraft:
    fields = ["name", "protocol", "base_url", "model", "currency"]
    if any(not isinstance(params.get(key, ""), str) for key in fields):
        raise ValueError("接口配置字段必须为文本")
    result = {key: params.get(key, "").strip() for key in fields}
    # 基础字段和协议先验证，不能从品牌名猜测具体传输协议。
    if not result["name"] or len(result["name"]) > 80 or len(result["model"]) > 160:
        raise ValueError("请填写有效配置名称，模型 ID 最长 160 字符")
    result["models"] = validate_models(
        params.get("models", [result["model"]] if result["model"] else [])
    )
    # 未设置默认值时允许空列表；已设置默认值必须是用户保存的目录项。
    if result["model"] and result["model"] not in result["models"]:
        raise ValueError("默认模型必须属于模型列表")
    if result["protocol"] not in PROTOCOLS:
        raise ValueError("请选择实际支持的接口协议")
    url = urlsplit(result["base_url"])
    # 拒绝把密钥放进 URL，远程仅允许 HTTPS，本机服务才可使用 HTTP。
    if not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("接口地址必须为不含凭据、查询参数的 HTTP(S) 基础地址")
    if url.scheme != "https" and not (
        url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ValueError("远程接口须使用 HTTPS；HTTP 仅允许本机服务")
    result["base_url"] = result["base_url"].rstrip("/")
    # 地址限长和币种限制独立于供应商协议，费用不能跨币种自动相加。
    if len(result["base_url"]) > 500:
        raise ValueError("接口地址过长")
    if result["currency"] not in {"USD", "CNY", "EUR"}:
        raise ValueError("请选择 USD、CNY 或 EUR")
    for key in ["input_price", "output_price"]:
        value = params.get(key)
        # 未填写价格保持未知；已填写必须是可计费的有限非负数值。
        if value is None or value == "":
            result[key] = None
        else:
            value = float(value)
            if not math.isfinite(value) or value < 0:
                raise ValueError("单价须为非负有限数值")
            result[key] = value
    return result


# 模型 ID 保持供应商原样，仅去除首尾空白并去重，拒绝不可信集合。
def validate_models(value: object) -> list[str]:
    if not isinstance(value, list) or len(value) > MAX_MODELS:
        raise ValueError("模型列表最多 1000 项")
    result = []
    # 不将数字或空值强制转为 ID，避免保存看似可用的损坏目录。
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item.strip()) > 160:
            raise ValueError("模型 ID 必须为 1–160 字符的文本")
        if any(ord(char) < 32 for char in item):
            raise ValueError("模型 ID 不能包含控制字符")
        if item.strip() not in result:
            result.append(item.strip())
    return result


# 按已固定的配置解析请求覆盖；只在真正需要生成时要求模型非空。
def resolve_generation(config: dict, params: dict) -> dict:
    override = params.get("model", "")
    if not isinstance(override, str):
        raise ValueError("无效模型 ID")
    model = override or config["model"]
    if not isinstance(model, str) or not model:
        raise ValueError("请选择模型；此接口未设置默认模型")
    if model not in config["models"]:
        raise ValueError("所选模型不在此接口列表中，请重新选择")
    effort = params.get("reasoning_effort", "auto")
    if effort not in ("auto", "low", "medium", "high"):
        raise ValueError("无效推理强度")
    if config["protocol"] == "anthropic" and effort != "auto":
        raise ValueError("此协议暂只支持由模型决定推理强度")
    result = {**config, "model": model, "reasoning_effort": effort}
    # 原配置单价仅属于默认模型，不能在临时换模型时误算费用。
    if model != config["model"]:
        result.update(input_price=None, output_price=None)
    return result
