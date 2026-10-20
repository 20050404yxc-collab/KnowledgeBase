// 文件：use_navigation.ts
// 层：React 交互 hook
// 作用：持有当前页面、筛选词和数据路径展示状态。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useState } from 'react'

import { type Section } from './navigation'

// 持有当前页面、筛选词和数据路径展示状态。
export function useNavigation() {
  const [section, setSection] = useState<Section>('探索')
  const [filter, setFilter] = useState('')
  const bodySection = ['探索', '常用', '在学', '归档'].includes(section)

  return { section, setSection, filter, setFilter, bodySection }
}
export type Navigation = ReturnType<typeof useNavigation>
