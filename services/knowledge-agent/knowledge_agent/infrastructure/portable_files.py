# 文件：portable_files.py
# 层：Python infrastructure
# 作用：创建可校验的数据备份、隔离恢复目录和 Markdown 导出。
# 说明：线程独立连接 SQLite，拒绝符号链接、路径穿越和覆盖既有数据。
import hashlib
import json
import re
import shutil
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from knowledge_agent.diagnostics import traced

MAX_FILES = 20_000
MAX_BYTES = 8 * 1024**3


# 用户选择目录必须已存在；禁止向应用管理根目录写递归备份。
def destination(value: str, root: Path) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("请选择有效目录")
    path = Path(value).resolve()
    if not path.is_dir() or path == root or root in path.parents:
        raise ValueError("请选择应用数据目录以外的已有目录")
    return path


# 流式计算摘要，避免把大资料一次加载到内存。
def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


# 数据库只读校验，不运行迁移或恢复业务。
def check_database(path: Path) -> set[str]:
    # 备份是已关闭的独立快照；immutable 防止只读检查创建 WAL/SHM 副文件。
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("备份数据库完整性检查失败")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version != 7:
            raise ValueError("备份数据库版本不兼容，未恢复")
        return {"sources/" + row[0] for row in db.execute("SELECT filename FROM sources")}


