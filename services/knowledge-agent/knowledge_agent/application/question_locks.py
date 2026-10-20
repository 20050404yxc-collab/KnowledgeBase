# 文件：question_locks.py
# 层：Python application
# 作用：序列化相同问题并回收不再使用的锁。
# 说明：等待者也计入所有权，取消等待不会提前替换仍被使用的锁。
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from knowledge_agent.diagnostics import record, step


@dataclass
class LockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0


class QuestionLocks:
    # 所有状态只在同一 asyncio 循环内访问，不跨线程共享。
    def __init__(self) -> None:
        self.entries: dict[str, LockEntry] = {}

    # 进入等待前登记所有者，最后一位退出时才移除关联。
    @asynccontextmanager
    async def acquire(self, key: str) -> AsyncIterator[None]:
        entry = self.entries.setdefault(key, LockEntry())
        # 等待前即占用关联，防止其他取消者删除仍有人排队的锁。
        entry.users += 1
        try:
            with step("question.lock_wait"):
                await entry.lock.acquire()
            # 等待结束后独占执行；日志不包含由问题正文构成的锁键。
            try:
                record("question.lock_acquired")
                yield
            finally:
                entry.lock.release()
        finally:
            # 包括等待取消在内的所有退出都释放计数，最后一位负责回收。
            entry.users -= 1
            if entry.users == 0:
                self.entries.pop(key)
