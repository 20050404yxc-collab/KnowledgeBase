# 文件：workspace.py
# 层：Python application
# 作用：协调草稿、完整知识导出与隔离备份恢复。
# 说明：只通过能力接口访问文件，不改变数据库或凭据位置。
import asyncio
from functools import partial

from knowledge_agent.diagnostics import traced

from .ports import PortableFiles, Repository, WorkspaceStorage


class Workspace:
    # 能力对象由 bootstrap 装配；不拥有仓库连接。
    def __init__(self, store: Repository, drafts: WorkspaceStorage, files: PortableFiles) -> None:
        self.store = store
        self.drafts = drafts
        self.files = files

    # 草稿操作不执行生成，不把恢复内容自动写回正式知识。
    @traced
    def draft(self, operation: str, params: dict) -> dict:
        slot = params.get("slot")
        if not isinstance(slot, str):
            raise ValueError("草稿位置无效")
        if operation == "workspace.read":
            return self.drafts.read(slot)
        if operation == "workspace.write" and "value" in params:
            return self.drafts.write(slot, params["value"], params.get("revision"))
        raise ValueError("草稿操作无效")

    # 文件任务在受控线程完成；取消等待后仍收束线程，避免清理与写入竞态。
    @traced
    async def portable(self, operation: str, params: dict) -> dict:
        if operation == "data.export":
            # 在仓库所属线程取得完整快照，不能导出界面的分页正文。
            item = self.store.get(params.get("id", ""))
            action = partial(self.files.export, item, params.get("directory", ""))
        elif operation == "data.backup":
            action = partial(self.files.backup, params.get("directory", ""))
        elif operation == "data.verify":
            action = partial(self.files.verify, params.get("path", ""))
        elif operation == "data.restore":
            action = partial(
                self.files.restore, params.get("path", ""), params.get("directory", "")
            )
        else:
            raise ValueError("数据操作无效")
        task = asyncio.create_task(asyncio.to_thread(action))
        while True:
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                # 重复取消也不能传播到线程所有者；完成后返回真实文件结果。
                continue
