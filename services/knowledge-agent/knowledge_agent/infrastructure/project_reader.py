# 文件：project_reader.py
# 层：Python infrastructure
# 作用：有界发现项目目录，按问题选择少量文件并提取可定位证据。
# 说明：不执行、复制或持久缓存项目；跳过链接、敏感与生成目录。
import hashlib
import os
import time
from collections import deque
from pathlib import Path
from threading import Event

from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.knowledge_rules import relevance, tokens
from knowledge_agent.domain.project_references import (
    MAX_DEPTH,
    MAX_ENTRIES,
    MAX_PROJECT_CHARS,
    MAX_READ_BYTES,
    MAX_READ_FILES,
    TEXT_SUFFIXES,
    eligible_name,
)

from .document_parser import parse_document


# 目录和文件链接均不跟随，Windows junction 也不能绕过根目录。
def safe_child(path: Path, root: Path) -> bool:
    return not path.is_symlink() and not path.is_junction() and path.resolve().is_relative_to(root)


# 广度遍历受条目、深度和时间限制；跳过项也占扫描预算，避免海量目录拖死界面。
@traced
def discover(root: Path, stop: Event) -> tuple[list[str], list[Path], list[str]]:
    queue = deque([(root, 0)])
    entries, files, notices = [], [], []
    visited, started = 0, time.monotonic()
    while queue and visited < MAX_ENTRIES and time.monotonic() - started < 3:
        directory, depth = queue.popleft()
        try:
            with os.scandir(directory) as children:
                for child in children:
                    # 每个条目都检查取消，已启动的读取线程能及时结束。
                    if stop.is_set():
                        raise ValueError("项目读取已取消")
                    visited += 1
                    if visited > MAX_ENTRIES or time.monotonic() - started >= 3:
                        notices.append("目录发现达到条目或时间预算，未覆盖整个项目。")
                        break
                    path = Path(child.path)
                    if not eligible_name(child.name) or not safe_child(path, root):
                        continue
                    relative = path.relative_to(root).as_posix()
                    if child.is_dir(follow_symlinks=False):
                        entries.append(relative + "/")
                        if depth + 1 < MAX_DEPTH:
                            queue.append((path, depth + 1))
                        else:
                            notices.append("目录层级超过 12 层，深层内容未读取。")
                    elif child.is_file(follow_symlinks=False):
                        entries.append(relative)
                        files.append(path)
        except OSError:
            # 单目录无权限时保留其他可读目录，明确声明发现不完整。
            notices.append("部分目录无法访问，目录发现不完整。")
    if queue:
        notices.append("目录发现达到条目或时间预算，未覆盖整个项目。")
    return sorted(entries), files, list(dict.fromkeys(notices))


# 源码按文本读取；PDF／DOCX 复用既有定位解析，不从扩展名推断程序执行能力。
def read_blocks(path: Path, query: str) -> list[dict]:
    if path.suffix.lower() in {".pdf", ".docx"}:
        document = parse_document(path)
        return [{**block, "warnings": document["warnings"]} for block in document["blocks"]]
    with path.open("rb") as source:
        raw = source.read(MAX_READ_BYTES + 1)
    if len(raw) > MAX_READ_BYTES:
        raise ValueError("文件超过按需读取预算")
    if b"\x00" in raw:
        raise ValueError("文件包含二进制数据，未作为文本读取")
    try:
        text, warning = raw.decode("utf-8-sig"), ""
    except UnicodeDecodeError:
        text = raw.decode("gb18030")
        warning = "文本按 GB18030 编码读取，请核对。"
    lines, result, position = text.splitlines(), [], 0
    # 每段保留行号；后续按相关性挑选，避免只看文件开头而遗漏实现。
    while position < len(lines):
        start, chunk = position, []
        while position < len(lines) and sum(map(len, chunk)) < 1200:
            chunk.append(lines[position])
            position += 1
        value = "\n".join(chunk)
        offset = max(
            0,
            min(
                (value.casefold().find(t) for t in tokens(query) if t in value.casefold()),
                default=0,
            )
            - 200,
        )
        result.append(
            {
                "text": value[offset : offset + 1600],
                "locator": f"第 {start + 1}–{position} 行（选段）",
                "warnings": [warning] if warning else [],
            }
        )
    return result


