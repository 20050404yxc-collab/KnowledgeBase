// 文件：use_directory.ts
// 层：React 交互 hook
// 作用：关联本地检索、知识目录和选中项学习请求。
// 说明：与探索共用忙碌标识，切页及选择变化拒绝晚到结果。
import { useEffect, useRef } from 'react'
import { usePageState } from '../../shared/use_page_state'
import type {
  DirectoryPoint,
  GenerationOptions,
  LearnInput,
  QuestionPlan,
  ProjectContext,
  RequestMap,
  SearchResult
} from '../../../../../../contracts/desktop'
import type { BatchOutcome } from './directory_batch'
import { generateBatch } from './directory_batch'
import { api, errorText } from '../../shared/api/client'
import type { Feedback } from '../../shared/api/use_feedback'
import type { Reading } from '../knowledge'
import type { Navigation } from '../../app/use_navigation'
import type { useExploration } from './use_exploration'

export type DirectoryOptions = Feedback &
  Reading &
  Navigation &
  ReturnType<typeof useExploration> & {
    generationOptions: GenerationOptions
    reload: () => Promise<void>
    openItem: (id: string) => Promise<void>
  }
type Options = DirectoryOptions

// 每份目录保留原查询分页条件，修改输入框不会让下一页跳到另一个查询。
function useDirectoryState(options: Options) {
  const page = options.section
  const [directory, setDirectory] = usePageState<QuestionPlan | null>(page, null)
  const [searchResult, setSearchResult] = usePageState<SearchResult | null>(page, null)
  const [selectedPoint, setSelectedPoint] = usePageState<DirectoryPoint | null>(page, null)
  const [targetId, setTargetId] = usePageState(page, '')
  const [reviewing, setReviewing] = usePageState(page, false)
  const [projectContext, setProjectContext] = usePageState<ProjectContext | null>(page, null)
  const [checkedPoints, setCheckedPoints] = usePageState<string[]>(page, [])
  const [outcomes, setOutcomes] = usePageState<Record<string, BatchOutcome>>(page, {})
  const [questionDraft, setQuestionDraft] = usePageState(page, '')
  const paramsByPage = useRef<Record<string, { current: RequestMap['knowledge.search'] }>>({})
  const searchParams = (paramsByPage.current[page] ??= { current: { query: '', page: 0 } })
  const { ownRequest, mounted, run } = useDirectoryRequests(options)

  const state = {
    directory,
    setDirectory,
    searchResult,
    setSearchResult,
    selectedPoint,
    setSelectedPoint,
    targetId,
    setTargetId,
    reviewing,
    setReviewing,
    projectContext,
    setProjectContext,
    checkedPoints,
    setCheckedPoints,
    outcomes,
    setOutcomes,
    questionDraft,
    setQuestionDraft,
    searchParams,
    ownRequest,
    mounted
  }
  useProjectRevocation(
    {
      ...options,
      query: page === '探索' ? options.query : questionDraft,
      resetProjectPreviews: () => {
        // 完整撤销使项目预览失效，保留已保存结果与无项目依赖的补充。
        setOutcomes((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([, item]) => item.answer?.knowledge || !item.point.project_required
            )
          )
        )
        if (selectedPoint?.project_required && options.answer?.review) {
          setReviewing(false)
          options.setAnswer(null)
        }
      }
    },
    directory,
    selectedPoint,
    setProjectContext,
    targetId
  )
  return { ...state, run }
}

