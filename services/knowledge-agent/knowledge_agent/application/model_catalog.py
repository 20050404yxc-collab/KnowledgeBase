# 文件：model_catalog.py
# 层：Python application
# 作用：解析配置草稿与凭据，协调模型目录发现。
# 说明：发现只读远端目录，不保存配置，也不发起生成或记账。
from knowledge_agent.domain.provider_rules import validate_provider

from .ports import CatalogReader, CredentialVault, ProviderRepository


# 草稿新密钥优先，留空仅允许从指定已保存配置读取，凭据不返回界面。
async def discover_models(
    store: ProviderRepository, vault: CredentialVault, reader: CatalogReader, params: dict
) -> dict:
    config = validate_provider(
        {
            **params,
            "name": "模型发现",
            "model": "",
            "models": [],
            "currency": "USD",
            "input_price": None,
            "output_price": None,
        }
    )
    config_id = params.get("id")
    if config_id is not None and (not isinstance(config_id, str) or not store.provider(config_id)):
        raise ValueError("配置不存在，请重新选择")
    secret = params.get("key", "")
    if not isinstance(secret, str) or len(secret) > 10000:
        raise ValueError("凭据格式无效")
    secret = secret.strip() or (vault.get(config_id) if config_id else None)
    if not secret:
        raise ValueError("请先填写 API Key")
    return await reader.list_models(config, secret)
