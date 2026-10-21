# 文件：model_transport.py
# 层：Python infrastructure
# 作用：编码三种供应商协议并读取有界 SSE 文本流。
# 说明：只返回文本与流状态，不写调用记录或知识。
from __future__ import annotations

import json

import httpx

from knowledge_agent.application.generation_prompts import SYSTEM
from knowledge_agent.application.ports import Emit
from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.generation import GenerationState
from knowledge_agent.domain.models import ProviderConfig

MAX_EVENT_CHARS = 1_000_000
MAX_OUTPUT_CHARS = 140_000
READ_TIMEOUT_SECONDS = 120
CONNECT_TIMEOUT_SECONDS = 15


# 按明确协议编码请求，不根据模型品牌猜测协议。
def build_request(
    config: ProviderConfig, secret: str, prompt: str, test: bool
) -> tuple[str, dict, dict]:
    protocol = config["protocol"]
    headers = {"Authorization": f"Bearer {secret}"}
    instructions = "请仅回复 OK。" if test else config.get("_instructions", SYSTEM)
    if protocol == "responses":
        endpoint = "/responses"
        payload = {
            "model": config["model"],
            "instructions": instructions,
            "input": prompt,
            "stream": True,
            "store": False,
            "max_output_tokens": 64 if test else 8192,
        }
        if not test and config.get("_output_schema"):
            # 审核请求使用原生结构化输出，其他用途及连接测试保持原请求格式。
            payload["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": "topic_review",
                    "strict": True,
                    "schema": config["_output_schema"],
                }
            }
    elif protocol == "anthropic":
        endpoint = "/messages"
        headers = {"x-api-key": secret, "anthropic-version": "2023-06-01"}
        payload = {
            "model": config["model"],
            "system": instructions,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
            "max_tokens": 64 if test else 8192,
        }
    else:
        endpoint = "/chat/completions"
        payload = {
            "model": config["model"],
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt},
            ],
            "stream": True,
            "stream_options": {"include_usage": True},
        }
    effort = config.get("reasoning_effort", "auto")
    # 默认不增加字段；协议不支持的强度必须在发出 HTTP 之前可观察地失败。
    if effort != "auto":
        if effort not in ("low", "medium", "high") or protocol == "anthropic":
            raise ValueError("此协议不支持所选推理强度")
        if protocol == "responses":
            payload["reasoning"] = {"effort": effort}
        else:
            payload["reasoning_effort"] = effort
    return endpoint, headers, payload


# 解析三种流协议的文本、完成状态及已知用量。
def decode_event(protocol: str, event: dict, state: GenerationState) -> str:
    delta = ""
    # 各协议分别识别片段、供应商错误、完成标志和用量，普通 EOF 不代表成功。
    if protocol == "responses":
        event_type = event.get("type", "")
        if event_type == "response.output_text.delta":
            delta = event.get("delta", "")
        if event_type in {"response.failed", "response.incomplete", "error"}:
            raise ValueError("生成未完整结束，未保存残缺内容")
        if event_type == "response.completed":
            state.completed = True
            usage = event.get("response", {}).get("usage", {})
            state.input_tokens, state.output_tokens = (
                usage.get("input_tokens"),
                usage.get("output_tokens"),
            )
    elif protocol == "anthropic":
        if event.get("type") == "error":
            raise ValueError("模型接口报告错误，未保存内容")
        if event.get("type") == "content_block_delta":
            delta = event.get("delta", {}).get("text", "")
        if event.get("type") == "message_start":
            state.input_tokens = event.get("message", {}).get("usage", {}).get("input_tokens")
        if event.get("type") == "message_delta":
            state.output_tokens = event.get("usage", {}).get("output_tokens")
            state.completed = event.get("delta", {}).get("stop_reason") in {
                "end_turn",
                "stop_sequence",
            }
    else:
        if event.get("error"):
            raise ValueError("模型接口报告错误，未保存内容")
        for choice in event.get("choices", []):
            delta += choice.get("delta", {}).get("content") or ""
            if choice.get("finish_reason") == "stop":
                state.completed = True
            elif choice.get("finish_reason"):
                raise ValueError("生成被截断或未正常完成，未保存内容")
        if event.get("usage"):
            state.input_tokens = event["usage"].get("prompt_tokens")
            state.output_tokens = event["usage"].get("completion_tokens")
    return delta


class ModelTransport:
    # 可注入模拟 HTTP 传输；每次调用独占并关闭自己的客户端。
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.transport = transport

    # 输出片段只发送进度，只有真实完成且非空才返回完整文本。
    @traced
    async def generate(
        self,
        config: ProviderConfig,
        secret: str,
        prompt: str,
        emit: Emit,
        state: GenerationState,
        *,
        test: bool = False,
    ) -> str:
        endpoint, headers, payload = build_request(config, secret, prompt, test)
        try:
            async with (
                httpx.AsyncClient(
                    timeout=httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
                    follow_redirects=False,
                    transport=self.transport,
                ) as client,
                client.stream(
                    "POST", config["base_url"] + endpoint, headers=headers, json=payload
                ) as response,
            ):
                record(
                    "model.http_response",
                    http_status=response.status_code,
                    protocol=config["protocol"],
                )
                if response.status_code != 200:
                    raise ValueError(
                        f"接口返回 HTTP {response.status_code}，请检查协议、模型、凭据与额度"
                    )
                return await self.read_stream(response, config["protocol"], state, emit)
        except httpx.HTTPError as exc:
            raise ValueError("网络连接失败或超时，请检查接口地址和网络；本地知识仍可使用") from exc

    # 无效结构、供应商失败和长度超限均拒绝，不透传私密响应体。
    @traced
    async def read_stream(
        self, response: httpx.Response, protocol: str, state: GenerationState, emit: Emit
    ) -> str:
        output: list[str] = []
        chars = 0
        first_chunk = True
        async for line in response.aiter_lines():
            # 每条 SSE 事件限长，忽略非 data 行和协议结束占位符。
            if len(line) > MAX_EVENT_CHARS:
                raise ValueError("接口事件过大")
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                continue
            try:
                event = json.loads(data)
                if not isinstance(event, dict):
                    raise ValueError("接口返回无效的流数据")
                delta = decode_event(protocol, event, state)
            except (json.JSONDecodeError, AttributeError, TypeError) as exc:
                raise ValueError("接口返回无效的流数据") from exc
            if delta:
                if first_chunk:
                    record("model.first_chunk")
                    first_chunk = False
                # 先验证片段类型并累计总长度，超过预算不再向外报告完整结果。
                if not isinstance(delta, str):
                    raise ValueError("接口文本格式不兼容")
                chars += len(delta)
                if chars > MAX_OUTPUT_CHARS:
                    raise ValueError("生成内容超过测试版长度限制")
                output.append(delta)
                emit({"type": "stream", "delta": delta})
        text = "".join(output)
        # 必须同时满足供应商完成状态和非空正文，截断流不能进入收录流程。
        if not state.completed or not text.strip():
            raise ValueError("接口未返回完整文本，未保存内容")
        record(
            "model.stream_completed",
            chars=chars,
            input_tokens=state.input_tokens,
            output_tokens=state.output_tokens,
        )
        return text
