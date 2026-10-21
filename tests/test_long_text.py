# 文件：test_long_text.py
# 层：验证
# 作用：保护长正文跨帧读取、版本绑定和分段原子编辑。
# 说明：使用隔离 SQLite 和合成文本，不请求模型或正式数据。
import json
import sqlite3
from pathlib import Path

import pytest
from knowledge_agent.application.long_text import LongText, compact_knowledge
from knowledge_agent.bootstrap import create_service
from test_knowledge import Vault
from test_library import call


# 两端读取同一长文分页样例，后台实际返回必须保持字段和 Unicode 语义一致。
def test_shared_long_text_sample():
    samples = json.loads(
        (Path(__file__).resolve().parents[1] / "contracts/protocol_samples.json").read_text(
            encoding="utf-8"
        )
    )
    expected = next(
        s["result"] for s in samples["dto_samples"] if s["operation"] == "knowledge.text"
    )

    # 内存仓库固定版本，只替代 I/O；执行实际分页边界逻辑。
    class MemoryStore:
        # 固定记录用于复核共享协议样例，不接触数据库。
        def get(self, _id: str) -> dict:
            return {"id": "sample", "version": expected["version"], "content": expected["content"]}

    assert (
        LongText(MemoryStore()).execute(
            {"action": "read", "id": "sample", "version": expected["version"]}
        )
        == expected
    )


# 多条长补充不应令首屏重返超大帧；完整字符数与独立读取入口保留。
def test_many_supplements_share_transport_budget():
    item = {
        "content": "正文" * 20000,
        "supplements": [{"id": str(i), "content": "补充" * 30000} for i in range(80)],
    }
    compact = compact_knowledge(item)
    assert len(compact["content"]) + sum(len(p["content"]) for p in compact["supplements"]) <= 24000
    assert len(json.dumps(compact, ensure_ascii=False).encode()) < 100000
    assert all(p["content_chars"] == 60000 for p in compact["supplements"])


# 每个长文场景独享服务连接及内存草稿，结束时释放。
@pytest.fixture
def library(tmp_path):
    service = create_service(tmp_path, vault=Vault())
    yield service
    service.close()


# 逐段暂存可超过普通新建上限，未提交前不得改变正式正文。
def upload(service, item: dict, content: str, **extra) -> dict:
    session = call(
        service,
        "knowledge.text",
        {
            "action": "begin",
            "id": item["id"],
            "version": item["version"],
            "title": item["title"],
            **extra,
        },
    )
    offset = 0
    for start in range(0, len(content), 12000):
        result = call(
            service,
            "knowledge.text",
            {
                "action": "append",
                **session,
                "offset": offset,
                "content": content[start : start + 12000],
            },
        )
        offset = result["offset"]
    assert offset == len(content)
    return {"edit_id": session["edit_id"], "chars": offset}


# 大于传输帧的完整知识能够逐页读回、保存并保留原件；Unicode 偏移不漂移。
def test_large_atomic_unicode_roundtrip(library):
    item = library.store.save("长知识", "original")
    content = "😀中文" * 370000 + "FULL_END"
    session = upload(library, item, content)
    assert library.store.get(item["id"])["content"] == "original"
    with pytest.raises(ValueError, match="完整上传"):
        call(library, "knowledge.text", {"action": "commit", **session, "chars": 3})
    call(library, "knowledge.text", {"action": "commit", **session})
    current = call(library, "knowledge.get", {"id": item["id"]})
    assert current["content_chars"] == len(content) and len(current["content"]) == 12000
    first = call(
        library,
        "knowledge.text",
        {"action": "read", "id": item["id"], "version": current["version"]},
    )
    parts = [
        call(
            library,
            "knowledge.text",
            {"action": "read", "id": item["id"], "version": current["version"], "page": page},
        )["content"]
        for page in range(first["pages"])
    ]
    assert "".join(parts) == content
    assert current["original_sources"] and library.store.get(item["id"])["edited"]


# 过期版本、主动丢弃和索引故障均不能留下部分正文；失败稿可继续恢复。
def test_staging_conflict_discard_and_rollback(library, monkeypatch):
    item = library.store.save("原知识", "原内容")
    session = upload(library, item, "重组后" * 50000)
    library.store.save(item["title"], "并发编辑", item_id=item["id"])
    with pytest.raises(ValueError, match="已变化"):
        call(library, "knowledge.text", {"action": "commit", **session})
    assert library.store.get(item["id"])["content"] == "并发编辑"
    call(library, "knowledge.text", {"action": "discard", **session})
    assert not library.text.edits
    current = library.store.get(item["id"])
    session = upload(library, current, "新的长正文" * 30000)

    # 事务末尾索引失败，知识和原件快照一起回滚。
    def fail() -> None:
        raise sqlite3.OperationalError("synthetic failure")

    monkeypatch.setattr(library.store, "populate_library_index", fail)
    with pytest.raises(sqlite3.OperationalError):
        call(library, "knowledge.text", {"action": "commit", **session})
    assert library.store.get(item["id"])["content"] == "并发编辑"
    assert library.store.db.execute("SELECT count(*) FROM restructure_originals").fetchone()[0] == 0
    call(library, "knowledge.text", {"action": "discard", **session})


# 补充编辑只影响指定补充；非法分页和错误块顺序明确拒绝。
def test_supplement_staging_and_invalid_pages(library):
    from test_topics_store import draft

    item = library.store.save("手工笔记", "不替换")
    library.store.capture_topic(draft(target=item, content="补充原文"))
    current = library.store.get(item["id"])
    part = current["supplements"][0]
    session = upload(library, current, "补充长文" * 40000, supplement_id=part["id"])
    with pytest.raises(ValueError, match="顺序"):
        call(
            library, "knowledge.text", {"action": "append", **session, "offset": 0, "content": "x"}
        )
    call(library, "knowledge.text", {"action": "commit", **session})
    saved = call(library, "knowledge.get", {"id": item["id"]})
    assert saved["content"] == "不替换" and saved["supplements"][0]["content_chars"] == 160000
    for page in (-1, True, 999):
        with pytest.raises(ValueError, match="分页"):
            call(
                library,
                "knowledge.text",
                {
                    "action": "read",
                    "id": item["id"],
                    "version": saved["version"],
                    "supplement_id": part["id"],
                    "page": page,
                },
            )
