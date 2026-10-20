// 文件：use_directory.ts
// 层：React 交互 hook
// 作用：关联本地检索、知识目录和选中项学习请求。
// 说明：执行归会话任务，结果归发起页面；阅读选择不取消批量。
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
  const ownRequest = options.activeRequest
  const mounted = options.mounted
  const run = options.runTask

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
  const { setSelectedPoint, setReviewing, run } = state
  return {
    ...state,
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
    current: () => state.mounted.current && !options.taskCancelled.current,
    request: options.taskRequest,
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
  options.selectionSequence.current++
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
  const local = await options.taskRequest('knowledge.search', state.searchParams.current)
  if (options.taskCancelled.current || !state.mounted.current) {
    return
  }
  state.setSearchResult(local)
  const plan = await options.taskRequest('question.plan', params)
  if (!options.taskCancelled.current && state.mounted.current) {
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
  const result = await options.taskRequest('knowledge.search', params)
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
  const value = await options.taskRequest('knowledge.learn', {
    ...options.generationOptions,
    plan_id: state.directory.plan_id,
    point_id: point.id,
    action,
    target_id: action === 'learn' ? '' : state.targetId,
    ...extra
  })
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

// 导航只切换展示；实际输入或材料变化才撤销相关目录的许可。
function useProjectRevocation(
  options: Options & { resetProjectPreviews: () => void },
  directory: QuestionPlan | null,
  point: DirectoryPoint | null,
  clear: (value: ProjectContext | null) => void,
  targetId: string
) {
  const snapshots = useRef<
    Record<
      string,
      {
        input: string
        materials: string
        directory: QuestionPlan | null
        reset: () => void
      }
    >
  >({})
  const materials = JSON.stringify([options.scope, options.attachments.map((a) => [a.id, a.state])])
  useEffect(() => {
    // 材料全局共享，因此隐藏页使用过的同组材料也必须失效。
    for (const [page, snapshot] of Object.entries(snapshots.current)) {
      if (
        snapshot.materials !== materials ||
        (page === options.section && snapshot.input !== options.query) ||
        (page === options.section &&
          snapshot.directory &&
          snapshot.directory.plan_id !== directory?.plan_id)
      ) {
        snapshot.reset()
        for (const item of snapshot.directory?.points ?? []) {
          revokeProject(snapshot.directory, item)
        }
        if (
          page !== '知识库' &&
          page !== '设置' &&
          options.taskOwner === page &&
          options.taskRunning.current &&
          (snapshot.materials !== materials || snapshot.input !== options.query)
        ) {
          void options.cancelTask()
        }
        snapshot.materials = materials
      }
    }
    snapshots.current[options.section] = {
      input: options.query,
      materials,
      directory,
      reset: () => {
        clear(null)
        options.resetProjectPreviews()
      }
    }
    // 明确取消撤销原任务许可；已保存结果由 reset 保留。
    if (options.taskCancelled.current && options.busy) {
      const origin = snapshots.current[options.taskOwner]
      origin?.reset()
      for (const item of origin?.directory?.points ?? []) {
        revokeProject(origin.directory, item)
      }
    }
  }, [options.section, options.query, materials, directory?.plan_id, options.taskCancelled.current])
  usePointChallenge(options, directory, point, clear, targetId)
}

// 各页实际选择变化重新领取公开检索挑战；在途任务拥有的许可延后至结束再撤销。
function usePointChallenge(
  options: Options,
  directory: QuestionPlan | null,
  point: DirectoryPoint | null,
  clear: (value: ProjectContext | null) => void,
  targetId: string
) {
  const selections = useRef<
    Record<string, { key: string; directory: QuestionPlan | null; point: DirectoryPoint | null }>
  >({})
  const page = options.section
  const key = JSON.stringify([directory?.plan_id, point?.id, targetId])
  useEffect(() => {
    const previous = selections.current[page]
    if (previous?.key === key || (options.taskRunning.current && options.taskOwner === page)) {
      return
    }
    selections.current[page] = { key, directory, point }
    clear(null)
    if (previous) {
      revokeProject(previous.directory, previous.point, undefined, true)
    }
    revokeProject(
      directory,
      point,
      (value) => {
        if (selections.current[page]?.key === key) {
          clear(value)
        }
      },
      true
    )
  }, [page, key, options.busy])
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
