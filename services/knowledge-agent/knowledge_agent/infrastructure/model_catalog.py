# 文件：model_catalog.py
# 层：Python infrastructure
# 作用：通过供应商协议读取有界模型目录。
# 说明：不跟随重定向，不发送生成请求或暴露响应正文。
import asyncio
import json

import httpx

from knowledge_agent.domain.models import ProviderDraft
from knowledge_agent.domain.provider_rules import validate_models

MAX_PAGES = 10
MAX_CATALOG_BYTES = 1_000_000
CATALOG_TIMEOUT_SECONDS = 30


# 先累计有限字节再解析，避免无界 JSON 响应占用内存。
async def read_page(client: httpx.AsyncClient, url: str, headers: dict, params: dict) -> dict:
    async with client.stream("GET", url, headers=headers, params=params) as response:
        if response.status_code != 200:
            raise ValueError(f"获取模型失败（HTTP {response.status_code}），可手动添加模型")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            if len(body) + len(chunk) > MAX_CATALOG_BYTES:
                raise ValueError("模型目录响应过大，可手动添加模型")
            body.extend(chunk)
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("模型目录不是有效 JSON，可手动添加模型") from exc
    if not isinstance(value, dict) or not isinstance(value.get("data"), list):
        raise ValueError("模型目录格式不兼容，可手动添加模型")
    return value


class ModelCatalog:
    # 测试可注入模拟传输，每次发现拥有独立客户端和超时范围。
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.transport = transport

    # 全部页面共享总等待上限，取消沿协程传播并释放客户端。
    async def list_models(self, config: ProviderDraft, secret: str) -> dict:
        headers = {"Authorization": f"Bearer {secret}"}
        if config["protocol"] == "anthropic":
            headers = {"x-api-key": secret, "anthropic-version": "2023-06-01"}
        try:
            async with (
                asyncio.timeout(CATALOG_TIMEOUT_SECONDS),
                httpx.AsyncClient(
                    timeout=15, follow_redirects=False, transport=self.transport
                ) as client,
            ):
                return await self.pages(client, config, headers)
        except (httpx.HTTPError, TimeoutError) as exc:
            raise ValueError("获取模型连接失败或超时，已有列表保留，可手动添加") from exc

    # 只接受 ID 游标，不跟随远端提供的任意 URL，避免把认证头带到其他域名。
    async def pages(self, client: httpx.AsyncClient, config: ProviderDraft, headers: dict) -> dict:
        models: list[str] = []
        cursor = ""
        seen = set()
        for _ in range(MAX_PAGES):
            params = {}
            if cursor:
                params["after_id" if config["protocol"] == "anthropic" else "after"] = cursor
            page = await read_page(client, config["base_url"] + "/models", headers, params)
            if not isinstance(page.get("has_more", False), bool):
                raise ValueError("模型目录分页格式无效，可手动添加模型")
            ids = []
            for item in page["data"]:
                if not isinstance(item, dict):
                    raise ValueError("模型目录包含无效条目")
                ids.append(item.get("id"))
            models = validate_models(list(dict.fromkeys([*models, *validate_models(ids)])))
            if not page.get("has_more", False):
                return {"models": models, "partial": False}
            cursor = page.get("last_id") or (ids[-1] if ids else "")
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise ValueError("模型目录分页无效，已有列表保留，可手动添加")
            cursor = validate_models([cursor])[0]
            seen.add(cursor)
        return {"models": models, "partial": True}
