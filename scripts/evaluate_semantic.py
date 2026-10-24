# 文件：evaluate_semantic.py
# 层：维护验证
# 作用：离线测量真实 INT8 编码并验证开发／冻结后台协议可建立语义索引。
# 说明：仅用合成题目与临时目录，不下载模型、不访问正式接口。
import argparse
import asyncio
import json
import platform
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/knowledge-agent"))

from knowledge_agent.infrastructure.semantic_model import RESOURCE_BYTES, LocalSemanticModel  # noqa: E402


# 计时仅覆盖本机合成短句，明确区分冷加载与热编码，不宣称真实库准确率。
def evaluate(model_root: Path) -> dict:
    import numpy as np

    cases = json.loads(
        (ROOT / "tests/fixtures/semantic_retrieval_cases.json").read_text(encoding="utf-8")
    )
    model = LocalSemanticModel(model_root)
    if not model.ready():
        raise ValueError("需要事先准备并校验的本地模型目录；该脚本不会下载")
    start = time.perf_counter()
    docs = np.array([np.frombuffer(v, dtype="<f4") for v in model.encode(cases["documents"])])
    cold = (time.perf_counter() - start) * 1000
    positives, negative, durations = [], [], []
    for query, target in cases["queries"]:
        start = time.perf_counter()
        vector = np.frombuffer(model.encode([query], True)[0], dtype="<f4")
        durations.append((time.perf_counter() - start) * 1000)
        scores = docs @ vector
        positives.append(
            {
                "query": query,
                "expected": target,
                "top": int(scores.argmax()),
                "score": float(scores.max()),
                "target_score": float(scores[target]),
            }
        )
    for query in cases["negative"]:
        scores = docs @ np.frombuffer(model.encode([query], True)[0], dtype="<f4")
        negative.append({"query": query, "max_score": float(scores.max())})
    model.close()
    return {
        "platform": platform.platform(),
        "cpu": platform.processor(),
        "resource_bytes": RESOURCE_BYTES,
        "cold_load_and_16_encode_ms": cold,
        "query_median_ms": statistics.median(durations),
        "query_max_ms": max(durations),
        "top1_correct": sum(i["top"] == i["expected"] for i in positives),
        "positive_cases": len(positives),
        "positive_results": positives,
        "negative_results": negative,
    }


# 每个协议请求都有期限；保持 stdin 打开检验真实运行形态，防止仅在独立编码时通过。
async def request(
    process: asyncio.subprocess.Process, identity: str, operation: str, params: dict
) -> dict:
    process.stdin.write(
        (json.dumps({"id": identity, "operation": operation, "params": params}) + "\n").encode()
    )
    await process.stdin.drain()
    while True:
        raw = await asyncio.wait_for(process.stdout.readline(), 20)
        if not raw:
            raise RuntimeError("后台意外退出")
        frame = json.loads(raw)
        if frame["type"] == "error":
            raise RuntimeError(frame["error"])
        if frame["type"] == "result":
            assert frame["id"] == identity
            return frame["result"]


# 模型复制到临时数据目录，验证完整握手、索引、检索、记忆和 EOF 清理。
async def worker_smoke(model_root: Path, executable: Path | None) -> dict:
    with tempfile.TemporaryDirectory(prefix="kb-semantic-worker-") as raw:
        root = Path(raw)
        shutil.copytree(model_root / "models", root / "models")
        command = (
            [str(executable.resolve())]
            if executable
            else [sys.executable, "-u", str(ROOT / "services/knowledge-agent/worker.py")]
        )
        with (root / "stderr.txt").open("wb") as errors:
            process = await asyncio.create_subprocess_exec(
                *command,
                "--data-dir",
                str(root),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=errors,
            )
            try:
                assert (
                    json.loads(await asyncio.wait_for(process.stdout.readline(), 20))["type"]
                    == "ready"
                )
                await request(
                    process,
                    "save",
                    "knowledge.save",
                    {
                        "title": "线程锁",
                        "content": "互斥锁保护共享变量，同一时刻只有一个线程操作共享资源。",
                    },
                )
                status = await request(process, "index", "semantic.rebuild", {})
                assert status["indexed"] == status["documents"] == 1 and not status["working"]
                opened = await request(
                    process,
                    "open",
                    "question.open",
                    {
                        "query": "怎样防止多个任务同时写同一份数据？",
                        "scope": "knowledge",
                        "attachment_ids": [],
                    },
                )
                answer = await request(
                    process,
                    "ask",
                    "selection.ask",
                    {
                        "session_id": opened["id"],
                        "turn_id": "smoke",
                        "action": "lookup",
                        "question": "怎样防止多个任务同时写同一份数据？",
                    },
                )
                turn = answer["turns"][0]
                assert turn["total"] > 0 and not turn["attempts"]
                memory = await request(process, "memory", "memory.get", {})
                assert memory["topics"][0]["count"] == 1
                process.stdin.close()
                assert await asyncio.wait_for(process.wait(), 20) == 0
                return {
                    "frozen": executable is not None,
                    "status": status,
                    "hits": turn["total"],
                    "paid_calls": 0,
                }
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()


# 结果写入忽略目录；参数必须明确给出已存在模型的父目录。
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--worker", type=Path)
    args = parser.parse_args()
    report = evaluate(args.model_root)
    report["worker"] = asyncio.run(worker_smoke(args.model_root, args.worker))
    destination = (
        ROOT
        / "artifacts/semantic-evaluation"
        / ("frozen-report.json" if args.worker else "report.json")
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                key: value
                for key, value in report.items()
                if key not in ("positive_results", "negative_results")
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    main()
