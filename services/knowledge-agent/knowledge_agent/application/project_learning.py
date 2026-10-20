# 文件：project_learning.py
# 层：Python application
# 作用：管理单知识点项目资料核对和显式公开示例授权。
# 说明：授权仅保存在目录会话，撤销和过期阻止晚到结果及提交。
import json
import uuid

from knowledge_agent.domain.topic_rules import json_object, short_field

from .ports import Emit, Generator, PublicProjectReader
from .questions import select_evidence


# 用户界面只接收可见状态，内部材料对象和许可标记不透传。
def project_result(point: dict, state: dict, message: str) -> dict:
    return {
        "content": message,
        "citations": [],
        "recommendations": [],
        "notice": "未收录。",
        "project": {
            "status": state.get("status", "materials"),
            "revision": state["revision"],
            "message": message,
            "material_request": point["material_request"],
            "search_terms": state.get("terms", point["search_terms"]),
            "candidates": state.get("candidates", []),
        },
    }


class ProjectLearning:
    # 只持有注入的技术能力；项目材料仍归附件用例管理。
    def __init__(self, reader: PublicProjectReader, documents: dict) -> None:
        self.reader = reader
        self.documents = documents

    # 撤销不用等待学习锁；新的版本使旧网络及生成结果失去提交许可。
    def revoke(self, session: dict, point: dict) -> dict:
        state = {"revision": str(uuid.uuid4()), "status": "materials"}
        session["projects"][point["id"]] = state
        session["pending"].pop(point["id"], None)
        return project_result(point, state, "请提供相关项目资料；公开项目授权已撤销。")

    # 返回界面下一步，只有已验证材料或已选公开示例才能进入生成。
    async def prepare(
        self, session: dict, point: dict, params: dict, client: Generator, config: dict, emit: Emit
    ) -> dict | None:
        states = session["projects"]
        state = states.setdefault(
            point["id"], {"revision": point["project_revision"], "status": "materials"}
        )
        action = params.get("action", "learn")
        if action == "materials":
            return await self.materials(session, point, params, client, config, emit)
        if action == "public-search":
            return await self.search(session, point, params)
        if action == "public-select":
            if params.get("revision") != state["revision"] or state["status"] != "candidates":
                raise ValueError("公开候选已过期，请重新授权检索")
            selected = next(
                (c for c in state["candidates"] if c["id"] == params.get("candidate_id")), None
            )
            if not selected:
                raise ValueError("请从本次真实检索结果选择项目")
            state.update({"status": "public-ready", "selected": selected})
            return project_result(
                point, state, "已选择公开示例；点击学习后按此示例解释，不代表你的实际经历。"
            )
        if state["status"] in ("material-ready", "public-ready"):
            self.check(session, point, state)
            return None
        return project_result(
            point, state, point["material_request"] + "。请提供资料并核对，或明确同意检索公开示例。"
        )

    # 材料相关性由独立调用判断，并要求非空的授权证据引用。
    async def materials(
        self, session: dict, point: dict, params: dict, client: Generator, config: dict, emit: Emit
    ) -> dict:
        state = self.reset(session, point)
        ids = params.get("attachment_ids")
        if (
            not isinstance(ids, list)
            or not 1 <= len(ids) <= 20
            or any(not isinstance(i, str) or i not in self.documents for i in ids)
        ):
            raise ValueError("请先加入 1–20 份相关项目附件")
        docs = [self.documents[i] for i in dict.fromkeys(ids)]
        state["documents"] = docs
        blocks = [
            {**b, "source_id": d["id"], "name": d["name"], "retained": d["retained"]}
            for d in docs
            for b in d["blocks"]
        ]
        notices = []
        evidence = select_evidence(blocks, len(blocks), False, notices)
        text = await client.generate(
            config,
            json.dumps({"point": point, "evidence": evidence}, ensure_ascii=False),
            "project-materials",
            emit,
        )
        self.check(session, point, state)
        raw = json_object(text)
        cited, allowed = raw.get("citation_ids"), {b["id"] for b in evidence}
        if (
            type(raw.get("sufficient")) is not bool
            or not isinstance(cited, list)
            or any(not isinstance(i, str) or i not in allowed for i in cited)
        ):
            raise ValueError("项目资料核对无效，未允许解释")
        reason = short_field(raw.get("reason"), "资料核对理由", 500)
        if raw["sufficient"] and cited:
            state.update({"status": "material-ready", "evidence": evidence, "documents": docs})
        return project_result(point, state, reason + " ".join(notices))

    # 显式按钮本身携带本次可编辑检索词与范围确认，不能从文档或模型接受授权。
    async def search(self, session: dict, point: dict, params: dict) -> dict:
        current = session["projects"][point["id"]]
        if params.get("revision") != current["revision"]:
            raise ValueError("公开检索授权已过期，请重新确认本知识点的检索词")
        if params.get("consent") is not True:
            raise ValueError("请明确同意按当前检索词查找公开项目")
        if session["scope"] == "files" and params.get("public_scope") is not True:
            raise ValueError("仅本次文件范围需明确同意增加公开项目来源")
        terms = short_field(params.get("search_terms"), "公开检索词", 120)
        state = self.reset(session, point)
        state["terms"] = terms
        state["candidates"] = await self.reader.search(terms)
        self.check(session, point, state)
        state["status"] = "candidates"
        message = (
            "请选择本次检索得到的公开示例，再点击学习。"
            if state["candidates"]
            else "没有找到可读取的公开 README，可调整检索词后重新授权。"
        )
        return project_result(point, state, message)

    # 更换材料或检索条件先撤销旧许可和预览。
    def reset(self, session: dict, point: dict) -> dict:
        self.revoke(session, point)
        return session["projects"][point["id"]]

    # 每次异步返回及提交前复核状态身份和仍存在的原始材料。
    def check(self, session: dict, point: dict, state: dict) -> None:
        if session["projects"].get(point["id"]) is not state:
            raise ValueError("项目授权已撤销或变更，结果未采用")
        if any(self.documents.get(d["id"]) is not d for d in state.get("documents", [])):
            self.revoke(session, point)
            raise ValueError("项目资料已移除，请重新核对")

    # 选中的公开项目成为独立可追溯证据，不能混入用户项目资料冒充经历。
    def context(self, session: dict, point: dict) -> tuple[dict, dict | None]:
        state = session["projects"].get(point["id"])
        if not state:
            raise ValueError("缺少项目许可")
        self.check(session, point, state)
        if state["status"] == "material-ready":
            return {**session, "evidence": state["evidence"]}, state
        if state["status"] != "public-ready":
            raise ValueError("请先选择公开示例或核对资料")
        c = state["selected"]
        blocks = []
        for start in range(0, len(c["excerpt"]), 4000):
            text = c["excerpt"][start : start + 4000]
            blocks.append(
                {
                    "id": "public-" + str(uuid.uuid4()),
                    "source_id": c["url"],
                    "name": "公开示例 · " + c["name"],
                    "text": text,
                    "retained": False,
                    "locator": f"{c['url']} · {c['locator']} · 第{start + 1}–{start + len(text)}字符 · 检索时间 {c['retrieved_at']}",
                }
            )
        return {**session, "evidence": blocks}, state
