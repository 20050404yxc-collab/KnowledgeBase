# 文件：test_candidate_picker.py
# 层：验证
# 作用：保护完整草案候选的标题路径搜索、分页与稳定标识。
# 说明：使用真实仓库和草案摘要，不发起模型调用或计入使用次数。
import pytest
from test_library import call
from test_library import library as library_fixture

# 复用隔离装配，不替换真实摘要和分页行为。
library = library_fixture


# 超过普通列表上限的候选全部可达；同名按完整路径区分且不泄露正文。
def test_complete_searchable_candidate_pages_and_names(library):
    store = library.store
    for index in range(205):
        store.save("同名知识", f"独立正文{index}", classification_path=["领域", f"分支{index:03}"])
    ref = call(library, "library.restructure.plan")
    draft = library.library.draft
    draft["outline"] = [
        {
            "id": item["id"],
            "title": item["title"],
            "old_path": item["category_path"],
            "category_path": item["category_path"],
            "category": "领域",
            "subcategory": item["category_path"][1],
            "reason": "合成分类",
        }
        for item in draft["items"]
    ]
    draft["status"] = "outline"
    ids = []
    for page in range(7):
        result = call(
            library, "library.restructure.preview", {**ref, "kind": "outline", "page": page}
        )
        assert result["total"] == 205
        assert len(result["outline"]) <= 30
        assert all("content" not in value for value in result["outline"])
        ids.extend(value["id"] for value in result["outline"])
    assert len(ids) == len(set(ids)) == 205
    result = call(
        library,
        "library.restructure.preview",
        {**ref, "kind": "outline", "query": "同名知识 分支204"},
    )
    assert result["total"] == 1
    assert result["outline"][0]["category_path"] == ["领域", "分支204"]
    new = call(
        library,
        "library.restructure.plan",
        {**ref, "review": {"action": "candidate", "sources": ids[-2:]}},
    )
    group = call(library, "library.restructure.preview", {**new, "kind": "duplicates"})[
        "duplicates"
    ][0]
    assert {item["id"] for item in group["source_details"]} == set(ids[-2:])
    assert all(
        item["title"] == "同名知识" and len(item["path"]) == 2 for item in group["source_details"]
    )
    with pytest.raises(ValueError, match="失效"):
        call(library, "library.restructure.preview", {**ref, "kind": "outline"})
    assert store.db.execute("SELECT count(*) FROM uses").fetchone()[0] == 0
    assert library.client.calls == []


# 非法页和搜索字段拒绝而非静默截断，候选选择仍遵守二到八项规则。
def test_candidate_query_and_selection_validation(library):
    library.store.save("候选标题", "正文")
    ref = call(library, "library.restructure.plan")
    for query in [False, [], "字" * 201]:
        with pytest.raises(ValueError, match="无效"):
            call(library, "library.restructure.preview", {**ref, "kind": "outline", "query": query})
    with pytest.raises(ValueError, match="分页无效"):
        call(library, "library.restructure.preview", {**ref, "kind": "outline", "page": -1})
