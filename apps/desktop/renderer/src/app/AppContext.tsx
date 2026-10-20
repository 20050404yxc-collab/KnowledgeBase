// 文件：AppContext.tsx
// 层：React 应用上下文
// 作用：向页面提供已组合的功能会话。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { createContext, useContext } from 'react'
import type { AppModel } from './use_app_model'
export const AppContext = createContext<AppModel | null>(null)
// 页面只在应用提供的会话内读取状态，挂载错误明确失败。
export function useAppContext(): AppModel {
  const model = useContext(AppContext)
  if (!model) {
    throw new Error('缺少应用状态')
  }
  return model
}
