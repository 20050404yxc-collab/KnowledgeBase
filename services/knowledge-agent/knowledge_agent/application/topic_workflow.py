# 文件：topic_workflow.py
# 层：Python application
# 作用：编排本地结果、知识目录、单点学习和经核对的补充。
# 说明：会话有界且只保存授权证据，提交前检查取消及目标版本。
import asyncio
import json
import uuid
from collections import OrderedDict

from knowledge_agent.domain.answer_validation import validate_answer
from knowledge_agent.domain.provider_rules import resolve_generation
from knowledge_agent.domain.taxonomy import encode_path
from knowledge_agent.domain.topic_review import review_points
from knowledge_agent.domain.topic_rules import (
    MAX_SESSIONS,
    json_object,
    question_points,
    validate_plan,
)

from .ports import Emit, Generator, PublicProjectReader, QuestionRepository
from .project_learning import ProjectLearning
from .question_locks import QuestionLocks
from .questions import Questions, select_evidence, validate_question
from .topic_context import file_hits, learning_context, require_attachments


# 详情统一转换为既有 Answer 格式，待核对内容不能谎报已经收录。
def detail_result(item: dict | None, draft: dict, notice: str, review: bool = False) -> dict:
    return {
        "knowledge": item,
        "content": item["content"] if item else draft["content"],
        "citations": item["citations"] if item else draft["citations"],
        "recommendations": [],
        "notice": notice + draft.get("coverage_notice", ""),
        "review": review,
    }


