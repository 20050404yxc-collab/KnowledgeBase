// 文件：use_provider_form.ts
// 层：React 交互 hook
// 作用：持有新增接口表单及保存和测试中的状态。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useState } from 'react'

import { blankProvider } from './provider_form'

// 持有新增接口表单及保存和测试中的状态。
export function useProviderForm() {
  const [providerForm, setProviderForm] = useState(blankProvider)

  return { providerForm, setProviderForm }
}
