// 文件：UsageHeading.tsx
// 层：React 页面／组件
// 作用：显示用量页面标题并提供记录刷新入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示用量页面标题并提供记录刷新入口。
export function UsageHeading() {
  const { loadUsage } = useAppContext()
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">USAGE & COSTS</div>
        <h1>每一次调用，都心中有数。</h1>
        <p>
          总览统计全部历史调用，明细展示最近 500 次。token
          按接口实际返回汇总；只有配置了价格才能估算费用，各币种分别统计。
        </p>
      </div>
      <button onClick={() => void loadUsage()}>刷新记录</button>
    </div>
  )
}
