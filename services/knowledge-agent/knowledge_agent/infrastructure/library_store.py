# 文件：library_store.py
# 层：Python infrastructure
# 作用：查询完整分层目录并原子应用经确认的知识重构。
# 说明：复用既有表；恢复点及 SQLite 连接均由仓库拥有。
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import closing

from knowledge_agent.diagnostics import traced
from knowledge_agent.domain.knowledge_rules import BUCKETS, identity, now, relevance
from knowledge_agent.domain.library_rules import display_path, inventory_version
from knowledge_agent.domain.taxonomy import (
    MAX_PATH_SEGMENTS,
    classification,
    encode_path,
    parent_path,
)
from knowledge_agent.domain.topic_rules import short_field

# 所有分页共享相同边界，树与预览均不发送完整全库正文。
TREE_PAGE_SIZE = 50


class LibraryStorage:
    # 全量快照按稳定 ID 排序，读取不会增加使用日。
    @traced
    def library_inventory(self) -> list[dict]:
        result = []
        for row in self.db.execute("SELECT id FROM knowledge ORDER BY created_at,id"):
            item = self.raw_knowledge(row[0])
            item["canonical_id"] = self.canonical_id(row[0])
            item["archived_evidence"] = self.archived_evidence(row[0])
            item["provenance"] = [
                dict(value)
                for value in self.db.execute(
                    "SELECT suggestion_id,kind,sources FROM restructure_provenance WHERE target_id=? ORDER BY created_at,suggestion_id",
                    (row[0],),
                )
            ]
            result.append(item)
        return result

    # 先分区和搜索过滤，再按路径聚合；没有旧卡片列表的 200 条限制。
    @traced
    def library_tree(self, params: dict) -> dict:
        query, bucket, path = tree_params(params)
        grouped, total, bodies = {}, 0, []
        rows = self.db.execute("""SELECT k.id,k.title,k.content,k.created_at,k.updated_at,
            k.manual_bucket,t.theme,group_concat(u.day) AS days FROM knowledge k
            LEFT JOIN topic_links t ON t.knowledge_id=k.id
            LEFT JOIN uses u ON u.knowledge_id=k.id WHERE k.id NOT IN (SELECT source_id FROM knowledge_merges) GROUP BY k.id ORDER BY k.id""")
        for row in rows:
            # 频率和正文查询均以完整集合为依据，补充同样可以成为命中来源。
            current_bucket = self.merged_bucket(dict(row))
            route = display_path(classification(row["theme"] or "未分类")) + [row["title"]]
            if bucket and current_bucket != bucket or route[: len(path)] != path:
                continue
            if query and not self._library_matches(row, query, route):
                continue
            total += 1
            # 本节点正文单独提供阅读入口，不重复列入它自己的下级。
            if route == path:
                bodies.append(tree_leaf(row, current_bucket))
                continue
            key = route[len(path)]
            terminal = len(route) == len(path) + 1
            node = grouped.setdefault(
                key,
                {
                    "key": key,
                    "label": key,
                    "count": 0,
                    "id": "",
                    "bucket": "",
                    "children": False,
                    "bodies": [],
                },
            )
            node["count"] += 1
            if terminal:
                node["bodies"].append(tree_leaf(row, current_bucket))
            else:
                node["children"] = True
        content_id = bodies[0]["id"] if len(bodies) == 1 else ""
        values = tree_nodes(grouped, bodies if len(bodies) > 1 else [])
        version = [query, bucket, path, content_id, values]
        revision = hashlib.sha256(json.dumps(version, ensure_ascii=False).encode()).hexdigest()
        offset = tree_offset(params.get("cursor", ""), revision)
        end = offset + TREE_PAGE_SIZE
        return {
            "nodes": values[offset:end],
            "total": total,
            "content_id": content_id,
            "revision": revision,
            "next_cursor": f"{revision}:{end}" if end < len(values) else "",
        }

    # 避免将补充全文传给界面，但搜索覆盖全部补充内容。
    def _library_matches(self, row: sqlite3.Row, query: str, route: list[str]) -> bool:
        if (
            relevance(query, row["title"] + " ".join(route), row["content"]) > 0
            or self.group_relevance(row["id"], query) > 0
        ):
            return True
        return any(
            relevance(query, value[0], value[1]) > 0
            for value in self.db.execute(
                "SELECT title,content FROM supplements WHERE knowledge_id=?", (row["id"],)
            )
        )

    # 备份先落临时文件，只有完整备份才成为本次恢复点；不覆盖其他恢复点。
    @traced
    def library_backup(self) -> str:
        target = self.root / f"before-restructure-{uuid.uuid4()}.sqlite3"
        temporary = target.with_suffix(".pending")
        try:
            with closing(sqlite3.connect(temporary)) as destination:
                self.db.backup(destination)
            temporary.replace(target)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
        return target.name

    # 分段上传后一次提交现有知识；版本、原件与索引受同一事务保护。
    @traced
    def save_long_text(self, params: dict) -> None:
        title = short_field(params.get("title"), "标题", 200)
        content = params["content"]
        if not content.strip():
            raise ValueError("正文不能为空")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            current = self.get(params["id"])
            if current["version"] != params["version"]:
                raise ValueError("知识已变化，请重新打开后编辑")
            self.retain_original(current)
            stamp, digest = now(), hashlib.sha256(content.encode()).hexdigest()
            if params["supplement_id"]:
                if not any(p["id"] == params["supplement_id"] for p in current["supplements"]):
                    raise ValueError("补充不存在")
                self.db.execute(
                    "UPDATE supplements SET title=?,content=?,digest=?,updated_at=?,edited=1 WHERE id=? AND knowledge_id=?",
                    (title, content, digest, stamp, params["supplement_id"], current["id"]),
                )
            else:
                concept = (
                    "topic:" + current["id"]
                    if self.db.execute(
                        "SELECT 1 FROM topic_links WHERE knowledge_id=?", (current["id"],)
                    ).fetchone()
                    else identity(title)
                )
                self.db.execute(
                    "UPDATE knowledge SET title=?,concept=?,content=?,digest=?,updated_at=?,edited=1 WHERE id=?",
                    (title, concept, content, digest, stamp, current["id"]),
                )
            # 历史原件也参与搜索，保证编辑不能抹掉重构前的信息。
            if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone():
                self.db.execute("DELETE FROM search_fts")
            self.db.execute("DELETE FROM search_documents")
            self.populate_library_index()

    # 统一提交分类、所选更新和索引，任一步失败都回滚；恢复点保留供排查。
    @traced
    def apply_library(self, draft: dict, selected: list[str]) -> dict:
        if inventory_version(self.library_inventory()) != draft["snapshot"]:
            raise ValueError("知识库已变化，请重新规划；未覆盖新内容")
        backup = self.library_backup()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            if inventory_version(self.library_inventory()) != draft["snapshot"]:
                raise ValueError("知识库已变化，请重新规划；未修改知识库")
            # 先删除全部旧关系，避免合法的分类交换被旧唯一约束误拦。
            self.db.execute("DELETE FROM topic_links")
            draft["selected"] = selected
            self.apply_merge_map(draft)
            for point in draft["targets"]:
                self._apply_library_point(point)
            for suggestion in draft["suggestions"]:
                if suggestion["id"] in selected:
                    self._apply_library_suggestion(suggestion, draft["config"])
            # 现有触发器只处理关系插入；全部重建可派生索引确保补充也同步。
            if self.db.execute("SELECT 1 FROM sqlite_master WHERE name='search_fts'").fetchone():
                self.db.execute("DELETE FROM search_fts")
            self.db.execute("DELETE FROM search_documents")
            self.populate_library_index()
        return {
            "applied": True,
            "count": len(draft["targets"]),
            "backup": backup,
            "source_count": len(draft["items"]),
            "target_count": len(draft["targets"]),
            "groups": len(draft["merges"]),
        }

    # 关系不改变知识身份、创建时间、正文与手工分区。
    def _apply_library_point(self, point: dict) -> None:
        theme = encode_path(parent_path(point))
        self.db.execute("UPDATE knowledge SET title=? WHERE id=?", (point["title"], point["id"]))
        self.db.execute(
            "INSERT INTO topic_links VALUES (?,?,?,?)",
            (point["id"], theme, identity(theme), identity(point["title"])),
        )

    # 手工内容只能追加建议；正文替换仍保留所有原引用及补充。
    def _apply_library_suggestion(self, suggestion: dict, config: dict) -> None:
        item = self.get(suggestion["target_id"])
        content = suggestion["content"]
        if suggestion["mode"] == "replace":
            if not item["generated"] or item["edited"]:
                raise ValueError("手工内容不能被重构替换")
            self.db.execute(
                "UPDATE knowledge SET content=?,digest=?,updated_at=?,citations=? WHERE id=?",
                (
                    content,
                    hashlib.sha256(content.encode()).hexdigest(),
                    now(),
                    json.dumps(suggestion["citations"], ensure_ascii=False),
                    item["id"],
                ),
            )
        else:
            self._append_supplement(
                item["id"],
                "模型补充解释（未独立核实）"
                if suggestion["kind"] == "model-explanation"
                else "重构原文整理",
                content,
                {
                    "citations": suggestion["citations"],
                    "model": config["model"],
                    "provider_name": config["name"],
                },
            )
        self.db.execute(
            "INSERT INTO restructure_provenance VALUES (?,?,?,?,?)",
            (
                item["id"],
                suggestion["id"],
                suggestion["kind"],
                json.dumps(suggestion["provenance"], ensure_ascii=False),
                now(),
            ),
        )


