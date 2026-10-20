"""Read bounded local snapshots. No user original is modified."""
from __future__ import annotations

import hashlib
import re
import zipfile
from pathlib import Path

MAX_BYTES = 50 * 1024 * 1024
MAX_TEXT = 2_000_000
FORMATS = {".md", ".txt", ".docx", ".pdf"}


def validate_path(value: str) -> Path:
    if not isinstance(value, str) or re.match(r"^[a-z][a-z0-9+.-]*://", value, re.IGNORECASE):
        raise ValueError("仅支持本地文件路径，不支持网络 URL")
    path = Path(value.strip().strip('"')).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in FORMATS:
        raise ValueError("请选择 MD、TXT、DOCX 或文字版 PDF；OCR 和旧 DOC 尚未接入")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("测试版单个文件上限为 50MB，请拆分后加入")
    return path


def parse_document(path: Path, name: str | None = None) -> dict:
    import pdfplumber
    from docx import Document

    fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
    blocks, warnings = [], []

    def add(text: str, locator: str):
        text = text.strip()
        if not text:
            return
        for start in range(0, len(text), 1600):
            blocks.append({"id": f"{fingerprint[:16]}-{len(blocks) + 1}", "text": text[start:start + 1600],
                           "locator": locator + (f" · 片段 {start // 1600 + 1}" if len(text) > 1600 else "")})

    suffix = path.suffix.lower()
    if suffix in {".md", ".txt"}:
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = raw.decode("gb18030")
                warnings.append("文件按 GB18030 编码读取，请核对中文内容")
            except UnicodeDecodeError as exc:
                raise ValueError("文本编码无法识别，请转换为 UTF-8") from exc
        heading, lines, start = "", [], 1
        for index, line in enumerate(text.splitlines(), 1):
            if line.startswith("#") and suffix == ".md":
                if lines:
                    add("\n".join(lines), f"{heading + ' · ' if heading else ''}第 {start}–{index - 1} 行")
                heading, lines, start = line.lstrip("# "), [], index
            if not lines:
                start = index
            lines.append(line)
            if sum(len(value) for value in lines) >= 1400 or (not line.strip() and lines):
                add("\n".join(lines), f"{heading + ' · ' if heading else ''}第 {start}–{index} 行")
                lines = []
        if lines:
            add("\n".join(lines), f"{heading + ' · ' if heading else ''}第 {start} 行起")
        warnings.append("MD 按原文文本读取，代码和表格保留文本，未还原图片或复杂版式")
    elif suffix == ".docx":
        with zipfile.ZipFile(path) as archive:
            if sum(info.file_size for info in archive.infolist()) > 100 * 1024 * 1024:
                raise ValueError("DOCX 解压内容过大，请拆分文件")
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        document, heading = Document(path), ""
        for index, item in enumerate(document.iter_inner_content(), 1):
            if isinstance(item, Paragraph):
                if item.style and item.style.name.startswith("Heading"):
                    heading = item.text
                add(item.text, f"{heading + ' · ' if heading else ''}正文块 {index}")
            elif isinstance(item, Table):
                add("\n".join(" | ".join(cell.text for cell in row.cells) for row in item.rows), f"表格 · 正文块 {index}")
        warnings.append("DOCX 使用正文块定位；页眉、页脚、图片、批注和文本框未解析，不提供固定页码")
    elif suffix == ".pdf":
        with pdfplumber.open(path) as document:
            if len(document.pages) > 200:
                raise ValueError("测试版最多读取 200 页 PDF，请先拆分文档")
            for page_number, page in enumerate(document.pages, 1):
                text = page.extract_text() or ""
                if not text.strip():
                    warnings.append(f"第 {page_number} 页无可提取文字，可能是扫描页；本版本未进行 OCR")
                else:
                    add(text, f"第 {page_number} 页")
        warnings.append("PDF 按页面提取文字；复杂分栏和表格顺序请核对，混合页内的图片文字可能遗漏")
    else:
        raise ValueError("不支持该文档格式")
    if sum(len(block["text"]) for block in blocks) > MAX_TEXT:
        raise ValueError("提取文本超过 200 万字，请拆分文件")
    if not blocks:
        raise ValueError("未提取到可用文字；扫描文件需要 OCR，本测试版尚未接入")
    return {"id": fingerprint, "fingerprint": fingerprint, "name": name or path.name,
            "blocks": blocks, "warnings": warnings, "retained": False, "path": str(path)}
