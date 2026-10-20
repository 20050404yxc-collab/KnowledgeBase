// 文件：renderer_diagnostics.ts
// 层：Electron 桌面宿主／诊断边界
// 作用：白名单校验来自界面的诊断元数据。
// 说明：不接受任意日志正文、额外字段、路径、堆栈正文和对象序列化。
import { isOperation, isRecord } from '../shared/protocol_validation'

const EVENTS = new Set([
  'ready',
  'error',
  'rejection',
  'react_error',
  'request_start',
  'request_completed',
  'request_failed',
  'cancel',
  'files_failed',
  'feedback_error'
])
const ERROR_TYPES = new Set([
  'Error',
  'UnknownError',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'AggregateError'
])

// 重新构造标量对象；不依赖 renderer 的 TypeScript 声明作为安全边界。
export function rendererDiagnostic(value: unknown): Record<string, string | number> | null {
  if (!isRecord(value) || typeof value.event !== 'string' || !EVENTS.has(value.event)) {
    return null
  }
  const fields: Record<string, string | number> = { kind: value.event }
  // 页面错误只接收固定分类；任何提示正文都不跨入日志。
  if (
    typeof value.reason === 'string' &&
    ['request_failed', 'attachments_pending', 'task_running', 'local_error'].includes(value.reason)
  ) {
    fields.reason = value.reason
  }
  // 只复制经过白名单验证的字段，额外输入直接丢弃。
  if (typeof value.request_id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.request_id)) {
    fields.request_id = value.request_id
  }
  if (isOperation(value.operation)) {
    fields.operation = value.operation
  }
  if (
    typeof value.elapsed_ms === 'number' &&
    Number.isFinite(value.elapsed_ms) &&
    value.elapsed_ms >= 0
  ) {
    fields.elapsed_ms = Math.min(Math.round(value.elapsed_ms), 86_400_000)
  }
  if (typeof value.error_type === 'string' && ERROR_TYPES.has(value.error_type)) {
    fields.error_type = value.error_type
  }
  if (Array.isArray(value.frames)) {
    fields.frames = value.frames
      .slice(0, 16)
      .filter(
        (frame: unknown) =>
          typeof frame === 'string' &&
          frame.length <= 160 &&
          /^[a-zA-Z0-9_.-]+\.(?:tsx?|m?js):\d{1,8}:\d{1,8}$/.test(frame)
      )
      .join(',')
  }
  return fields
}