# 名称相关性优先，README 和构建入口仅作为结构背景候选，不假装覆盖全部代码。
def file_score(path: Path, root: Path, query: str) -> float:
    name = path.relative_to(root).as_posix()
    overview = path.name.casefold() in {"readme.md", "readme.txt", "cmakelists.txt", "package.json"}
    return relevance(query, name, "") + (0.5 if overview else 0)


# 单次只读取六个候选，每文件大小和总证据字数独立限额；正文不留在登记表。
@traced
def read_selected(
    root: Path, files: list[Path], query: str, stop: Event
) -> tuple[list[dict], list[str]]:
    candidates = [p for p in files if p.suffix.lower() in TEXT_SUFFIXES | {".pdf", ".docx"}]
    candidates.sort(key=lambda p: (-file_score(p, root, query), p.relative_to(root).as_posix()))
    blocks, notices, size = [], [], 0
    for path in candidates[:MAX_READ_FILES]:
        if stop.is_set():
            raise ValueError("项目读取已取消")
        try:
            # 再校验路径，拒绝扫描后变为链接或逃逸的条目。
            if not safe_child(path, root) or path.stat().st_size > MAX_READ_BYTES:
                notices.append("部分候选是链接或超过每文件 2 MiB，未读取。")
                continue
            before = path.stat()
            parts = read_blocks(path, query)
            after = path.stat()
            if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                notices.append("部分文件在读取时发生变化，未采用其片段。")
                continue
            parts.sort(key=lambda b: -relevance(query, path.name, b["text"]))
            for part in parts[:2]:
                text = part["text"][:1600]
                if not text.strip() or size + len(text) > MAX_PROJECT_CHARS - 4000:
                    continue
                relative = path.relative_to(root).as_posix()
                blocks.append({"text": text, "locator": relative + " · " + part["locator"]})
                size += len(text)
                notices.extend(part["warnings"])
        except (OSError, ValueError, UnicodeError):
            # 文件级错误不制造可用证据；日志只记录固定阶段，不记录路径或内容。
            record("project.file_unreadable")
            notices.append("部分候选文件无法解析或访问，未采用其内容。")
    notices.append(
        f"按文件名相关性最多选择 {MAX_READ_FILES} 个文件，本次取得 {len(blocks)} 段正文；未分析整个项目。"
    )
    return blocks, list(dict.fromkeys(notices))


# 绝对路径仅用于本机访问，模型只接收项目标签、相对位置和不可变摘录。
@traced
def read_project(root: Path, reference: dict, query: str, stop: Event, tree_only: bool) -> dict:
    entries, files, notices = discover(root, stop)
    blocks = []
    if not tree_only:
        blocks, reading_notices = read_selected(root, files, query, stop)
        notices.extend(reading_notices)
    tree = "\n".join(entries)
    if len(tree) > 3600:
        notices.append("发送的目录结构仅为前 3600 字符，后续条目未发送。")
    tree = "目录结构（仅表示文件位置，不证明具体实现）：\n" + tree[:3600]
    if not tree_only:
        blocks.append({"text": tree, "locator": "项目目录结构（有界发现）"})
    source = "project:" + reference["id"]
    evidence = [
        {
            **block,
            "id": source
            + ":"
            + hashlib.sha256((block["locator"] + block["text"]).encode()).hexdigest()[:20],
            "source_id": source,
            "name": reference["label"],
            "retained": False,
        }
        for block in blocks
    ]
    notice = " ".join(dict.fromkeys(notices))
    record("project.evidence", entries=len(entries), blocks=len(evidence))
    return {"entries": entries, "evidence": evidence, "notice": notice}
