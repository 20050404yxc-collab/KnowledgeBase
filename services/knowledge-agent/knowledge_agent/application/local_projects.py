# 文件：local_projects.py
# 层：Python application
# 作用：管理带标签的项目路径，协调有界按需读取及撤销。
# 说明：持久化与文件访问由接口完成；线程收束后才关闭服务。
from __future__ import annotations

import asyncio
import threading

from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.project_references import match_reference

from .ports import ProjectFiles


class LocalProjects:
    # 限制后台扫描并发，实际线程集合由服务退出时统一收束。
    def __init__(self, files: ProjectFiles) -> None:
        self.files = files
        self.slots = asyncio.Semaphore(2)
        self.work: set[asyncio.Task] = set()

    # 登记不扫描目录或读取项目正文，只保存用户明确给出的标签与路径。
    @traced
    def save(self, params: dict) -> list[dict]:
        return self.files.save(params)

    # 返回路径元数据，不在列表读取时扫描项目。
    def list(self) -> list[dict]:
        return self.files.list()

    # 删除仅撤销引用，用户原目录和旧知识中的引用摘录均保留。
    @traced
    def delete(self, identity: str) -> list[dict]:
        return self.files.delete(identity)

    # 自动复用仅在明确标签或先前显式绑定的分类路径唯一匹配时发生。
    def match(self, query: str, path: list[str] | None = None) -> dict | None:
        return match_reference(self.list(), query, path)

    # 网络返回后与提交前检查登记版本，编辑和删除阻止旧依据继续写入。
    def check(self, reference: dict) -> None:
        if not any(row == reference for row in self.list()):
            raise ValueError("项目路径或标签已修改／移除，请重新生成")

    # 线程在两个槽内运行；取消等待也等待实际工作响应停止，避免后台积压。
    @traced
    async def read(self, reference: dict, query: str, tree_only: bool = False) -> dict:
        async with self.slots:
            stop = threading.Event()
            work = asyncio.create_task(
                asyncio.to_thread(self.files.read, reference, query, stop, tree_only)
            )
            self.work.add(work)
            try:
                result = await asyncio.shield(work)
                self.check(reference)
                return result
            except asyncio.CancelledError:
                stop.set()
                # 取消可能再次到来，退出收束仍持有实际线程任务。
                await asyncio.shield(asyncio.gather(work, return_exceptions=True))
                raise
            finally:
                work.add_done_callback(self.work.discard)
                work.add_done_callback(self.consume)

    # 被取消等待者的线程异常只能进入脱敏诊断，不成为未处理异常。
    @staticmethod
    def consume(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception() is not None:
            record("project.read_discarded", error=task.exception())

    # 仅目录预览不读取任何文件正文。
    async def tree(self, identity: str) -> dict:
        reference = next((row for row in self.list() if row["id"] == identity), None)
        if reference is None:
            raise ValueError("项目路径登记不存在")
        result = await self.read(reference, "", True)
        return {"entries": result["entries"], "notice": result["notice"]}

    # 服务退出等待实际文件线程，不只等待已取消的协议请求。
    async def settle(self) -> None:
        if self.work:
            await asyncio.gather(*self.work, return_exceptions=True)