# 旧主题可能映射到同一显示位置，正文以稳定 ID 独立保留，不能覆盖同名项。
def tree_leaf(row: sqlite3.Row, bucket: str) -> dict:
    return {
        "key": row["id"],
        "label": row["title"],
        "count": 1,
        "id": row["id"],
        "bucket": bucket,
        "children": False,
    }


# 只有唯一正文才附着分支；存在显示别名冲突时保留每个正文的独立阅读入口。
def tree_nodes(grouped: dict, values: list[dict]) -> list[dict]:
    for node in grouped.values():
        bodies = node.pop("bodies")
        if not node["children"]:
            values.extend(bodies)
            continue
        if len(bodies) == 1:
            node.update(id=bodies[0]["id"], bucket=bodies[0]["bucket"])
        elif bodies:
            values.extend(bodies)
            node["count"] -= len(bodies)
        values.append(node)
    return sorted(values, key=lambda node: (node["label"], node["key"]))


# 严格验证树请求，不从字符串强转分页或容忍未知分区。
def tree_params(params: dict) -> tuple[str, str | None, list[str]]:
    query, bucket, path = params.get("query", ""), params.get("bucket"), params.get("path", [])
    if (
        not isinstance(query, str)
        or len(query) > 12000
        or bucket is not None
        and bucket not in BUCKETS
    ):
        raise ValueError("目录筛选无效")
    if (
        not isinstance(path, list)
        or len(path) > MAX_PATH_SEGMENTS + 1
        or any(not isinstance(p, str) or not p or len(p) > 2000 for p in path)
    ):
        raise ValueError("目录路径无效")
    return query.strip(), bucket, path


# 游标绑定本级目录版本，变化时拒绝跳页而不是静默遗漏。
def tree_offset(cursor: str, revision: str) -> int:
    if not isinstance(cursor, str) or len(cursor) > 100:
        raise ValueError("目录分页无效")
    if not cursor:
        return 0
    prefix, separator, offset = cursor.partition(":")
    if prefix != revision or not separator or not offset.isdecimal():
        raise ValueError("目录已变化，请刷新后展开")
    return int(offset)
