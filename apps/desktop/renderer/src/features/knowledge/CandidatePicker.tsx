// 文件：CandidatePicker.tsx
// 层：React 展示组件
// 作用：按标题和完整路径搜索并选择拟合并候选。
// 说明：读取完整草案的分页摘要，选择仍以稳定 ID 提交并接受全文核验。
import { useEffect, useState } from 'react'
import type { OutlinePoint } from '../../../../../../contracts/library'
import { useAppContext } from '../../app/AppContext'
import { api, errorText } from '../../shared/api/client'
import { categoryPath } from '../../shared/knowledge_tree'

// 查询、翻页和修订的旧响应不能覆盖新结果；失败保留已勾选的候选。
function useCandidatePage(query: string, page: number, open: boolean) {
  const { restructureDraft: draft } = useAppContext()
  const [result, setResult] = useState({ outline: [] as OutlinePoint[], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!draft || !open) {
      return
    }
    let current = true
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      void api
        .request('library.restructure.preview', { ...draft, kind: 'outline', query, page })
        .then((value) => {
          // 仅当前查询使用响应，切页、修订或卸载都使其失效。
          if (current) {
            setResult(value)
          }
        })
        .catch((err) => {
          if (current) {
            setError(errorText(err))
          }
        })
        .finally(() => {
          if (current) {
            setLoading(false)
          }
        })
    }, 150)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [draft?.draft_id, draft?.revision, query, page, open])
  return { ...result, loading, error }
}

// 跨查询和分页保留最多八项；同名知识通过路径和辅助 ID 区分。
export function CandidatePicker() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<OutlinePoint[]>([])
  const { busy, reviewRestructure } = useAppContext()
  const result = useCandidatePage(query, page, open)
  // 移除已选项不依赖当前筛选，用户始终可以纠正隐藏页的选择。
  const toggle = (point: OutlinePoint) =>
    setSelected((current) =>
      current.some((item) => item.id === point.id)
        ? current.filter((item) => item.id !== point.id)
        : current.length < 8
          ? [...current, point]
          : current
    )
  return (
    <details className="candidate-picker" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>按标题补充或重新核验候选</summary>
      <label>
        搜索候选标题或路径
        <input
          maxLength={200}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
        />
      </label>
      <p>选择 2 至 8 项。翻页和筛选保留勾选；提交后仍需核验全文。</p>
      <div aria-label="已选整理候选">
        <strong>已选 {selected.length}/8</strong>
        {selected.map((point) => (
          <button key={point.id} onClick={() => toggle(point)} disabled={!!busy}>
            移除：{point.title} · {categoryPath(point).join(' → ')}
          </button>
        ))}
      </div>
      <CandidateOptions result={result} selected={selected} toggle={toggle} locked={!!busy} />
      <div className="candidate-pages">
        <button disabled={result.loading || page === 0} onClick={() => setPage(page - 1)}>
          上一页候选
        </button>
        <span>
          第 {page + 1} 页 · 共 {result.total} 项
        </span>
        <button
          disabled={result.loading || (page + 1) * 30 >= result.total}
          onClick={() => setPage(page + 1)}
        >
          下一页候选
        </button>
      </div>
      <button
        disabled={!!busy || selected.length < 2}
        onClick={() =>
          void reviewRestructure({
            action: 'candidate',
            sources: selected.map((point) => point.id)
          })
        }
      >
        添加拟合并候选（确认后核验全文）
      </button>
    </details>
  )
}

// 候选列表保持独立的有界滚动区域，选择上限不阻止取消已选项。
function CandidateOptions({
  result,
  selected,
  toggle,
  locked
}: {
  result: ReturnType<typeof useCandidatePage>
  selected: OutlinePoint[]
  toggle: (point: OutlinePoint) => void
  locked: boolean
}) {
  return (
    <>
      {result.error && <p role="alert">{result.error}</p>}
      {result.loading ? (
        <p role="status">正在读取候选…</p>
      ) : (
        <div className="candidate-options">
          {result.outline.map((point) => (
            <label key={point.id}>
              <input
                type="checkbox"
                checked={selected.some((item) => item.id === point.id)}
                disabled={
                  locked || (selected.length >= 8 && !selected.some((item) => item.id === point.id))
                }
                onChange={() => toggle(point)}
              />
              <span>
                <b>{point.title}</b>
                <small>
                  {categoryPath(point).join(' → ')} · 原位置：{point.old_path.join(' → ')}
                </small>
                <small>{point.id}</small>
              </span>
            </label>
          ))}
          {!result.outline.length && <p>没有匹配候选，可清空搜索词查看全部。</p>}
        </div>
      )}
    </>
  )
}
