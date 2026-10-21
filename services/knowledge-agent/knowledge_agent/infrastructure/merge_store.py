# 文件：merge_store.py
# 层：Python infrastructure
# 作用：统一保留点解析、原文快照和事务内合并写入。
# 说明：不物理删除来源，不将合并操作记录为主动使用。
from __future__ import annotations

import json

from knowledge_agent.domain.knowledge_rules import bucket_for, now, relevance
from knowledge_agent.domain.restructure_evidence import source_chunks, source_version


class MergeStorage:
    # 映射表仅允许一跳，异常链条不能被静默容忍。
    def canonical_id(self, item_id: str) -> str:
        row = self.db.execute(
            "SELECT target_id FROM knowledge_merges WHERE source_id=?", (item_id,)
        ).fetchone()
        return row[0] if row else item_id

    # 来源集合包含保留点自身，供频率集合与检索统一使用。
    def group_ids(self, item_id: str) -> list[str]:
        target = self.canonical_id(item_id)
        return [target] + [
            row[0]
            for row in self.db.execute(
                "SELECT source_id FROM knowledge_merges WHERE target_id=? ORDER BY source_id",
                (target,),
            )
        ]

    # 读取原始行供重构覆盖，不能把多个隐藏来源重复解析成同一个保留点。
    def raw_knowledge(self, item_id: str) -> dict:
        row = self.db.execute("SELECT * FROM knowledge WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise ValueError("知识不存在或已删除")
        return self.knowledge(row)

    # 使用日按集合聚合，同一天的多来源使用不重复计数。
    def merged_bucket(self, item: dict) -> str:
        ids = self.group_ids(item["id"])
        placeholders = ",".join("?" for _ in ids)
        days = [
            row[0]
            for row in self.db.execute(
                f"SELECT DISTINCT day FROM uses WHERE knowledge_id IN ({placeholders})", ids
            )
        ]
        created = self.db.execute(
            f"SELECT min(created_at) FROM knowledge WHERE id IN ({placeholders})", ids
        ).fetchone()[0]
        return bucket_for(created, days, item["manual_bucket"])

    # 搜索全部来源和原始快照，但将命中呈现在当前保留点路径下。
    def group_relevance(self, item_id: str, query: str) -> float:
        best = 0
        for source_id in self.group_ids(item_id):
            for row in self.db.execute(
                "SELECT title,body FROM search_documents WHERE knowledge_id=?", (source_id,)
            ):
                best = max(best, relevance(query, row[0], row[1]))
        return best

    # 元数据不包含正文，原文通过有界只读入口逐块查看。
    def original_sources(self, item_id: str) -> list[dict]:
        result = []
        for source_id in self.group_ids(item_id):
            for row in self.db.execute(
                "SELECT version,snapshot FROM restructure_originals WHERE source_id=? ORDER BY created_at,version",
                (source_id,),
            ):
                item = json.loads(row[1])
                result.append(
                    {
                        "source_id": source_id,
                        "version": row[0],
                        "title": item["title"],
                        "chunks": len(source_chunks(item)),
                    }
                )
        return result

    # 旧标识只能在所属合并组内读取快照，不增加使用日或提供写入入口。
    def get_original(self, item_id: str, params: dict) -> dict:
        source_id, version, page = (
            params.get("source_id"),
            params.get("version"),
            params.get("page", 0),
        )
        if (
            source_id not in self.group_ids(item_id)
            or not isinstance(version, str)
            or type(page) is not int
            or page < 0
        ):
            raise ValueError("原文来源或分页无效")
        row = self.db.execute(
            "SELECT snapshot FROM restructure_originals WHERE source_id=? AND version=?",
            (source_id, version),
        ).fetchone()
        if not row:
            raise ValueError("原文版本不存在")
        item = json.loads(row[0])
        chunks = source_chunks(item)
        if page >= len(chunks):
            raise ValueError("原文分页超出范围")
        part = next(
            (
                part
                for part in item.get("supplements", [])
                if chunks[page]["part"] == "supplement:" + part["id"]
            ),
            None,
        )
        return {
            **item,
            "citations": part["citations"] if part else item["citations"],
            "content": chunks[page]["text"],
            "supplements": [],
            "original_sources": [],
            "read_only": True,
            "original_locator": chunks[page]["locator"],
            "version": version,
            "canonical_id": self.canonical_id(item_id),
            "original_page": page,
            "original_total": len(chunks),
        }

    # 保存修改前来源的完整版本，同一版本幂等，任何用户原文不会被整理稿取代。
    def retain_original(self, item: dict) -> None:
        snapshot = {
            key: value
            for key, value in item.items()
            if key not in ("original_sources", "provenance", "archived_evidence")
        }
        self.db.execute(
            "INSERT OR IGNORE INTO restructure_originals VALUES (?,?,?,?)",
            (item["id"], source_version(item), json.dumps(snapshot, ensure_ascii=False), now()),
        )

    # 已有映射整体重建并展平，组内来源行、引用、补充和复用键全部保留。
    def apply_merge_map(self, draft: dict) -> None:
        for item in draft["items"]:
            if draft["source_map"][item["id"]] != item["id"] or any(
                s["target_id"] == item["id"] and s["id"] in draft["selected"]
                for s in draft["suggestions"]
            ):
                self.retain_original(item)
        self.db.execute("DELETE FROM knowledge_merges")
        for source_id, target_id in draft["source_map"].items():
            if source_id != target_id:
                self.db.execute("INSERT INTO knowledge_merges VALUES (?,?)", (source_id, target_id))
        for group in draft["merges"]:
            self.db.execute(
                "UPDATE knowledge SET manual_bucket=? WHERE id=?",
                (group["manual_bucket"], group["target_id"]),
            )

    # 删除合并组会破坏来源与历史，因此普通删除明确拒绝。
    def require_deletable(self, item_id: str) -> None:
        if len(self.group_ids(item_id)) > 1:
            raise ValueError("此知识属于已合并组，普通删除不可用；原文与来源映射需要保留")

    # 合并组所有来源只返回最相关命中，普通未合并的补充仍沿用原有检索语义。
    def canonical_matches(self, matches: list[tuple]) -> list[tuple]:
        result, seen = [], set()
        for score, hit in matches:
            source_id = hit["knowledge_id"]
            if not source_id:
                result.append((score, hit))
                continue
            target = self.canonical_id(source_id)
            merged = len(self.group_ids(target)) > 1
            if merged and target in seen:
                continue
            seen.add(target)
            if not merged:
                result.append((score, hit))
                continue
            current = self.get(target)
            hit.pop("category_path", None)
            if "category_path" in current:
                hit["category_path"] = current["category_path"]
            hit.update(
                knowledge_id=target,
                title=current["title"],
                theme=current["theme"],
                category=current.get("category", ""),
                subcategory=current.get("subcategory", ""),
            )
            result.append((score, hit))
        return result

    # 原始快照也进入派生索引，替换保留点正文后仍可检索原独有内容。
    def populate_original_index(self) -> None:
        for row in self.db.execute("SELECT source_id,version,snapshot FROM restructure_originals"):
            item = json.loads(row[2])
            for chunk in source_chunks(item):
                index_id = "original:" + row[0] + ":" + row[1] + ":" + chunk["locator"]
                self.db.execute(
                    "INSERT INTO search_documents VALUES (?,?,?,?,?,?,?,?,kb_tokens(?))",
                    (
                        index_id,
                        "knowledge",
                        row[0],
                        None,
                        item["title"],
                        item["theme"],
                        chunk["text"],
                        chunk["locator"],
                        item["title"] + " " + chunk["text"],
                    ),
                )

    # 历史快照作为来源证据加入只读快照，不作为新的独立知识目标。
    def archived_evidence(self, item_id: str) -> list[dict]:
        return [
            {"version": row[0], "item": json.loads(row[1])}
            for row in self.db.execute(
                "SELECT version,snapshot FROM restructure_originals WHERE source_id=? ORDER BY version",
                (item_id,),
            )
        ]
