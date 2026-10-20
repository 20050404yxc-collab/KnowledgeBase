// 文件：SupplementList.tsx
// 层：React 页面／组件
// 作用：展示可独立维护的知识补充及来源。
// 说明：编辑保留草稿，成功写入后才更新详情。
import { useState } from 'react'
import type { Supplement } from '../../../../../../contracts/desktop'
import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'
import { MarkdownContent } from './MarkdownContent'

// 每个补充单独管理编辑状态，不替换原笔记。
function SupplementItem({ item }: { item: Supplement }) {
  const { selected, setSelected, setCitation, guarded, reload, selectionSequence } = useAppContext()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // 并发版本由后台复核；失败保留输入供用户恢复。
  async function maintain(remove: boolean) {
    if (!selected?.version || saving) {
      return
    }
    if (remove && !confirm('删除这条补充？原笔记保留，删除后将同步移除该补充的检索记录。')) {
      return
    }
    setSaving(true)
    const sequence = selectionSequence.current
    try {
      await guarded(async () => {
        const value = await api.request(remove ? 'supplements.delete' : 'supplements.save', {
          id: item.id,
          knowledge_id: selected.id,
          version: selected.version ?? '',
          title: item.title,
          content: draft ?? item.content
        })
        if (sequence === selectionSequence.current) {
          setSelected(value)
          setDraft(null)
        }
        await reload()
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="supplement-item">
      <h3>新增补充 · {item.title}</h3>
      <small>
        {new Date(item.created_at).toLocaleString('zh-CN')} · {item.provider_name} · {item.model}
        {item.edited ? ' · 已编辑' : ''}
      </small>
      {draft === null ? (
        <MarkdownContent
          content={item.content}
          citations={item.citations}
          onCitation={setCitation}
        />
      ) : (
        <textarea
          aria-label="补充正文"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
        />
      )}
      <SupplementCitations item={item} />
      <div className="supplement-actions">
        {draft === null ? (
          <button onClick={() => setDraft(item.content)}>编辑补充</button>
        ) : (
          <>
            <button disabled={saving} onClick={() => void maintain(false)}>
              保存补充
            </button>
            <button disabled={saving} onClick={() => setDraft(null)}>
              取消编辑
            </button>
          </>
        )}
        <button disabled={saving} className="danger-text" onClick={() => void maintain(true)}>
          删除补充
        </button>
      </div>
    </section>
  )
}

// 无论正文是否包含行内标记，都保留该补充可核对的来源入口。
function SupplementCitations({ item }: { item: Supplement }) {
  const { setCitation } = useAppContext()
  return (
    <div className="citations">
      {item.citations.map((citation, index) => (
        <button key={citation.id} onClick={() => setCitation(citation)}>
          {index + 1} · {citation.name} · {citation.locator}
        </button>
      ))}
    </div>
  )
}

// 知识详情按时间排列补充，空列表不制造占位知识。
export function SupplementList() {
  const { selected } = useAppContext()
  return (
    <>
      {selected?.supplements?.map((item) => (
        <SupplementItem key={item.id} item={item} />
      ))}
    </>
  )
}
