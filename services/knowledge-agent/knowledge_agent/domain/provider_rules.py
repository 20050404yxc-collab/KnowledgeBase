# 文件：provider_rules.py
# 层：Python domain
# 作用：验证接口地址、协议和价格。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import math
from urllib.parse import urlsplit

from knowledge_agent.domain.models import ProviderDraft

PROTOCOLS = {"responses", "chat-completions", "anthropic"}


# 校验协议、地址、币种与有限非负单价，不推断供应商能力。
def validate_provider(params: dict) -> ProviderDraft:
    result = {
        key: str(params.get(key, "")).strip()
        for key in ["name", "protocol", "base_url", "model", "currency"]
    }
    # 基础字段和协议先验证，不能从品牌名猜测具体传输协议。
    if (
        not result["name"]
        or len(result["name"]) > 80
        or not result["model"]
        or len(result["model"]) > 160
    ):
        raise ValueError("请填写配置名称和模型 ID")
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
