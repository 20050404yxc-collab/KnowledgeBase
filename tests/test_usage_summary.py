# 文件：test_usage_summary.py
# 层：验证
# 作用：验证全部历史 token 汇总和未知、币种边界。
# 说明：只使用临时数据库，不连接外部服务。
from knowledge_agent.infrastructure.sqlite_store import Store


# 超过明细上限时仍统计全部记录，并分别报告部分缺失用量与币种。
def test_all_history_summary_preserves_unknown_and_currencies(tmp_path):
    store = Store(tmp_path)
    try:
        assert store.usage_summary()["total_tokens"] == 0
        with store.db:
            store.db.executemany(
                """INSERT INTO attempts
                (id,purpose,provider,model,status,started_at,input_tokens,output_tokens,cost,currency)
                VALUES (?,'test','fixture','model','failed','2026-10-21',10,20,0.1,'USD')""",
                [(str(i),) for i in range(501)],
            )
            store.db.execute("""INSERT INTO attempts
                (id,purpose,provider,model,status,started_at,input_tokens,currency)
                VALUES ('missing','test','fixture','model','cancelled','2026-10-21',5,'CNY')""")
        summary = store.usage_summary()
        assert len(store.list_attempts()) == 500
        assert summary["calls"] == 502 and summary["successful"] == 0
        assert summary["input_tokens"] == 5015 and summary["output_tokens"] == 10020
        assert summary["total_tokens"] == 15035
        assert summary["missing_input"] == 0 and summary["missing_output"] == 1
        currencies = {item["currency"]: item for item in summary["currencies"]}
        assert currencies["USD"]["estimated"] == 501
        assert currencies["CNY"]["cost"] is None and currencies["CNY"]["unknown"] == 1
        with store.db:
            store.db.execute("UPDATE attempts SET input_tokens=NULL,output_tokens=NULL,cost=NULL")
        summary = store.usage_summary()
        assert summary["total_tokens"] is None and summary["input_tokens"] is None
        assert summary["missing_input"] == summary["missing_output"] == 502
    finally:
        store.close()
