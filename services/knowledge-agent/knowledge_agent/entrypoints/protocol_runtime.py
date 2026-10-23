# 文件：protocol_runtime.py
# 层：Python entrypoints
# 作用：维护协议任务关联、取消、错误脱敏和退出清理。
# 说明：标准输出仅包含协议，业务通过分发入口执行。
from __future__ import annotations

import asyncio
import json
import re
import sys

from knowledge_agent.application.knowledge_service import KnowledgeService
from knowledge_agent.diagnostics import record, request_context, step

from .dispatch import dispatch

MAX_FRAME_BYTES = 1_000_000
MAX_PENDING_REQUESTS = 16


# 单线程事件循环中完整写入一行，线程解析器不直接写协议输出。
def send(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


# 未知 JSON 必须先收窄结构和标识，再访问字段或作为字典键。
def parse_message(raw: bytes) -> dict:
    message = json.loads(raw)
    if not isinstance(message, dict):
        raise ValueError("无效协议消息")
    request_id = message.get("id")
    # 标识与参数必须在可哈希使用和分发之前验证，非法帧不进入任务表。
    if not isinstance(request_id, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", request_id):
        raise ValueError("无效协议消息")
    if not isinstance(message.get("operation"), str):
        raise ValueError("无效协议消息")
    if not isinstance(message.get("params", {}), dict):
        raise ValueError("无效协议消息")
    return message


class ProtocolRuntime:
    # 入口拥有任务关联；service 拥有数据库和会话快照。
    def __init__(self, service: KnowledgeService) -> None:
        self.service = service
        self.tasks: dict[str, asyncio.Task] = {}

    # 所有请求结算并移除关联；异常体不泄漏网络和文档内容。
    async def execute(self, message: dict) -> None:
        with request_context(message["id"], message["operation"]):
            await self.execute_request(message)

    # 进度和流式正文仅计数，步骤失败后由协议兜底给用户受控提示。
    async def execute_request(self, message: dict) -> None:
        request_id = message["id"]
        events = {"progress": 0, "stream": 0, "stream_chars": 0}

        # 回调继承请求上下文；不把 progress message 或 delta 正文写入日志。
        def emit(event: dict) -> None:
            kind = event.get("type")
            if kind in ("progress", "stream"):
                events[kind] += 1
                if kind == "stream":
                    events["stream_chars"] += len(event.get("delta", ""))
                else:
                    record("request.progress", index=events["progress"])
            send({**event, "id": request_id})

        try:
            # 整库恢复必须独占会话；后台生成和解析仍在途时拒绝，避免晚到提交覆盖恢复结果。
            with step("request.dispatch"):
                if message["operation"] == "recovery.restore" and len(self.tasks) > 1:
                    raise ValueError("请等待其他任务结束后恢复知识库")
                result = await dispatch(
                    self.service, message["operation"], message.get("params", {}), emit
                )
            send({"id": request_id, "type": "result", "result": result})
            record("request.result_sent")
        except asyncio.CancelledError:
            send({"id": request_id, "type": "error", "error": "任务已取消，未收录残缺内容"})
        except (ValueError, FileNotFoundError, PermissionError) as exc:
            error = str(exc) if isinstance(exc, ValueError) else "无法访问文件，请检查路径和权限"
            send({"id": request_id, "type": "error", "error": error})
        except Exception:
            # 协议兜底只给受控提示，不暴露 SDK、SQL 或本地私密数据。
            send(
                {
                    "id": request_id,
                    "type": "error",
                    "error": "操作失败，未报告保存成功；请检查文件、配置或存储空间后重试",
                }
            )
        finally:
            record("request.finished", **events)
            self.tasks.pop(request_id, None)

    # 重复标识不能替换原任务；取消帧不占业务任务额度。
    def accept(self, message: dict) -> None:
        request_id = message["id"]
        if message["operation"] == "cancel":
            # 取消没有独立业务响应；只传播给仍在途的目标。
            target_id = message.get("params", {}).get("target")
            target = self.tasks.get(target_id) if isinstance(target_id, str) else None
            if target:
                record("request.cancel", request_id=target_id)
                target.cancel()
            else:
                record("request.cancel_inactive")
            return
        if request_id in self.tasks:
            record("request.duplicate", request_id=request_id)
            # 忽略重复帧以保留首请求的终态归属，不能发送同 ID 错误误伤它。
            return
        if len(self.tasks) >= MAX_PENDING_REQUESTS:
            record("request.overloaded", request_id=request_id, pending=len(self.tasks))
            # 并发达到上限直接报错，不再无界创建任务等待资源。
            send({"id": request_id, "type": "error", "error": "后台任务过多，请稍后重试"})
            return
        self.tasks[request_id] = asyncio.create_task(self.execute(message))

    # EOF 和超大帧结束会话；格式错误可恢复，后续合法请求仍能执行。
    async def run(self) -> None:
        send({"type": "ready", "version": "0.12.0"})
        record("worker.ready")
        try:
            while True:
                raw = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_FRAME_BYTES + 1)
                if not raw or len(raw) > MAX_FRAME_BYTES:
                    record(
                        "worker.input_closed" if not raw else "protocol.frame_too_large",
                        bytes=len(raw),
                    )
                    # EOF 或超大帧结束本会话，统一走下方资源收束路径。
                    break
                try:
                    message = parse_message(raw)
                except (ValueError, UnicodeError) as error:
                    record("protocol.invalid_frame", error=error, bytes=len(raw))
                    send({"type": "error", "error": "无效协议消息"})
                    continue
                self.accept(message)
        finally:
            # 先取消业务并等待实际解析完成，再关闭数据库和会话目录。
            pending = list(self.tasks.values())
            record("worker.shutdown", pending=len(pending))
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            try:
                await self.service.settle()
            finally:
                self.service.close()
