// 文件：diagnostic_error.ts
// 层：桌面共享诊断
// 作用：提取异常类别与代码位置，剔除原始错误信息。
// 说明：不记录异常 message、源码、URL、参数和局部变量。
export interface DiagnosticError {
  error_type: string
  frames: string[]
  code?: string
}

// 错误提示附带可检索的请求编号；原异常保留在 cause，诊断仍不输出正文。
export function requestError(error: unknown, requestId: string): Error {
  const message = error instanceof Error ? error.message : '操作未完成，请重试'
  // 异常调用方标识不能注入多行提示，非法标识交回原错误处理。
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) {
    return error instanceof Error ? error : new Error(message)
  }
  return new Error(`${message}\n日志请求 ID：${requestId}`, { cause: error })
}

// 只保留标准错误名、系统码和栈中的源文件名／行列；不保留目录或首行消息。
export function diagnosticError(error: unknown): DiagnosticError {
  if (!(error instanceof Error)) {
    return { error_type: 'UnknownError', frames: [] }
  }
  const error_type =
    /^(?:Error|TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|AggregateError)$/.test(
      error.name
    )
      ? error.name
      : 'Error'
  const prefix = `${error.name}: ${error.message}`
  const stack = error.stack?.startsWith(prefix) ? error.stack.slice(prefix.length) : ''
  const frames = stack
    .split('\n')
    .slice(1, 17)
    .flatMap((line) => {
      const match = line.match(/(?:[/\\])([a-zA-Z0-9_.-]+\.(?:tsx?|m?js)):(\d+):(\d+)\)?$/)
      return match ? [`${match[1]}:${match[2]}:${match[3]}`] : []
    })
  const code =
    'code' in error && typeof error.code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(error.code)
      ? error.code
      : undefined
  return { error_type, frames, code }
}
