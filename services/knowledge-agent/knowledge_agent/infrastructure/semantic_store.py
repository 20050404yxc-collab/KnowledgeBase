# 文件：semantic_store.py
# 层：Python infrastructure
# 作用：提供版本化向量片段的有界存取与当前来源映射。
# 说明：仅连接所有者调用；CPU 编码线程不访问 SQLite。
from knowledge_agent.domain.memory_rules import document_hash
from knowledge_agent.domain.taxonomy import classification


class SemanticStorage:
    # 分批返回原始索引快照；已合并原件不重复参与普通知识检索。
    def semantic_documents(self, after: str = "", limit: int = 32) -> list[dict]:
        return [
            dict(row)
            for row in self.db.execute(
                """SELECT * FROM search_documents WHERE id>? AND kind IN ('knowledge','supplement','source')
            AND (knowledge_id IS NULL OR knowledge_id NOT IN (SELECT source_id FROM knowledge_merges))
            ORDER BY id LIMIT ?""",
                (after, limit),
            )
        ]

    # 只读取当前指纹一致的向量，模型与分块版本也必须相同。
    def semantic_rows(self, model: str, after: str = "", offset: int = -1) -> list[dict]:
        rows = list(
            self.db.execute(
                """SELECT v.*
            FROM semantic_vectors v JOIN search_documents s ON s.id=v.document_id
            WHERE v.model=? AND (v.document_id>? OR (v.document_id=? AND v.offset>?)) AND
            (s.knowledge_id IS NULL OR s.knowledge_id NOT IN (SELECT source_id FROM knowledge_merges))
            ORDER BY v.document_id,v.offset LIMIT 512""",
                (model, after, after, offset),
            )
        )
        if not rows:
            return []
        # 同一长文的多个片段共用正文快照，避免每个向量重复复制全文。
        ids = list({row["document_id"] for row in rows})
        sources = {
            row["id"]: dict(row)
            for row in self.db.execute(
                "SELECT * FROM search_documents WHERE id IN (" + ",".join("?" for _ in ids) + ")",
                ids,
            )
        }
        return [{**sources[row["document_id"]], **dict(row)} for row in rows]

    # 派生索引状态以片段数与未建索引来源数呈现，不假装全库已完成。
    def semantic_counts(self, model: str) -> dict:
        eligible = "(s.knowledge_id IS NULL OR s.knowledge_id NOT IN (SELECT source_id FROM knowledge_merges))"
        total = self.db.execute(
            "SELECT count(*) FROM search_documents s WHERE " + eligible
        ).fetchone()[0]
        indexed, vectors = self.db.execute(
            "SELECT count(DISTINCT v.document_id),count(*) FROM semantic_vectors v "
            "JOIN search_documents s ON s.id=v.document_id WHERE v.model=? AND " + eligible,
            (model,),
        ).fetchone()
        return {"documents": total, "indexed": indexed, "vectors": vectors}

    # 每次提交复查代次和完整内容指纹，编辑／重建期间的晚到结果不能回填。
    def semantic_put(
        self, row: dict, chunks: list[dict], vectors: list[bytes], model: str, epoch: int
    ) -> bool:
        current = self.db.execute(
            "SELECT * FROM search_documents WHERE id=?", (row["id"],)
        ).fetchone()
        if (
            epoch != self.semantic_epoch()
            or current is None
            or document_hash(dict(current)) != document_hash(row)
        ):
            return False
        with self.db:
            self.db.execute("DELETE FROM semantic_vectors WHERE document_id=?", (row["id"],))
            self.db.executemany(
                "INSERT INTO semantic_vectors VALUES (?,?,?,?,?,?)",
                [
                    (row["id"], chunk["offset"], document_hash(row), model, chunk["text"], vector)
                    for chunk, vector in zip(chunks, vectors, strict=True)
                ],
            )
        return True

    # 进程取消与恢复由递增代次撤销旧结果；不用改正式知识内容。
    def semantic_epoch(self) -> int:
        return int(
            self.db.execute("SELECT value FROM semantic_state WHERE key='epoch'").fetchone()[0]
        )

    # 清空索引仍保留明确偏好；代次与向量删除原子提交。
    def semantic_reset(self) -> None:
        with self.db:
            self.db.execute("DELETE FROM semantic_vectors")
            self.db.execute(
                "UPDATE semantic_state SET value=CAST(value AS INTEGER)+1 WHERE key='epoch'"
            )

    # 把当前来源转换为统一检索摘要，资料可回看，知识仍按稳定 ID 打开。
    def semantic_hit(self, row: dict) -> dict:
        hit = {key: row[key] for key in ("kind", "knowledge_id", "title", "theme")}
        hit.update(classification(row["theme"]))
        hit.update(
            id=row["document_id"], excerpt=row["excerpt"], knowledge_id=row["knowledge_id"] or ""
        )
        if row["kind"] == "source":
            hit["citation"] = {
                "id": row["document_id"],
                "source_id": row["source_id"],
                "name": row["title"],
                "locator": row["locator"],
                "text": row["excerpt"],
                "retained": True,
            }
        return hit