// 目录状态和请求生命周期归同一 hook，批量调用仍受全局忙碌和取消约束。
export function useDirectory(options: Options) {
  const state = useDirectoryState(options)
  const { directory, setSelectedPoint, setReviewing, setProjectContext, run } = state
  return {
    ...state,
    cancelTask: async () => {
      // 撤销后续步骤和详情所有权，即使取消刚好发生在两次请求之间也有效。
      options.selectionSequence.current++
      for (const point of directory?.points ?? []) {
        revokeProject(directory, point)
      }
      setProjectContext(null)
      if (options.activeRequest.current) {
        await options.guarded(() => api.cancel(options.activeRequest.current ?? ''))
      }
    },
    openLocalItem: async (id: string) => {
      setSelectedPoint(null)
      setReviewing(false)
      await options.openItem(id)
    },
    buildDirectory: (query = options.query) => run(() => planAction({ ...options, query }, state)),
    localSearch: (page?: number) => run(() => searchAction(options, state, page)),
    selectPoint: (point: DirectoryPoint) => selectPointAction(options, state, point),
    learnBatch: (ids: string[], attachmentIds?: string[]) =>
      run(() => batchAction(options, state, ids, attachmentIds)),
    learnPoint: (action: LearnInput['action'], extra: Partial<LearnInput> = {}) =>
      run(() => learnAction(options, state, action, extra))
  }
}

// 批量补充预览留在对应目录项，主动选取后才能核对和提交。
async function selectPointAction(options: Options, state: State, point: DirectoryPoint) {
  options.selectionSequence.current++
  state.setSelectedPoint(point)
  state.setTargetId(point.target_id)
  const cached = state.outcomes[point.id]?.answer
  state.setReviewing(!!cached?.review && !cached.knowledge)
  options.setAnswer(cached ?? null)
  options.setSelected(cached?.knowledge ?? null)
  options.setRecommendations(cached?.recommendations ?? [])
  // 缓存中的预览优先；已有知识则读取最新持久化详情。
  if (point.target_id && !cached?.review) {
    await options.openItem(point.target_id)
  }
}

// 同一次选择固定模型与目录快照；已完成项不再调用模型，结果逐项可见。
async function batchAction(
  options: Options,
  state: State,
  ids: string[],
  attachmentIds?: string[]
) {
  if (!state.directory?.plan_id || options.attachments.some((a) => a.state === 'loading')) {
    throw new Error('请等待附件解析完成，并先生成知识目录')
  }
  const planId = state.directory.plan_id
  const sequence = ++options.selectionSequence.current
  const points = state.directory.points.filter(
    (p) => ids.includes(p.id) && p.status !== '已有知识' && !state.outcomes[p.id]?.answer?.review
  )
  await generateBatch({
    points,
    input: { ...options.generationOptions, plan_id: planId },
    attachmentIds,
    current: () => state.mounted.current && sequence === options.selectionSequence.current,
    requestId: () => state.ownRequest.current ?? undefined,
    progress: options.setProgress,
    receive: (outcome) => {
      // 已提交结果仍更新所属探索目录，切页不能把保存说成已撤销。
      state.setOutcomes((current) => ({ ...current, [outcome.point.id]: outcome }))
      if (outcome.answer?.knowledge) {
        updateCompleted(state, planId, outcome.point, outcome.answer.knowledge.id)
      }
    }
  })
  await options.reload()
  // 提示只属于仍拥有本次选择的页面，不打断其他页面的新操作。
  if (sequence === options.selectionSequence.current) {
    options.setMessage('批量处理结束；逐项结果见右侧，待核对补充需选择后确认。已保存内容保留。')
  }
}

