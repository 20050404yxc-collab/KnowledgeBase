# 文件：selection_rules.py
# 层：Python domain
# 作用：定义选区问答限额、确定性检索词及可独立阅读的保存正文。
# 说明：不做外部 I/O；选区是背景，不能冒充结论证据。
import json
import re
from html import unescape

from .knowledge_rules import tokens
from .limits import MAX_CONTEXT_CHARS, MAX_QUERY_CHARS

MAX_SELECTION_CHARS = 6000
MAX_SELECTION_SESSIONS = 8
MAX_SELECTION_TURNS = 24
MAX_SELECTION_ANSWER_CHARS = 24000
MAX_SELECTION_SESSION_BYTES = 750000
SELECTION_PAGE_SIZE = 10
QUESTION_FILLERS = re.compile(
    r"为什么|怎么|如何|请问|解释|一下|这个|这些|那个|继续|举个例子|是什么"
)


# 以实际 UTF-8 序列化大小约束会话，不依赖字符到字节的乐观估算。
def selection_budget(session: dict, turn: dict, changes: dict) -> None:
    proposed = {
        **session,
        "turns": [({**item, **changes} if item is turn else item) for item in session["turns"]],
    }
    if len(json.dumps(proposed, ensure_ascii=False).encode()) > MAX_SELECTION_SESSION_BYTES:
        raise ValueError("会话内容超过上限，请先保存已有回答并新开会话")


# 只折叠展示格式，保留中文、代码标识和数学运算符。
def normalized_selection(value: str) -> str:
    value = unescape(value)
    value = re.sub(r"!?\[([^\]]*)\]\([^\n)]*\)", r"\1", value)
    value = re.sub(r"(?m)^\s*(?:[-+]|\d+[.)])\s+", "", value)
    value = re.sub(r"引用\s*\d+", "", value)
    return re.sub(r"[\s`*_#>~|\\]+", "", value)


# 参数缺失、空白和超限都显式报错，不截断用户问题或选区。
def selection_text(value: object, limit: int, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label}为空或超过长度限制（{limit} 字符）")
    return value.strip()


# 去掉无主题的问法，避免把“为什么”本身当作知识命中依据。
def question_terms(question: str) -> set[str]:
    return tokens(QUESTION_FILLERS.sub(" ", question)) - {"的", "了", "是", "这", "吗", "呢"}


# 本地确定性抽词；每轮加当前选区与最近问题，保持现有 256 检索词边界。
def selection_query(question: str, quote: str, history: list[dict]) -> str:
    primary = sorted(question_terms(question))[:96]
    context = sorted(tokens(quote))[:48]
    previous = sorted(question_terms(history[-1]["question"]))[:32] if history else []
    return " ".join(dict.fromkeys(primary + context + previous)) or quote[:120]


# 同条正文只因选区命中时不作为答案；其余解释确实匹配问题仍可展示。
def selection_match(row: dict, params: dict) -> bool:
    same_note = row["kind"] == "knowledge" and row["knowledge_id"] == params.get("source_id")
    same_supplement = row["kind"] == "supplement" and row["id"] == "supplement:" + params.get(
        "supplement_id", ""
    )
    if not same_note and not same_supplement:
        return True
    body = normalized_selection(row["body"])
    rest = body.replace(normalized_selection(params["quote"]), "")
    return bool(question_terms(params["question"]) & tokens(rest))


# 按完整字符预算带入最近的完整问答；不摘要、不隐瞒遗漏的历史范围。
def selection_prompt(session: dict, turn: dict, candidate: dict | None) -> tuple[str, str]:
    payload = {"quote": session["quote"], "question": turn["question"], "history": []}
    if candidate:
        payload["local_candidate"] = {"title": candidate["title"], "excerpt": candidate["excerpt"]}
    history = session["turns"][: session["turns"].index(turn)]
    included = []
    for item in reversed(history):
        entry = {"question": item["question"], "answer": item["content"]}
        trial = {**payload, "history": [entry] + included}
        if len(json.dumps(trial, ensure_ascii=False)) > MAX_CONTEXT_CHARS:
            break
        included.insert(0, entry)
    payload["history"] = included
    text = json.dumps(payload, ensure_ascii=False)
    if len(text) > MAX_CONTEXT_CHARS:
        raise ValueError("本轮问题与选区超过上下文预算，请缩小选区或问题")
    notice = f"本轮包含最近 {len(included)}/{len(history)} 轮历史；未发送其他正文或附件。"
    return text, notice


# 保存的是自足问答；模型来源作为背景文字，不伪造外部文献。
def selection_body(session: dict, turn: dict) -> str:
    quote = "\n".join("> " + line for line in session["quote"].splitlines())
    history = "\n\n".join(
        f"前文问题：{item['question']}\n\n前文回答：{item['answer']}"
        for item in turn.get("_context", [])
    )
    return (
        f"## 问题\n\n{turn['question']}\n\n## 阅读背景\n\n{quote}\n\n"
        f"来源：{session['source_title']} · {session['locator']}\n\n"
        + (f"## 必要前文\n\n{history}\n\n" if history else "")
        + f"## 回答\n\n{turn['content']}\n\n"
        f"模型解释：{turn['provider_name']} · {turn['model']}。阅读背景不代表结论已核实。"
    )


# 问题限额沿用原目录入口，避免不同提问路径漂移。
def selection_question(value: object) -> str:
    return selection_text(value, MAX_QUERY_CHARS, "问题")
