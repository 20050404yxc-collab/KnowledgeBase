# 文件：file_snapshots.py
# 层：Python infrastructure
# 作用：管理会话快照、解析线程和应用保存的资料副本。
# 说明：仅删除所属管理目录的文件，不删除用户原件。
from __future__ import annotations

import asyncio
import shutil
import tempfile
import uuid
from pathlib import Path

from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.models import Document

from .document_parser import MAX_FILE_BYTES, parse_document, validate_path


class FileSnapshots:
    # 单实例启动后清理上次崩溃留下的会话目录，保留资料由仓库恢复。
    @traced
    def __init__(self, root: Path) -> None:
        self.sources_dir = root / "sources"
        self.sessions = root / "sessions"
        self.sessions.mkdir(exist_ok=True)
        for path in self.sessions.iterdir():
            if path.is_dir() and path.name.startswith("session-"):
                shutil.rmtree(path)
        self.session = Path(tempfile.mkdtemp(prefix="session-", dir=self.sessions))
        self.work: set[asyncio.Task] = set()

    # 复制和解析在同一线程；取消不能在复制完成前删除目标。
    @traced
    def _read(self, source: Path, target: Path) -> Document:
        shutil.copyfile(source, target)
        if target.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("复制期间文件超过 50MB，未解析")
        return parse_document(target, source.name)

    # 被取消的等待者不再持有结果；线程完成后由所有者回收快照。
    @traced
    async def read(self, value: str) -> Document:
        path = validate_path(value)
        target = self.session / f"{uuid.uuid4()}{path.suffix.lower()}"
        work = asyncio.create_task(asyncio.to_thread(self._read, path, target))
        self.work.add(work)
        work.add_done_callback(self.work.discard)
        try:
            return await asyncio.shield(work)
        except asyncio.CancelledError:
            # 等待取消不代表线程终止，把副本清理权交给实际完成回调。
            work.add_done_callback(lambda done: self._discard_result(done, target))
            raise
        except Exception as error:
            self._remove_failed_copy(target, error)
            raise

    # 清理失败仅补充上下文，保留复制或解析时的主错误供调用者处理。
    @staticmethod
    @traced
    def _remove_failed_copy(target: Path, error: Exception) -> None:
        try:
            target.unlink(missing_ok=True)
        except OSError as cleanup_error:
            record("snapshot.cleanup_failed", error=cleanup_error)
            error.add_note("失败副本清理未完成；退出或下次启动时重新清理会话资源")

    # 消费后台异常，防止已取消解析任务留下未处理异常或临时文件。
    @traced
    def _discard_result(self, task: asyncio.Task, target: Path) -> None:
        if not task.cancelled():
            error = task.exception()
            if error is not None:
                record("snapshot.cancelled_work_failed", error=error)
        target.unlink(missing_ok=True)

    # 应用传入的路径也必须位于当前会话目录，拒绝越界清理。
    @traced
    def remove_temporary(self, document: Document) -> None:
        path = Path(document["path"]).resolve()
        if path.parent != self.session.resolve():
            raise ValueError("无效会话副本")
        path.unlink(missing_ok=True)

    # 文件名来自解析器指纹，不接受用户原始文件名作为保存路径。
    def retained_filename(self, document: Document) -> str:
        return document["id"] + Path(document["path"]).suffix

    # 复制失败也回收半写入文件，数据库失败由应用调用补偿删除。
    @traced
    def copy_retained(self, document: Document, filename: str) -> None:
        target = self._retained_path(filename)
        try:
            shutil.copyfile(document["path"], target)
        except Exception as error:
            self._remove_failed_copy(target, error)
            raise

    # 管理目录限制独立于数据库字段校验，损坏记录不能导致越界删除。
    def _retained_path(self, filename: str) -> Path:
        target = (self.sources_dir / filename).resolve()
        if target.parent != self.sources_dir.resolve():
            raise ValueError("无效资料副本")
        return target

    # 从受管理资料副本建立会话快照，沿用解析取消与清理保证。
    async def read_retained(self, filename: str) -> Document:
        return await self.read(str(self._retained_path(filename)))

    # 删除仅影响应用持有的副本，保留知识中的引用摘录。
    @traced
    def remove_retained(self, filename: str) -> None:
        self._retained_path(filename).unlink(missing_ok=True)

    # 正常同步关闭用于无在途解析的调用者；后台先等待线程再关闭。
    @traced
    def close(self) -> None:
        shutil.rmtree(
            self.session,
            onexc=lambda _function, _path, error: record("snapshot.close_failed", error=error),
        )

    # asyncio 线程不可强制中断，退出时等待有界解析完成再移除目录。
    @traced
    async def settle(self) -> None:
        if self.work:
            await asyncio.gather(*self.work, return_exceptions=True)