// 更新叶子状态而不改其他项的选择和归属，目录 ID 保证不会串入新拆解。
function updateCompleted(state: State, planId: string, point: DirectoryPoint, id: string) {
  state.setDirectory((current) =>
    current?.plan_id === planId
      ? {
          ...current,
          points: current.points.map((p) =>
            p.id === point.id ? { ...p, status: '已有知识', target_id: id } : p
          )
        }
      : current
  )
}
// 请求生命周期单独管理，取消或切页撤销晚到响应的所有权。
function useDirectoryRequests(options: Options) {
  const ownRequest = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // 卸载仅取消本 hook 的在途工作，后台处理已提交结果的真实边界。
      if (ownRequest.current) {
        void api
          .cancel(ownRequest.current)
          .catch((error) => console.error('取消卸载任务失败', errorText(error)))
      }
    }
  }, [])
  useEffect(() => {
    // 切页撤销界面所有权；晚到结果不会更新其他页面的知识。
    options.selectionSequence.current++
    if (options.activeRequest.current) {
      void api
        .cancel(options.activeRequest.current)
        .catch((error) => options.setError(errorText(error)))
    }
  }, [options.section])

  // 所有操作共用当前请求标识和选中版本，失败保留目录和本地结果。
  async function run(action: () => Promise<void>) {
    if (options.activeRequest.current) {
      return
    }
    const id = crypto.randomUUID()
    options.activeRequest.current = id
    ownRequest.current = id
    options.setBusy(id)
    options.setError('')
    options.setProgress('正在检索和整理')
    try {
      await action()
    } catch (error) {
      if (mounted.current && options.pageOwner.current === options.section) {
        options.setError(errorText(error))
      }
    } finally {
      if (ownRequest.current === id) {
        ownRequest.current = null
        if (options.activeRequest.current === id) {
          options.activeRequest.current = null
          options.setBusy(null)
          options.setProgress('')
        }
      }
    }
  }

  return { ownRequest, mounted, run }
}

type State = ReturnType<typeof useDirectoryState>

// 明确文件范围须有已解析附件；普通无附件查询沿用知识库范围。
function questionInput(options: Options) {
  if (options.attachments.some((item) => item.state === 'loading')) {
    throw new Error('附件仍在解析，请等待或移除后重试')
  }
  const ids = options.attachments
    .filter((item) => item.state === 'ready' && item.id)
    .map((item) => item.id ?? '')
  return {
    query: options.query,
    scope: ids.length || options.scope === 'files' ? options.scope : ('knowledge' as const),
    attachment_ids: ids,
    purpose: 'topic-plan',
    ...options.generationOptions
  }
}

// 请求前先显示本地结果，模型失败仍可选择已有知识。
async function planAction(options: Options, state: State) {
  const params = questionInput(options)
  const sequence = ++options.selectionSequence.current
  state.setDirectory(null)
  state.setOutcomes({})
  state.setCheckedPoints([])
  state.setSelectedPoint(null)
  state.setReviewing(false)
  options.setAnswer(null)
  options.setSelected(null)
  options.setRecommendations([])
  state.setSearchResult(null)
  state.searchParams.current = {
    query: params.query,
    page: 0,
    scope: params.scope,
    attachment_ids: params.attachment_ids
  }
  const local = await api.request(
    'knowledge.search',
    state.searchParams.current,
    state.ownRequest.current ?? undefined
  )
  if (sequence !== options.selectionSequence.current || !state.mounted.current) {
    return
  }
  state.setSearchResult(local)
  const plan = await api.request('question.plan', params, state.ownRequest.current ?? undefined)
  if (sequence === options.selectionSequence.current && state.mounted.current) {
    state.setDirectory(plan)
    state.setSearchResult(plan.search)
    options.setMessage(plan.notice)
  }
}

// 独立本地搜索没有生成参数，不会请求模型。
async function searchAction(options: Options, state: State, page?: number) {
  const params =
    page === undefined ? { query: options.query, page: 0 } : { ...state.searchParams.current, page }
  state.searchParams.current = params
  const sequence = ++options.selectionSequence.current
  const result = await api.request(
    'knowledge.search',
    params,
    state.ownRequest.current ?? undefined
  )
  if (sequence === options.selectionSequence.current && state.mounted.current) {
    state.setSearchResult(result)
    if (page === undefined) {
      state.setDirectory(null)
      state.setOutcomes({})
      state.setCheckedPoints([])
      state.setSelectedPoint(null)
      options.setAnswer(null)
      options.setSelected(null)
      options.setRecommendations([])
      state.setReviewing(false)
    }
    options.setMessage(result.notice + '未调用模型。')
  }
}

