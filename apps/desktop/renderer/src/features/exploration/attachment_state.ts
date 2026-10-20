// 文件：attachment_state.ts
// 层：React 探索功能
// 作用：表达附件加载状态及检索范围。
// 说明：未完成解析的附件不能作为证据提交。
import type { Attachment, Scope } from '../../../../../../contracts/desktop'
export type Attached = Partial<Attachment> & {
  localId: string
  path: string
  name: string
  state: 'loading' | 'ready' | 'error'
  error?: string
}
// 下拉框值也校验后再进入业务状态。
export function readScope(value: string): Scope {
  if (value === 'files' || value === 'knowledge' || value === 'mixed') {
    return value
  }
  throw new Error('无效检索范围')
}
// 加载中的附件没有后台标识，不允许用于保留或提问。
export function requireAttachmentId(item: Attached): string {
  if (!item.id) {
    throw new Error('附件尚未解析完成')
  }
  return item.id
}
