"""Canonical local data. Search and frequency never mutate note contents."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

BUCKETS = {"常用", "在学", "归档"}


def now() -> str:
    return datetime.now().astimezone().isoformat()


def identity(title: str) -> str:
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", title).casefold())


def tokens(text: str) -> set[str]:
    text = unicodedata.normalize("NFKC", text).casefold()
    result = set(re.findall(r"[a-z0-9_]+", text))
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        result.update(run[i:i + 2] for i in range(max(1, len(run) - 1)))
    return result


def relevance(query: str, title: str, content: str) -> float:
    terms = tokens(query)
    if not terms:
        return 0
    title_terms, body_terms = tokens(title), tokens(content)
    score = len(terms & title_terms) * 3 + len(terms & body_terms)
    if query.strip().casefold() in (title + "\n" + content).casefold():
        score += 5
    return score / len(terms)


def bucket_for(created_at: str, use_days: list[str], manual: str | None = None, today: date | None = None) -> str:
    if manual in BUCKETS:
        return manual
    today = today or date.today()
    days = {date.fromisoformat(day) for day in use_days}
    if sum(today - timedelta(days=13) <= day <= today for day in days) >= 3:
        return "常用"
    created = datetime.fromisoformat(created_at).date()
    if (today - created).days >= 30 and not any(day > today - timedelta(days=30) for day in days):
        return "归档"
    return "在学"


class Store:
    def __init__(self, data_dir: Path):
        self.root = data_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.sources_dir = self.root / "sources"
        self.sources_dir.mkdir(exist_ok=True)
        self.db = sqlite3.connect(self.root / "knowledge.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        schema_version = self.db.execute("PRAGMA user_version").fetchone()[0]
        if schema_version > 1:
            raise ValueError("数据库版本高于当前程序，请使用新版程序打开")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS knowledge (
                id TEXT PRIMARY KEY, concept TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
                content TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, generated INTEGER NOT NULL, edited INTEGER NOT NULL DEFAULT 0,
                manual_bucket TEXT, citations TEXT NOT NULL DEFAULT '[]', model TEXT, provider_name TEXT
            );
            CREATE TABLE IF NOT EXISTS uses (
                knowledge_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
                day TEXT NOT NULL, timezone TEXT NOT NULL, PRIMARY KEY (knowledge_id, day)
            );
            CREATE TABLE IF NOT EXISTS generation_keys (
                concept TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, filename TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL, blocks TEXT NOT NULL, warnings TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, base_url TEXT NOT NULL,
                model TEXT NOT NULL, has_key INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0,
                input_price REAL, output_price REAL, currency TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_provider ON providers(active) WHERE active=1;
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY, purpose TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
                status TEXT NOT NULL, started_at TEXT NOT NULL, elapsed_ms INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER, output_tokens INTEGER, cost REAL, currency TEXT NOT NULL,
                input_price REAL, output_price REAL
            );
            PRAGMA user_version=1;
        """)
        with self.db:
            self.db.execute("UPDATE attempts SET status='interrupted' WHERE status='running'")
        # Crash recovery: only app-owned orphan copies are eligible for cleanup.
        managed = {r[0] for r in self.db.execute("SELECT filename FROM sources")}
        for path in self.sources_dir.iterdir():
            if path.is_file() and path.name not in managed:
                path.unlink(missing_ok=True)

    def close(self):
        self.db.close()

    def knowledge(self, row: sqlite3.Row) -> dict:
        result = dict(row)
        result.pop("concept", None)
        result.pop("digest", None)
        result["generated"] = bool(result["generated"])
        result["edited"] = bool(result["edited"])
        result["citations"] = json.loads(result["citations"])
        for citation in result["citations"]:
            citation["retained"] = bool(self.db.execute("SELECT 1 FROM sources WHERE id=?", (citation["source_id"],)).fetchone())
        days = [r[0] for r in self.db.execute("SELECT day FROM uses WHERE knowledge_id=?", (result["id"],))]
        result["bucket"] = bucket_for(result["created_at"], days, result["manual_bucket"])
        return result

    def get(self, item_id: str, active_use: bool = False) -> dict:
        row = self.db.execute("SELECT * FROM knowledge WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise ValueError("知识不存在或已删除")
        if active_use:
            current = datetime.now().astimezone()
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO uses VALUES (?, ?, ?)", (item_id, current.date().isoformat(), str(current.tzinfo)))
        return self.knowledge(row)

    def list_knowledge(self, query: str = "", bucket: str | None = None, brief: bool = True) -> list[dict]:
        result = []
        for row in self.db.execute("SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT 5000"):
            score = relevance(query, row["title"], row["content"]) if query.strip() else 1
            if score <= 0:
                continue
            item = self.knowledge(row)
            if bucket and item["bucket"] != bucket:
                continue
            if brief:
                item["content"] = item["content"][:260]
                item["citations"] = []
            result.append((score, item))
        result.sort(key=lambda pair: pair[0], reverse=True)
        return [item for _, item in result[:200]]

    def save(self, title: str, content: str, *, item_id: str | None = None, generated: bool = False,
             citations: list | None = None, model: str = "", provider_name: str = "", capture_key: str | None = None) -> dict:
        title, content = title.strip(), content.strip()
        concept = identity(title)
        if not concept or len(title) > 160 or not content or len(content) > 120000:
            raise ValueError("标题须为 1–160 字且包含文字，正文须为 1–120000 字")
        digest = hashlib.sha256(content.encode()).hexdigest()
        if item_id:
            self.get(item_id)
            other = self.db.execute("SELECT id FROM knowledge WHERE concept=? AND id!=?", (concept, item_id)).fetchone()
            if other:
                raise ValueError("同标题知识已存在，请更换标题或编辑已有条目")
            with self.db:
                self.db.execute("UPDATE knowledge SET concept=?,title=?,content=?,digest=?,updated_at=?,edited=1 WHERE id=?",
                                (concept, title, content, digest, now(), item_id))
            return self.get(item_id)
        existing = self.db.execute("SELECT id FROM knowledge WHERE concept=? OR digest=?", (concept, digest)).fetchone()
        if existing:
            if capture_key:
                with self.db:
                    self.db.execute("INSERT OR IGNORE INTO generation_keys VALUES (?,?)", (capture_key, existing[0]))
            return self.get(existing[0])
        item_id, stamp = str(uuid.uuid4()), now()
        with self.db:
            self.db.execute("""INSERT INTO knowledge
                (id,concept,title,content,digest,created_at,updated_at,generated,citations,model,provider_name)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                            (item_id, concept, title, content, digest, stamp, stamp, int(generated),
                             json.dumps(citations or [], ensure_ascii=False), model, provider_name))
            if capture_key:
                self.db.execute("INSERT OR IGNORE INTO generation_keys VALUES (?,?)", (capture_key, item_id))
        return self.get(item_id)

    def set_bucket(self, item_id: str, bucket: str | None):
        if bucket is not None and bucket not in BUCKETS:
            raise ValueError("无效分区")
        self.get(item_id)
        with self.db:
            self.db.execute("UPDATE knowledge SET manual_bucket=? WHERE id=?", (bucket, item_id))
        return self.get(item_id)

    def delete_knowledge(self, item_id: str):
        with self.db:
            self.db.execute("DELETE FROM knowledge WHERE id=?", (item_id,))
        return {"deleted": True}

    def list_sources(self) -> list[dict]:
        return [{"id": r["id"], "name": r["name"], "created_at": r["created_at"],
                 "blocks": len(json.loads(r["blocks"])), "warnings": json.loads(r["warnings"])}
                for r in self.db.execute("SELECT * FROM sources ORDER BY created_at DESC")]

    def source_blocks(self) -> list[dict]:
        result = []
        for row in self.db.execute("SELECT id, name, blocks FROM sources"):
            result.extend({**block, "source_id": row["id"], "name": row["name"], "retained": True} for block in json.loads(row["blocks"]))
        return result

    def providers(self) -> list[dict]:
        return [dict(row) for row in self.db.execute("SELECT * FROM providers ORDER BY name")]

    def provider(self, provider_id: str | None = None) -> dict | None:
        return next((p for p in self.providers() if p["id"] == provider_id or (not provider_id and p["active"])), None)

    def select_provider(self, provider_id: str):
        if not self.provider(provider_id):
            raise ValueError("API 配置不存在")
        with self.db:
            self.db.execute("UPDATE providers SET active=0")
            self.db.execute("UPDATE providers SET active=1 WHERE id=?", (provider_id,))
        return self.providers()