// 补充先预览，确认后才提交；已保存内容刷新到同一目录项。
async function learnAction(
  options: Options,
  state: State,
  action: LearnInput['action'],
  extra: Partial<LearnInput>
) {
  if (!state.directory?.plan_id || !state.selectedPoint) {
    return
  }
  const sequence = ++options.selectionSequence.current
  const point = state.selectedPoint
  const value = await api.request(
    'knowledge.learn',
    {
      ...options.generationOptions,
      plan_id: state.directory.plan_id,
      point_id: point.id,
      action,
      target_id: action === 'learn' ? '' : state.targetId,
      ...extra
    },
    state.ownRequest.current ?? undefined
  )
  const updated = value.knowledge
    ? { ...point, status: '已有知识', target_id: value.knowledge.id }
    : null
  if (value.knowledge) {
    void options.reload()
    state.setDirectory((current) =>
      current && current.plan_id === state.directory?.plan_id && updated
        ? { ...current, points: current.points.map((p) => (p.id === point.id ? updated : p)) }
        : current
    )
  }
  state.setOutcomes((current) => ({
    ...current,
    [point.id]: { point, answer: value, message: value.notice }
  }))
  if (sequence !== options.selectionSequence.current || !state.mounted.current) {
    if (value.knowledge && state.mounted.current) {
      options.setMessage(`“${point.title}”已完成保存，可从知识列表打开；已提交内容保留。`)
    }
    return
  }
  options.setAnswer(value)
  if (value.project) {
    state.setProjectContext(value.project)
  }
  options.setSelected(value.knowledge ?? null)
  options.setRecommendations(value.recommendations)
  state.setReviewing(!!value.review)
  if (updated) {
    state.setSelectedPoint(updated)
  }
}

// 页面、问题、范围或附件改变时撤销项目许可；阅读完成内容仍保留。
function useProjectRevocation(
  options: Options & { resetProjectPreviews: () => void },
  directory: QuestionPlan | null,
  point: DirectoryPoint | null,
  clear: (value: ProjectContext | null) => void,
  targetId: string
) {
  const attachmentKey = options.attachments.map((a) => `${a.id}:${a.state}`).join('|')
  useEffect(() => {
    // 问题、范围、文件或页面改变撤销整份目录的项目依据及预览。
    clear(null)
    options.resetProjectPreviews()
    for (const item of directory?.points ?? []) {
      revokeProject(directory, item)
    }
    return () => {
      // 离开页面或替换输入时释放旧目录的全部材料许可。
      options.resetProjectPreviews()
      for (const item of directory?.points ?? []) {
        revokeProject(directory, item)
      }
    }
  }, [options.section, options.query, options.scope, attachmentKey, directory?.plan_id])
  useEffect(() => {
    let current = true
    clear(null)
    // 进入或恢复项目点时重新领取挑战，旧许可不能随阅读快照恢复。
    if (directory) {
      revokeProject(
        directory,
        point,
        (context) => {
          if (current) {
            clear(context)
          }
        },
        true
      )
    }
    return () => {
      current = false
      revokeProject(directory, point, undefined, true)
    }
  }, [options.section, directory?.plan_id, point?.id, targetId])
}

// 撤销独立于学习请求，后台会在提交前再次复核许可。
function revokeProject(
  directory: QuestionPlan | null,
  point: DirectoryPoint | null,
  receive?: (value: ProjectContext | null) => void,
  publicOnly = false
) {
  if (directory?.plan_id && point?.project_required) {
    void api
      .request('knowledge.learn', {
        plan_id: directory.plan_id,
        point_id: point.id,
        action: 'revoke',
        public_only: publicOnly
      })
      .then((answer) => receive?.(answer.project ?? null))
      .catch((error) => console.error('撤销项目许可失败', errorText(error)))
  }
}
