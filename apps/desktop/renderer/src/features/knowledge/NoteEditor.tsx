// 文件：NoteEditor.tsx
// 层：React 页面／组件
// 作用：显示笔记编辑表单并提交保存操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useAppContext } from '../../app/AppContext'
import { CategoryPicker } from './CategoryPicker'

// 关闭有修改的笔记前先确认；保存期间锁定输入和关闭，失败后仍可编辑。
export function NoteEditor() {
  const { editor, setEditor, editorDirty, saving, saveNote, error, setError } = useAppContext()
  const [discarding, setDiscarding] = useState(false)
  const content = useRef<HTMLTextAreaElement>(null)
  const wasDiscarding = useRef(false)
  useEffect(() => {
    setError('')
  }, [])
  useEffect(() => {
    // 从放弃确认返回编辑时，将焦点交还正文；初次打开仍聚焦标题。
    if (wasDiscarding.current && !discarding) {
      content.current?.focus()
    }
    wasDiscarding.current = discarding
  }, [discarding])
  const close = () => {
    // 保存请求终结前不允许放弃正在提交的草稿。
    if (saving) {
      return
    }
    // 实际有改动才提示；恢复原文或未输入的新笔记可直接关闭。
    if (editorDirty) {
      setDiscarding(true)
    } else {
      setEditor(null)
    }
  }
  // 页面没有编辑稿时不显示窗口。
  if (!editor) {
    return null
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-editor-title"
        onSubmit={saveNote}
      >
        <div className="modal-heading">
          <h2 id="note-editor-title">{editor.id ? '编辑知识' : '新建知识'}</h2>
          <button type="button" disabled={saving} onClick={close} aria-label="关闭编辑">
            ×
          </button>
        </div>
        <NoteEditorFields blocked={saving || discarding} contentRef={content} />
        {error && (
          <p className="editor-error" role="alert">
            {error}。输入已保留，可修改标题或分类后重试。
          </p>
        )}
        <p className="subtle">内容仅保存在本地；同一分类中标题不可重复，不会覆盖已有知识。</p>
        <NoteEditorActions
          discarding={discarding}
          onContinue={() => setDiscarding(false)}
          close={close}
        />
      </form>
    </div>
  )
}

// 表单输入只修改页面草稿；确认放弃和等待保存时统一禁用。
function NoteEditorFields({
  blocked,
  contentRef
}: {
  blocked: boolean
  contentRef: RefObject<HTMLTextAreaElement | null>
}) {
  const { editor, setEditor } = useAppContext()
  // 关闭后组件清理前不读取已经释放的草稿。
  if (!editor) {
    return null
  }
  return (
    <fieldset className="note-editor-fields" disabled={blocked}>
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
          ref={contentRef}
          required
          maxLength={120000}
          value={editor.content}
          onChange={(e) => setEditor({ ...editor, content: e.target.value })}
          placeholder="写下概念、思考、例子，或待解决的问题…"
        />
      </label>
      <CategoryPicker
        value={editor.category_path ?? []}
        onChange={(category_path) => setEditor({ ...editor, category_path })}
      />
    </fieldset>
  )
}

// 放弃必须显式确认；继续编辑不丢失输入，也不会触发保存请求。
function NoteEditorActions({
  discarding,
  onContinue,
  close
}: {
  discarding: boolean
  onContinue: () => void
  close: () => void
}) {
  const { saving, setEditor } = useAppContext()
  // 放弃确认期间仅提供继续和明确放弃，不暴露保存入口。
  if (discarding) {
    return (
      <section className="discard-warning" role="alert" aria-label="未保存修改">
        <p>有尚未保存的修改，放弃后无法恢复。</p>
        <div className="modal-actions">
          <button type="button" autoFocus onClick={onContinue}>
            继续编辑
          </button>
          <button type="button" className="danger-text" onClick={() => setEditor(null)}>
            放弃修改
          </button>
        </div>
      </section>
    )
  }
  return (
    <div className="modal-actions">
      <button type="button" disabled={saving} onClick={close}>
        取消
      </button>
      <button className="primary" disabled={saving}>
        {saving ? '保存中…' : '保存知识'}
      </button>
    </div>
  )
}
