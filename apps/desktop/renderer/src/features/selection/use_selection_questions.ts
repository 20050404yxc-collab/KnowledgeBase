// 文件：use_selection_questions.ts
// 层：React 交互 hook
// 作用：持有按发起页隔离的运行期选区会话、输入和保存草稿。
// 说明：模型请求复用应用任务锁；切页不会丢失或串用上下文。
import { useRef, useState } from 'react'
import type { GenerationOptions, Knowledge } from '../../../../../../contracts/desktop'
import type {
  SelectionAsk,
  SelectionSession,
  SelectionSource
} from '../../../../../../contracts/selection'
import type { Section } from '../../app/navigation'
import type { useSessionTask } from '../../app/use_session_task'
import { api, errorText } from '../../shared/api/client'
import { updateChatEntries, type ChatUpdate } from './selection_state'

export interface CaptureDraft {
  turn: string
  title: string
  content: string
  path: string[]
  target: Knowledge | null
}
export interface ChatEntry {
  owner: Section
  session: SelectionSession
  draft: string
  error: string
  preview: CaptureDraft | null
}
type Task = ReturnType<typeof useSessionTask>
type Dependencies = Pick<Task, 'runTask' | 'taskRequest' | 'taskRunning'> & {
  section: Section
  generationOptions: GenerationOptions
  reload: () => Promise<void>
}

// 根节点持有全部会话；异步返回只能更新原标识，已关闭会话不会复活。
export function useSelectionQuestions(deps: Dependencies) {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [active, setActive] = useState<Partial<Record<Section, string>>>({})
  const [visible, setVisible] = useState(false)
  const [openingError, setOpeningError] = useState('')
  const opening = useRef(false)
  const saving = useRef(false)
  const previewSequence = useRef(0)
  const [savingId, setSavingId] = useState('')
  const patch = (id: string, value: ChatUpdate) =>
    setEntries((items) => updateChatEntries(items, id, value))
  // 来源和页归属在打开时冻结；拒绝连续点击产生重复会话。
  async function open(source: SelectionSource, quote: string) {
    if (opening.current) {
      return
    }
    opening.current = true
    const owner = deps.section
    try {
      const session = await api.request('selection.open', { source, quote })
      setEntries((items) => [...items, { owner, session, draft: '', error: '', preview: null }])
      setActive((items) => ({ ...items, [owner]: session.id }))
      setOpeningError('')
      setVisible(true)
    } catch (error) {
      setOpeningError(errorText(error))
      setVisible(true)
    } finally {
      opening.current = false
    }
  }
  // 本地检索成功无命中才自动生成；任何错误都刷新后台终态并保留草稿。
  async function ask(entry: ChatEntry, params: Omit<SelectionAsk, 'session_id'>) {
    if (deps.taskRunning.current) {
      return
    }
    const id = entry.session.id
    await deps.runTask(async () => {
      patch(id, { error: '' })
      try {
        const session = await deps.taskRequest('selection.ask', {
          ...deps.generationOptions,
          ...params,
          session_id: id
        })
        patch(id, { session, ...(params.action === 'lookup' ? { draft: '' } : {}) })
      } catch (error) {
        try {
          patch(id, { session: await api.request('selection.get', { session_id: id }) })
        } catch {
          // 断线时保留已有展示，不把缺失会话当作空成功。
        }
        patch(id, { error: errorText(error) })
      }
    })
  }
  const actions = selectionActions({
    setEntries,
    patch,
    saving,
    previewSequence,
    setSavingId,
    reload: deps.reload
  })
  return {
    entries,
    active,
    setActive,
    visible,
    setVisible,
    openingError,
    savingId,
    patch,
    open,
    ask,
    ...actions
  }
}

type Actions = {
  setEntries: React.Dispatch<React.SetStateAction<ChatEntry[]>>
  patch: (id: string, value: ChatUpdate) => void
  saving: React.RefObject<boolean>
  previewSequence: React.RefObject<number>
  setSavingId: (id: string) => void
  reload: () => Promise<void>
}
// 预览和提交均不调用模型；失败保留编辑内容，保存后只刷新列表。
function selectionActions(state: Actions) {
  async function preview(entry: ChatEntry, turn: string) {
    const sequence = ++state.previewSequence.current
    try {
      const value = await api.request('selection.preview', {
        session_id: entry.session.id,
        turn_id: turn
      })
      // 只允许最后一次明确打开的预览落地，旧结果不能覆盖已编辑草稿。
      if (sequence !== state.previewSequence.current) {
        return
      }
      state.patch(entry.session.id, {
        preview: { ...value, turn, path: entry.session.category_path, target: null },
        error: ''
      })
    } catch (error) {
      state.patch(entry.session.id, { error: errorText(error) })
    }
  }
  async function capture(entry: ChatEntry) {
    if (!entry.preview || state.saving.current) {
      return
    }
    state.saving.current = true
    state.setSavingId(entry.session.id)
    const draft = entry.preview
    try {
      const session = await api.request('selection.capture', {
        session_id: entry.session.id,
        turn_id: draft.turn,
        title: draft.title,
        content: draft.content,
        category_path: draft.path,
        target_id: draft.target?.id,
        version: draft.target?.version
      })
      state.patch(session.id, { session, preview: null, error: '' })
      await state.reload()
    } catch (error) {
      state.patch(entry.session.id, { error: errorText(error) })
    } finally {
      state.saving.current = false
      state.setSavingId('')
    }
  }
  async function close(entry: ChatEntry) {
    try {
      await api.request('selection.close', { session_id: entry.session.id })
      state.setEntries((items) => items.filter((item) => item.session.id !== entry.session.id))
    } catch (error) {
      state.patch(entry.session.id, { error: errorText(error) })
    }
  }
  return { preview, capture, close }
}
