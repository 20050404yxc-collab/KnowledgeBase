# 文件：dispatch.py
# 层：Python entrypoints
# 作用：将白名单协议操作路由到应用用例。
# 说明：不执行 SQL，也不管理具体文件或模型协议。
from knowledge_agent.application.knowledge_service import KnowledgeService
from knowledge_agent.application.ports import Emit
from knowledge_agent.application.provider_settings import save_provider


# 按操作名转交用例，入口只处理契约映射，不直接访问技术实现。
# 在应用调用前校验基本参数类型，业务限额和取值由用例继续验证。
def validate_params(operation: str, params: dict) -> None:
    id_operations = {
        "knowledge.get",
        "knowledge.delete",
        "knowledge.bucket",
        "attachments.remove",
        "sources.retain",
        "sources.delete",
        "providers.select",
        "providers.delete",
        "providers.test",
        "recommendations",
    }
    if operation in id_operations and not isinstance(params.get("id"), str):
        raise ValueError("缺少有效条目标识")
    for key in (
        "id",
        "query",
        "title",
        "content",
        "path",
        "purpose",
        "provider_id",
        "model",
        "reasoning_effort",
    ):
        if key in params and params[key] is not None and not isinstance(params[key], str):
            raise ValueError("请求参数类型无效")
    bucket = params.get("bucket")
    if bucket is not None and bucket not in ("常用", "在学", "归档"):
        raise ValueError("无效分区")


# 路由仅转换协议字段并调用应用，不执行 SQL 或文件操作。
async def dispatch(
    service: KnowledgeService, operation: str, params: dict, emit: Emit
) -> dict | list[dict]:
    validate_params(operation, params)
    store = service.store
    if operation == "bootstrap":
        return service.info()
    if operation == "knowledge.list":
        return store.list_knowledge(str(params.get("query", "")), params.get("bucket"))
    if operation == "knowledge.get":
        return store.get(params["id"], active_use=True)
    if operation == "knowledge.save":
        return store.save(
            str(params.get("title", "")), str(params.get("content", "")), item_id=params.get("id")
        )
    if operation == "knowledge.delete":
        return store.delete_knowledge(params["id"])
    if operation == "knowledge.bucket":
        return store.set_bucket(params["id"], params.get("bucket"))
    if operation == "attachments.add":
        return await service.add_attachment(params, emit)
    if operation == "attachments.remove":
        return service.attachment_usecase.remove(params["id"])
    if operation == "sources.list":
        return store.list_sources()
    if operation == "sources.retain":
        return service.retain(params["id"])
    if operation == "sources.delete":
        return service.delete_source(params["id"])
    if operation == "providers.save":
        return save_provider(store, service.vault, params)
    if operation == "providers.select":
        return store.select_provider(params["id"])
    if operation == "providers.delete":
        return service.delete_provider(params["id"])
    if operation == "providers.test":
        return await service.test_provider(params, emit)
    if operation == "providers.models":
        return await service.discover_models(params)
    if operation == "usage.list":
        return store.list_attempts()
    if operation == "question":
        return await service.question(params, emit)
    if operation == "recommendations":
        item = store.get(params["id"])
        return service.recommendations(item["title"], item["content"], exclude=item["id"])
    raise ValueError("不支持的操作")
