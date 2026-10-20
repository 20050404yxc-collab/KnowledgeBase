// 文件：use_knowledge.ts
// 层：React 交互 hook
// 作用：协调知识打开、笔记保存与推荐状态更新。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import type React from 'react'

import { api } from '../../shared/api/client'

import type { Feedback } from '../../shared/api/use_feedback'
import type { Library } from '../../app/use_library'
import type { Reading } from './use_reading'

// 协调知识打开、笔记保存与推荐状态更新。
export function useKnowledge(options: Feedback & Library & Reading) {
  const {
    setMessage,
    guarded,
    reload,
    setAnswer,
    setSelected,
    setRecommendations,
    editor,
    setEditor,
    saving,
    setSaving,
    selectionSequence
  } = options
  // 读取完整知识再加载推荐；主动打开计入后台使用日。
  async function openItem(id: string) {
    const sequence = ++selectionSequence.current
    await guarded(async () => {
      const item = await api.request('knowledge.get', { id })
      // 只更新仍由本次选择持有的详情，晚到结果不得覆盖新选择。
      if (sequence !== selectionSequence.current) {
        return
      }
      setSelected(item)
      setAnswer(null)
      const cards = await api.request('recommendations', { id })
      if (sequence === selectionSequence.current) {
        setRecommendations(cards)
      }
      void reload()
    })
  }
  // 保存完成后才关闭编辑器，失败保留可修改的内容。
  async function saveNote(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || saving) {
      return
    }
    setSaving(true)
    const sequence = ++selectionSequence.current
    await guarded(async () => {
      const item = await api.request('knowledge.save', editor)
      if (sequence === selectionSequence.current) {
        setSelected(item)
        setAnswer(null)
        setRecommendations([])
      }
      setEditor(null)
      setMessage('知识已保存')
      void reload()
    })
    setSaving(false)
  }

  return { openItem, saveNote }
}
