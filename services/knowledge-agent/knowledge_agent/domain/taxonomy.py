# 文件：taxonomy.py
# 层：Python domain
# 作用：编码完整父级路径并保留旧两级分类和自由主题的原意。
# 说明：仅识别本程序完整编码，旧主题不猜测拆分。
import json

PREFIX = "@kb-taxonomy-v1:"
TREE_PREFIX = "@kb-taxonomy-v2:"
# 防止不可信模型输出制造无界递归；不要求业务知识使用固定层数。
MAX_PATH_SEGMENTS = 64


# 显式路径错误不能退回旧字段，否则会悄悄丢掉下级。
def validate_path(value: object) -> list[str]:
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= MAX_PATH_SEGMENTS
        or any(not isinstance(p, str) or not p.strip() or len(p) > 80 for p in value)
    ):
        raise ValueError("分类路径无效：需要 1 至 64 层，每层 1 至 80 字")
    return [p.strip() for p in value]


# 缺少新字段时才适配已有两级调用，完整路径始终是唯一归属依据。
def parent_path(item: dict) -> list[str]:
    if "category_path" in item:
        return validate_path(item["category_path"])
    return validate_path([item.get("category"), item.get("subcategory")])


# 兼容字段只摘要前两级；业务逻辑必须读取完整数组。
def path_fields(item: dict) -> dict:
    path = parent_path(item)
    return {
        "category_path": path,
        "category": path[0],
        "subcategory": path[1] if len(path) > 1 else "",
    }


# 十六进制保留边界且兼容旧身份规范化，不修改数据库结构。
def encode_path(category: str | list[str], subcategory: str | None = None) -> str:
    parts = validate_path(category if isinstance(category, list) else [category, subcategory])
    prefix = PREFIX if len(parts) == 2 else TREE_PREFIX
    return prefix + json.dumps(parts, ensure_ascii=False).encode().hex()


# 解码失败保持旧文本，不能因一个分隔符将用户主题重新归类。
def classification(theme: str) -> dict:
    prefix = next((p for p in (PREFIX, TREE_PREFIX) if theme.startswith(p)), None)
    if prefix:
        try:
            parts = json.loads(bytes.fromhex(theme[len(prefix) :]).decode())
            fields = path_fields({"category_path": parts})
            if prefix == TREE_PREFIX or len(parts) == 2:
                return {"theme": "／".join(fields["category_path"]), **fields}
        except (ValueError, UnicodeError):
            pass
    return {"theme": theme}
