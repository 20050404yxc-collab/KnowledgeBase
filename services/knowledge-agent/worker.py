# 文件：worker.py
# 层：Python 启动入口
# 作用：保留桌面进程的命令行启动方式。
# 说明：装配后将协议生命周期交给入口层。
import argparse
import asyncio
import os
import sys
from pathlib import Path

from knowledge_agent.diagnostics import configure, record, step


# 事件循环兜底只记录异常对象的脱敏诊断，不输出可能含正文的 context 消息。
async def run_service(data_dir: Path) -> None:
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(
        lambda _loop, context: record(
            "worker.unhandled_async_error", error=context.get("exception")
        )
    )
    # 依赖导入也在已启用日志的启动步骤内，缺少运行时依赖可查。
    from knowledge_agent.bootstrap import create_service
    from knowledge_agent.entrypoints.protocol_runtime import ProtocolRuntime

    await ProtocolRuntime(create_service(data_dir)).run()


# 只在实际启动时设置标准流，不在导入时创建数据库或凭据对象。
def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args()
    configure(args.data_dir, os.environ.get("KB_LOG_SESSION"))
    record("worker.start", python_version=sys.version.split()[0], version="0.12.0")
    try:
        with step("worker.lifecycle"):
            asyncio.run(run_service(args.data_dir))
    finally:
        record("worker.stopped")


if __name__ == "__main__":
    main()
