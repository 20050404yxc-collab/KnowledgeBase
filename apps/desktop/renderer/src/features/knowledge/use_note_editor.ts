// 文件：use_note_editor.ts
// 层：React 交互 hook
// 作用：按页面保存笔记编辑内容和打开时的原稿，判断未保存修改。
// 说明：草稿与原稿分别恢复，正式保存仍检查目标版本，不自动覆盖新内容。
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { useDurableText } from '../../shared/use_durable_text'
import type { NoteInput } from '../../../../../../contracts/desktop'

type NoteDraft = NoteInput
type EditorState = { draft: NoteDraft; original: NoteDraft }

// 编辑和原稿属于同一页面；切页后回来仍与最初打开的内容比较。
export function useNoteEditor(page: string) {
  const persistence = useDurableText('note-' + page)
  const state = decodeEditor(persistence.value)
  const invalid = persistence.value !== null && state === null
  const setState = (value: (current: EditorState | null) => EditorState | null) =>
    persistence.setValue((current) => {
      const next = value(decodeEditor(current))
      return next ? JSON.stringify(next) : null
    })
  const setEditor = useCallback<Dispatch<SetStateAction<NoteDraft | null>>>(
    (value) => {
      // 格式错误保留原始草稿；只能通过显式清除入口放弃，不能被新建覆盖。
      if (invalid) {
        return
      }
      setState((current) => {
        const draft = typeof value === 'function' ? value(current?.draft ?? null) : value
        // 保存成功或明确放弃后，同时释放编辑内容和原稿。
        if (!draft) {
          return null
        }
        // 新建或打开另一篇不能静默替换已恢复或未保存的内容。
        const switching =
          current &&
          (current.draft.id !== draft.id ||
            (!draft.id &&
              !draft.title &&
              !draft.content &&
              !!(current.draft.title || current.draft.content)))
        if (
          switching &&
          JSON.stringify(current.draft) !== JSON.stringify(current.original) &&
          !confirm('已有未保存草稿。替换编辑对象会放弃当前草稿，继续？')
        ) {
          return current
        }
        // 同一笔记的输入只更新草稿；首次打开和更换笔记建立新原稿。
        const original = current && current.draft.id === draft.id ? current.original : draft
        return { draft, original }
      })
    },
    [persistence.setValue, invalid]
  )
  const editorDirty =
    !!state &&
    (state.draft.title !== state.original.title ||
      state.draft.content !== state.original.content ||
      JSON.stringify(state.draft.category_path ?? []) !==
        JSON.stringify(state.original.category_path ?? []))
  return {
    editor: state?.draft ?? null,
    setEditor,
    editorDirty,
    draftStatus: persistence.status,
    draftUpdated: persistence.updated,
    retryDraft: persistence.retry,
    noteDraftReady: persistence.loaded && !invalid,
    noteDraftInvalid: invalid,
    clearInvalidDraft: () => persistence.setValue(null)
  }
}

// 恢复内容视为未知输入，坏数据不进入表单或正式保存接口。
function decodeEditor(value: string | null): EditorState | null {
  if (!value) {
    return null
  }
  try {
    const data: unknown = JSON.parse(value)
    if (typeof data !== 'object' || !data || !('draft' in data) || !('original' in data)) {
      return null
    }
    if (validNote(data.draft) && validNote(data.original)) {
      return { draft: data.draft, original: data.original }
    }
  } catch {
    // 不解析不可信内容为代码；格式错误时仍保留后台草稿供备份排查。
    return null
  }
  return null
}

// 字段逐项收窄，不依靠类型断言信任磁盘数据。
function validNote(value: unknown): value is NoteInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof value.title === 'string' &&
    value.title.length <= 300000 &&
    'content' in value &&
    typeof value.content === 'string' &&
    value.content.length <= 300000 &&
    (!('id' in value) || typeof value.id === 'string') &&
    (!('version' in value) || typeof value.version === 'string') &&
    (!('category_path' in value) ||
      value.category_path === undefined ||
      (Array.isArray(value.category_path) &&
        value.category_path.every((part) => typeof part === 'string')))
  )
}
