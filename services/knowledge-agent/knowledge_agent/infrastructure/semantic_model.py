# 文件：semantic_model.py
# 层：Python infrastructure
# 作用：校验固定 INT8 模型资源并执行离线 CPU 句向量编码。
# 说明：只显式准备时访问网络；模型资源合计少于 100 MB。
import hashlib
import os
import threading
from pathlib import Path

import httpx

from knowledge_agent.diagnostics import record

REVISION = "75c43b069aac4d136ba6bc1122f995fedcfd2781"
MODEL_ID = "bge-small-zh-v1.5-int8:" + REVISION + ":chunks360-v1"
BASE_URL = "https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/" + REVISION + "/"
FILES = (
    (
        "onnx/model_int8.onnx",
        23903394,
        "b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5",
    ),
    ("tokenizer.json", 439125, "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26"),
    ("config.json", 716, "d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f"),
)
RESOURCE_BYTES = sum(item[1] for item in FILES)


class LocalSemanticModel:
    # 对象归应用用例持有，所有重操作在单个受控执行线程上串行完成。
    def __init__(self, root: Path) -> None:
        self.root = root / "models" / "bge-small-zh-v1.5-int8"
        self.session = None
        self.tokenizer = None
        self.lock = threading.Lock()
        self.validated = False
        self.model_id = MODEL_ID
        # 在协议读线程启动前导入原生库，规避本机复现的首次导入卡住。
        self.runtime_error: Exception | None = None
        try:
            import numpy  # noqa: F401
            import onnxruntime  # noqa: F401
            import tokenizers  # noqa: F401
        except Exception as error:
            self.runtime_error = error
            record("semantic.runtime_unavailable", error=error)

    # 状态只检查固定资源是否存在；实际编码前还校验 SHA-256，普通查询绝不下载。
    def ready(self) -> bool:
        return all(
            (self.root / name).is_file() and (self.root / name).stat().st_size == size
            for name, size, _ in FILES
        )

    # 由服务在异步任务收束后释放 ONNX 与 tokenizer 引用。
    def close(self) -> None:
        with self.lock:
            self.session = None
            self.tokenizer = None
            self.validated = False

    # 部分下载只落本对象管理的 pending 文件；取消或失败删除半成品。
    def prepare(self, cancel: threading.Event) -> None:
        if RESOURCE_BYTES >= 100_000_000:
            raise ValueError("模型资源超过 100 MB 限制")
        with self.lock, httpx.Client(follow_redirects=True, timeout=30) as client:
            for name, size, digest in FILES:
                self.check_cancel(cancel)
                target = self.root / name
                if target.is_file() and self.file_hash(target) == digest:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_suffix(".pending")
                try:
                    count = 0
                    hasher = hashlib.sha256()
                    with (
                        client.stream("GET", BASE_URL + name) as response,
                        temporary.open("wb") as output,
                    ):
                        response.raise_for_status()
                        for block in response.iter_bytes(65536):
                            self.check_cancel(cancel)
                            count += len(block)
                            if count > size:
                                raise ValueError("语义模型下载超限")
                            hasher.update(block)
                            output.write(block)
                    if count != size or hasher.hexdigest() != digest:
                        raise ValueError("语义模型文件校验失败")
                    temporary.replace(target)
                finally:
                    temporary.unlink(missing_ok=True)
            self.validated = False

    # 显式取消停止下一阶段；单次 ONNX 调用不可中断，由所有者等待线程结束。
    def check_cancel(self, cancel: threading.Event) -> None:
        if cancel.is_set():
            raise InterruptedError("语义任务已取消")

    # 分块校验避免把整个文件复制进额外内存，固定提交防止上游更新漂移。
    def file_hash(self, path: Path) -> str:
        with path.open("rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest()

    # 官方 BGE 使用 CLS pooling 和 L2 归一化；禁用外部模型代码与网络加载。
    def load(self) -> None:
        if self.runtime_error is not None:
            raise ValueError("本地语义运行库不可用，请检查安装") from self.runtime_error
        if not self.validated:
            for name, _, digest in FILES:
                if self.file_hash(self.root / name) != digest:
                    raise ValueError("语义模型文件校验失败")
            self.validated = True
        if self.session is not None:
            return
        import onnxruntime as ort
        from tokenizers import Tokenizer

        options = ort.SessionOptions()
        options.intra_op_num_threads = min(4, os.cpu_count() or 1)
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(
            str(self.root / FILES[0][0]), options, providers=["CPUExecutionProvider"]
        )
        self.tokenizer = Tokenizer.from_file(str(self.root / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")

    # 每批最多 16 段，返回独立 float32 字节；线程内不触碰数据库或应用会话。
    def encode(self, texts: list[str], query: bool = False) -> list[bytes]:
        import numpy as np

        with self.lock:
            self.load()
            result = []
            for offset in range(0, len(texts), 16):
                batch = texts[offset : offset + 16]
                if query:
                    batch = ["为这个句子生成表示以用于检索相关文章：" + text for text in batch]
                encodings = self.tokenizer.encode_batch(batch)
                inputs = {
                    "input_ids": np.array([e.ids for e in encodings], dtype=np.int64),
                    "attention_mask": np.array(
                        [e.attention_mask for e in encodings], dtype=np.int64
                    ),
                    "token_type_ids": np.array([e.type_ids for e in encodings], dtype=np.int64),
                }
                names = {item.name for item in self.session.get_inputs()}
                output = self.session.run(None, {k: v for k, v in inputs.items() if k in names})[0]
                vectors = output[:, 0, :] if output.ndim == 3 else output
                vectors = vectors / np.maximum(
                    np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12
                )
                if vectors.shape[1] != 512 or not np.isfinite(vectors).all():
                    raise ValueError("语义向量结果无效")
                result.extend(vector.astype("<f4").tobytes() for vector in vectors)
            return result
