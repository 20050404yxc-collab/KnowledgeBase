// 文件：OriginalSources.tsx
// 层：React 展示组件
// 作用：在保留点下分页打开合并或整理前的只读原文。
// 说明：不改变当前编辑目标；迟到响应绑定知识标识与序号。
import { useEffect, useRef, useState } from 'react'
import type { Knowledge } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { api } from '../../shared/api/client'

// 快照只读展示，原始引用与补充正文仍通过分页完整保留。
export function OriginalSources() {
  const { selected, guarded } = useAppContext()
  const [original, setOriginal] = useState<Knowledge | null>(null)
  const sequence = useRef(0)
  useEffect(() => {
    sequence.current++
    setOriginal(null)
    return () => {
      sequence.current++
    }
  }, [selected?.id])
  if (!selected?.original_sources?.length) {
    return null
  }
  const load = (source: { source_id: string; version: string }, page = 0) =>
    guarded(async () => {
      const request = ++sequence.current
      const value = await api.request('knowledge.get', {
        id: selected.id,
        original: true,
        ...source,
        page
      })
      if (request === sequence.current) {
        setOriginal(value)
      }
    })
  return (
    <details>
      <summary>查看整理／合并前原文（只读）</summary>
      {selected.original_sources.map((source) => (
        <button key={source.source_id + source.version} onClick={() => void load(source)}>
          {source.title} · {source.source_id} · {source.version.slice(0, 12)}
        </button>
      ))}
      {original && (
        <section aria-label="只读原文">
          <h4>{original.title} · 只读</h4>
          <p>{original.original_locator}</p>
          <pre>{original.content}</pre>
          <button
            disabled={!original.original_page}
            onClick={() =>
              void load(
                { source_id: original.id, version: original.version! },
                (original.original_page ?? 0) - 1
              )
            }
          >
            上一段原文
          </button>
          <span>
            {(original.original_page ?? 0) + 1}/{original.original_total}
          </span>
          <button
            disabled={(original.original_page ?? 0) + 1 >= (original.original_total ?? 0)}
            onClick={() =>
              void load(
                { source_id: original.id, version: original.version! },
                (original.original_page ?? 0) + 1
              )
            }
          >
            下一段原文
          </button>
          {original.citations.map((citation) => (
            <blockquote key={citation.source_id + citation.id}>
              {citation.text} · {citation.name} · {citation.locator}
            </blockquote>
          ))}
        </section>
      )}
    </details>
  )
}
