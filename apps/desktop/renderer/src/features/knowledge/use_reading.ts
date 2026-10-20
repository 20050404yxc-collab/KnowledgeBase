// 文件：use_reading.ts
// 层：React 交互 hook
// 作用：持有当前知识、回答、引用弹窗及笔记编辑状态。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useState } from 'react'
import type {
  Answer,
  Citation,
  Knowledge,
  Recommendation
} from '../../../../../../contracts/desktop'

// 持有当前知识、回答、引用弹窗及笔记编辑状态。
export function useReading() {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [selected, setSelected] = useState<Knowledge | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [editor, setEditor] = useState<{ id?: string; title: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [citation, setCitation] = useState<Citation | null>(null)
  const visibleContent = answer?.content ?? selected?.content
  const visibleCitations = answer?.citations ?? selected?.citations ?? []

  return {
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
    citation,
    setCitation,
    visibleContent,
    visibleCitations
  }
}
export type Reading = ReturnType<typeof useReading>
