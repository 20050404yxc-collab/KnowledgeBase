# 文件：sqlite_store.py
# 层：Python infrastructure
# 作用：提供知识、资料、配置和调用记录的 SQLite 仓库。
# 说明：保持既有协议与数据兼容。
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from knowledge_agent.diagnostics import record, traced
from knowledge_agent.domain.knowledge_rules import (
    BUCKETS,
    bucket_for,
    identity,
    now,
    validate_note,
)
from knowledge_agent.domain.models import (
    Document,
    EvidenceBlock,
    Knowledge,
    ProviderConfig,
    ProviderDraft,
    SourceSummary,
)
from knowledge_agent.domain.taxonomy import encode_path, validate_path

from .library_store import LibraryStorage
from .merge_schema import migrate_merges
from .merge_store import MergeStorage
from .model_catalog_schema import migrate_catalog
from .model_prices import migrate_prices, read_prices
from .topic_schema import migrate_topics, populate_index, register_tokens
from .topic_store import TopicStorage
from .usage_store import summarize_usage


class Store(TopicStorage, LibraryStorage, MergeStorage):
    # 重构事务内部重建索引，不开启另一层提交。
    def populate_library_index(self) -> None:
        populate_index(self.db)
        self.populate_original_index()

    # 初始化本对象拥有的状态和资源，依赖由调用方显式提供。
    @traced
    def __init__(self, data_dir: Path) -> None:
        self.root = data_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.sources_dir = self.root / "sources"
        self.sources_dir.mkdir(exist_ok=True)
        self.db = sqlite3.connect(self.root / "knowledge.sqlite3")
        try:
            self._initialize_database()
        except Exception:
            self.db.close()
            raise

    # 初始化表结构并恢复应用拥有的资源，失败由构造方关闭连接。
    @traced
    def _initialize_database(self) -> None:
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        schema_version = self.db.execute("PRAGMA user_version").fetchone()[0]
        record("storage.schema", schema_version=schema_version)
        # 遇到更新版本的库应拒绝打开，不能建空库绕过数据兼容问题。
        if schema_version > 5:
            raise ValueError("数据库版本高于当前程序，请使用新版程序打开")
        # 保留基础表与外键，再通过独立增量迁移添加模型目录。
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
        """)
        register_tokens(self.db)
        self.db.create_function("kb_identity", 1, identity)
        migrate_catalog(self.db, self.root, schema_version)
        migrate_topics(self.db, self.root)
        migrate_merges(self.db, self.root)
        migrate_prices(self.db, self.root)
        with self.db:
            self.db.execute("UPDATE attempts SET status='interrupted' WHERE status='running'")
        # 崩溃恢复仅清理应用资料目录内没有元数据的副本。
        managed = {r[0] for r in self.db.execute("SELECT filename FROM sources")}
        for path in self.sources_dir.iterdir():
            if path.is_file() and path.name not in managed:
                path.unlink(missing_ok=True)

    # 释放本对象持有的资源，不修改用户原件。
    @traced
    def close(self) -> None:
        self.db.close()

    # 将数据库记录转换为知识摘要，动态计算分区和资料保留状态。
    def knowledge(self, row: sqlite3.Row) -> Knowledge:
        result = dict(row)
        result.pop("concept", None)
        result.pop("digest", None)
        result["generated"] = bool(result["generated"])
        result["edited"] = bool(result["edited"])
        result["citations"] = json.loads(result["citations"])
        # 保留状态从当前资料元数据读取；删除资料不删除知识中的引用摘录。
        for citation in result["citations"]:
            citation["retained"] = bool(
                self.db.execute(
                    "SELECT 1 FROM sources WHERE id=?", (citation["source_id"],)
                ).fetchone()
            )
        days = [
            r[0]
            for r in self.db.execute("SELECT day FROM uses WHERE knowledge_id=?", (result["id"],))
        ]
        result["bucket"] = bucket_for(result["created_at"], days, result["manual_bucket"])
        result.update(self.topic_details(result["id"]))
        result["version"] = self.topic_version(result)
        return result

    # 按稳定标识读取当前记录，缺失状态由所属适配器明确处理。
    def get(self, item_id: str, active_use: bool = False) -> Knowledge:
        item_id = self.canonical_id(item_id)
        row = self.db.execute("SELECT * FROM knowledge WHERE id=?", (item_id,)).fetchone()
        # 缺失条目可观察地失败；主动打开按本地自然日幂等计入使用记录。
        if not row:
            raise ValueError("知识不存在或已删除")
        if active_use:
            current = datetime.now().astimezone()
            with self.db:
                self.db.execute(
                    "INSERT OR IGNORE INTO uses VALUES (?, ?, ?)",
                    (item_id, current.date().isoformat(), str(current.tzinfo)),
                )
        result = self.knowledge(row)
        result["canonical_id"] = item_id
        result["bucket"] = self.merged_bucket(result)
        result["original_sources"] = self.original_sources(item_id)
        return result

    # 扫描最近条目并排序，摘要裁剪不改变持久化正文。
    @traced
    def list_knowledge(
        self, query: str = "", bucket: str | None = None, brief: bool = True
    ) -> list[dict]:
        result = []
        # 先按关键词和分区过滤，再只裁剪列表摘要；持久化正文保持完整。
        for row in self.db.execute(
            "SELECT * FROM knowledge WHERE id NOT IN (SELECT source_id FROM knowledge_merges) ORDER BY updated_at DESC"
        ):
            score = self.group_relevance(row["id"], query) if query.strip() else 1
            if score <= 0:
                continue
            item = self.get(row["id"])
            if bucket and item["bucket"] != bucket:
                continue
            if brief:
                item["content"] = item["content"][:260]
                item["citations"] = []
                item["supplements"] = []
            result.append((score, item))
        result.sort(key=lambda pair: pair[0], reverse=True)
        return [item for _, item in result[:200]]

    # 原子保存知识和问题复用标识，重复生成不得覆盖个人编辑。
    @traced
    def save(
        self,
        title: str,
        content: str,
        *,
        item_id: str | None = None,
        generated: bool = False,
        citations: list[EvidenceBlock] | None = None,
        model: str = "",
        provider_name: str = "",
        capture_key: str | None = None,
        classification_path: tuple[str, ...] | list[str] | None = None,
    ) -> dict:
        if item_id:
            item_id = self.canonical_id(item_id)
        title, content, concept = validate_note(title, content)
        # 新路径在复用前校验，非法路径不能因已有同名正文而被忽略。
        if classification_path is not None:
            classification_path = validate_path(list(classification_path))
        # 主题知识使用独立身份键，编辑标题不退回全库标题唯一规则。
        if (
            item_id
            and self.db.execute(
                "SELECT 1 FROM topic_links WHERE knowledge_id=?", (item_id,)
            ).fetchone()
        ):
            concept = "topic:" + item_id
        digest = hashlib.sha256(content.encode()).hexdigest()
        # 明确编辑已有 ID 时才更新正文，并拒绝与其他条目标题冲突。
        if item_id:
            self.get(item_id)
            other = self.db.execute(
                "SELECT id FROM knowledge WHERE concept=? AND id!=?", (concept, item_id)
            ).fetchone()
            if other:
                raise ValueError("同标题知识已存在，请更换标题或编辑已有条目")
            with self.db:
                self.db.execute(
                    "UPDATE knowledge SET concept=?,title=?,content=?,digest=?,updated_at=?,edited=1 WHERE id=?",
                    (concept, title, content, digest, now(), item_id),
                )
            record("knowledge.committed", mode="edit")
            return self.get(item_id)
        existing = self._saved_identity(title, concept, digest, classification_path)
        # 新建或生成命中标题／正文时只复用，可补问题映射但不覆盖旧正文。
        if existing:
            if capture_key:
                with self.db:
                    self._insert_generation_key(capture_key, existing[0])
            record("knowledge.reused", capture_key_added=bool(capture_key))
            return self.get(existing[0])
        item_id, stamp = str(uuid.uuid4()), now()
        concept = "topic:" + item_id if classification_path else concept
        # 新知识和问题复用键在同一 SQLite 事务内提交，失败不会写半套关联。
        with self.db:
            self.db.execute(
                """INSERT INTO knowledge
                (id,concept,title,content,digest,created_at,updated_at,generated,citations,model,provider_name)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    item_id,
                    concept,
                    title,
                    content,
                    digest,
                    stamp,
                    stamp,
                    int(generated),
                    json.dumps(citations or [], ensure_ascii=False),
                    model,
                    provider_name,
                ),
            )
            if classification_path:
                self._apply_library_point(
                    {
                        "id": item_id,
                        "title": title,
                        "category_path": list(classification_path),
                    }
                )
            if capture_key:
                self._insert_generation_key(capture_key, item_id)
        record("knowledge.committed", mode="create", generated=generated)
        return self.get(item_id)

    # 已分类知识只在完整父级与标题身份内复用，不串到其他领域的同名项。
    def _saved_identity(
        self, title: str, concept: str, digest: str, path: list[str] | None
    ) -> sqlite3.Row | None:
        if path is not None:
            return self.db.execute(
                """SELECT k.id FROM knowledge k LEFT JOIN topic_links t ON t.knowledge_id=k.id
                WHERE (t.theme_key=? AND t.title_key=?) OR (t.knowledge_id IS NULL AND k.concept=?)""",
                (identity(encode_path(path)), identity(title), concept),
            ).fetchone()
        return self.db.execute(
            "SELECT id FROM knowledge WHERE concept=? OR digest=?", (concept, digest)
        ).fetchone()

    # 仅写入复用关联；事务归调用方所有，不提前提交知识收录。
    def _insert_generation_key(self, capture_key: str, item_id: str) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO generation_keys VALUES (?,?)", (capture_key, item_id)
        )

    # 固定有效分区或恢复自动计算，拒绝其他分区值。
    @traced
    def set_bucket(self, item_id: str, bucket: str | None) -> dict:
        if bucket is not None and bucket not in BUCKETS:
            raise ValueError("无效分区")
        item_id = self.canonical_id(item_id)
        self.get(item_id)
        with self.db:
            self.db.execute("UPDATE knowledge SET manual_bucket=? WHERE id=?", (bucket, item_id))
        return self.get(item_id)

    # 删除知识及外键关联记录，不删除资料或用户文件。
    @traced
    def delete_knowledge(self, item_id: str) -> dict:
        self.require_deletable(item_id)
        with self.db:
            self.db.execute("DELETE FROM knowledge WHERE id=?", (item_id,))
        return {"deleted": True}

    # 仅返回资料摘要，不将完整来源正文暴露为列表。
    @traced
    def list_sources(self) -> list[SourceSummary]:
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "created_at": r["created_at"],
                "blocks": len(json.loads(r["blocks"])),
                "warnings": json.loads(r["warnings"]),
            }
            for r in self.db.execute("SELECT * FROM sources ORDER BY created_at DESC")
        ]

    # 读取已保留资料的证据，明确附加来源标识和保留状态。
    @traced
    def source_blocks(self) -> list[EvidenceBlock]:
        result = []
        for row in self.db.execute("SELECT id, name, blocks FROM sources"):
            result.extend(
                {**block, "source_id": row["id"], "name": row["name"], "retained": True}
                for block in json.loads(row["blocks"])
            )
        return result

    # 返回无密钥配置，SQLite 整数字段映射为协议布尔值。
    @traced
    def providers(self) -> list[ProviderConfig]:
        return [
            {
                **dict(row),
                "active": bool(row["active"]),
                "has_key": bool(row["has_key"]),
                "model_prices": read_prices(self.db, row["id"]),
                "models": [
                    item[0]
                    for item in self.db.execute(
                        "SELECT model_id FROM provider_models WHERE provider_id=? ORDER BY position",
                        (row["id"],),
                    )
                ],
            }
            for row in self.db.execute("SELECT * FROM providers ORDER BY name")
        ]

    # 按标识读取配置；未指定标识时只取当前启用项。
    def provider(self, provider_id: str | None = None) -> ProviderConfig | None:
        return next(
            (
                p
                for p in self.providers()
                if p["id"] == provider_id or (not provider_id and p["active"])
            ),
            None,
        )

    # 在同一事务中切换唯一启用配置，不改变凭据。
    @traced
    def select_provider(self, provider_id: str) -> list[dict]:
        # 不存在的目标拒绝切换，避免先清空已有启用配置。
        if not self.provider(provider_id):
            raise ValueError("API 配置不存在")
        with self.db:
            self.db.execute("UPDATE providers SET active=0")
            self.db.execute("UPDATE providers SET active=1 WHERE id=?", (provider_id,))
        return self.providers()

    # 判断资料元数据是否已持久化，不访问用户原始路径。
    def has_source(self, item_id: str) -> bool:
        return self.source_filename(item_id) is not None

    # 返回应用持有的副本名，缺失资料返回空。
    def source_filename(self, item_id: str) -> str | None:
        row = self.db.execute("SELECT filename FROM sources WHERE id=?", (item_id,)).fetchone()
        return row[0] if row else None

    # 以单次事务写入资料及解析片段，文件补偿由应用协调。
    @traced
    def insert_source(self, document: Document, filename: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO sources VALUES (?,?,?,?,?,?)",
                (
                    document["id"],
                    document["name"],
                    filename,
                    now(),
                    json.dumps(document["blocks"], ensure_ascii=False),
                    json.dumps(document["warnings"], ensure_ascii=False),
                ),
            )

    # 移除资料元数据，保留知识中已有的引用摘录。
    @traced
    def remove_source(self, item_id: str) -> None:
        with self.db:
            self.db.execute("DELETE FROM sources WHERE id=?", (item_id,))

    # 检查规范化概念是否已存在，避免生成重复推荐。
    def concept_exists(self, concept: str) -> bool:
        return (
            self.db.execute("SELECT 1 FROM knowledge WHERE concept=?", (concept,)).fetchone()
            is not None
        )

    # 按问题复用映射读取已有知识，始终保留其最新编辑。
    def generation_item(self, concept: str) -> Knowledge | None:
        row = self.db.execute(
            "SELECT knowledge_id FROM generation_keys WHERE concept=?", (concept,)
        ).fetchone()
        return self.get(row[0]) if row else None

    # 更新同标识配置并维持唯一启用项，不把密钥写入 SQLite。
    @traced
    def save_provider_config(self, config_id: str, config: ProviderDraft) -> None:
        with self.db:
            self.db.execute(
                """INSERT INTO providers
                (id,name,protocol,base_url,model,has_key,active,input_price,output_price,currency)
                VALUES (?,?,?,?,?,?,0,?,?,?) ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, protocol=excluded.protocol, base_url=excluded.base_url,
                model=excluded.model, has_key=1, input_price=excluded.input_price,
                output_price=excluded.output_price, currency=excluded.currency""",
                (
                    config_id,
                    config["name"],
                    config["protocol"],
                    config["base_url"],
                    config["model"],
                    1,
                    config["input_price"],
                    config["output_price"],
                    config["currency"],
                ),
            )
            # 同一事务替换目录及默认值，避免出现半更新配置。
            self.db.execute("DELETE FROM provider_models WHERE provider_id=?", (config_id,))
            self.db.executemany(
                "INSERT INTO provider_models VALUES (?,?,?)",
                [(config_id, model, index) for index, model in enumerate(config["models"])],
            )
            # 删除目录会级联删除旧价格，新价格与目录在同一事务写入。
            prices = config.get("model_prices")
            if prices is None:
                prices = [
                    {
                        "model": config["model"],
                        "input_price": config["input_price"],
                        "output_price": config["output_price"],
                        "currency": config["currency"],
                    }
                ]
            self.db.executemany(
                "INSERT INTO provider_model_prices VALUES (?,?,?,?,?)",
                [
                    (config_id, p["model"], p["input_price"], p["output_price"], p["currency"])
                    for p in prices
                    if p["model"] in config["models"]
                ],
            )
            # 没有启用项时才默认选择本配置，编辑其他配置不改变当前接口。
            if not any(p["active"] for p in self.providers()):
                self.db.execute("UPDATE providers SET active=1 WHERE id=?", (config_id,))

    # 只删除指定配置，是否处理系统凭据由应用层决定。
    @traced
    def delete_provider(self, config_id: str) -> list[dict]:
        with self.db:
            self.db.execute("DELETE FROM providers WHERE id=?", (config_id,))
        return self.providers()

    # 在请求之前记录调用与价格快照，崩溃后可标记中断。
    @traced
    def start_attempt(self, attempt_id: str, config: ProviderConfig, purpose: str) -> None:
        with self.db:
            self.db.execute(
                """INSERT INTO attempts
                (id,purpose,provider,model,status,started_at,currency,input_price,output_price)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    attempt_id,
                    purpose,
                    config["name"],
                    config["model"],
                    "running",
                    now(),
                    config["currency"],
                    config["input_price"],
                    config["output_price"],
                ),
            )

    # 写入实际调用终态和已知用量，不推断未知费用。
    @traced
    def finish_attempt(
        self,
        attempt_id: str,
        status: str,
        elapsed_ms: int,
        input_tokens: int | None,
        output_tokens: int | None,
        cost: float | None,
    ) -> None:
        with self.db:
            self.db.execute(
                "UPDATE attempts SET status=?,elapsed_ms=?,input_tokens=?,output_tokens=?,cost=? WHERE id=?",
                (status, elapsed_ms, input_tokens, output_tokens, cost, attempt_id),
            )

    # 全历史聚合保留未知值，不受明细数量上限影响。
    @traced
    def usage_summary(self) -> dict:
        return summarize_usage(self.db)

    # 按时间返回最近调用，各币种费用由界面分别统计。
    @traced
    def list_attempts(self) -> list[dict]:
        return [
            dict(row)
            for row in self.db.execute("SELECT * FROM attempts ORDER BY started_at DESC LIMIT 500")
        ]
