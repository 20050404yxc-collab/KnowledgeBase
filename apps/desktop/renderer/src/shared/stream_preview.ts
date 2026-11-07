// 文件：stream_preview.ts
// 层：React 共享展示
// 作用：只从结构化生成流提取有界可读正文。
// 说明：预览不代表完整、已校验或已收录，不显示原始 JSON。
export function readablePreview(raw: string): string {
  const match = raw.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)/)
  if (!match) {
    return ''
  }
  // 不完整的转义和 Unicode 尾部等待下一片段，绝不通过 eval 解析。
  const complete = match[1].replace(/\\(?:u[0-9a-f]{0,3})?$/i, '')
  try {
    const value: unknown = JSON.parse('"' + complete + '"')
    return typeof value === 'string' ? value.slice(0, 6000) : ''
  } catch {
    return ''
  }
}
