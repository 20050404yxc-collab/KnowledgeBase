// 文件：use_reading.ts
// 层：React 交互 hook
// 作用：持有当前知识、回答、引用弹窗及笔记编辑状态。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useEffect, useRef } from 'react'
import type {
  Answer,
  Citation,
  Knowledge,
  Recommendation
} from '../../../../../../contracts/desktop'
import { usePageState } from '../../shared/use_page_state'
import { useNoteEditor } from './use_note_editor'

// 空推荐作为稳定初值，由各页 setter 创建新数组，不在原地修改。
const EMPTY_CARDS: Recommendation[] = []
const EMPTY_DRAFTS: Record<string, string | null> = {}

// 持有当前知识、回答、引用弹窗及笔记编辑状态。
export function useReading(page: string, searchRevision = 0) {
  const sequences = useRef<Record<string, { current: number }>>({})
  const pageSequence = (sequences.current[page] ??= { current: 0 })
  const owner = useRef(page)
  // 阅读序号按页保存；导航只更新当前阅读页标记。
  if (owner.current !== page) {
    owner.current = page
  }
  const [answer, setAnswer] = usePageState<Answer | null>(page, null)
  const [selected, setSelected] = usePageState<Knowledge | null>(page, null)
  const [recommendations, setRecommendations] = usePageState<Recommendation[]>(page, EMPTY_CARDS)
  const noteEditor = useNoteEditor(page)
  const [saving, setSaving] = usePageState(page, false)
  const [supplementDrafts, setSupplementDrafts] = usePageState(page, EMPTY_DRAFTS)
  const [citation, setCitation] = usePageState<Citation | null>(page, null)
  const consumedSearch = useRef(-1)
  useEffect(() => {
    // 新搜索只清理搜索页旧阅读；切出再回来继续保留本次阅读。
    if (page === '搜索' && consumedSearch.current !== searchRevision) {
      consumedSearch.current = searchRevision
      pageSequence.current++
      setSelected(null)
      setAnswer(null)
      setCitation(null)
    }
  }, [page, searchRevision])
  const visibleContent = answer?.content ?? selected?.content
  const visibleCitations = answer?.citations ?? selected?.citations ?? []

  return {
    selectionSequence: pageSequence,
    pageOwner: owner,
    answer,
    setAnswer,
    selected,
    setSelected,
    recommendations,
    setRecommendations,
    ...noteEditor,
    saving,
    setSaving,
    supplementDrafts,
    setSupplementDrafts,
    citation,
    setCitation,
    visibleContent,
    visibleCitations
  }
}
export type Reading = ReturnType<typeof useReading>
