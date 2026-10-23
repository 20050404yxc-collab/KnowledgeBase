# 文件：selection_questions.py
# 层：Python application
# 作用：协调选区会话、本地优先检索、明确的模型回退与完整回答保存。
# 说明：会话只驻留当前进程；通过窄仓库接口访问知识和原子提交。
from __future__ import annotations

import asyncio
import copy
import json
import uuid

from knowledge_agent.diagnostics import record, step, traced
from knowledge_agent.domain.answer_validation import validate_answer
from knowledge_agent.domain.knowledge_rules import validate_note
from knowledge_agent.domain.provider_rules import resolve_generation
from knowledge_agent.domain.selection_rules import (
    MAX_SELECTION_ANSWER_CHARS,
    MAX_SELECTION_CHARS,
    MAX_SELECTION_SESSION_BYTES,
    MAX_SELECTION_SESSIONS,
    MAX_SELECTION_TURNS,
    normalized_selection,
    selection_body,
    selection_budget,
    selection_prompt,
    selection_query,
    selection_question,
    selection_text,
)
from knowledge_agent.domain.taxonomy import encode_path, validate_path

from .generation_context import ATTEMPT_OBSERVER
from .ports import Emit, Generator, Repository


# 会话内部字段不跨进程；每次返回副本，防止界面改写后台完整回答或出处。
def session_view(session: dict, store: Repository) -> dict:
    attempts = {item["id"]: item for item in store.list_attempts()}
    fields = (
        "id",
        "question",
        "state",
        "candidates",
        "total",
        "page",
        "content",
        "title",
        "citations",
        "model",
        "provider_name",
        "notice",
        "saved_id",
    )
    turns = []
    for turn in session["turns"]:
        item = {key: turn[key] for key in fields}
        item["attempts"] = [attempts[key] for key in turn["_attempts"] if key in attempts]
        turns.append(item)
    return copy.deepcopy(
        {
            **{
                key: session[key]
                for key in (
                    "id",
                    "source",
                    "source_title",
                    "locator",
                    "quote",
                    "category_path",
                    "notice",
                )
            },
            "turns": turns,
        }
    )


# 来源须存在并与当前版本相同；展示选区只能取自已读取的正文或资料块。
def selection_source(store: Repository, source: object, quote: str) -> dict:
    if not isinstance(source, dict) or not isinstance(source.get("id"), str):
        raise ValueError("选区来源无效，请重新选择文字")
    if any(
        key in source and not isinstance(source[key], str)
        for key in ("version", "supplement_id", "block_id")
    ):
        raise ValueError("选区来源参数类型无效")
    if "page" in source and (type(source["page"]) is not int or source["page"] < 0):
        raise ValueError("选区来源页码无效")
    kind = source.get("kind")
    if kind in ("knowledge", "supplement"):
        item = store.get(source["id"])
        if source.get("version") != item["version"]:
            raise ValueError("选区来源已变化，请重新打开并选择文字")
        content = item["content"]
        title = item["title"]
        if kind == "supplement":
            found = next(
                (s for s in item["supplements"] if s["id"] == source.get("supplement_id")), None
            )
            if found is None:
                raise ValueError("选区补充已删除，请重新选择文字")
            content, title = found["content"], found["title"]
        path = item.get("category_path", [])
        locator = "知识正文" if kind == "knowledge" else "独立补充"
    elif kind == "source":
        page = source.get("page")
        if type(page) is not int or page < 0:
            raise ValueError("选区资料页码无效")
        result = store.read_source({"id": source["id"], "page": page})
        found = next((i for i in result["items"] if i["id"] == source.get("block_id")), None)
        if found is None:
            raise ValueError("选区资料块不存在，请重新选择文字")
        content, title, locator, path = found["text"], result["name"], found["locator"], []
    else:
        raise ValueError("选区来源类型无效")
    if not normalized_selection(quote) or normalized_selection(quote) not in normalized_selection(
        content
    ):
        raise ValueError("选区与来源不一致，请仅选择同一段正文中的文字")
    return {"source_title": title, "locator": locator, "category_path": path}


