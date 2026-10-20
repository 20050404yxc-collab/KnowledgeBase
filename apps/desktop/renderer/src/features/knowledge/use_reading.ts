// 文件：use_reading.ts
// 层：React 交互 hook
// 作用：持有当前知识、回答、引用弹窗及笔记编辑状态。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useRef } from 'react'
import { usePageState } from '../../shared/use_page_state'
import type {
  Answer,
  Citation,
  Knowledge,
  Recommendation
} from '../../../../../../contracts/desktop'

// 空推荐作为稳定初值，由各页 setter 创建新数组，不在原地修改。
const EMPTY_CARDS: Recommendation[] = []
const EMPTY_DRAFTS: Record<string, string | null> = {}

// 持有当前知识、回答、引用弹窗及笔记编辑状态。
export function useReading(page: string) {
  const selectionSequence = useRef(0)
  const owner = useRef(page)
  // 导航渲染立即撤销旧选择的所有权，不等待 effect 才隐藏旧页面内容。
  if (owner.current !== page) {
    owner.current = page
    selectionSequence.current++
  }
  const [answer, setAnswer] = usePageState<Answer | null>(page, null)
  const [selected, setSelected] = usePageState<Knowledge | null>(page, null)
  const [recommendations, setRecommendations] = usePageState<Recommendation[]>(page, EMPTY_CARDS)
  const [editor, setEditor] = usePageState<{ id?: string; title: string; content: string } | null>(
    page,
    null
  )
  const [saving, setSaving] = usePageState(page, false)
  const [supplementDrafts, setSupplementDrafts] = usePageState(page, EMPTY_DRAFTS)
  const [citation, setCitation] = usePageState<Citation | null>(page, null)
  const visibleContent = answer?.content ?? selected?.content
  const visibleCitations = answer?.citations ?? selected?.citations ?? []

  return {
    selectionSequence,
    pageOwner: owner,
    answer,
    setAnswer,
    selected,
    setSelected,
    recommendations,
    setRecommendations,
    editor,
    setEditor,
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
