# 文件：ports.py
# 层：Python application
# 作用：声明用例所需的窄存储、凭据、文件和模型能力。
# 说明：只声明契约，不导入 SQLite、HTTP 或文件实现。
from __future__ import annotations

from typing import Callable, Protocol

from knowledge_agent.domain.generation import GenerationState
from knowledge_agent.domain.models import (
    Document,
    EvidenceBlock,
    Knowledge,
    ProviderConfig,
    ProviderDraft,
    SourceSummary,
)

Emit = Callable[[dict], None]


class KnowledgeRepository(Protocol):
    # 现有正文或补充的分段编辑最终原子写入，版本不符不得覆盖。
    def save_long_text(self, params: dict) -> None: ...
    # 全量重构读取不改变使用日，树查询按分区先过滤再分页。
    def library_inventory(self) -> list[dict]: ...
    # 按两级路径分页聚合，筛选先于计数且不改变使用日。
    def library_tree(self, params: dict) -> dict: ...
    # 创建恢复点并原子校验提交，失败整体回滚。
    def apply_library(self, draft: dict, selected: list[str]) -> dict: ...
    # 汇总全库分类，匹配排序后发送有界摘要并报告覆盖量。
    def taxonomy_summary(self, query: str) -> dict: ...
    # 全库词法搜索返回稳定分页和来源摘录，不调用模型。
    def search(self, params: dict) -> dict: ...
    # 原子新增主题知识或补充，校验幂等键和目标版本。
    def capture_topic(self, draft: dict) -> dict: ...
    # 补充独立维护，正文及索引在同一事务变更。
    def maintain_supplement(self, params: dict, delete: bool = False) -> dict: ...
    # 按标识读取完整知识；主动使用按自然日去重计数。
    def get(self, item_id: str, active_use: bool = False) -> Knowledge: ...
    # 分页读取合并前原文，返回只读 DTO 且不增加使用日。
    def get_original(self, item_id: str, params: dict) -> dict: ...
    # 扫描最近条目并排序，摘要裁剪不改变持久化正文。
    def list_knowledge(
        self, query: str = "", bucket: str | None = None, brief: bool = True
    ) -> list[Knowledge]: ...
    # 原子保存知识和问题复用标识，重复生成不得覆盖个人编辑。
    def save(
        self,
        title: str,
        content: str,
        *,
        item_id: str | None = None,
        generated: bool = False,
        citations: list[EvidenceBlock] | None = None,
        model: str = "",
        provider_name: str = "",
        capture_key: str | None = None,
        classification_path: tuple[str, ...] | list[str] | None = None,
    ) -> dict: ...
    # 固定有效分区或恢复自动计算，拒绝其他分区值。
    def set_bucket(self, item_id: str, bucket: str | None) -> dict: ...
    # 删除知识及外键关联记录，不删除资料或用户文件。
    def delete_knowledge(self, item_id: str) -> dict: ...
    # 检查规范化概念是否已存在，避免生成重复推荐。
    def concept_exists(self, concept: str) -> bool: ...
    # 按问题复用映射读取已有知识，始终保留其最新编辑。
    def generation_item(self, concept: str) -> Knowledge | None: ...


class SourceRepository(Protocol):
    # 判断资料元数据是否已持久化，不访问用户原始路径。
    def has_source(self, item_id: str) -> bool: ...
    # 返回应用持有的副本名，缺失资料返回空。
    def source_filename(self, item_id: str) -> str | None: ...
    # 以单次事务写入资料及解析片段，文件补偿由应用协调。
    def insert_source(self, document: Document, filename: str) -> None: ...
    # 移除资料元数据，保留知识中已有的引用摘录。
    def remove_source(self, item_id: str) -> None: ...
    # 仅返回资料摘要，不将完整来源正文暴露为列表。
    def list_sources(self) -> list[SourceSummary]: ...
    # 读取已保留资料的证据，明确附加来源标识和保留状态。
    def source_blocks(self) -> list[EvidenceBlock]: ...