class TopicWorkflow:
    # 会话与互斥只归本用例所有，应用关闭即释放，不作为正式知识存储。
    def __init__(
        self,
        store: QuestionRepository,
        client: Generator,
        questions: Questions,
        projects: PublicProjectReader,
    ) -> None:
        self.store = store
        self.client = client
        self.questions = questions
        self.sessions: OrderedDict[str, dict] = OrderedDict()
        self.locks = QuestionLocks()
        self.projects = ProjectLearning(projects, questions.documents)

    # 独立搜索默认全库；显式附件范围按本次文件优先、知识库随后稳定分页。
    def search(self, params: dict) -> dict:
        if not isinstance(params.get("query"), str):
            raise ValueError("请输入有效关键词")
        query, scope, ids = validate_question(params)
        page = params.get("page", 0)
        if type(page) is not int or not 0 <= page <= 100000:
            raise ValueError("无效分页位置")
        files = file_hits(self.questions.documents, ids, query) if scope != "knowledge" else []
        start = page * 30
        items = files[start : start + 30]
        local = {"items": [], "total": 0, "notice": "仅本次文件；未检索知识库。"}
        if scope != "files":
            offset = max(0, start - len(files))
            local = self.store.search({**params, "query": query, "page": offset // 30})
            if len(items) < 30:
                rows = local["items"]
                if offset % 30:
                    rows += self.store.search({**params, "query": query, "page": offset // 30 + 1})[
                        "items"
                    ]
                items += rows[offset % 30 : offset % 30 + 30 - len(items)]
        return {
            "items": items,
            "total": len(files) + local["total"],
            "page": page,
            "notice": ("本次文件片段优先；" if scope != "knowledge" else "") + local["notice"],
        }

    # 详情保留有效关联卡片，推荐不足时明确说明，绝不补入无关条目。
    def result(self, item: dict | None, draft: dict, notice: str, review: bool = False) -> dict:
        result = detail_result(item, draft, notice, review)
        if item:
            result["recommendations"] = self.questions.cards.recommend(
                item["title"], item["content"], draft.get("recommendations", []), item["id"]
            )
            if len(result["recommendations"]) < 3:
                result["notice"] += f"仅找到 {len(result['recommendations'])} 条有效关联。"
        return result

    # 分组本地检索在任何模型请求之前完成，文件范围严格不加入库内知识。
    def context(self, params: dict) -> tuple[str, str, list[dict], list[dict], dict, str]:
        query, scope, attachment_ids = validate_question(params)
        search = self.search(params)
        library = self.store.search({"query": query}) if scope != "files" else {"items": []}
        ids = list(
            dict.fromkeys(hit["knowledge_id"] for hit in library["items"] if hit["knowledge_id"])
        )
        local = [self.store.get(item_id) for item_id in ids[:6]]
        evidence, count, summary, notices = self.questions.collect(
            query, scope, attachment_ids, local
        )
        for item in local:
            # 补充也可作为证据，不能只召回原始正文。
            evidence.extend(
                {
                    "id": "supplement-" + s["id"],
                    "source_id": item["id"],
                    "name": item["title"],
                    "locator": "知识补充",
                    "text": s["content"],
                    "retained": False,
                }
                for s in item.get("supplements", [])
            )
        evidence = select_evidence(evidence, count, summary, notices)
        return query, scope, local, evidence, search, " ".join(notices[1:])

    # 固定配置后规划，失败不丢弃本地命中；取消仍传播到协议层。
    async def plan(self, params: dict, emit: Emit) -> dict:
        config = self.store.provider(params.get("provider_id"))
        if params.get("provider_id") and not config:
            raise ValueError("所选接口已删除")
        query, scope, local, evidence, search, coverage = self.context(params)
        response = {
            "plan_id": "",
            "points": [],
            "search": search,
            "notice": "本地检索结果；尚未配置生成接口，未调用模型。" + coverage,
        }
        if not config:
            return response
        config = resolve_generation(config, params)
        taxonomy = self.store.taxonomy_summary(query) if scope != "files" else None
        coverage += (" " + taxonomy["notice"]) if taxonomy else ""
        emit({"type": "progress", "message": "正在细化问题并组织知识目录"})
        prompt = {
            "question": query,
            "explicit_points": question_points(query),
            "scope": scope,
            "evidence": evidence,
            "coverage_notice": coverage,
            "taxonomy": taxonomy,
            "candidates": [
                {"id": k["id"], "title": k["title"], "theme": k["theme"]} for k in local
            ],
        }
        try:
            text = await self.client.generate(
                config, json.dumps(prompt, ensure_ascii=False), "topic-plan", emit
            )
            points = validate_plan(text, query, local, evidence)
            emit({"type": "progress", "message": "正在独立判断知识点资格、项目依赖与两级分类"})
            review = await self.client.generate(
                config,
                json.dumps({**prompt, "points": points}, ensure_ascii=False),
                "topic-review",
                emit,
            )
            points, rejected = review_points(review, points)
        except (ValueError, TypeError):
            response["notice"] = (
                "知识点拆解失败或审核未通过，未放行未审核知识点；本地结果保留，请重试。"
            )
            return response
        session_id = str(uuid.uuid4())
        for point in points:
            # 许可挑战由程序颁发，模型无法在规划响应中生成有效授权。
            if point.get("project_required"):
                point["project_revision"] = str(uuid.uuid4())
        # 有界会话淘汰后拒绝晚到写入，界面应重新拆解。
        while len(self.sessions) >= MAX_SESSIONS:
            _, expired = self.sessions.popitem(last=False)
            expired["projects"].clear()
            expired["pending"].clear()
        self.sessions[session_id] = {
            "query": query,
            "scope": scope,
            "attachment_ids": list(params.get("attachment_ids", []))
            if scope != "knowledge"
            else [],
            "points": points,
            "evidence": evidence,
            "coverage_notice": coverage,
            "pending": {},
            "completed": {},
            "projects": {},
        }
        return {
            **response,
            "plan_id": session_id,
            "points": points,
            "excluded": rejected,
            "notice": ("目录已独立审核；选择知识点学习。" if points else "没有合格的可学习知识点。")
            + coverage,
        }

    # 取消也撤销项目许可，不能让后续普通学习沿用取消前的公开授权。
    async def learn(self, params: dict, emit: Emit) -> dict:
        try:
            return await self._learn(params, emit)
        except asyncio.CancelledError:
            session = self.sessions.get(params.get("plan_id"))
            point = (
                next((p for p in session["points"] if p["id"] == params.get("point_id")), None)
                if session
                else None
            )
            if point and point.get("project_required"):
                self.projects.revoke(session, point)
            raise

    # 同一目录项串行处理，目标变更时存储在提交边界再次校验。
    async def _learn(self, params: dict, emit: Emit) -> dict:
        config = self.store.provider(params.get("provider_id"))
        session_id, point_id = params.get("plan_id"), params.get("point_id")
        if not isinstance(session_id, str) or not isinstance(point_id, str):
            raise ValueError("目录标识无效")
        # 撤销必须越过生成锁，不能等网络返回之后才撤销提交许可。
        if params.get("action") == "revoke":
            session = self.sessions.get(session_id)
            point = (
                next((p for p in session["points"] if p["id"] == point_id), None)
                if session
                else None
            )
            if not point or not point.get("project_required"):
                raise ValueError("项目目录已过期")
            return self.projects.revoke(session, point, params.get("public_only") is True)
        async with self.locks.acquire(session_id + ":" + point_id):
            session = self.sessions.get(session_id)
            if not session:
                raise ValueError("目录已过期，请重新拆解问题")
            point = next((p for p in session["points"] if p["id"] == point_id), None)
            if not point:
                raise ValueError("知识点不属于本次目录")
            if point_id in session["completed"]:
                item = self.store.get(session["completed"][point_id])
                return self.result(item, {}, "已复用本次完成的知识，未重复生成。")
            require_attachments(self.questions.documents, session)
            action = params.get("action", "learn")
            if action in ("confirm", "separate"):
                return await self.confirm(session_id, session, point, action)
            if action not in ("learn", "supplement", "materials", "public-search", "public-select"):
                raise ValueError("无效学习操作")
            if not config:
                raise ValueError("尚未配置生成接口；已有知识仍可直接阅读")
            config = resolve_generation(config, params)
            if point.get("project_required"):
                gate = await self.projects.prepare(
                    session, point, params, self.client, config, emit
                )
                if gate:
                    return gate
            elif action not in ("learn", "supplement"):
                raise ValueError("此知识点不需要项目操作")
            return await self.generate(session_id, session, point, params, config, emit)

    # 针对明确选中的侧面生成，保守地将所有目标补充先交用户核对。
    async def generate(
        self, session_id: str, session: dict, point: dict, params: dict, config: dict, emit: Emit
    ) -> dict:
        target = params.get("target_id", "")
        allowed = {c["id"] for c in point["candidates"]}
        if not isinstance(target, str) or (target and target not in allowed):
            raise ValueError("补充目标不属于本次候选")
        if params.get("action") == "supplement" and not target:
            raise ValueError("请先选择补充到哪条已有知识")
        current = self.store.get(target) if target else None
        context, project_state = (
            self.projects.context(session, point)
            if point.get("project_required")
            else (session, None)
        )
        evidence, existing, coverage = learning_context(context, current)
        prompt = {
            "question": session["query"],
            "scope": "public-example"
            if project_state and project_state["status"] == "public-ready"
            else session["scope"],
            "point": point,
            "evidence": evidence,
            "existing": existing,
            "coverage_notice": coverage,
            "project_mode": project_state["status"] if project_state else "general",
            "task": "只生成选中侧面的新知识；已有知识只补缺口，不重写原文；冲突请明确标注",
        }
        emit({"type": "progress", "message": "正在生成选中的知识点；完整校验后才可收录"})
        text = await self.client.generate(
            config, json.dumps(prompt, ensure_ascii=False), "topic-learn", emit
        )
        raw = json_object(text)
        if "conflict" in raw and type(raw["conflict"]) is not bool:
            raise ValueError("冲突状态无效，未收录")
        result = validate_answer(text, evidence, session["scope"] == "files" or bool(project_state))
        # 外部示例的标识由程序加入正文，不能依靠模型自觉区分用户经历。
        if project_state and project_state["status"] == "public-ready":
            c = project_state["selected"]
            result["content"] = (
                f"公开项目示例：{c['name']}。以下解释仅针对公开资料，不代表你的项目或工作经历。\n\n"
                + result["content"]
            )
        draft = {
            **result,
            "title": point["title"],
            "theme": point.get("storage_theme", point["theme"]),
            "model": config["model"],
            "provider_name": config["name"],
            "target_id": target,
            "version": current["version"] if current else "",
            "capture_key": session_id + ":" + point["id"],
            "coverage_notice": coverage,
        }
        await asyncio.sleep(0)
        if self.sessions.get(session_id) is not session:
            raise ValueError("目录已过期，结果未收录")
        require_attachments(self.questions.documents, session)
        if project_state:
            self.projects.check(session, point, project_state)
            draft["project_revision"] = project_state["revision"]
        if result.get("insufficient"):
            return self.result(None, draft, "依据不足，未收录。")
        if target or raw.get("conflict"):
            session["pending"][point["id"]] = draft
            return self.result(None, draft, "请核对归属及冲突后保存；原笔记未修改。", True)
        item = self.store.capture_topic(draft)
        session["completed"][point["id"]] = item["id"]
        return self.result(item, draft, "已完整收录选中的知识点。")

    # 核对后提交仍需检查目标版本；另存独立点不再关联原目标。
    async def confirm(self, session_id: str, session: dict, point: dict, action: str) -> dict:
        draft = session["pending"].get(point["id"])
        if not draft:
            raise ValueError("没有待核对的完整内容，请先生成")
        draft = dict(draft)
        if action == "separate":
            draft["target_id"] = ""
            # 编码分类保持完整；独立保存通过标题区分，不破坏两级路径。
            if point.get("category"):
                draft["theme"] = encode_path(point["category"], point["subcategory"])
                draft["title"] += "（独立补充）"
            else:
                draft["theme"] += "／独立补充"
        elif not draft["target_id"]:
            raise ValueError("无补充目标，请选择独立保存")
        await asyncio.sleep(0)
        if self.sessions.get(session_id) is not session:
            raise ValueError("目录已过期，未提交")
        require_attachments(self.questions.documents, session)
        if point.get("project_required"):
            _, state = self.projects.context(session, point)
            if not state or draft.get("project_revision") != state["revision"]:
                raise ValueError("项目依据或授权已变化，请重新生成")
        item = self.store.capture_topic(draft)
        session["completed"][point["id"]] = item["id"]
        session["pending"].pop(point["id"], None)
        return self.result(item, draft, "已保存核对后的内容，原笔记保持不变。")
