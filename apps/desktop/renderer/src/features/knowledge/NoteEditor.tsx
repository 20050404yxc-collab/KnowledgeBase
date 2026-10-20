// 文件：NoteEditor.tsx
// 层：React 页面／组件
// 作用：显示笔记编辑表单并提交保存操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示笔记编辑表单并提交保存操作。
export function NoteEditor() {
  const { editor, setEditor, saving, saveNote } = useAppContext()
  if (!editor) {
    return null
  }
  return (
    <div className="modal-backdrop">
      <form className="modal editor" onSubmit={saveNote}>
        <div className="modal-heading">
          <h2>{editor.id ? '编辑知识' : '新建知识'}</h2>
          <button type="button" onClick={() => setEditor(null)} aria-label="关闭编辑">
            ×
          </button>
        </div>
        <label>
          标题
          <input
            autoFocus
            required
            maxLength={160}
            value={editor.title}
            onChange={(e) => setEditor({ ...editor, title: e.target.value })}
          />
        </label>
        <label>
          知识正文
          <textarea
            required
            maxLength={120000}
            value={editor.content}
            onChange={(e) => setEditor({ ...editor, content: e.target.value })}
            placeholder="写下概念、思考、例子，或待解决的问题…"
          />
        </label>
        <p className="subtle">内容仅保存在本地；同标题或完全相同内容会复用已有知识。</p>
        <div className="modal-actions">
          <button type="button" onClick={() => setEditor(null)}>
            取消
          </button>
          <button className="primary" disabled={saving}>
            {saving ? '保存中…' : '保存知识'}
          </button>
        </div>
      </form>
    </div>
  )
}
