// 文件：UsagePage.tsx
// 层：React 页面／组件
// 作用：组合调用记录摘要与明细表。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { UsageHeading } from './UsageHeading'
import { UsageSummary } from './UsageSummary'
import { UsageTable } from './UsageTable'

// 组合调用记录摘要与明细表。
export function UsagePage() {
  return (
    <>
      <UsageHeading />
      <UsageSummary />
      <UsageTable />
    </>
  )
}