class SelectionQuestions:
    # 运行期所有权在本用例，关闭和恢复都会清空；无后台淘汰或隐式持久化。
    def __init__(self, store: Repository, client: Generator) -> None:
        self.store = store
        self.client = client
        self.sessions: dict[str, dict] = {}
        self.generating = False

    # 入口只返回对应会话，未知标识不得建立隐式会话或恢复旧上下文。
    def require(self, params: dict) -> dict:
        session_id = params.get("session_id")
        if not isinstance(session_id, str) or session_id not in self.sessions:
            raise ValueError("问答会话已结束，请重新选择文字")
        return self.sessions[session_id]

    # 新建前验证实际来源和内存上限，不静默淘汰未保存会话。
    @traced
    def open(self, params: dict) -> dict:
        if len(self.sessions) >= MAX_SELECTION_SESSIONS:
            raise ValueError("问答会话已达 8 个，请先关闭不需要的会话；已有内容保留")
        quote = selection_text(params.get("quote"), MAX_SELECTION_CHARS, "选区")
        metadata = selection_source(self.store, params.get("source"), quote)
        source = {
            k: v
            for k, v in params["source"].items()
            if k in ("kind", "id", "version", "supplement_id", "page", "block_id")
        }
        session = {
            **metadata,
            "id": str(uuid.uuid4()),
            "source": source,
            "quote": quote,
            "turns": [],
            "notice": "会话仅暂存；切页可继续，重启前请保存需要的回答。",
        }
        self.sessions[session["id"]] = session
        return session_view(session, self.store)

    # 关闭使在途回调失去会话所有权；调用者同时取消其实际模型请求。
    @traced
    def close(self, params: dict) -> dict:
        session = self.require(params)
        self.sessions.pop(session["id"])
        return {"closed": True}

    # 显式刷新用于取消后取回真实终态，不额外调用模型或改变知识使用次数。
    def get(self, params: dict) -> dict:
        return session_view(self.require(params), self.store)

    # 单个生成任务和会话上限都在后台复核，重复发送只返回既有轮次。
    @traced
    async def ask(self, params: dict, emit: Emit) -> dict:
        session = self.require(params)
        action = params.get("action")
        turn_id = selection_text(params.get("turn_id"), 80, "问题标识")
        turn = next((t for t in session["turns"] if t["id"] == turn_id), None)
        if self.generating:
            raise ValueError("已有选区回答正在生成，请等待或取消后再试")
        if action == "lookup" and (turn is None or turn["state"] == "lookup-failed"):
            if turn is None:
                turn = self.new_turn(session, turn_id, params.get("question"))
            self.lookup(session, turn, 0)
            if turn["state"] == "local":
                return session_view(session, self.store)
            await self.generate(session, turn, params, emit)
        elif turn is None:
            raise ValueError("问题不存在，请先发送问题进行本地检索")
        elif action == "generate":
            await self.generate(session, turn, params, emit)
        elif action == "page":
            page = params.get("page")
            if type(page) is not int or not 0 <= page <= 100000:
                raise ValueError("无效分页位置")
            self.lookup(session, turn, page, preserve_state=True)
        elif action != "lookup":
            raise ValueError("无效选区问答动作")
        return session_view(session, self.store)

    # 持有完整轮次直至用户关闭，超限时保留已有草稿与结果。
    def new_turn(self, session: dict, turn_id: str, question: object) -> dict:
        if len(session["turns"]) >= MAX_SELECTION_TURNS:
            raise ValueError("会话已达 24 轮，请先保存回答并新开会话")
        if (
            len(json.dumps(session, ensure_ascii=False).encode())
            > MAX_SELECTION_SESSION_BYTES - 240000
        ):
            raise ValueError("会话内容接近上限，请先保存回答并新开会话")
        question = selection_question(question)
        turn = {
            "id": turn_id,
            "question": question,
            "state": "unconfigured",
            "candidates": [],
            "total": 0,
            "page": 0,
            "content": "",
            "title": "",
            "citations": [],
            "model": "",
            "provider_name": "",
            "notice": "",
            "saved_id": None,
            "_attempts": [],
            "_working": False,
            "_context": [],
            "_candidate_pages": {},
        }
        turn["_query"] = selection_query(question, session["quote"], session["turns"])
        session["turns"].append(turn)
        return turn

    # 搜索成功与失败有不同结果；失败异常不经过自动模型回退。
    def lookup(self, session: dict, turn: dict, page: int, *, preserve_state: bool = False) -> None:
        try:
            with step("selection.lookup"):
                result = self.store.selection_search(
                    {
                        "query": turn["_query"],
                        "question": turn["question"],
                        "quote": session["quote"],
                        "supplement_id": session["source"].get("supplement_id", ""),
                        "source_id": session["source"]["id"]
                        if session["source"]["kind"] != "source"
                        else "",
                        "page": page,
                    }
                )
        except Exception:
            if not preserve_state:
                turn["state"] = "lookup-failed"
            turn["notice"] = "本地检索失败，未调用模型；可重新检索或明确询问模型。"
            raise
        candidates = {item["id"]: item for item in result["items"]}
        selection_budget(
            session, turn, {"candidates": result["items"], "_candidate_pages": candidates}
        )
        turn.update(candidates=result["items"], total=result["total"], page=page)
        # 只保存显示过的有界候选；翻页不会累计完整全库结果。
        turn["_candidate_pages"] = candidates
        if not preserve_state:
            turn["state"] = "local" if result["total"] else "unconfigured"
            turn["notice"] = (
                "本地相关内容，未调用模型；关键词相关不代表已经解答。"
                if result["total"]
                else "未找到相关结果。"
            )

    # 显式选中的候选只能来自本轮已显示摘录，不暗中读取或发送全文。
    def candidate(self, turn: dict, params: dict) -> dict | None:
        candidate_id = params.get("candidate_id")
        if candidate_id is None:
            return None
        if not isinstance(candidate_id, str) or candidate_id not in turn["_candidate_pages"]:
            raise ValueError("候选已变化，请重新选择显示中的相关内容")
        return turn["_candidate_pages"][candidate_id]

    # 只完整成功后写入会话；失败／取消保留问题并按实际尝试记账。
    async def generate(self, session: dict, turn: dict, params: dict, emit: Emit) -> None:
        if turn["state"] == "answered" or turn["_working"]:
            return
        config = self.store.provider(params.get("provider_id"))
        if not config:
            turn["state"] = "unconfigured"
            turn["notice"] = "尚未配置可用模型，未调用接口；问题已保留。"
            return
        config = resolve_generation(config, params)
        candidate = self.candidate(turn, params)
        prompt, coverage = selection_prompt(session, turn, candidate)
        self.generating = turn["_working"] = True
        token = ATTEMPT_OBSERVER.set(turn["_attempts"].append)
        turn.update(model=config["model"], provider_name=config["name"])
        try:
            emit({"type": "progress", "message": "正在直接回答选区问题；完整回复后可确认入库"})
            with step("selection.generate"):
                text = await self.client.generate(config, prompt, "selection-answer", emit)
                result = validate_answer(text, [], False)
                if len(result["content"]) > MAX_SELECTION_ANSWER_CHARS:
                    raise ValueError("选区回答超过 24000 字符，请缩小问题后重试")
            if self.sessions.get(session["id"]) is not session:
                raise ValueError("会话已关闭，未保存回答")
            history = json.loads(prompt)["history"]
            selection_budget(
                session,
                turn,
                {"content": result["content"], "title": result["title"], "_context": history},
            )
            turn.update(
                state="answered",
                content=result["content"],
                title=result["title"],
                citations=result["citations"],
                notice="模型解释，尚未入库。" + coverage,
            )
            turn["_context"] = history
            record("selection.answered", chars=len(turn["content"]))
        except asyncio.CancelledError:
            turn.update(
                state="cancelled", notice="本轮已取消，残缺回答不能保存；实际调用可能产生费用。"
            )
            raise
        except Exception:
            turn.update(state="failed", notice="本轮生成失败，未保存残缺回答；可明确重试。")
            raise
        finally:
            ATTEMPT_OBSERVER.reset(token)
            self.generating = turn["_working"] = False

    # 保存预览由用户编辑，后台仍固定完整回答身份、有效引用及真实模型出处。
    @traced
    def capture(self, params: dict) -> dict:
        session = self.require(params)
        turn = next((t for t in session["turns"] if t["id"] == params.get("turn_id")), None)
        if turn is None or turn["state"] != "answered" or turn["_working"]:
            raise ValueError("只有完整成功的回答可以保存")
        title, content, _ = validate_note(params.get("title", ""), params.get("content", ""))
        path = params.get("category_path")
        if path != []:
            path = validate_path(path)
        target = params.get("target_id", "")
        version = params.get("version", "")
        if not isinstance(target, str) or not isinstance(version, str):
            raise ValueError("补充目标或版本无效")
        if target and not version:
            raise ValueError("追加补充需要当前知识版本，请重新选择目标")
        draft = {
            "title": title,
            "content": content,
            "theme": encode_path(path) if path else "未分类",
            "target_id": target,
            "version": version,
            "citations": turn["citations"],
            "model": turn["model"],
            "provider_name": turn["provider_name"],
            "capture_key": "selection:" + session["id"] + ":" + turn["id"],
        }
        with step("selection.capture"):
            item = self.store.capture_topic(draft)
        turn["saved_id"] = item["id"]
        turn["notice"] = (
            "已追加为补充，原笔记保留。" if target else "已保存为知识，可供后续本地检索。"
        )
        return session_view(session, self.store)

    # 默认预览在本地构造，不调用模型；包含必要历史，保留依赖前文的指代。
    def preview(self, params: dict) -> dict:
        session = self.require(params)
        turn = next((t for t in session["turns"] if t["id"] == params.get("turn_id")), None)
        if turn is None or turn["state"] != "answered":
            raise ValueError("只有完整成功的回答可以预览")
        return {"title": turn["title"], "content": selection_body(session, turn)}