class ProviderRepository(Protocol):
    # 返回无密钥配置，SQLite 整数字段映射为协议布尔值。
    def providers(self) -> list[ProviderConfig]: ...
    # 按标识读取配置；未指定标识时只取当前启用项。
    def provider(self, provider_id: str | None = None) -> ProviderConfig | None: ...
    # 在同一事务中切换唯一启用配置，不改变凭据。
    def select_provider(self, provider_id: str) -> list[dict]: ...
    # 更新同标识配置并维持唯一启用项，不把密钥写入 SQLite。
    def save_provider_config(self, config_id: str, config: ProviderDraft) -> None: ...
    # 只删除指定配置，是否处理系统凭据由应用层决定。
    def delete_provider(self, config_id: str) -> list[dict]: ...


class AttemptRepository(Protocol):
    # 汇总全历史已知 token 和费用，同时报告缺失项数量。
    def usage_summary(self) -> dict: ...
    # 在请求之前记录调用与价格快照，崩溃后可标记中断。
    def start_attempt(self, attempt_id: str, config: ProviderConfig, purpose: str) -> None: ...
    # 写入实际调用终态和已知用量，不推断未知费用。
    def finish_attempt(
        self,
        attempt_id: str,
        status: str,
        elapsed_ms: int,
        input_tokens: int | None,
        output_tokens: int | None,
        cost: float | None,
    ) -> None: ...
    # 按时间返回最近调用，各币种费用由界面分别统计。
    def list_attempts(self) -> list[dict]: ...


class QuestionRepository(KnowledgeRepository, SourceRepository, ProviderRepository, Protocol):
    pass


class Repository(QuestionRepository, AttemptRepository, Protocol):
    # 关闭仓库拥有的连接；不触及用户原件。
    def close(self) -> None: ...


class CredentialVault(Protocol):
    # 只按配置标识读取系统凭据。
    def get(self, config_id: str) -> str | None: ...
    # 凭据写入失败须抛出异常，不使用普通文件降级。
    def set(self, config_id: str, secret: str) -> None: ...
    # 缺失凭据的重复删除允许成功。
    def delete(self, config_id: str) -> None: ...


class Generator(Protocol):
    # 返回完整文本；取消或残缺流不能作为成功返回。
    async def generate(
        self, config: ProviderConfig, prompt: str, purpose: str, emit: Emit, *, test: bool = False
    ) -> str: ...


class ModelTransport(Protocol):
    # 状态保留取消前已解析的用量，传输本身不记账。
    async def generate(
        self,
        config: ProviderConfig,
        secret: str,
        prompt: str,
        emit: Emit,
        state: GenerationState,
        *,
        test: bool = False,
    ) -> str: ...


class CatalogReader(Protocol):
    # 返回有界、去重的模型 ID；不能执行生成、写配置或读取本地凭据。
    async def list_models(self, config: ProviderDraft, secret: str) -> dict: ...


class PublicProjectReader(Protocol):
    # 单次授权最多一次仓库检索及三个 README，不克隆或执行项目。
    async def search(self, terms: str) -> list[dict]: ...


class SnapshotFiles(Protocol):
    # 校验路径并解析副本，取消后回收线程结果。
    async def read(self, value: str) -> Document: ...
    # 删除本会话拥有的副本。
    def remove_temporary(self, document: Document) -> None: ...
    # 构造稳定且限于资料目录的文件名。
    def retained_filename(self, document: Document) -> str: ...
    # 复制失败回收半写入文件。
    def copy_retained(self, document: Document, filename: str) -> None: ...
    # 删除资料目录内副本，禁止越界。
    def remove_retained(self, filename: str) -> None: ...
    # 等待已有线程结束，不能把取消等待当成线程停止。
    async def settle(self) -> None: ...
    # 释放当前会话的临时目录。
    def close(self) -> None: ...
