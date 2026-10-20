// 文件：ProviderSettings.tsx
// 层：React 页面／组件
// 作用：组合接口列表与新增接口表单。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { ProviderList } from './ProviderList'
import { ProviderForm } from './ProviderForm'

// 组合接口列表与新增接口表单。
export function ProviderSettings() {
  return (
    <div className="settings-grid">
      <ProviderList />
      <ProviderForm />
    </div>
  )
}
