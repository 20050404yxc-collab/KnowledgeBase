// 文件：NoteFooter.tsx
// 层：React 页面／组件
// 作用：提供笔记保存、删除及分区设置操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 提供笔记保存、删除及分区设置操作。
export function NoteFooter() {
  const {
    guarded,
    reload,
    setAnswer,
    selected,
    setSelected,
    setRecommendations,
    setEditor,
    selectionSequence
  } = useAppContext()
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
        {!selected.content_chars && (
          <button
            onClick={() =>
              setEditor({
                id: selected.id,
                title: selected.title,
                content: selected.content,
                category_path: selected.category_path,
                version: selected.version
              })
            }
          >
            编辑
          </button>
        )}
        <button
          className="danger-text"
          onClick={() => {
            // 显式展示操作对象；取消不发请求，确认后仍沿用后台原子删除与限制。
            if (
              confirm(
                `将知识「${selected.title}」移到回收站？\n正文、补充、分类与使用记录将一并保留，可从左侧“回收站”恢复。`
              )
            ) {
              void guarded(async () => {
                const sequence = selectionSequence.current
                await api.request('knowledge.delete', { id: selected.id })
                // 删除原条目成功也不能清空之后主动选择的另一条知识。
                if (sequence === selectionSequence.current) {
                  setSelected(null)
                  setAnswer(null)
                  setRecommendations([])
                }
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
