# 文件：project_registry.py
# 层：Python infrastructure
# 作用：原子持久化项目标签及本地路径，提供按需目录读取能力。
# 说明：独立元数据不改变 SQLite 结构，不保存项目文件或正文。
from __future__ import annotations

import copy
import json
import os
import uuid
from pathlib import Path
from threading import Event

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.project_references import MAX_PROJECTS
from knowledge_agent.domain.taxonomy import validate_path

from .project_reader import read_project


# 仅接受存在的本地绝对目录，错误不包含私密路径。
def project_root(value: object) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("请输入项目文件夹的本地绝对路径")
    path = Path(value.strip().strip('"'))
    if not path.is_absolute():
        raise ValueError("请使用项目文件夹的绝对路径")
    try:
        path = path.resolve(strict=True)
        if not path.is_dir():
            raise ValueError("请选择项目文件夹，单文件仍可通过附件加入")
        return path
    except OSError as error:
        raise ValueError("项目路径失效或无法访问，请在资料库更新路径") from error


class ProjectRegistry:
    # 只加载有界元数据；损坏时显式报错，不静默覆盖已登记路径。
    def __init__(self, root: Path) -> None:
        self.path = root / "project-references.json"
        self.rows: list[dict] = []
        if self.path.exists():
            if self.path.stat().st_size > 1024 * 1024:
                raise ValueError("项目路径登记文件过大，请检查备份")
            rows = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(rows, list) or len(rows) > MAX_PROJECTS:
                raise ValueError("项目路径登记格式无效，请检查备份")
            for row in rows:
                self.validate_row(row)
            self.rows = rows

    # 载入仅验证元数据，移动或离线的原目录不会阻止软件启动。
    @staticmethod
    def validate_row(row: object) -> None:
        if not isinstance(row, dict) or any(
            not isinstance(row.get(key), str) or not row[key]
            for key in ("id", "label", "path", "revision")
        ):
            raise ValueError("项目路径登记格式无效，请检查备份")
        if row.get("category_path") != []:
            validate_path(row.get("category_path"))

    # 深拷贝防止应用会话或界面修改内部登记版本。
    def list(self) -> list[dict]:
        return copy.deepcopy(self.rows)

    # 同一标签只能对应一条路径；编辑须给出原登记标识。
    @traced
    def save(self, params: dict) -> list[dict]:
        label, identity = params.get("label"), params.get("id", "")
        if not isinstance(label, str) or not 2 <= len(label.strip()) <= 80:
            raise ValueError("项目标签需为 2–80 个字符，请使用易区分的项目名称")
        if not isinstance(identity, str):
            raise ValueError("无效项目登记标识")
        label = label.strip()
        current = next((row for row in self.rows if row["id"] == identity), None)
        if identity and current is None:
            raise ValueError("项目登记已移除，请刷新后重试")
        if any(
            row["label"].casefold() == label.casefold() and row is not current for row in self.rows
        ):
            raise ValueError("项目标签已存在，请编辑原登记或使用不同标签")
        if current is None and len(self.rows) >= MAX_PROJECTS:
            raise ValueError("最多登记 100 个项目，请先移除不用的登记")
        path = str(project_root(params.get("path")))
        categories = params.get("category_path", [])
        if categories != []:
            categories = list(validate_path(categories))
        row = {
            "id": identity or str(uuid.uuid4()),
            "label": label,
            "path": path,
            "category_path": categories,
            "revision": str(uuid.uuid4()),
        }
        self.commit([r for r in self.rows if r is not current] + [row])
        return self.list()

    # 移除不存在的登记幂等成功，绝不操作原项目路径。
    @traced
    def delete(self, identity: str) -> list[dict]:
        self.commit([row for row in self.rows if row["id"] != identity])
        return self.list()

    # 同目录临时文件原子替换；写入失败保留旧登记和旧磁盘数据。
    def commit(self, rows: list[dict]) -> None:
        payload = json.dumps(rows, ensure_ascii=False)
        # 写入和重启读取使用相同预算，避免成功保存后下一次启动无法加载。
        if len(payload.encode("utf-8")) > 1024 * 1024:
            raise ValueError("项目路径登记超过 1 MiB，请减少登记或缩短分类路径")
        temporary = self.path.with_name(f"project-references-{uuid.uuid4()}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.path)
        except Exception as error:
            # 临时文件清理失败不能掩盖持久化主错误，旧内存版本仍保留。
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                error.add_note("项目路径登记临时文件清理未完成")
            raise
        self.rows = copy.deepcopy(rows)

    # 文件线程只持有登记快照，不接触 SQLite 或可变元数据。
    def read(self, reference: dict, query: str, stop: Event, tree_only: bool) -> dict:
        return read_project(project_root(reference["path"]), reference, query, stop, tree_only)
