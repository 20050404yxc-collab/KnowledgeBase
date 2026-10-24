# 文件：memory_store.py
# 层：Python infrastructure
# 作用：保存独立用户画像并在全库计算探索精选。
# 说明：不存问题正文，清空不会从 uses 重新填充画像。
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.memory_rules import (
    DEFAULT_MEMORY,
    interest_weight,
    lexical_interest,
    topic_matches,
    validate_memory,
)
from knowledge_agent.domain.taxonomy import classification


class MemoryStorage:
    # 每次返回新快照；明确偏好与计数摘要均不暴露数据库对象。
    def memory_state(self) -> dict:
        settings = dict(DEFAULT_MEMORY)
        settings.update(
            {r[0]: json.loads(r[1]) for r in self.db.execute("SELECT * FROM memory_settings")}
        )
        topics = [
            dict(r)
            for r in self.db.execute("SELECT * FROM memory_totals ORDER BY count DESC,topic,kind")
        ]
        reading = self.db.execute(
            "SELECT coalesce(sum(count),0) FROM memory_reading_totals"
        ).fetchone()[0]
        return {"settings": settings, "topics": topics[:100], "reading_days": reading}

    # 参数先完整校验再写入，非法字段不能导致部分偏好生效。
    @traced
    def memory_update(self, params: dict) -> dict:
        settings = validate_memory(params)
        with self.db:
            self.db.executemany(
                "INSERT OR REPLACE INTO memory_settings VALUES (?,?)",
                [(key, json.dumps(value, ensure_ascii=False)) for key, value in settings.items()],
            )
        return self.memory_state()

    # 清空只影响明确范围，保存去重收据防止迟到重试把已清空的提问重新计入。
    @traced
    def memory_clear(self, scope: str) -> dict:
        if scope not in ("questions", "reading", "all"):
            raise ValueError("无效记忆清空范围")
        with self.db:
            if scope in ("questions", "all"):
                self.db.execute("DELETE FROM memory_daily")
                self.db.execute("DELETE FROM memory_totals")
                self.db.execute("UPDATE memory_questions SET topic='',kind=''")
            if scope in ("reading", "all"):
                self.db.execute("UPDATE memory_reading SET counted=0")
                self.db.execute("DELETE FROM memory_reading_totals")
            if scope == "all":
                self.db.execute("DELETE FROM memory_settings")
        return self.memory_state()

    # 请求标识哈希后持久去重，存储不包含提问全文；已禁用也保留收据避免补记。
    @traced
    def remember_question(self, identity: str, topic: str, kind: str) -> None:
        key = hashlib.sha256(identity.encode()).hexdigest()
        today = date.today().isoformat()
        enabled = self.memory_state()["settings"]["questions_enabled"]
        with self.db:
            result = self.db.execute(
                "INSERT OR IGNORE INTO memory_questions VALUES (?,?,?,?)",
                (key, topic if enabled else "", kind if enabled else "", today),
            )
            if not result.rowcount or not enabled:
                return
            self.db.execute(
                """INSERT INTO memory_daily VALUES (?,?,?,1) ON CONFLICT(topic,kind,day)
                DO UPDATE SET count=count+1""",
                (topic, kind, today),
            )
            self.db.execute(
                """INSERT INTO memory_totals VALUES (?,?,1,?) ON CONFLICT(topic,kind)
                DO UPDATE SET count=count+1,last_used=excluded.last_used""",
                (topic, kind, today),
            )
            self.db.execute(
                "DELETE FROM memory_daily WHERE day<?",
                ((date.today() - timedelta(days=90)).isoformat(),),
            )

    # 主动阅读按日去重，不把检索、展示推荐和预加载记成阅读。
    def remember_reading(self, knowledge_id: str) -> None:
        enabled = self.memory_state()["settings"]["reading_enabled"]
        today = date.today().isoformat()
        with self.db:
            result = self.db.execute(
                "INSERT OR IGNORE INTO memory_reading VALUES (?,?,?)",
                (knowledge_id, today, int(enabled)),
            )
            self.db.execute(
                "DELETE FROM memory_reading WHERE day<?",
                ((date.today() - timedelta(days=90)).isoformat(),),
            )
            if result.rowcount and enabled:
                self.db.execute(
                    """INSERT INTO memory_reading_totals VALUES (?,1,?) ON CONFLICT(knowledge_id)
                    DO UPDATE SET count=count+1,last_used=excluded.last_used""",
                    (knowledge_id, today),
                )

    # 全部候选先评分再取九条，不受旧列表 200 条截断影响。
    @traced
    def exploration_list(self, query: str = "") -> list[dict]:
        if not isinstance(query, str) or len(query) > 12000:
            raise ValueError("探索筛选无效")
        settings = self.memory_state()["settings"]
        question_rows = defaultdict(list)
        reading_rows = defaultdict(list)
        for row in self.db.execute("SELECT * FROM memory_daily"):
            question_rows[row["topic"]].append(dict(row))
        for row in self.db.execute("SELECT * FROM memory_reading WHERE counted=1"):
            canonical = self.canonical_id(row["knowledge_id"])
            reading_rows[canonical].append({"day": row["day"], "count": 1})
        ranked = []
        cursor = self.db.execute(
            "SELECT k.*,coalesce(t.theme,'未分类') AS theme FROM knowledge k LEFT JOIN topic_links t ON t.knowledge_id=k.id WHERE k.id NOT IN (SELECT source_id FROM knowledge_merges)"
        )
        for row in cursor:
            item = dict(row)
            item.update(classification(item["theme"]))
            lexical = lexical_interest(query, item["title"], item["content"]) if query else 0
            if query and not lexical:
                continue
            questions = [
                r
                for topic, rows in question_rows.items()
                if topic_matches(topic, item.get("category_path", []))
                for r in rows
            ]
            q = interest_weight(questions, date.today()) if settings["questions_enabled"] else 0
            reads = {r["day"]: r for r in reading_rows[item["id"]]}
            v = (
                interest_weight(list(reads.values()), date.today())
                if settings["reading_enabled"]
                else 0
            )
            ranked.append(
                (lexical, q, v, max(reads, default="") if settings["reading_enabled"] else "", item)
            )
        qmax = max((x[1] for x in ranked), default=0) or 1
        vmax = max((x[2] for x in ranked), default=0) or 1
        ranked.sort(
            key=lambda x: (
                x[0],
                0.6 * x[1] / qmax + 0.4 * x[2] / vmax,
                x[3],
                x[4]["updated_at"],
                x[4]["id"],
            ),
            reverse=True,
        )
        result = []
        for *_, row in ranked[:9]:
            item = self.knowledge(row)
            item.update(content=item["content"][:260], citations=[], supplements=[])
            result.append(item)
        return result
