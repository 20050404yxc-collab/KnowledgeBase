// 文件：selection_state.ts
// 层：React 交互状态
// 作用：对仍存在的会话应用当前状态更新，保留并发编辑的保存草稿。
// 说明：不创建已关闭会话，不执行外部 I/O。
import type { CaptureDraft, ChatEntry } from './use_selection_questions'
export type ChatUpdate = Partial<ChatEntry> | ((entry: ChatEntry) => Partial<ChatEntry>)

// 函数式更新使用提交时草稿，目标读取的旧闭包不能恢复旧正文。
export function updateChatEntries(items: ChatEntry[], id: string, value: ChatUpdate): ChatEntry[] {
  return items.map((item) =>
    item.session.id === id
      ? { ...item, ...(typeof value === 'function' ? value(item) : value) }
      : item
  )
}

// 关闭预览后的晚到目标读取不重新打开预览，其他修改与当前草稿合并。
export function updateCapture(
  entry: ChatEntry,
  changes: Partial<CaptureDraft>
): Partial<ChatEntry> {
  return { preview: entry.preview ? { ...entry.preview, ...changes } : null }
}
