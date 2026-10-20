# 文件：document_parser.py
# 层：Python infrastructure
# 作用：对有界本地副本提取文本、位置和解析警告。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import hashlib
import re
import zipfile
from pathlib import Path
from typing import Callable

import pdfplumber
from docx import Document as WordDocument
from docx.table import Table
from docx.text.paragraph import Paragraph

from knowledge_agent.domain.models import Document

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000
FORMATS = {".md", ".txt", ".docx", ".pdf"}


# 只接受受支持的有界本地文件，不访问网络 URL。
def validate_path(value: str) -> Path:
    # 先拒绝 URL，再解析本地真实路径；格式和文件大小失败均不开始复制解析。
    if not isinstance(value, str) or re.match(r"^[a-z][a-z0-9+.-]*://", value, re.IGNORECASE):
        raise ValueError("仅支持本地文件路径，不支持网络 URL")
    path = Path(value.strip().strip('"')).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in FORMATS:
        raise ValueError("请选择 MD、TXT、DOCX 或文字版 PDF；OCR 和旧 DOC 尚未接入")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("测试版单个文件上限为 50MB，请拆分后加入")
    return path


# 保留 Markdown 原文和中文行位置，编码降级时返回警告。
def parse_text(path: Path, add: Callable[[str, str], None], warnings: list[str]) -> None:
    suffix = path.suffix.lower()
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        # 兼容已有中文文本编码，回退成功也提醒用户核对，不静默替换字符。
        try:
            text = raw.decode("gb18030")
            warnings.append("文件按 GB18030 编码读取，请核对中文内容")
        except UnicodeDecodeError as exc:
            raise ValueError("文本编码无法识别，请转换为 UTF-8") from exc
    heading, lines, start = "", [], 1
    # 标题切换先结算前段，空行或段长达到预算时也结算并保留原行号。
    for index, line in enumerate(text.splitlines(), 1):
        if line.startswith("#") and suffix == ".md":
            if lines:
                add(
                    "\n".join(lines),
                    f"{heading + ' · ' if heading else ''}第 {start}–{index - 1} 行",
                )
            heading, lines, start = line.lstrip("# "), [], index
        if not lines:
            start = index
        lines.append(line)
        if sum(len(value) for value in lines) >= 1400 or (not line.strip() and lines):
            add("\n".join(lines), f"{heading + ' · ' if heading else ''}第 {start}–{index} 行")
            lines = []
    if lines:
        # 最后一个未遇到分隔符的段落也必须提交，避免尾部内容遗漏。
        add("\n".join(lines), f"{heading + ' · ' if heading else ''}第 {start} 行起")
    warnings.append("MD 按原文文本读取，代码和表格保留文本，未还原图片或复杂版式")


# 依正文块顺序读取段落和表格，不承诺固定页码。
def parse_docx(path: Path, add: Callable[[str, str], None], warnings: list[str]) -> None:
    # 压缩文件大小不足以限制解压资源，先检查条目总大小再交给解析器。
    with zipfile.ZipFile(path) as archive:
        if sum(info.file_size for info in archive.infolist()) > 100 * 1024 * 1024:
            raise ValueError("DOCX 解压内容过大，请拆分文件")
    document, heading = WordDocument(path), ""
    # 按正文顺序区分段落和表格，标题更新定位上下文，不能伪造固定页码。
    for index, item in enumerate(document.iter_inner_content(), 1):
        if isinstance(item, Paragraph):
            if item.style and item.style.name.startswith("Heading"):
                heading = item.text
            add(item.text, f"{heading + ' · ' if heading else ''}正文块 {index}")
        elif isinstance(item, Table):
            add(
                "\n".join(" | ".join(cell.text for cell in row.cells) for row in item.rows),
                f"表格 · 正文块 {index}",
            )
    warnings.append("DOCX 使用正文块定位；页眉、页脚、图片、批注和文本框未解析，不提供固定页码")


# 逐页提取有界 PDF 文本，空扫描页只报告遗漏而不执行 OCR。
def parse_pdf(path: Path, add: Callable[[str, str], None], warnings: list[str]) -> None:
    with pdfplumber.open(path) as document:
        # 页数超限拒绝整个文件，不能将已读取部分宣称为全文。
        if len(document.pages) > 200:
            raise ValueError("测试版最多读取 200 页 PDF，请先拆分文档")
        for page_number, page in enumerate(document.pages, 1):
            text = page.extract_text() or ""
            # 无文字页仅记解析警告，其他页仍可提取，但未执行 OCR。
            if not text.strip():
                warnings.append(f"第 {page_number} 页无可提取文字，可能是扫描页；本版本未进行 OCR")
            else:
                add(text, f"第 {page_number} 页")
    warnings.append("PDF 按页面提取文字；复杂分栏和表格顺序请核对，混合页内的图片文字可能遗漏")


# 按真实后缀解析副本，返回稳定指纹、文本块、定位和局限。
def parse_document(path: Path, name: str | None = None) -> Document:
    fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
    blocks, warnings = [], []

    # 将非空文本切成有界片段，片段标识由指纹与顺序组成。
    def add(text: str, locator: str) -> None:
        text = text.strip()
        # 空块不产生引用标识；非空块保留相同来源位置并按长度切片。
        if not text:
            return
        for start in range(0, len(text), 1600):
            blocks.append(
                {
                    "id": f"{fingerprint[:16]}-{len(blocks) + 1}",
                    "text": text[start : start + 1600],
                    "locator": locator
                    + (f" · 片段 {start // 1600 + 1}" if len(text) > 1600 else ""),
                }
            )

    suffix = path.suffix.lower()
    # 按已校验后缀选择解析器；不支持的格式没有隐式降级。
    if suffix in {".md", ".txt"}:
        parse_text(path, add, warnings)
    elif suffix == ".docx":
        parse_docx(path, add, warnings)
    elif suffix == ".pdf":
        parse_pdf(path, add, warnings)
    else:
        raise ValueError("不支持该文档格式")
    # 总文本和空结果必须明确拒绝，不能给界面一个貌似可用的附件。
    if sum(len(block["text"]) for block in blocks) > MAX_TEXT_CHARS:
        raise ValueError("提取文本超过 200 万字，请拆分文件")
    if not blocks:
        raise ValueError("未提取到可用文字；扫描文件需要 OCR，本测试版尚未接入")
    return {
        "id": fingerprint,
        "fingerprint": fingerprint,
        "name": name or path.name,
        "blocks": blocks,
        "warnings": warnings,
        "retained": False,
        "path": str(path),
    }
