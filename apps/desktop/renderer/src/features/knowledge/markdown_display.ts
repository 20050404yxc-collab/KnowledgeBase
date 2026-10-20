// 文件：markdown_display.ts
// 层：React 展示规则
// 作用：修复显示副本中明确的加粗标签空格错误。
// 说明：保留存储原文，代码、转义、链接和不明确的星号不改写。

// 仅修复以冒号结尾的成对标签；不将任意星号解释为格式。
function repairLabel(text: string): string {
  return text.replace(
    /\*\*([ \t]*[^\s*][^*\n]{0,100}[:：])[ \t]+\*\*(?=\S)/g,
    (_match, label: string) => `**${label.trim()}** `
  )
}

// 按围栏和行内保护区分段，改写只发生在普通正文。
export function markdownForDisplay(content: string): string {
  let fence = ''
  return content
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      // 围栏内全部保留；闭合围栏必须与开启字符相同且不短于开启标记。
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          /^\s*$/.test(line.slice(marker[0].length))
        ) {
          fence = ''
        }
        return line
      }
      if (marker) {
        fence = marker[1]
        return line
      }
      // 缩进代码、引用式链接定义与含未闭合代码的行保持原样。
      if (/^(?: {4}|\t)|^\s*\[[^\]]+\]:/.test(line) || /[`\\<>]|\]\(/.test(line)) {
        return line
      }
      return repairLabel(line)
    })
    .join('\n')
}
