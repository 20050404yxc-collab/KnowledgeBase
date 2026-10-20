# 文件：generation_context.py
# 层：Python application
# 作用：将实际模型尝试关联到当前有界业务片段。
# 说明：ContextVar 隔离并行调用；调用者负责恢复 token，不记录正文。
from collections.abc import Callable
from contextvars import ContextVar

ATTEMPT_OBSERVER: ContextVar[Callable[[str], None] | None] = ContextVar(
    "generation_attempt_observer", default=None
)
