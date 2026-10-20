// 文件：SourcesPage.tsx
// 层：React 页面／组件
// 作用：组合资料库标题和已保留资料列表。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { SourcesHeading } from './SourcesHeading'
import { SourceList } from './SourceList'

// 组合资料库标题和已保留资料列表。
export function SourcesPage() {
  return (
    <>
      <SourcesHeading />
      <SourceList />
    </>
  )
}
