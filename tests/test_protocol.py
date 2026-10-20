# 文件：test_protocol.py
# 层：验证
# 作用：验证对应业务和资源边界。
# 说明：使用隔离资源，不代表正式接口验收。
import json
import subprocess
import sys
from pathlib import Path


# 验证真实后台握手、关联结果、受控错误与 EOF 清理。
def test_worker_jsonlines_ready_errors_and_shutdown(tmp_path):
    script = Path(__file__).resolve().parents[1] / "services" / "knowledge-agent" / "worker.py"
    messages = [
        {
            "id": "1",
            "operation": "knowledge.save",
            "params": {"title": "协议测试", "content": "hello\nworld"},
        },
        {"id": "2", "operation": "unknown", "params": {}},
        {"id": "3", "operation": "bootstrap", "params": {}},
    ]
    with subprocess.Popen(
        [sys.executable, "-u", str(script), "--data-dir", str(tmp_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    ) as process:
        try:
            assert json.loads(process.stdout.readline())["type"] == "ready"
            frames = []
            for message in messages:
                process.stdin.write(json.dumps(message) + "\n")
                process.stdin.flush()
                frames.append(json.loads(process.stdout.readline()))
            assert frames[0]["id"] == "1" and frames[0]["type"] == "result"
            assert frames[1]["id"] == "2" and frames[1]["type"] == "error"
            assert frames[2]["id"] == "3" and frames[2]["type"] == "result"
            # EOF 会取消未完成请求，因此测试先等结果再关闭输入。
            process.communicate(timeout=15)
            assert process.returncode == 0
        finally:
            if process.poll() is None:
                process.kill()
    assert not list((tmp_path / "sessions").iterdir())
