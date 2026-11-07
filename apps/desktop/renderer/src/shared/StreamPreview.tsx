// 文件：StreamPreview.tsx
// 层：React 共享展示
// 作用：按任务归属呈现生成中的可读片段。
// 说明：仅用于等待反馈，不提供保存入口，不持久化模型正文。
import { useAppContext } from '../app/AppContext'
import { readablePreview } from './stream_preview'

// 未形成可读正文或不属于当前页时隐藏，避免结构原文及串页预览。
export function StreamPreview() {
  const { streamPreview, taskOwner, section, busy } = useAppContext()
  const text = readablePreview(streamPreview)
  if (!busy || taskOwner !== section || !text) {
    return null
  }
  return (
    <aside className="stream-preview">
      <strong>生成中预览 · 尚未校验或保存</strong>
      <p>{text}</p>
    </aside>
  )
}
