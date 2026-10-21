# 文件：restructure_memory.py
# 层：Python application
# 作用：保留重构会话的意见、目录和可复用正文工作。
# 说明：仅存于当前会话；不写用户配置或正式知识。
from __future__ import annotations

import copy
import hashlib
import json
import uuid

from knowledge_agent.domain.library_rules import inventory_version
from knowledge_agent.domain.topic_rules import short_field

# 全部意见逐字保留；超预算拒绝新意见，不静默遗忘旧要求。
FEEDBACK_MEMORY_CHARS = 6000


# 先验证快照和意见预算，失败时完整保留可查看的旧草案。
def revise_draft(draft: dict, params: dict, items: list[dict]) -> None:
    if draft["status"] not in ("outline", "ready", "paused"):
        raise ValueError("请等待当前阶段收束后再修改结构")
    if inventory_version(items) != draft["snapshot"]:
        raise ValueError("知识库已变化，请取消草案后重新开始；旧草案仍可查看")
    feedback = short_field(params.get("feedback"), "调整意见", 2000)
    history = list(draft["feedback_history"])
    if not history or history[-1] != feedback:
        history.append(feedback)
    if sum(map(len, history)) > FEEDBACK_MEMORY_CHARS:
        raise ValueError("本次重构意见记忆已满，请合并意见后重新开始；已有草案保留")
    remember_preparation(draft)
    # 当前目录保持可读，新目录逐项形成后才整体替换。
    draft.update(
        revision=str(uuid.uuid4()),
        feedback=feedback,
        feedback_history=history,
        previous_outline=copy.deepcopy(draft["outline"]),
        revised_outline=[],
        assignment=None,
        grouping=None,
        approved=None,
        errors=[],
        status="planning",
        phase="classification",
        suggestions=[],
        prepared=0,
        preparation=None,
        targets=[],
        source_map={},
        merges=[],
    )


# 缓存依据目标结构、全部来源快照、意见和生成配置，不能复用过期正文。
def preparation_key(draft: dict, point: dict) -> str:
    sources = [
        item for item in draft["items"] if draft["source_map"].get(item["id"]) == point["id"]
    ]
    data = [point, inventory_version(sources), draft["feedback_history"], draft["config"]]
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# 已成功的独立目标留在会话缓存；确认后仅使用依赖仍相同的稿件。
def remember_preparation(draft: dict) -> None:
    for point in draft["targets"]:
        suggestion = next((s for s in draft["suggestions"] if s["id"] == point["id"]), None)
        if suggestion:
            draft["prepared_cache"][preparation_key(draft, point)] = copy.deepcopy(suggestion)
