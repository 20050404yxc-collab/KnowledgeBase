# 文件：provider_settings.py
# 层：Python application
# 作用：协调配置持久化和凭据失败补偿。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import uuid

from knowledge_agent.domain.provider_rules import validate_provider

from .ports import CredentialVault, ProviderRepository


# 先保存系统凭据，再写入配置；元数据失败时恢复原凭据。
def save_provider(store: ProviderRepository, vault: CredentialVault, params: dict) -> list[dict]:
    config = validate_provider(params)
    config_id = str(params.get("id") or uuid.uuid4())
    # 旧凭据保留到元数据提交成功，支持跨资源写入失败补偿。
    old = store.provider(config_id)
    old_secret = vault.get(config_id) if old else None
    secret = params.get("key", "")
    if not isinstance(secret, str) or len(secret) > 10000:
        raise ValueError("凭据格式无效")
    secret = secret.strip() or old_secret
    if not secret:
        raise ValueError("请填写 API Key")
    # 凭据不可用时不写配置，避免界面出现实际无法调用的已保存接口。
    try:
        vault.set(config_id, secret)
    except Exception as exc:
        raise ValueError("无法写入 Windows 凭据管理器，未保存配置") from exc
    try:
        store.save_provider_config(config_id, config)
    except Exception as error:
        # SQLite 无法参与凭据事务，按之前是否存在密钥恢复对应状态。
        try:
            if old_secret:
                vault.set(config_id, old_secret)
            else:
                vault.delete(config_id)
        except Exception:
            # 补偿也失败时保留最初存储错误，附加不含凭据的诊断信息。
            error.add_note("凭据恢复失败；重新保存该配置前需核对系统凭据状态")
        raise
    return store.providers()
