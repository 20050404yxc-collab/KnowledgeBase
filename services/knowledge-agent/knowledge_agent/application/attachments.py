# 文件：attachments.py
# 层：Python application
# 作用：编排临时附件、资料保留和文件数据库补偿。
# 说明：文件访问和 SQL 均通过能力接口执行。
from __future__ import annotations

from knowledge_agent.domain.models import Document

from .ports import Emit, SnapshotFiles, SourceRepository


class Attachments:
    # 会话附件由本用例持有，具体文件由快照适配器持有。
    def __init__(self, store: SourceRepository, snapshots: SnapshotFiles) -> None:
        self.store = store
        self.snapshots = snapshots
        self.documents: dict[str, Document] = {}

    # 外部只获取摘要，不泄漏内部管理路径和完整解析文本。
    @staticmethod
    def info(document: Document) -> dict:
        return {
            **{key: document[key] for key in ["id", "name", "fingerprint", "warnings", "retained"]},
            "blocks": len(document["blocks"]),
        }

    # 解析完成才登记；重复内容复用首个附件并清理多余快照。
    async def add(self, params: dict, emit: Emit) -> dict:
        emit({"type": "progress", "message": "正在读取本地文档"})
        document = await self.snapshots.read(params.get("path", ""))
        existing = self.documents.get(document["id"])
        if existing:
            self.snapshots.remove_temporary(document)
            return self.info(existing)
        document["retained"] = self.store.has_source(document["id"])
        self.documents[document["id"]] = document
        return self.info(document)

    # 保存顺序为复制、原子写入元数据；写入失败补偿副本。
    def retain(self, item_id: str) -> list[dict]:
        document = self.documents.get(item_id)
        if not document:
            raise ValueError("附件已移除，请重新加入")
        if not self.store.has_source(item_id):
            filename = self.snapshots.retained_filename(document)
            self.snapshots.copy_retained(document, filename)
            try:
                self.store.insert_source(document, filename)
            except Exception as error:
                try:
                    self.snapshots.remove_retained(filename)
                except Exception:
                    # 启动恢复会处理无元数据副本，当前不掩盖数据库主错误。
                    error.add_note("资料副本补偿清理失败；下次启动将重试清理孤立副本")
                raise
        document["retained"] = True
        return self.store.list_sources()

    # 文件删除失败则不移除元数据，不报告资料删除成功。
    def delete_source(self, item_id: str) -> list[dict]:
        filename = self.store.source_filename(item_id)
        if filename:
            self.snapshots.remove_retained(filename)
            self.store.remove_source(item_id)
        if item_id in self.documents:
            self.documents[item_id]["retained"] = False
        return self.store.list_sources()

    # 只移除会话副本，已保留的资料和用户原件不受影响。
    def remove(self, item_id: str) -> dict:
        document = self.documents.get(item_id)
        if document:
            self.snapshots.remove_temporary(document)
            self.documents.pop(item_id)
        return {"removed": True}
