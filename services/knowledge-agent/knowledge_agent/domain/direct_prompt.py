# 文件：direct_prompt.py
# 层：Python domain
# 作用：在既定预算内组合直接回答的明确偏好、历史和检索证据。
# 说明：来源均为数据而非指令，不截断当前问题或扩大资料范围。
import json

from .limits import MAX_CONTEXT_CHARS


# 只发送用户明确设置的风格字段，不向外传兴趣统计。
def style_preferences(settings: dict) -> dict:
    return (
        {key: settings[key] for key in ("language", "detail", "examples")}
        if settings["preferences_enabled"]
        else {}
    )


# 证据最多五段，历史最多 4000 字符；总预算不足先减历史再减低排名证据。
def direct_prompt(session: dict, turn: dict, settings: dict) -> tuple[str, str, list[dict]]:
    evidence = []
    for hit in turn["candidates"][:5]:
        citation = hit.get("citation")
        evidence.append(
            {
                "id": hit["id"],
                "source_id": citation["source_id"] if citation else hit["knowledge_id"],
                "name": hit["title"],
                "locator": citation["locator"] if citation else "本地知识摘录",
                "text": hit["excerpt"][:1200],
                "retained": bool(citation and citation.get("retained")),
            }
        )
    payload = {
        "question": turn["question"],
        "quote": session["quote"],
        "history": [],
        "preferences": style_preferences(settings),
        "evidence": evidence,
        "scope": session.get("_scope", "knowledge"),
    }
    prior = session["turns"][: session["turns"].index(turn)]
    history = []
    for item in reversed(prior):
        if item["state"] != "answered":
            continue
        candidate = [{"question": item["question"], "answer": item["content"]}] + history
        if len(json.dumps(candidate, ensure_ascii=False)) > 4000:
            break
        history = candidate
    payload["history"] = history
    while len(json.dumps(payload, ensure_ascii=False)) > MAX_CONTEXT_CHARS:
        if payload["history"]:
            payload["history"].pop(0)
        elif evidence:
            evidence.pop()
        else:
            raise ValueError("本轮问题与背景超过上下文预算，请缩短后重试")
    notice = f"本轮带入 {len(evidence)} 段本地摘录、{len(payload['history'])}/{len(prior)} 轮历史；兴趣统计未发送。"
    return json.dumps(payload, ensure_ascii=False), notice, evidence
