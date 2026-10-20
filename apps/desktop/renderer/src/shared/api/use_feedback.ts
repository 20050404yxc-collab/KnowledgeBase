// 文件：use_feedback.ts
// 层：React 交互 hook
// 作用：统一管理操作提示并显示异步错误。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useEffect } from 'react'

import { usePageState } from '../use_page_state'

import { errorText, reportFeedback } from './client'

// 统一管理操作提示并显示异步错误。
export function useFeedback(page: string) {
  const [error, setError] = usePageState(page, '')
  const [message, setMessage] = usePageState(page, '')
  // 只在当前页面实际有错误提示时报告，切页后的异步结果仍归原页面状态。
  useEffect(() => {
    if (error) {
      reportFeedback(error)
    }
  }, [error, page])
  // 统一清空旧提示并显示受控错误，不吞掉成功提交状态。
  async function guarded(action: () => Promise<void>) {
    setError('')
    setMessage('')
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return { error, setError, message, setMessage, guarded }
}
export type Feedback = ReturnType<typeof useFeedback>