# Windows 目录联接与符号链接均不能作为受管理备份内容。
def linked(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


# 清单保留原始相对路径，拒绝规范化别名、设备名和 Windows ADS。
def entry_path(value: object) -> PurePosixPath:
    if not isinstance(value, str):
        raise ValueError("备份路径无效")
    relative = PurePosixPath(value)
    valid = len(relative.parts) == 1 and value in ("knowledge.sqlite3", "project-references.json")
    valid = valid or (len(relative.parts) == 2 and relative.parts[0] in ("sources", "drafts"))
    if not valid or relative.as_posix() != value or relative.is_absolute():
        raise ValueError("备份包含越界路径")
    for part in relative.parts:
        # 不让同一文件经不同拼写、多余分隔符或 Windows 特殊名称重复出现。
        device = part.split(".")[0].upper()
        if (
            part in ("..", ".")
            or part.rstrip(" .") != part
            or re.search(r'[<>:"\\|?*\x00-\x1f]', part)
            or device in {"CON", "PRN", "AUX", "NUL"}
            or re.fullmatch(r"(?:COM|LPT)[0-9]", device)
        ):
            raise ValueError("备份包含越界路径")
    return relative


# 单项校验先核对大小，随后流式计算摘要；父目录不得绕过链接限制。
def verify_entry(entry: object, folder: Path) -> tuple[str, int]:
    if not isinstance(entry, dict):
        raise ValueError("备份路径无效")
    relative = entry_path(entry.get("path"))
    path = folder.joinpath(*relative.parts)
    size = entry.get("bytes")
    if type(size) is not int or not 0 <= size <= MAX_BYTES:
        raise ValueError("备份清单大小无效")
    if linked(path) or linked(path.parent):
        raise ValueError("备份超限或包含链接")
    if not path.is_file() or path.stat().st_size != size or digest(path) != entry.get("sha256"):
        raise ValueError("备份文件校验失败，未恢复")
    return relative.as_posix(), size


# 管理目录只允许一层文件；枚举数量有界，拒绝在未知目录或联接里递归。
def actual_files(folder: Path) -> set[str]:
    result = set()
    for path in folder.iterdir():
        if linked(path):
            raise ValueError("备份超限或包含链接")
        paths = [path]
        if path.is_dir():
            if path.name not in ("sources", "drafts"):
                raise ValueError("备份包含未登记目录")
            paths = path.iterdir()
        for item in paths:
            if linked(item) or not item.is_file():
                raise ValueError("备份超限或包含链接")
            result.add(item.relative_to(folder).as_posix())
            if len(result) > MAX_FILES + 1:
                raise ValueError("备份超出本机保护限额")
    return result


class PortableData:
    # 只保存受管理根路径，不跨线程使用已有 SQLite 连接。
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    # 导出包括补充和引用的完整正文，文件名使用安全标题和随机后缀。
    @traced
    def export(self, item: dict, directory: str) -> dict:
        folder = destination(directory, self.root)
        title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", item["title"])[:70].strip(" .") or "知识"
        path = folder / ("知序-" + title + "-" + uuid.uuid4().hex[:8] + ".md")
        parts = ["# " + item["title"], item["content"]]
        citations = list(item.get("citations", []))
        for supplement in item.get("supplements", []):
            parts.extend(["## 补充：" + supplement["title"], supplement["content"]])
            citations.extend(supplement.get("citations", []))
        parts.append("## 引用与来源摘录")
        for citation in citations:
            parts.extend([f"### {citation['name']} · {citation['locator']}", citation["text"]])
        body = "\n\n".join(parts) + "\n"
        # 独占新文件防止覆盖；写失败删除本次半成品。
        created = False
        try:
            with path.open("x", encoding="utf-8") as target:
                created = True
                target.write(body)
        except BaseException as error:
            if created:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    error.add_note("导出半成品清理失败，原始错误保留")
            raise
        return {"path": str(path), "files": 1, "bytes": path.stat().st_size, "verified": True}

    # 停写由协议入口持有直到线程完成；数据库使用 online backup 而非复制 WAL。
    @traced
    def backup(self, directory: str) -> dict:
        parent = destination(directory, self.root)
        folder = parent / ("知序备份-" + uuid.uuid4().hex)
        folder.mkdir()
        try:
            target_path = folder / "knowledge.sqlite3"
            with closing(sqlite3.connect(self.root / "knowledge.sqlite3")) as source:
                with closing(sqlite3.connect(target_path)) as target:
                    source.backup(target)
            entries = [self._entry(target_path, folder)]
            total = entries[0]["bytes"]
            for name in ("sources", "drafts", "project-references.json"):
                source_path = self.root / name
                if linked(source_path):
                    raise ValueError("备份资料包含链接，未生成备份")
                if not source_path.exists():
                    continue
                paths = source_path.iterdir() if source_path.is_dir() else [source_path]
                for path in paths:
                    if linked(path):
                        raise ValueError("备份资料包含链接，未生成备份")
                    if not path.is_file():
                        raise ValueError("备份包含不支持的子目录")
                    if path.suffix == ".pending":
                        continue
                    entry = self._entry(path, self.root)
                    if len(entries) >= MAX_FILES or total + entry["bytes"] > MAX_BYTES:
                        raise ValueError("备份超出本机保护限额")
                    output = folder / entry["path"]
                    output.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, output)
                    entries.append(entry)
                    total += entry["bytes"]
            manifest = {
                "format": 1,
                "schema": 7,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "entries": entries,
            }
            (folder / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
            )
            return self.verify(str(folder))
        except BaseException as error:
            # folder 由本次在已验证父目录中新建，绝不清理用户选择的父目录。
            try:
                shutil.rmtree(folder)
            except OSError:
                error.add_note("备份半成品清理失败，原始错误保留")
            raise

    # 清单只允许固定数据库、项目登记和受管理资料／草稿子目录。
    def _entry(self, path: Path, base: Path) -> dict:
        if linked(path):
            raise ValueError("备份包含不支持的文件链接")
        size = path.stat().st_size
        if size > MAX_BYTES:
            raise ValueError("备份超出本机保护限额")
        return {
            "path": path.relative_to(base).as_posix(),
            "bytes": size,
            "sha256": digest(path),
        }

    # 校验清单和每个文件；拒绝越界、重复、链接、额外文件及超限输入。
    def _verified_entries(self, folder: Path) -> list[dict]:
        manifest_path = folder / "manifest.json"
        if linked(folder) or linked(manifest_path) or manifest_path.stat().st_size > 8_000_000:
            raise ValueError("备份清单无效")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError):
            raise ValueError("备份清单损坏") from None
        if (
            not isinstance(manifest, dict)
            or manifest.get("format") != 1
            or manifest.get("schema") != 7
        ):
            raise ValueError("备份格式不兼容")
        entries = manifest.get("entries")
        if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_FILES:
            raise ValueError("备份文件数量无效")
        seen, folded, total = set(), set(), 0
        for entry in entries:
            name, size = verify_entry(entry, folder)
            if name.casefold() in folded:
                raise ValueError("备份清单重复或大小无效")
            seen.add(name)
            folded.add(name.casefold())
            total += size
            if total > MAX_BYTES:
                raise ValueError("备份超限或包含链接")
        if "knowledge.sqlite3" not in seen:
            raise ValueError("备份缺少数据库")
        actual = actual_files(folder)
        if actual != seen | {"manifest.json"}:
            raise ValueError("备份包含未登记文件")
        if not check_database(folder / "knowledge.sqlite3") <= seen:
            raise ValueError("备份缺少已保留资料，未恢复")
        return entries

    # 核对不改变备份与当前工作库。
    @traced
    def verify(self, value: str) -> dict:
        if not isinstance(value, str) or not value:
            raise ValueError("请选择备份目录")
        folder = Path(value).resolve()
        entries = self._verified_entries(folder)
        return {
            "path": str(folder),
            "files": len(entries),
            "bytes": sum(e["bytes"] for e in entries),
            "verified": True,
        }

    # 恢复始终创建隔离目录；失败回收本次半成品，成功后再次逐文件校验。
    @traced
    def restore(self, value: str, directory: str) -> dict:
        self.verify(value)
        source = Path(value).resolve()
        parent = destination(directory, self.root)
        if parent == source or source in parent.parents:
            raise ValueError("恢复位置不能在备份内部")
        target = parent / ("知序恢复-" + uuid.uuid4().hex)
        target.mkdir()
        try:
            entries = self._verified_entries(source)
            for entry in entries:
                output = target / entry["path"]
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source / entry["path"], output)
            shutil.copyfile(source / "manifest.json", target / "manifest.json")
            return self.verify(str(target))
        except BaseException as error:
            try:
                shutil.rmtree(target)
            except OSError:
                error.add_note("恢复半成品清理失败，原始错误保留")
            raise
