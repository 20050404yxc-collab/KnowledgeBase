# 文件：check_standards.py
# 层：维护验证
# 作用：检查 Python 文件头、函数规模和层依赖方向。
# 说明：静态检查补充评审，不证明所有语义和注释均正确。
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "services/knowledge-agent/knowledge_agent"
HEADER_LABELS = ("文件：", "层：", "作用：", "说明：")
MAX_FUNCTION_LINES = 80
FORBIDDEN_DOMAIN = {"sqlite3", "httpx", "keyring", "subprocess", "shutil", "tempfile"}


# 报错包含实际相对路径与行号，方便直接定位偏差。
def issue(path: Path, line: int, message: str) -> str:
    return f"{path.relative_to(ROOT)}:{line}: {message}"


# 同时检查声明和其内部实现，空行与纯注释不计入规模。
def check_functions(path: Path, tree: ast.AST, lines: list[str]) -> list[str]:
    errors = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        count = sum(
            bool(line.strip()) and not line.lstrip().startswith("#")
            for line in lines[node.lineno - 1 : node.end_lineno]
        )
        if count > MAX_FUNCTION_LINES:
            errors.append(issue(path, node.lineno, f"{node.name} 超过 80 行：{count}"))
        declaration = min([node.lineno] + [value.lineno for value in node.decorator_list])
        if declaration < 2 or not lines[declaration - 2].lstrip().startswith("#"):
            errors.append(issue(path, declaration, f"{node.name} 缺少接口说明"))
        if PACKAGE in path.parents and node.returns is None:
            errors.append(issue(path, declaration, f"{node.name} 缺少返回类型"))
        if ast.get_docstring(node) is not None:
            errors.append(issue(path, declaration, "普通函数注释应使用 #"))
    return errors


# 四层约束按源码导入检查，避免空目录制造已经分层的假象。
def check_dependencies(path: Path, tree: ast.AST, source: str) -> list[str]:
    if PACKAGE not in path.parents:
        return []
    layer = path.relative_to(PACKAGE).parts[0]
    errors = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules = [name.name for name in node.names]
        elif isinstance(node, ast.ImportFrom):
            modules = [node.module or ""]
        else:
            continue
        for module in modules:
            parts = set(module.split("."))
            forbidden = layer == "domain" and (
                parts & (FORBIDDEN_DOMAIN | {"application", "infrastructure", "entrypoints"})
            )
            forbidden = forbidden or (
                layer in {"application", "entrypoints"} and "infrastructure" in parts
            )
            if forbidden:
                errors.append(issue(path, node.lineno, f"违反层依赖：{module}"))
    if layer in {"application", "entrypoints", "domain"} and re.search(r"\.db\b", source):
        errors.append(issue(path, 1, "业务与入口不得直接访问数据库连接"))
    return errors


# 仅扫描自有 Python，不读取虚拟环境、产物或正式数据。
def main() -> None:
    paths = sorted((ROOT / "services").rglob("*.py"))
    paths += sorted((ROOT / "tests").glob("*.py")) + sorted((ROOT / "scripts").glob("*.py"))
    errors = []
    for path in paths:
        source = path.read_text(encoding="utf-8")
        lines = source.splitlines()
        for index, label in enumerate(HEADER_LABELS):
            if len(lines) <= index or not lines[index].startswith("# " + label):
                errors.append(issue(path, index + 1, "缺少四行文件头"))
        if not re.fullmatch(r"[a-z_][a-z0-9_]*\.py", path.name):
            errors.append(issue(path, 1, "文件名必须使用小写和下划线"))
        tree = ast.parse(source)
        errors.extend(check_functions(path, tree, lines))
        errors.extend(check_dependencies(path, tree, source))
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Python 规范检查通过：{len(paths)} 个文件；函数规模、接口说明、文件头及层依赖。")


if __name__ == "__main__":
    main()
