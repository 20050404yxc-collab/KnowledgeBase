// 文件：use_restructure.ts
// 层：React 交互 hook
// 作用：推进有界重构阶段、分页预览和显式应用。
// 说明：根会话持有草案；页面卸载不取消工作或丢失确认选择。
import { useRef, useState } from 'react'
import type {
  GenerationOptions,
  PreviewKind,
  StructureReview,
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
    setPreview,
    selectedUpdates,
    setSelectedUpdates,
    feedback,
    setRestructureFeedback
  } = state
  const { advance, showPreview } = useRestructureProgress(options, state)
  // 意见调整复用同一草案的分析与当前目录，只撤销过期确认和最终选择。
  const plan = () =>
    options.runTask(async () => {
      const value = await options.taskRequest('library.restructure.plan', {
        ...options.generationOptions,
        ...(draft ?? {}),
        feedback
      })
      state.activeDraft.current = value
      setDraft(value)
      setSelectedUpdates([])
      await advance(value)
    })
  const resume = () =>
    options.runTask(async () => {
      if (draft) {
        await advance(draft, draft.phase === 'preparing' || draft.phase === 'duplicates', true)
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
  const review = useStructureReview(options, state, { advance, showPreview })
  return {
    reviewRestructure: review,
    restructureDraft: draft,
    restructurePreview: state.preview,
    selectedUpdates,
    setSelectedUpdates,
    restructureFeedback: feedback,
    setRestructureFeedback,
    planRestructure: plan,
    resumeRestructure: resume,
    prepareRestructure: prepare,
    applyRestructure: apply,
    discardRestructure: discard,
    previewRestructure: (kind: PreviewKind, page: number, evidencePage = 0, textPage = 0) =>
      options.guarded(() => showPreview(draft, kind, page, evidencePage, textPage))
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
    kind: PreviewKind = 'outline',
    page = 0,
    evidencePage = 0,
    textPage = 0
  ) {
    if (!value) {
      return
    }
    const sequence = ++state.previewSequence.current
    const result = await api.request('library.restructure.preview', {
      ...value,
      kind,
      page,
      text_page: textPage,
      evidence_page: evidencePage
    })
    if (
      sequence === state.previewSequence.current &&
      state.activeDraft.current?.draft_id === value.draft_id &&
      state.activeDraft.current.revision === value.revision
    ) {
      state.setPreview(result)
    }
  }
  // 模型每次请求独立超时；同一会话任务约束全部阶段。
  async function advance(current: RestructureSummary, prepare = false, retry = false) {
    let value = current
    let initial = true
    try {
      while (
        (retry && value.status === 'paused') ||
        (prepare
          ? value.status === 'preparing' || (initial && value.status === 'outline')
          : value.status === 'planning')
      ) {
        value = prepare
          ? await options.taskRequest('library.restructure.prepare', { ...value, retry })
          : await options.taskRequest('library.restructure.plan', {
              ...value,
              advance: true,
              retry
            })
        initial = false
        retry = false
        state.activeDraft.current = value
        state.setDraft(value)
      }
    } catch (error) {
      try {
        const result = await api.request('library.restructure.preview', {
          ...value,
          kind: 'summary'
        })
        if (result.summary && state.activeDraft.current?.revision === value.revision) {
          state.activeDraft.current = result.summary
          state.setDraft(result.summary)
        }
      } catch {
        // 后台退出或草案失效时保留原始请求错误。
      }
      throw error
    }
    await showPreview(
      value,
      value.status === 'paused'
        ? 'records'
        : value.status === 'outline'
          ? 'outline'
          : prepare
            ? 'suggestions'
            : 'outline',
      0
    )
  }
  return { advance, showPreview }
}

// 结构纠正只影响当前修订，清除内容选择后再更新相关分页。
function useStructureReview(
  options: Options,
  state: ReturnType<typeof useRestructureState>,
  progress: ReturnType<typeof useRestructureProgress>
) {
  const { draft, setDraft, setSelectedUpdates, setPreview } = state
  const { advance, showPreview } = progress
  // 结构纠正立即更新修订并清除最终选择，继续分析仍受单任务约束。
  const review = (review: StructureReview) =>
    options.runTask(async () => {
      if (!draft) {
        return
      }
      const value = await options.taskRequest('library.restructure.plan', { ...draft, review })
      state.activeDraft.current = value
      setDraft(value)
      setSelectedUpdates([])
      setPreview(EMPTY_PREVIEW)
      if (value.status === 'planning') {
        await advance(value)
      } else {
        await showPreview(
          value,
          review.action === 'point' ? 'outline' : 'duplicates',
          review.action === 'point' ? 0 : state.preview.page
        )
      }
    })
  return review
}
