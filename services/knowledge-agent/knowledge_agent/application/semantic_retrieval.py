# 文件：semantic_retrieval.py
# 层：Python application
# 作用：拥有受控语义线程、派生索引任务与混合检索降级策略。
# 说明：SQLite 始终在调用上下文；取消等待后收束实际线程。
import asyncio
import threading
from typing import Callable, TypeVar

from knowledge_agent.diagnostics import record, step
from knowledge_agent.domain.memory_rules import document_hash, semantic_chunks
from knowledge_agent.domain.selection_rules import selection_match, selection_query

from .ports import EmbeddingEncoder, Emit, Repository

T = TypeVar("T")


# 余弦计算在工作线程处理，每次仅一批当前有效快照。
def scored_vectors(rows: list[dict], query: bytes) -> list[tuple[float, dict]]:
    import numpy as np

    vector = np.frombuffer(query, dtype="<f4")
    if vector.shape != (512,) or not np.isfinite(vector).all():
        raise ValueError("语义查询向量无效")
    scores = []
    fingerprints = {}
    for row in rows:
        identity = row["document_id"]
        if identity not in fingerprints:
            fingerprints[identity] = document_hash(row)
        if row["fingerprint"] != fingerprints[identity]:
            continue
        item = np.frombuffer(row["vector"], dtype="<f4")
        if item.shape != (512,) or not np.isfinite(item).all():
            raise ValueError("语义索引向量无效，请重建索引")
        score = float(item @ vector)
        if score >= 0.50:
            scores.append((score, row))
    return best_sources(scores)


# 同一长文只占一个候选名额，避免多个相邻片段挤掉其他相关来源。
def best_sources(scores: list[tuple[float, dict]]) -> list[tuple[float, dict]]:
    best = {}
    for score, row in scores:
        key = row["document_id"]
        previous = best.get(key)
        if previous is None or (score, -row["offset"]) > (previous[0], -previous[1]["offset"]):
            best[key] = (score, row)
    return sorted(best.values(), key=lambda x: (-x[0], x[1]["document_id"], x[1]["offset"]))[:30]


class SemanticRetrieval:
    # 一个模型工作槽避免无界线程；索引和查询冲突时查询明确退回词法。
    def __init__(self, store: Repository, encoder: EmbeddingEncoder) -> None:
        self.store = store
        self.encoder = encoder
        self.working = False
        self.cancel = threading.Event()
        self.workers: set[asyncio.Task] = set()

    # 等待取消不能丢弃真实线程；关闭前仍由本对象持有它并统一收束。
    async def run(self, function: Callable[..., T], *args: object) -> T:
        task = asyncio.create_task(asyncio.to_thread(function, *args))
        self.workers.add(task)
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            self.cancel.set()
            await asyncio.shield(asyncio.gather(task, return_exceptions=True))
            raise
        finally:
            self.workers.discard(task)

    # 退出不留编码／下载线程访问已释放资源。
    async def settle(self) -> None:
        self.cancel.set()
        await asyncio.gather(*self.workers, return_exceptions=True)

    # 状态显式显示部分索引；文件就绪不等于推理与检索质量已经验收。
    def status(self) -> dict:
        return {
            **self.store.semantic_counts(self.encoder.model_id),
            "ready": self.encoder.ready(),
            "working": self.working,
            "model": "BGE-small-zh-v1.5 INT8",
            "resource_bytes": 24343235,
        }

    # 显式准备／重建只有一个所有者，逐文档有界编码并复核当前代次。
    async def build(self, prepare: bool, emit: Emit) -> dict:
        if self.working:
            raise ValueError("语义任务正在执行，请稍后重试")
        self.working = True
        self.cancel.clear()
        try:
            if prepare:
                emit({"type": "progress", "message": "正在准备约 24.4 MB 的 INT8 模型并校验文件"})
                with step("semantic.prepare"):
                    await self.run(self.encoder.prepare, self.cancel)
            if not self.encoder.ready():
                raise ValueError("请先准备本地语义模型")
            self.store.semantic_reset()
            epoch = self.store.semantic_epoch()
            after = ""
            while rows := self.store.semantic_documents(after):
                for row in rows:
                    after = row["id"]
                    chunks = semantic_chunks(row)
                    vectors = []
                    for offset in range(0, len(chunks), 16):
                        with step("semantic.encode"):
                            vectors.extend(
                                await self.run(
                                    self.encoder.encode,
                                    [c["text"] for c in chunks[offset : offset + 16]],
                                )
                            )
                    self.store.semantic_put(row, chunks, vectors, self.encoder.model_id, epoch)
                    emit({"type": "progress", "message": "正在建立本地语义索引"})
                    await asyncio.sleep(0)
            return {**self.status(), "working": False}
        finally:
            self.working = False

    # 词法失败直接传播；语义资源或编码异常只在词法成功后允许可见降级。
    async def search(self, query: str, selection: dict | None = None) -> dict:
        with step("hybrid.lexical"):
            local = (
                self.store.selection_search(selection)
                if selection
                else self.store.search({"query": selection_query(query, "", [])})
            )
        notice = "仅关键词检索；语义模型未准备、正在工作或索引尚未建立。"
        counts = self.store.semantic_counts(self.encoder.model_id)
        if self.working or not self.encoder.ready() or not counts["vectors"]:
            return {**local, "notice": notice}
        self.working = True
        self.cancel.clear()
        try:
            with step("hybrid.semantic"):
                encoded = (await self.run(self.encoder.encode, [query], True))[0]
                best = []
                after, offset = "", -1
                while rows := self.store.semantic_rows(self.encoder.model_id, after, offset):
                    after, offset = rows[-1]["document_id"], rows[-1]["offset"]
                    if selection:
                        # 先限定候选再取最高分，避免选区自身和资料挤占其他知识名额。
                        rows = [
                            row
                            for row in rows
                            if row["kind"] != "source"
                            and selection_match({**row, "id": row["document_id"]}, selection)
                        ]
                    scores = await self.run(scored_vectors, rows, encoded)
                    best = best_sources(best + scores)
            hits = []
            for _, row in best:
                hits.append(self.store.semantic_hit(row))
            merged = fuse_hits(local["items"], hits)
            notice = "关键词＋本地语义检索（问题前 512 token）；相关片段并不保证已经解答。"
            if counts["indexed"] < counts["documents"]:
                notice += "部分内容未建立语义索引，可在设置中重建。"
            return {"items": merged, "total": len(merged), "page": 0, "notice": notice}
        except asyncio.CancelledError:
            raise
        except Exception as error:
            record("hybrid.degraded", error=error)
            return {**local, "notice": "语义检索失败，已降级关键词；可检查模型并重建索引。"}
        finally:
            self.working = False


# 稳定秩融合不把两个不同量纲的分数直接相加，同来源只保留最相关片段。
def fuse_hits(lexical: list[dict], semantic: list[dict]) -> list[dict]:
    scores = {}
    hits = {}
    for group in (lexical[:30], semantic[:30]):
        seen = set()
        for rank, hit in enumerate(group):
            if hit["id"] in seen:
                continue
            seen.add(hit["id"])
            scores[hit["id"]] = scores.get(hit["id"], 0) + 1 / (60 + rank + 1)
            hits.setdefault(hit["id"], hit)
    return [hits[key] for key in sorted(scores, key=lambda key: (-scores[key], key))][:30]
