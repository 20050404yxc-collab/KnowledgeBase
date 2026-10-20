// 文件：client.ts
// 层：React 共享 API
// 作用：集中受限桌面 API 与错误显示。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
// 只转交 preload 暴露的受限 API，DTO 已在进程边界校验。
export const api = window.knowledgeBase

// 显示受控错误，移除 Electron 包装但不输出调试对象。
export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : '操作未完成，请重试'
