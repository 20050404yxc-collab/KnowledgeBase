"""Bounded JSON-lines protocol. stdout contains protocol only, never diagnostics."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from service import KnowledgeService

MAX_FRAME = 1_000_000


def send(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


async def run(data_dir: Path):
    service = KnowledgeService(data_dir)
    tasks = {}

    async def execute(message):
        request_id = message["id"]
        try:
            result = await service.dispatch(message["operation"], message.get("params", {}), lambda event: send({**event, "id": request_id}))
            send({"id": request_id, "type": "result", "result": result})
        except asyncio.CancelledError:
            send({"id": request_id, "type": "error", "error": "任务已取消，未收录残缺内容"})
        except (ValueError, FileNotFoundError, PermissionError) as exc:
            # Only controlled user-facing errors; network/SDK bodies never enter protocol errors.
            error = str(exc) if isinstance(exc, ValueError) else "无法访问文件，请检查路径和权限"
            send({"id": request_id, "type": "error", "error": error})
        except Exception:  # noqa: BLE001 - the protocol must settle failures without exposing private SDK data.
            send({"id": request_id, "type": "error", "error": "操作失败，未报告保存成功；请检查文件、配置或存储空间后重试"})
        finally:
            tasks.pop(request_id, None)

    send({"type": "ready", "version": "test0.02"})
    try:
        while True:
            raw = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_FRAME + 1)
            if not raw:
                break
            if len(raw) > MAX_FRAME:
                break
            try:
                message = json.loads(raw)
                request_id = message["id"]
                if not isinstance(request_id, str) or len(request_id) > 80 or not isinstance(message.get("params", {}), dict):
                    raise ValueError()
                operation = message["operation"]
            except (ValueError, KeyError, TypeError):
                send({"type": "error", "error": "无效协议消息"})
                continue
            if operation == "cancel":
                target = tasks.get(message.get("params", {}).get("target"))
                if target:
                    target.cancel()
                continue
            if request_id in tasks:
                # Do not replace the first operation's correlation entry.
                continue
            if len(tasks) >= 16:
                send({"id": request_id, "type": "error", "error": "后台任务过多，请稍后重试"})
                continue
            tasks[request_id] = asyncio.create_task(execute(message))
    finally:
        pending = list(tasks.values())
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        service.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args()
    asyncio.run(run(args.data_dir))
