// 文件：use_restructure.ts
// 层：React 交互 hook
// 作用：推进有界重构阶段、分页预览和显式应用。
// 说明：根会话持有草案；页面卸载不取消工作或丢失确认选择。
import { useRef, useState } from 'react'
import type {
  GenerationOptions,
  RestructureSummary,
  RestructurePreview
} from '../../../../../../contracts/desktop'
import type { useSessionTask } from '../../app/use_session_task'
import { api } from '../../shared/api/client'
import type { Feedback } from '../../shared/api/use_feedback'

type Options = ReturnType<typeof useSessionTask> &
  Feedback & { generationOptions: GenerationOptions; reload: () => Promise<void> }
const EMPTY_PREVIEW: RestructurePreview = { outline: [], suggestions: [], total: 0, page: 0 }

// 准备与应用是不同按钮，进入页面和查看预览都不代表确认。
export function useRestructure(options: Options) {
  const state = useRestructureState()
  const {
    draft,
    setDraft,
    preview,
    setPreview,
    selectedUpdates,
    setSelectedUpdates,
    feedback,
    setRestructureFeedback
  } = state
  const { advance, showPreview } = useRestructureProgress(options, state)
  // 重新规划明确废弃旧目录及更新选择，不能沿用原确认。
  const plan = () =>
    options.runTask(async () => {
      const value = await options.taskRequest('library.restructure.plan', {
        ...options.generationOptions,
        ...(draft ?? {}),
        feedback
      })
      state.activeDraft.current = value
      setDraft(value)
      setPreview(EMPTY_PREVIEW)
      setSelectedUpdates([])
      await advance(value)
    })
  const resume = () =>
    options.runTask(async () => {
      if (draft) {
        await advance(draft, draft.status === 'preparing')
      }
    })
  const prepare = () =>
    options.runTask(async () => {
      if (draft) {
        setPreview(EMPTY_PREVIEW)
        await advance(draft, true)
      }
    })
  // 最后确认才提交；成功刷新全库与各分区，恢复点名称可供用户定位。
  const apply = (directoryOnly: boolean) =>
    options.runTask(async () => {
      if (!draft) {
        return
      }
      const result = await options.taskRequest('library.restructure.apply', {
        ...draft,
        selected: directoryOnly ? [] : selectedUpdates
      })
      setDraft({ ...draft, status: 'applied' })
      options.setMessage(`已重构 ${result.count} 条知识；恢复点：${result.backup}`)
      await options.reload()
    })
  const discard = () =>
    options.guarded(async () => {
      if (draft) {
        await api.request('library.restructure.discard', draft)
        state.activeDraft.current = null
        state.previewSequence.current++
        setDraft(null)
        setPreview(EMPTY_PREVIEW)
        setSelectedUpdates([])
      }
    })
  return {
    restructureDraft: draft,
    restructurePreview: preview,
    selectedUpdates,
    setSelectedUpdates,
    restructureFeedback: feedback,
    setRestructureFeedback,
    planRestructure: plan,
    resumeRestructure: resume,
    prepareRestructure: prepare,
    applyRestructure: apply,
    discardRestructure: discard,
    previewRestructure: (kind: 'outline' | 'suggestions', page: number) =>
      options.guarded(() => showPreview(draft, kind, page))
  }
}

// 草案与勾选状态由根会话持有，导航卸载展示组件不会清除。
function useRestructureState() {
  const activeDraft = useRef<RestructureSummary | null>(null)
  const previewSequence = useRef(0)
  const [draft, setDraft] = useState<RestructureSummary | null>(null)
  const [preview, setPreview] = useState(EMPTY_PREVIEW)
  const [selectedUpdates, setSelectedUpdates] = useState<string[]>([])
  const [feedback, setRestructureFeedback] = useState('')
  return {
    activeDraft,
    previewSequence,
    draft,
    setDraft,
    preview,
    setPreview,
    selectedUpdates,
    setSelectedUpdates,
    feedback,
    setRestructureFeedback
  }
}

// 阶段推进与预览版本分开；重规划和丢弃后旧预览不能覆盖新草案。
function useRestructureProgress(options: Options, state: ReturnType<typeof useRestructureState>) {
  async function showPreview(
    value = state.draft,
    kind: 'outline' | 'suggestions' = 'outline',
    page = 0
  ) {
    if (!value) {
      return
    }
    const sequence = ++state.previewSequence.current
    const result = await api.request('library.restructure.preview', { ...value, kind, page })
    if (
      sequence === state.previewSequence.current &&
      state.activeDraft.current?.draft_id === value.draft_id
    ) {
      state.setPreview(result)
    }
  }
  // 模型每次请求独立超时；同一会话任务约束全部阶段。
  async function advance(current: RestructureSummary, prepare = false) {
    let value = current
    while (
      prepare ? ['outline', 'preparing'].includes(value.status) : value.status === 'planning'
    ) {
      value = prepare
        ? await options.taskRequest('library.restructure.prepare', value)
        : await options.taskRequest('library.restructure.plan', { ...value, advance: true })
      state.activeDraft.current = value
      state.setDraft(value)
    }
    await showPreview(value, prepare ? 'suggestions' : 'outline', 0)
  }
  return { advance, showPreview }
}
