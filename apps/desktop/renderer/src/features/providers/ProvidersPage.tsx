// 文件：ProvidersPage.tsx
// 层：React 页面／组件
// 作用：组合接口配置页面及其说明。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { ProvidersHeading } from './ProvidersHeading'
import { ProviderSettings } from './ProviderSettings'

// 组合接口配置页面及其说明。
export function ProvidersPage() {
  return (
    <>
      <ProvidersHeading />
      <ProviderSettings />
    </>
  )
}
