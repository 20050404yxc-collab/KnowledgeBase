// 文件：UsageSummary.tsx
// 层：React 页面／组件
// 作用：显示全部历史 token、缺失用量和分币种费用估算。
// 说明：未知保持未知，部分记录有用量时明确标示为已知小计。
import { useAppContext } from '../../app/AppContext'

// 汇总由后台全量聚合，不能拿最近 500 条明细冒充全部历史。
export function UsageSummary() {
  const { usageSummary: summary } = useAppContext()
  if (!summary) {
    return <p role="status">正在读取用量汇总…</p>
  }
  const partial = summary.missing_input > 0 || summary.missing_output > 0
  return (
    <>
      <div className="usage-summary">
        <Metric label="调用次数" value={summary.calls} />
        <Metric label="成功调用" value={summary.successful} />
        <Metric label={partial ? '已知 token 小计' : '总 token'} value={summary.total_tokens} />
        <Metric label="已知输入 token" value={summary.input_tokens} />
        <Metric label="已知输出 token" value={summary.output_tokens} />
        {summary.currencies.map((item) => (
          <div key={item.currency}>
            <small>{item.currency} 已知费用估算</small>
            <strong>{item.cost === null ? '未知' : item.cost.toFixed(6)}</strong>
            <small>
              {item.estimated} 条可估算 · {item.unknown} 条未知
            </small>
          </div>
        ))}
      </div>
      {partial && (
        <p className="subtle">
          {summary.missing_input} 条缺少输入用量，{summary.missing_output}{' '}
          条缺少输出用量；已知小计不代表完整用量。
        </p>
      )}
      <p className="subtle">
        费用按调用时保存的模型价格估算，仅供参考；无价格或无完整用量的记录保持未知。
      </p>
    </>
  )
}

// 空值不会通过格式化退化成零。
function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value === null ? '未知' : value.toLocaleString('zh-CN')}</strong>
    </div>
  )
}
