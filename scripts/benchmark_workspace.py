# 文件：benchmark_workspace.py
# 层：维护验证
# 作用：记录合成小中大知识库的启动、首屏搜索和长正文读取基线。
# 说明：只创建临时数据库，不下载资源或访问正式数据，不声明优化前后收益。
import json
import platform
import statistics
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/knowledge-agent"))

from knowledge_agent.infrastructure.sqlite_store import Store  # noqa: E402


# 五次暖测量同时记录中位数与最大值，不混入样例构造时间。
def measured(action) -> dict:
    durations = []
    for _ in range(5):
        start = time.perf_counter()
        action()
        durations.append((time.perf_counter() - start) * 1000)
    return {"median_ms": round(statistics.median(durations), 2), "max_ms": round(max(durations), 2)}


# 每档使用独立数据库，普通正文约五百字、长文十二万字，保留索引真实触发器。
def sample(count: int, root: Path) -> dict:
    with closing(Store(root)) as store:
        with store.db:
            store.db.executemany(
                """INSERT INTO knowledge(id,concept,title,content,digest,created_at,updated_at,generated)
                VALUES (?,?,?,?,?,'2026-11-07','2026-11-07',0)""",
                [
                    (
                        f"fixture-{i}",
                        f"concept-{i}",
                        f"性能测试记录{i}",
                        ("合成普通内容。" * 60 + ("稀有目标词" if i == 0 else "")),
                        f"digest-{i}",
                    )
                    for i in range(count)
                ],
            )
        store.save("长文读取基线", "长文" * 60000)
    opened = []

    # 每次重新打开连接，属于暖文件缓存重开，并非操作系统冷启动。
    def reopen():
        with closing(Store(root)) as store:
            opened.append(len(store.exploration_list("")))

    startup = measured(reopen)
    with closing(Store(root)) as store:
        selective = measured(lambda: store.search({"query": "稀有目标词"}))
        broad = measured(lambda: store.search({"query": "性能测试记录"}))
        item = next(row for row in store.list_knowledge() if row["title"] == "长文读取基线")
        reading = measured(lambda: store.get(item["id"]))
    return {
        "records": count + 1,
        "ordinary_chars": len("合成普通内容。" * 60),
        "long_chars": 120000,
        "warm_reopen_and_home": startup,
        "selective_search": selective,
        "broad_search_first_page": broad,
        "full_long_read": reading,
    }


# 当前基线只用于后续比较，界面、网络模型和真实大库另行计时。
def main() -> None:
    with tempfile.TemporaryDirectory(prefix="kb-workspace-benchmark-") as temporary:
        results = [sample(count, Path(temporary) / str(count)) for count in (100, 1000, 5000)]
    report = {
        "platform": platform.platform(),
        "cpu": platform.processor(),
        "python": platform.python_version(),
        "repeats": 5,
        "cache": "warm OS cache; fresh SQLite connection per reopen",
        "scope": "synthetic local backend; excludes renderer, native imports and model latency",
        "results": results,
    }
    output = ROOT / "artifacts/0.14.0/workspace-performance.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
