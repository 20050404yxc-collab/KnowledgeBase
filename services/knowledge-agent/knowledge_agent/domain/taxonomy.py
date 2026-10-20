# 文件：taxonomy.py
# 层：Python domain
# 作用：编码两级分类并保留旧自由主题的原意。
# 说明：仅识别本程序完整编码，旧主题不猜测拆分。
import json

PREFIX = "@kb-taxonomy-v1:"


# 十六进制保留边界且兼容旧身份规范化，不修改数据库结构。
def encode_path(category: str, subcategory: str) -> str:
    return PREFIX + json.dumps([category, subcategory], ensure_ascii=False).encode().hex()


# 解码失败保持旧文本，不能因一个分隔符将用户主题重新归类。
def classification(theme: str) -> dict:
    if theme.startswith(PREFIX):
        try:
            parts = json.loads(bytes.fromhex(theme[len(PREFIX) :]).decode())
            if (
                isinstance(parts, list)
                and len(parts) == 2
                and all(isinstance(p, str) and p.strip() for p in parts)
            ):
                return {"theme": "／".join(parts), "category": parts[0], "subcategory": parts[1]}
        except (ValueError, UnicodeError):
            pass
    return {"theme": theme}
