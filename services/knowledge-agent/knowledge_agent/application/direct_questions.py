# 文件：direct_questions.py
# 层：Python application
# 作用：为普通问题和选区问题提供有界、范围受限的混合检索。
# 说明：复用现有运行期会话与确认保存，词法失败不自动生成。
import uuid

from knowledge_agent.domain.memory_rules import question_kind, question_topic
from knowledge_agent.domain.selection_rules import MAX_SELECTION_SESSIONS, selection_query

from .ports import Repository
from .questions import validate_question
from .semantic_retrieval import SemanticRetrieval
from .topic_context import file_hits, require_attachments


# 普通提问无需伪造已保存选区来源，范围与附件在创建时冻结。
def open_question(sessions: dict, params: dict, documents: dict) -> dict:
    if len(sessions) >= MAX_SELECTION_SESSIONS:
        raise ValueError("问答会话已达 8 个，请先关闭不需要的会话")
    query, scope, ids = validate_question(params)
    require_attachments(documents, {"attachment_ids": ids})
    if scope == "files" and not ids:
        raise ValueError("仅本次文件范围需要先加入附件")
    session = {
        "id": str(uuid.uuid4()),
        "source": {"kind": "question", "id": ""},
        "source_title": "直接问答",
        "locator": "本次问题",
        "category_path": [],
        "quote": "",
        "turns": [],
        "notice": "会话仅暂存；直接回答会请求所选模型，满意后可预览入库。",
        "_scope": scope,
        "_attachment_ids": ids,
        "_initial_query": query,
    }
    sessions[session["id"]] = session
    return session


# 附件使用现有本次授权资料，files 范围绝不混入知识或阅读兴趣。
async def direct_lookup(
    store: Repository, retrieval: SemanticRetrieval, documents: dict, session: dict, turn: dict
) -> dict:
    scope = session.get("_scope", "knowledge")
    ids = session.get("_attachment_ids", [])
    require_attachments(documents, {"attachment_ids": ids})
    query = selection_query(turn["question"], session["quote"], session["turns"][:-1])
    result = {"items": [], "notice": "仅本次文件；未检索知识库。"}
    if scope != "files":
        selection = None
        if session["source"]["kind"] != "question":
            selection = {
                "query": query,
                "question": turn["question"],
                "quote": session["quote"],
                "source_id": session["source"]["id"]
                if session["source"]["kind"] != "source"
                else "",
                "supplement_id": session["source"].get("supplement_id", ""),
                "page": 0,
            }
        result = await retrieval.search(turn["question"] + " " + session["quote"][:120], selection)
    hits = file_hits(documents, ids, query)[:5] if scope != "knowledge" else []
    hits += result["items"][:30]
    # 原始问题只在会话中；统计只存可靠主题、题型和幂等轮标识。
    if scope != "files":
        store.remember_question(
            session["id"] + ":" + turn["id"], question_topic(hits), question_kind(turn["question"])
        )
    return {"items": hits[:5], "total": min(5, len(hits)), "page": 0, "notice": result["notice"]}
