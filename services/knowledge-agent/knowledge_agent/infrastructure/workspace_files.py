# 文件：workspace_files.py
# 层：Python infrastructure
# 作用：原子保存有界草稿并拒绝过期写入。
# 说明：独立于正式知识，不保存临时附件或凭据。
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from knowledge_agent.diagnostics import traced

SLOTS = {"question", "recent"} | {
    "note-" + page
    for page in (
        "探索",
        "知识库",
        "常用",
        "在学",
        "归档",
        "搜索",
        "资料库",
        "设置",
        "回收站",
        "用量统计",
    )
}
MAX_DRAFT_BYTES = 850_000


class WorkspaceFiles:
    # 读写均归后台事件循环，原子替换前关闭文件，兼容 Windows。
    def __init__(self, root: Path) -> None:
        self.root = root / "drafts"
        if self.root.is_symlink() or self.root.is_junction():
            raise ValueError("草稿目录不支持链接，请保留原目录")
        self.root.mkdir(exist_ok=True)

    # 固定槽位拒绝路径穿越，不信任渲染层提供的文件名。
    def _path(self, slot: str) -> Path:
        if slot not in SLOTS:
            raise ValueError("不支持的草稿位置")
        path = self.root / (slot + ".json")
        if any(
            p.is_symlink() or p.is_junction()
            for p in (self.root, path, path.with_suffix(".pending"))
        ):
            raise ValueError("草稿不支持链接，未覆盖原文件")
        return path

    # 无草稿返回明确空快照；损坏文件报错，不静默覆盖旧内容。
    @traced
    def read(self, slot: str) -> dict:
        path = self._path(slot)
        if not path.exists():
            return {"value": None, "revision": 0, "updated_at": ""}
        if path.stat().st_size > MAX_DRAFT_BYTES:
            raise ValueError("草稿文件超限，未覆盖原文件")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if (
                not isinstance(data, dict)
                or type(data.get("revision")) is not int
                or data["revision"] < 0
                or not isinstance(data.get("updated_at"), str)
                or "value" not in data
                or not (data["value"] is None or isinstance(data["value"], str))
            ):
                raise ValueError
        except (ValueError, UnicodeError):
            raise ValueError("草稿损坏，原文件已保留；请先备份后处理") from None
        return data

    # 写入失败保留旧版；成功替换才返回可恢复状态。
    @traced
    def write(self, slot: str, value: str | None, revision: int) -> dict:
        current = self.read(slot)
        if type(revision) is not int or revision != current["revision"]:
            raise ValueError("草稿版本冲突，请先恢复或清除已有草稿")
        if value is not None and not isinstance(value, str):
            raise ValueError("草稿内容无效")
        result = {
            "value": value,
            "revision": revision + 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        if len(encoded) > MAX_DRAFT_BYTES:
            raise ValueError("草稿超出本地恢复容量，请另存正文")
        path = self._path(slot)
        temporary = path.with_suffix(".pending")
        try:
            with temporary.open("wb") as target:
                target.write(encoded)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, path)
        finally:
            # 只清理本适配器创建的固定临时文件。
            temporary.unlink(missing_ok=True)
        return result
