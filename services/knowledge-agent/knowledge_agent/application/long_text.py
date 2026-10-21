# 文件：long_text.py
# 层：Python application
# 作用：为现有长知识提供版本绑定的分段读取和原子编辑会话。
# 说明：草稿只归当前后台内存；没有总字符业务上限，退出即释放。
from __future__ import annotations

import uuid

from knowledge_agent.diagnostics import traced

TEXT_PAGE_CHARS = 12000


# 仅在协议边界裁剪长正文；完整数据始终留在仓库和应用内部。
def compact_knowledge(item: dict) -> dict:
    result = dict(item)
    # 短正文保持原契约；长正文提供总字符数，界面须逐段读取而不是当作全文保存。
    if len(item["content"]) > TEXT_PAGE_CHARS:
        result.update(content=item["content"][:TEXT_PAGE_CHARS], content_chars=len(item["content"]))
    result["supplements"] = []
    budget = TEXT_PAGE_CHARS
    for part in item.get("supplements", []):
        value = dict(part)
        # 多条补充共享首屏正文预算，未载入的正文由独立分页入口完整读取。
        if len(value["content"]) > budget:
            value.update(content="", content_chars=len(part["content"]))
        else:
            budget -= len(value["content"])
        result["supplements"].append(value)
    return result


class LongText:
    # 会话所有权与服务一致，不写临时文件，也不允许恢复已退出的草稿。
    def __init__(self, store) -> None:
        self.store = store
        self.edits: dict = {}

    # 所有读取及写入块受限；提交再次校验版本，未完成上传不能保存。
    @traced
    def execute(self, params: dict) -> dict:
        action = params.get("action")
        # 先核验知识版本及补充归属，读取不计使用日，也不改变正式数据。
        if action in ("read", "begin"):
            item = self.store.get(params.get("id", ""))
            if item["version"] != params.get("version"):
                raise ValueError("知识已变化，请重新打开后继续")
            part_id = params.get("supplement_id", "")
            part = next((p for p in item.get("supplements", []) if p["id"] == part_id), None)
            if part_id and not part:
                raise ValueError("补充不存在")
            content = part["content"] if part else item["content"]
            if action == "read":
                page = params.get("page", 0)
                if type(page) is not int or not 0 <= page < max(
                    1, (len(content) + TEXT_PAGE_CHARS - 1) // TEXT_PAGE_CHARS
                ):
                    raise ValueError("正文分页无效")
                return {
                    "content": content[page * TEXT_PAGE_CHARS : (page + 1) * TEXT_PAGE_CHARS],
                    "version": item["version"],
                    "page": page,
                    "pages": max(1, (len(content) + TEXT_PAGE_CHARS - 1) // TEXT_PAGE_CHARS),
                }
            # 开始会话只创建内存暂存，标题与内容在正式事务中再次验证。
            edit_id = str(uuid.uuid4())
            self.edits[edit_id] = {
                "id": item["id"],
                "version": item["version"],
                "supplement_id": part_id,
                "title": params.get("title"),
                "parts": [],
                "chars": 0,
            }
            return {"edit_id": edit_id, "offset": 0}
        edit_id = params.get("edit_id")
        state = self.edits.get(edit_id) if isinstance(edit_id, str) else None
        if not state:
            raise ValueError("编辑会话已失效")
        if action == "discard":
            # 只释放此会话的未提交块，正式知识始终不变。
            del self.edits[edit_id]
            return {"discarded": True}
        if action == "append":
            # 严格顺序拒绝重复或缺块；Unicode 字符数由后台统一计数。
            content, offset = params.get("content"), params.get("offset")
            if (
                not isinstance(content, str)
                or len(content) > TEXT_PAGE_CHARS
                or type(offset) is not int
                or offset != state["chars"]
            ):
                raise ValueError("编辑分段或顺序无效")
            state["parts"].append(content)
            state["chars"] += len(content)
            return {"edit_id": edit_id, "offset": state["chars"]}
        if (
            action != "commit"
            or type(params.get("chars")) is not int
            or params["chars"] != state["chars"]
        ):
            raise ValueError("正文尚未完整上传")
        # 总数一致才完整组装；仓库事务失败时保留草稿供重试或丢弃。
        content = "".join(state["parts"])
        self.store.save_long_text({**state, "content": content})
        del self.edits[edit_id]
        return {"saved": True, "id": state["id"]}
