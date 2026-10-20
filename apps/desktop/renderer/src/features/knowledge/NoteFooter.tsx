// 文件：NoteFooter.tsx
// 层：React 页面／组件
// 作用：提供笔记保存、删除及分区设置操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 提供笔记保存、删除及分区设置操作。
export function NoteFooter() {
  const { guarded, reload, setAnswer, selected, setSelected, setRecommendations, setEditor } =
    useAppContext()
  if (!selected) {
    return null
  }
  return (
    <footer className="note-footer">
      <span>
        {selected.generated ? `${selected.provider_name} · ${selected.model}` : '个人笔记'}
        {selected.edited ? ' · 已手动编辑' : ''} ·{' '}
        {new Date(selected.updated_at).toLocaleDateString('zh-CN')}
      </span>
      <div>
        <button
          onClick={() =>
            setEditor({ id: selected.id, title: selected.title, content: selected.content })
          }
        >
          编辑
        </button>
        <button
          className="danger-text"
          onClick={() => {
            if (confirm('删除这条知识？关联使用记录会一并删除，此操作不可撤销。')) {
              void guarded(async () => {
                await api.request('knowledge.delete', { id: selected.id })
                setSelected(null)
                setAnswer(null)
                setRecommendations([])
                void reload()
              })
            }
          }}
        >
          删除
        </button>
      </div>
    </footer>
  )
}
