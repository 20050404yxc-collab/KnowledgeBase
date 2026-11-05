# 文件：project_references.py
# 层：Python domain
# 作用：定义项目目录引用的限额和确定性标签匹配。
# 说明：不访问文件；标签匹配歧义时不自动选项目。
import re

# 限额约束单次目录发现和按需读取，不表示整个项目已被分析。
MAX_PROJECTS = 100
MAX_ENTRIES = 2000
MAX_DEPTH = 12
MAX_READ_FILES = 6
MAX_READ_BYTES = 2 * 1024 * 1024
MAX_PROJECT_CHARS = 16000
SKIP_NAMES = {
    ".git",
    ".svn",
    ".hg",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
    "out",
    "target",
    "bin",
    "obj",
    ".next",
    ".idea",
    ".vscode",
}
TEXT_SUFFIXES = {
    ".md",
    ".txt",
    ".py",
    ".cpp",
    ".cc",
    ".c",
    ".cxx",
    ".h",
    ".hpp",
    ".hxx",
    ".pro",
    ".pri",
    ".qml",
    ".qrc",
    ".ui",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".css",
    ".html",
    ".vue",
    ".rs",
    ".go",
    ".java",
    ".cs",
    ".swift",
    ".cmake",
    ".toml",
    ".yaml",
    ".yml",
    ".xml",
    ".sql",
    ".sh",
    ".ps1",
}


# 敏感配置、依赖锁和构建产物不进入目录上下文或按需读取候选。
def eligible_name(name: str) -> bool:
    value = name.casefold()
    return not (
        value in SKIP_NAMES
        or value.startswith((".env", "id_rsa", "id_ed25519"))
        or any(part in value for part in ("secret", "credential", "password"))
        or value.endswith((".pem", ".key", ".pfx", ".p12", ".lock"))
        or value in {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
    )


# 英文短标签按词边界匹配，避免 app 自动命中 happy；中文标签按完整名称匹配。
def has_label(label: str, text: str) -> bool:
    pattern = re.escape(label.casefold())
    if re.fullmatch(r"[a-z0-9 _.-]+", label.casefold()):
        pattern = rf"(?<![a-z0-9_]){pattern}(?![a-z0-9_])"
    return re.search(pattern, text.casefold()) is not None


# 只接受唯一标签命中；分类路径仅可在问题未指向其他标签时复用显式绑定。
def match_reference(rows: list[dict], query: str, path: list[str] | None = None) -> dict | None:
    matches = [row for row in rows if has_label(row["label"], query)]
    if len(matches) == 1:
        return matches[0]
    if matches:
        return None
    bound = [row for row in rows if path and row["category_path"] == path]
    return bound[0] if len(bound) == 1 else None
