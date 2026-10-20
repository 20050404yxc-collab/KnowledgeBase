# 文件：usage_store.py
# 层：Python infrastructure
# 作用：汇总全部历史调用的已知 token 和按币种费用。
# 说明：SQL 聚合不受最近 500 条明细限制，未知用量保留空值。
import sqlite3


# 记录数、已知值和缺失数一起返回，避免部分用量被误解为完整账单。
def summarize_usage(db: sqlite3.Connection) -> dict:
    row = db.execute("""SELECT COUNT(*) AS calls,
        COUNT(CASE WHEN status='success' THEN 1 END) AS successful,
        SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        COUNT(*)-COUNT(input_tokens) AS missing_input,
        COUNT(*)-COUNT(output_tokens) AS missing_output FROM attempts""").fetchone()
    result = dict(row)
    # 没有调用时是确定的零；有记录但没有返回用量时仍为未知。
    if not result["calls"]:
        result.update(input_tokens=0, output_tokens=0)
    known = [result[key] for key in ("input_tokens", "output_tokens") if result[key] is not None]
    result["total_tokens"] = sum(known) if known else None
    result["currencies"] = [
        dict(item)
        for item in db.execute("""
        SELECT currency,SUM(cost) AS cost,COUNT(cost) AS estimated,
        COUNT(*)-COUNT(cost) AS unknown FROM attempts GROUP BY currency ORDER BY currency""")
    ]
    return result
