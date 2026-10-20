# 文件：knowledge_service.py
# 层：Python application
# 作用：组合知识、附件、接口配置和问答用例。
# 说明：由 bootstrap 注入能力，协议分发位于入口层。
from __future__ import annotations

from knowledge_agent.domain.provider_rules import resolve_generation

from .attachments import Attachments
from .model_catalog import discover_models
from .ports import CatalogReader, CredentialVault, Emit, Generator, Repository, SnapshotFiles
from .questions import Questions
from .recommendations import Recommendations
from .topic_workflow import TopicWorkflow


class KnowledgeService:
    # 本对象持有后台会话；仓库和快照由它统一关闭。
    def __init__(
        self,
        store: Repository,
        vault: CredentialVault,
        client: Generator,
        snapshots: SnapshotFiles,
        data_dir: str,
        catalog: CatalogReader,
    ) -> None:
        self.store = store
        self.vault = vault
        self.client = client
        self.snapshots = snapshots
        self.data_dir = data_dir
        self.attachment_usecase = Attachments(store, snapshots)
        self.attachments = self.attachment_usecase.documents
        self.cards = Recommendations(store)
        self.questions = Questions(store, client, self.attachments, self.cards)
        self.topics = TopicWorkflow(store, client, self.questions)
        self.closed = False
        self.catalog = catalog

    # 关闭可重复调用，先关闭数据库再清理会话；不删除保留资料。
    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.store.close()
        finally:
            self.snapshots.close()

    # 入口退出时先收束解析线程，再执行同步资源释放。
    async def settle(self) -> None:
        await self.snapshots.settle()

    # 启动摘要仅含显示数据，不包含凭据或内部文件句柄。
    def info(self) -> dict:
        return {
            "version": "test0.03",
            "data_dir": self.data_dir,
            "providers": self.store.providers(),
            "knowledge": self.store.list_knowledge(),
            "sources": self.store.list_sources(),
            "notice": "关键词检索 · 未启用语义索引；OCR、旧 DOC 与安装包仍待验证",
        }

    # 为入口提供稳定的附件用例边界。
    async def add_attachment(self, params: dict, emit: Emit) -> dict:
        return await self.attachment_usecase.add(params, emit)

    # 原子元数据和文件补偿由附件用例协调。
    def retain(self, item_id: str) -> list[dict]:
        return self.attachment_usecase.retain(item_id)

    # 删除资料保留知识和引用摘录。
    def delete_source(self, item_id: str) -> list[dict]:
        return self.attachment_usecase.delete_source(item_id)

    # 已有知识和生成拓展共享同一推荐规则。
    def recommendations(
        self,
        title: str,
        content: str,
        expansions: list[dict] | None = None,
        exclude: str | None = None,
    ) -> list[dict]:
        return self.cards.recommend(title, content, expansions, exclude)

    # 客户端可由装配或测试替换，锁和会话状态始终属于同一个问答用例。
    async def question(self, params: dict, emit: Emit) -> dict:
        self.questions.client = self.client
        return await self.questions.question(params, emit)

    # 删除凭据后才删除配置，失败不报告删除成功。
    def delete_provider(self, item_id: str) -> list[dict]:
        self.vault.delete(item_id)
        return self.store.delete_provider(item_id)

    # 测试生成也产生真实尝试记录，不宣称具备向量能力。
    async def test_provider(self, params: dict, emit: Emit) -> dict:
        config = self.store.provider(params["id"])
        if not config:
            raise ValueError("配置不存在")
        config = resolve_generation(config, params)
        await self.client.generate(config, "请回复 OK", "connection-test", emit, test=True)
        return {"message": "生成接口已响应；此测试会产生调用记录，不表示具备向量能力。"}

    # 草稿目录发现不保存配置，也不创建生成尝试记录。
    async def discover_models(self, params: dict) -> dict:
        return await discover_models(self.store, self.vault, self.catalog, params)
