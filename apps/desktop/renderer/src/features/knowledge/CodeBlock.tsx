// 文件：CodeBlock.tsx
// 层：React 阅读展示
// 作用：复制代码块纯文本并显示剪贴板实际结果。
// 说明：只读取当前代码，不执行文档内容。
import { useRef, useState, type ReactNode } from 'react'

// 剪贴板失败可观察，不提前显示复制成功。
export function CodeBlock({ children }: { children?: ReactNode }) {
  const content = useRef<HTMLPreElement>(null)
  const [status, setStatus] = useState('复制代码')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content.current?.textContent ?? '')
      setStatus('已复制')
    } catch {
      setStatus('复制失败，请手动选择')
    }
  }
  return (
    <div className="code-block">
      <button onClick={() => void copy()}>{status}</button>
      <pre ref={content}>{children}</pre>
    </div>
  )
}
