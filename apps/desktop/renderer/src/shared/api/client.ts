// 文件：client.ts
// 层：React 共享 API
// 作用：集中受限桌面 API 与错误显示。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
// 只转交 preload 暴露的受限 API，DTO 已在进程边界校验。
export const api = window.knowledgeBase

// 红色提示出现时记录请求关联或固定的界面拦截原因，不传提示正文。
export function reportFeedback(message: string): void {
  const request_id = message.match(/\n日志请求 ID：([a-zA-Z0-9-]{1,80})$/)?.[1]
  const reasons = new Map([
    ['附件仍在解析，请等待完成或移除后提问', 'attachments_pending' as const],
    ['已有任务正在执行，请从任务状态条返回或取消', 'task_running' as const]
  ])
  api.reportDiagnostic({
    event: 'feedback_error',
    request_id,
    reason: request_id ? 'request_failed' : (reasons.get(message) ?? 'local_error')
  })
}

// 显示受控错误，移除 Electron 包装但不输出调试对象。
export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : '操作未完成，请重试'
