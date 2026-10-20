# 文件：bootstrap.py
# 层：Python 装配点
# 作用：构造应用用例与具体基础设施。
# 说明：依赖实现的选择只集中于此，测试可注入模拟传输。
from pathlib import Path

import httpx

from .application.generation import ProviderClient
from .application.knowledge_service import KnowledgeService
from .application.ports import CredentialVault, Generator, PublicProjectReader
from .infrastructure.file_snapshots import FileSnapshots
from .infrastructure.model_catalog import ModelCatalog
from .infrastructure.model_transport import ModelTransport
from .infrastructure.public_projects import PublicProjects
from .infrastructure.secret_vault import SecretVault
from .infrastructure.sqlite_store import Store


# 模拟和正式请求共用记账用例，仅替换 HTTP 传输。
def create_client(
    store: Store, vault: CredentialVault, transport: httpx.AsyncBaseTransport | None = None
) -> ProviderClient:
    return ProviderClient(store, vault, ModelTransport(transport))


# 装配失败也关闭已经创建的资源，防止残留数据库连接。
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
        return KnowledgeService(
            store,
            credentials,
            generator,
            snapshots,
            str(store.root),
            ModelCatalog(),
            projects if projects is not None else PublicProjects(),
        )
    except Exception:
        store.close()
        if snapshots is not None:
            snapshots.close()
        raise
