// 文件：use_exploration.ts
// 层：React 交互 hook
// 作用：协调附件状态、提问、请求事件和资料保留。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useEffect, useRef, useState } from 'react'
import type { GenerationOptions, Scope } from '../../../../../../contracts/desktop'
import { api, errorText } from '../../shared/api/client'

import { requireAttachmentId, type Attached } from './attachment_state'
import type { Feedback } from '../../shared/api/use_feedback'
import type { Navigation } from '../../app/use_navigation'
import type { Library } from '../../app/use_library'
import type { Reading } from '../knowledge'

// 协调附件状态、提问、请求事件和资料保留。
// 本 hook 只持有状态，动作通过显式能力对象访问。
function useExplorationState() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('mixed')
  const [attachments, setAttachments] = useState<Attached[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [streamChars, setStreamChars] = useState(0)
  const [pathEntry, setPathEntry] = useState<string | null>(null)
  const activeRequest = useRef<string | null>(null)
  return {
    query,
    setQuery,
    scope,
    setScope,
    attachments,
    setAttachments,
    busy,
    setBusy,
    progress,
    setProgress,
    streamChars,
    setStreamChars,
    pathEntry,
    setPathEntry,
    activeRequest
  }
}
type ExplorationState = ReturnType<typeof useExplorationState>

// 将提问、附件和请求事件绑定到当前应用会话。
export function useExploration(
  options: Feedback & Library & Reading & Navigation & { generationOptions: GenerationOptions }
) {
  const state = useExplorationState()
  const combined = { ...options, ...state }
  const { activeRequest, setProgress, setStreamChars } = state
  const ask = (text = state.query, expansion = false) => askAction(combined, text, expansion)
  const addFiles = (paths: string[]) => addFilesAction(combined, paths)
  const removeAttachment = (item: Attached) => removeAttachmentAction(combined, item)
  const retain = (item: Attached) => retainAction(combined, item)

  useEffect(
    // 按当前请求关联接收进度，effect 返回退订函数避免重复监听。
    () =>
      api.onEvent((event) => {
        if (event.id !== activeRequest.current) {
          return
        }
        if (event.type === 'progress') {
          setProgress(event.message ?? '')
        }
        if (event.type === 'stream') {
          setStreamChars((count) => count + (event.delta?.length ?? 0))
        }
      }),
    [activeRequest, setProgress, setStreamChars]
  )
  return { ...state, ask, addFiles, removeAttachment, retain }
}

// 完整回答到达前仅显示进度，终态统一释放忙碌状态。
async function askAction(
  state: Feedback &
    Library &
    Reading &
    Navigation &
    ExplorationState & { generationOptions: GenerationOptions },
  text: string,
  expansion = false
) {
  const {
    setError,
    setMessage,
    setSection,
    reload,
    setAnswer,
    setSelected,
    setRecommendations,
    scope,
    attachments,
    setBusy,
    setProgress,
    setStreamChars,
    activeRequest
  } = state

  // 空输入和重复提交在界面侧提前结束；附件未就绪时允许用户先移除。
  if (!text.trim() || activeRequest.current) {
    return
  }
  if (!expansion && attachments.some((a) => a.state === 'loading')) {
    setError('附件仍在解析，请等待完成或移除后提问')
    return
  }
  const id = crypto.randomUUID()
  // 提交时清空上一轮显示，并以本次 ID 关联后续事件与取消。
  activeRequest.current = id
  setBusy(id)
  setProgress('正在检索')
  setStreamChars(0)
  setError('')
  setMessage('')
  setSelected(null)
  setAnswer(null)
  setRecommendations([])
  try {
    const value = await api.request(
      'question',
      {
        query: text,
        ...state.generationOptions,
        scope: requestScope(scope, attachments, expansion),
        attachment_ids: expansion
          ? []
          : attachments.filter((a) => a.state === 'ready').map(requireAttachmentId),
        purpose: expansion ? 'expansion' : 'question'
      },
      id
    )
    setAnswer(value)
    // 只在完整终态到达后展示知识和推荐，流片段不表示收录。
    setSelected(value.knowledge ?? null)
    setRecommendations(value.recommendations)
    setSection('探索')
    void reload()
  } catch (err) {
    setError(errorText(err))
  } finally {
    // 所有终态释放忙碌状态，旧事件之后不会再被认作当前请求。
    activeRequest.current = null
    setBusy(null)
    setProgress('')
  }
}

// 逐个登记附件；重复内容由后台指纹去重。
async function addFilesAction(
  state: Feedback &
    Library &
    Reading &
    Navigation &
    ExplorationState & { generationOptions: GenerationOptions },
  paths: string[]
) {
  const { setAttachments } = state

  for (const path of paths.slice(0, 20)) {
    // 本地标识在解析前就存在，用于取消在途请求及显示解析失败。
    const localId = crypto.randomUUID()
    const name = path.split(/[\\/]/).pop() || path
    setAttachments((current) => [...current, { localId, path, name, state: 'loading' }])
    try {
      const result = await api.request('attachments.add', { path }, localId)
      // 同内容附件保留首个可见条目，避免多个本地条目指向同一后台副本。
      setAttachments((current) =>
        current.some((a) => a.id === result.id && a.localId !== localId)
          ? current.filter((a) => a.localId !== localId)
          : current.map((a) => (a.localId === localId ? { ...a, ...result, state: 'ready' } : a))
      )
    } catch (err) {
      setAttachments((current) =>
        current.map((a) =>
          a.localId === localId ? { ...a, state: 'error', error: errorText(err) } : a
        )
      )
    }
  }
}

// 解析中发送取消，已完成则释放会话副本。
async function removeAttachmentAction(
  state: Feedback &
    Library &
    Reading &
    Navigation &
    ExplorationState & { generationOptions: GenerationOptions },
  item: Attached
) {
  const { guarded, setAttachments } = state

  await guarded(async () => {
    if (item.state === 'loading') {
      await api.cancel(item.localId)
    } else if (item.id) {
      await api.request('attachments.remove', { id: requireAttachmentId(item) })
    }
    setAttachments((current) => current.filter((a) => a.localId !== item.localId))
  })
}

// 保留成功后再更新界面中的资料状态。
async function retainAction(
  state: Feedback &
    Library &
    Reading &
    Navigation &
    ExplorationState & { generationOptions: GenerationOptions },
  item: Attached
) {
  const { setMessage, guarded, setSources, setAttachments } = state

  await guarded(async () => {
    const value = await api.request('sources.retain', { id: requireAttachmentId(item) })
    setSources(value)
    setAttachments((current) =>
      current.map((a) => (a.id === item.id ? { ...a, retained: true } : a))
    )
    setMessage('资料已保留；删除或修改原路径文件不会改变保存的副本')
  })
}

// 无附件时沿用本地知识范围；显式文件范围仍由后台提示缺少附件。
function requestScope(scope: Scope, attachments: Attached[], expansion: boolean): Scope {
  if (expansion) {
    return 'knowledge'
  }
  if (attachments.some((item) => item.state === 'ready') || scope === 'files') {
    return scope
  }
  return 'knowledge'
}
