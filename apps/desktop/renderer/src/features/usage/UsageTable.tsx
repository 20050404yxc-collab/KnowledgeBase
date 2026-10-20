// 文件：UsageTable.tsx
// 层：React 页面／组件
// 作用：展示每次模型尝试的终态、用量及价格快照。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 展示每次模型尝试的终态、用量及价格快照。
export function UsageTable() {
  const { attempts } = useAppContext()
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {['时间 / 用途', '接口 / 模型', '结果', '输入', '输出', '耗时', '费用估算'].map(
              (label) => (
                <th key={label}>{label}</th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id}>
              <td>
                {new Date(a.started_at).toLocaleString('zh-CN')}
                <small>{a.purpose}</small>
              </td>
              <td>
                {a.provider}
                <small>{a.model}</small>
              </td>
              <td>{a.status}</td>
              <td>{a.input_tokens ?? '未知'}</td>
              <td>{a.output_tokens ?? '未知'}</td>
              <td>{a.elapsed_ms} ms</td>
              <td>{a.cost === null ? '未知' : `${a.currency} ${a.cost.toFixed(6)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!attempts.length && (
        <div className="empty-state">
          <h3>还没有调用记录</h3>
          <p>本地搜索和编辑知识不会产生 API 用量。</p>
        </div>
      )}
    </div>
  )
}
