// 文件：ReadingTools.tsx
// 层：React 阅读交互
// 作用：调整阅读字号、导航当前正文标题并导出完整知识。
// 说明：目录只包含当前已加载正文，长文仍按实际分页读取。
import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../../app/AppContext'
import { api } from '../../shared/api/client'

// DOM 中已渲染标题作为真实导航目标，不从未加载内容伪造目录。
export function ReadingTools() {
  const { selected, visibleContent, guarded, setMessage } = useAppContext()
  const [size, setSize] = useState(16)
  const [headings, setHeadings] = useState<HTMLElement[]>([])
  const toolbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const article = toolbar.current?.closest('article')
    if (!article) {
      return
    }
    article.style.setProperty('--reading-font-size', size + 'px')
    const update = () => {
      const next = Array.from(
        article.querySelectorAll<HTMLElement>(
          '.markdown-content h1, .markdown-content h2, .markdown-content h3'
        )
      )
      // 只在标题 DOM 实际改变时刷新，工具栏自身更新不能形成观察循环。
      setHeadings((previous) =>
        previous.length === next.length && previous.every((item, index) => item === next[index])
          ? previous
          : next
      )
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(article, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [visibleContent, selected?.id, size])
  const exportKnowledge = () =>
    guarded(async () => {
      if (!selected) {
        return
      }
      const directory = await api.chooseFolder()
      if (!directory) {
        return
      }
      const result = await api.request('data.export', { id: selected.id, directory })
      setMessage(`完整知识已导出：${result.path}`)
    })
  return (
    <div className="reading-tools" ref={toolbar}>
      <label>
        阅读字号{' '}
        <select
          aria-label="阅读字号"
          value={size}
          onChange={(event) => setSize(Number(event.target.value))}
        >
          <option value={15}>15</option>
          <option value={16}>16</option>
          <option value={18}>18</option>
          <option value={20}>20</option>
        </select>
      </label>
      {headings.length > 0 && (
        <details>
          <summary>本段目录 · {headings.length}</summary>
          <nav aria-label="正文目录">
            {headings.map((heading, index) => (
              <button
                key={index}
                onClick={() => {
                  heading.tabIndex = -1
                  heading.scrollIntoView({ block: 'start' })
                  heading.focus({ preventScroll: true })
                }}
              >
                {heading.textContent}
              </button>
            ))}
          </nav>
        </details>
      )}
      {selected && <button onClick={() => void exportKnowledge()}>导出 Markdown</button>}
    </div>
  )
}
