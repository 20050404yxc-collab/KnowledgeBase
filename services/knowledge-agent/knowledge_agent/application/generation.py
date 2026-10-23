# 文件：generation.py
# 层：Python application
# 作用：协调凭据读取、模型调用及每次尝试的记账。
# 说明：取消和失败均结算记录，不将流片段收录为知识。
from __future__ import annotations

import asyncio
import time
import uuid

from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.generation import GenerationState
from knowledge_agent.domain.models import ProviderConfig

from .generation_context import ATTEMPT_OBSERVER
from .generation_prompts import instructions_for
from .ports import AttemptRepository, CredentialVault, Emit, ModelTransport


class ProviderClient:
    # 传输适配器由装配点注入，本流程不依赖 HTTP 库。
    def __init__(
        self, store: AttemptRepository, vault: CredentialVault, transport: ModelTransport
    ) -> None:
        self.store = store
        self.vault = vault
        self.transport = transport

    # 每次实际请求先记录价格快照，再在退出路径写入终态和已知用量。
    @traced
    async def generate(
        self, config: ProviderConfig, prompt: str, purpose: str, emit: Emit, *, test: bool = False
    ) -> str:
        config = {**config, "_instructions": instructions_for(purpose)}
        secret = self.vault.get(config["id"])
        if not secret:
            raise ValueError("Windows 凭据中未找到 API Key，请重新保存该配置")
        attempt_id = str(uuid.uuid4())
        observer = ATTEMPT_OBSERVER.get()
        if observer:
            observer(attempt_id)
        record(
            "model.attempt",
            attempt_id=attempt_id,
            protocol=config["protocol"],
            connection_test=test,
            purpose=purpose
            if purpose
            in {
                "question",
                "question-review",
                "topic-plan",
                "topic-review",
                "topic-learn",
                "selection-answer",
                "project-materials",
                "library-summary",
                "library-outline",
                "library-duplicates",
                "library-content",
                "library-group",
                "connection-test",
            }
            else "other",
        )
        started = time.monotonic()
        self.store.start_attempt(attempt_id, config, purpose)
        status = "failed"
        state = GenerationState()
        primary_error: BaseException | None = None
        try:
            text = await self.transport.generate(config, secret, prompt, emit, state, test=test)
            status = "success"
            return text
        except BaseException as error:
            # 取消保留原异常语义；其他失败也不能被收尾记账覆盖。
            primary_error = error
            if isinstance(error, asyncio.CancelledError):
                status = "cancelled"
            raise
        finally:
            # 即使传输取消，已经解析的用量仍属于本次尝试。
            cost = state.cost(config)
            try:
                self.store.finish_attempt(
                    attempt_id,
                    status,
                    round((time.monotonic() - started) * 1000),
                    state.input_tokens,
                    state.output_tokens,
                    cost,
                )
            except Exception as error:
                record("model.accounting_failed", error=error, attempt_id=attempt_id)
                if primary_error is None:
                    # 模型已响应但记账失败时不得继续报告整个操作成功。
                    raise
                primary_error.add_note("调用终态记账失败；下次启动将把在途记录标记为中断")
            record(
                "model.attempt_finished",
                attempt_id=attempt_id,
                status=status,
                input_tokens=state.input_tokens,
                output_tokens=state.output_tokens,
            )
