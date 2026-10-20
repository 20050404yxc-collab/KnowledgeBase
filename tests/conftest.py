# 文件：conftest.py
# 层：验证
# 作用：验证对应业务和资源边界。
# 说明：使用隔离资源，不代表正式接口验收。
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "knowledge-agent"))
