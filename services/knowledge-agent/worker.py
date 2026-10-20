# 文件：worker.py
# 层：Python 启动入口
# 作用：保留桌面进程的命令行启动方式。
# 说明：装配后将协议生命周期交给入口层。
import argparse
import asyncio
import sys
from pathlib import Path

from knowledge_agent.bootstrap import create_service
from knowledge_agent.entrypoints.protocol_runtime import ProtocolRuntime


# 只在实际启动时设置标准流，不在导入时创建数据库或凭据对象。
def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args()
    asyncio.run(ProtocolRuntime(create_service(args.data_dir)).run())


if __name__ == "__main__":
    main()
