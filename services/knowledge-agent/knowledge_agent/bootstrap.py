# 文件：bootstrap.py
# 层：Python 装配点
# 作用：构造应用用例与具体基础设施。
# 说明：依赖实现的选择只集中于此，测试可注入模拟传输。
from pathlib import Path

import httpx

from knowledge_agent.diagnostics import traced

from .application.generation import ProviderClient
from .application.knowledge_service import KnowledgeService
from .application.ports import CredentialVault, Generator, PublicProjectReader
from .application.semantic_retrieval import SemanticRetrieval
from .infrastructure.file_snapshots import FileSnapshots
from .infrastructure.model_catalog import ModelCatalog
from .infrastructure.model_transport import ModelTransport
from .infrastructure.public_projects import PublicProjects
from .infrastructure.secret_vault import SecretVault
from .infrastructure.semantic_model import LocalSemanticModel
from .infrastructure.sqlite_store import Store


# 模拟和正式请求共用记账用例，仅替换 HTTP 传输。
@traced
def create_client(
    store: Store, vault: CredentialVault, transport: httpx.AsyncBaseTransport | None = None
) -> ProviderClient:
    return ProviderClient(store, vault, ModelTransport(transport))


# 装配失败也关闭已经创建的资源，防止残留数据库连接。
@traced
def create_service(
    data_dir: Path,
    vault: CredentialVault | None = None,
    client: Generator | None = None,
    projects: PublicProjectReader | None = None,
) -> KnowledgeService:
    store = Store(data_dir)
    snapshots = None
    try:
        credentials = vault if vault is not None else SecretVault()
        snapshots = FileSnapshots(store.root)
        generator = client if client is not None else create_client(store, credentials)
        service = KnowledgeService(
            store,
            credentials,
            generator,
            snapshots,
            str(store.root),
            ModelCatalog(),
            projects if projects is not None else PublicProjects(),
        )
        service.semantic = SemanticRetrieval(store, LocalSemanticModel(store.root))
        service.selection.retrieval = service.semantic
        service.selection.documents = service.attachments
        return service
    except Exception:
        store.close()
        if snapshots is not None:
            snapshots.close()
        raise
