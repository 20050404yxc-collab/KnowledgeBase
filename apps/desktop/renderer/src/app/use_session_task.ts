// 文件：use_session_task.ts
// 层：React 应用会话
// 作用：持有跨页面生成任务、阶段请求、取消标志与进度。
// 说明：导航不改变任务；根卸载和明确取消才停止后续阶段。
import { useEffect, useRef, useState } from 'react'
import type { Operation, RequestMap, ResultMap } from '../../../../../contracts/desktop'
import type { Section } from './navigation'
import type { Feedback } from '../shared/api/use_feedback'
import { api, errorText } from '../shared/api/client'

// 每次任务固定发起页；请求标识只在实际调用阶段持有。
export function useSessionTask(section: Section, feedback: Feedback) {
  const [busy, setBusy] = useState<string | null>(null)
  const [taskOwner, setTaskOwner] = useState<Section>('探索')
  const [progress, setProgress] = useState('')
  const [streamChars, setStreamChars] = useState(0)
  const activeRequest = useRef<string | null>(null)
  const taskRunning = useRef(false)
  const mounted = useRef(true)
  const taskCancelled = useRef(false)
  useTaskEvents({ activeRequest, mounted, taskCancelled, setProgress, setStreamChars })
  // 一次流程含多个唯一请求；取消检查覆盖两个阶段之间。
  async function taskRequest<K extends Operation>(
    operation: K,
    params: RequestMap[K]
  ): Promise<ResultMap[K]> {
    if (taskCancelled.current || !mounted.current) {
      throw new Error('任务已停止；已保存内容保留')
    }
    const id = crypto.randomUUID()
    activeRequest.current = id
    try {
      return await api.request(operation, params, id)
    } catch (error) {
      // 超时或后台断线终止整个流程，不能在下一批隐式继续发起模型调用。
      if (/任务超时|后台.*(退出|断开|中断|不可用|重启|启动超时)/.test(errorText(error))) {
        taskCancelled.current = true
      }
      throw error
    } finally {
      if (activeRequest.current === id) {
        activeRequest.current = null
      }
    }
  }
  // 显式取消立即阻止后续阶段，但等待在途终态后才释放生成锁。
  async function cancelTask() {
    taskCancelled.current = true
    setProgress('正在取消；已保存内容保留')
    if (activeRequest.current) {
      await feedback.guarded(() => api.cancel(activeRequest.current ?? ''))
    }
  }
  // 生成流程的错误落回发起页，旧 finally 不可能释放下一项任务。
  async function runTask(action: () => Promise<void>) {
    if (taskRunning.current) {
      feedback.setError('已有任务正在执行，请从任务状态条返回或取消')
      return
    }
    taskRunning.current = true
    taskCancelled.current = false
    setBusy(crypto.randomUUID())
    setTaskOwner(section)
    setProgress('正在整理')
    setStreamChars(0)
    feedback.setError('')
    try {
      await action()
    } catch (error) {
      feedback.setError(errorText(error))
    } finally {
      taskRunning.current = false
      setBusy(null)
      setProgress('')
    }
  }
  return {
    busy,
    taskOwner,
    progress,
    setProgress,
    streamChars,
    setStreamChars,
    activeRequest,
    taskRunning,
    taskCancelled,
    mounted,
    taskRequest,
    runTask,
    cancelTask
  }
}

// 会话只订阅一次；根卸载取消实际在途请求，导航不会触发清理。
function useTaskEvents(
  state: Pick<
    ReturnType<typeof useSessionTask>,
    'activeRequest' | 'mounted' | 'taskCancelled' | 'setProgress' | 'setStreamChars'
  >
) {
  const { activeRequest, mounted, taskCancelled, setProgress, setStreamChars } = state
  // 所有页共用一份订阅，事件只能更新当前在途阶段。
  useEffect(() => {
    mounted.current = true
    const unsubscribe = api.onEvent((event) => {
      if (event.id !== activeRequest.current) {
        return
      }
      if (event.type === 'progress') {
        setProgress(event.message ?? '')
      } else {
        setStreamChars((count) => count + (event.delta?.length ?? 0))
      }
    })
    return () => {
      mounted.current = false
      taskCancelled.current = true
      unsubscribe()
      if (activeRequest.current) {
        void api.cancel(activeRequest.current).catch((error) => console.error(errorText(error)))
      }
    }
  }, [])
}
