// 文件：UsageSummary.tsx
// 层：React 页面／组件
// 作用：按币种汇总已知费用并保留未知用量提示。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 按币种汇总已知费用并保留未知用量提示。
export function UsageSummary() {
  const { attempts } = useAppContext()
  return (
    <div className="usage-summary">
      <div>
        <small>调用次数</small>
        <strong>{attempts.length}</strong>
      </div>
      <div>
        <small>成功调用</small>
        <strong>{attempts.filter((a) => a.status === 'success').length}</strong>
      </div>
      {['USD', 'CNY', 'EUR'].map((currency) => (
        <div key={currency}>
          <small>{currency} 已知费用估算</small>
          <strong>
            {attempts
              .filter((a) => a.currency === currency && a.cost !== null)
              .reduce((sum, a) => sum + (a.cost ?? 0), 0)
              .toFixed(6)}
          </strong>
        </div>
      ))}
    </div>
  )
}
