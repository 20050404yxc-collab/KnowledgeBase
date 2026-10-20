# 文件：public_projects.py
# 层：Python infrastructure
# 作用：限量检索 GitHub 公开仓库和 README。
# 说明：匿名、固定主机、禁止重定向、克隆及执行，不读取凭据。
import asyncio
import base64
import json
import re
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from knowledge_agent.diagnostics import record, traced

MAX_RESPONSE_BYTES = 1_000_000
MAX_README_BYTES = 20_000
TIMEOUT_SECONDS = 15


class PublicProjects:
    # HTTP 客户端归单次查询所有；测试只能注入传输，不改变官方主机。
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.transport = transport

    # 每次只请求一次搜索和最多三个 README，不自动重试。
    @traced
    async def search(self, terms: str) -> list[dict]:
        async with httpx.AsyncClient(
            transport=self.transport,
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "KnowledgeBase"},
        ) as client:
            response = await self.read(
                client, "/search/repositories?q=" + quote(terms, safe="") + "&per_page=3"
            )
            rows = response.get("items")
            if not isinstance(rows, list):
                raise ValueError("公开项目检索结果无效")
            candidates = []
            for row in rows[:3]:
                name = row.get("full_name") if isinstance(row, dict) else None
                if not isinstance(name, str) or not re.fullmatch(
                    r"(?!\.{1,2}/)[A-Za-z0-9_.-]+/(?!\.{1,2}$)[A-Za-z0-9_.-]+", name
                ):
                    raise ValueError("公开项目标识无效")
                readme = await self.read(client, "/repos/" + name + "/readme", missing=True)
                if not readme:
                    continue
                candidates.append(self.candidate(name, readme))
            return candidates

    # 同一请求的响应体有总量限制；HTTP 错误与跨主机重定向均拒绝。
    @traced
    async def read(self, client: httpx.AsyncClient, path: str, missing: bool = False) -> dict:
        try:
            async with (
                asyncio.timeout(TIMEOUT_SECONDS),
                client.stream("GET", "https://api.github.com" + path) as response,
            ):
                record("public_project.http_response", http_status=response.status_code)
                if missing and response.status_code == 404:
                    return {}
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise ValueError("公开项目响应超限，已停止")
                    body.extend(chunk)
                value = json.loads(body)
                if not isinstance(value, dict):
                    raise ValueError("公开项目响应格式无效")
                return value
        except (httpx.HTTPError, ValueError, TimeoutError) as error:
            raise ValueError("公开项目读取失败或超限；未扩大范围、未自动重试") from error

    # 只使用 API 返回的内容，不请求返回的任意下载地址。
    def candidate(self, name: str, readme: dict) -> dict:
        content, size, path = readme.get("content"), readme.get("size"), readme.get("path")
        if not isinstance(content, str) or type(size) is not int or size < 0:
            raise ValueError("公开 README 数据无效")
        if not isinstance(path, str) or len(path) > 500 or readme.get("encoding") != "base64":
            raise ValueError("公开 README 编码无效")
        try:
            decoded = base64.b64decode(content, validate=False)
            excerpt = decoded[:MAX_README_BYTES].decode("utf-8", errors="ignore")
        except ValueError as error:
            raise ValueError("公开 README 无法解码") from error
        if not excerpt.strip():
            raise ValueError("公开 README 没有可读文字")
        return {
            "id": name,
            "name": name,
            "url": "https://github.com/" + name,
            "locator": path + ("（仅前20000字节）" if size > MAX_README_BYTES else ""),
            "excerpt": excerpt,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }
