// 文件：use_note_editor.ts
// 层：React 交互 hook
// 作用：按页面保存笔记编辑内容和打开时的原稿，判断未保存修改。
// 说明：原稿仅在打开另一篇笔记或关闭后重新打开时重置，不写入持久存储。
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { usePageState } from '../../shared/use_page_state'
import type { NoteInput } from '../../../../../../contracts/desktop'

type NoteDraft = NoteInput
type EditorState = { draft: NoteDraft; original: NoteDraft }

// 编辑和原稿属于同一页面；切页后回来仍与最初打开的内容比较。
export function useNoteEditor(page: string) {
  const [state, setState] = usePageState<EditorState | null>(page, null)
  const setEditor = useCallback<Dispatch<SetStateAction<NoteDraft | null>>>(
    (value) => {
      setState((current) => {
        const draft = typeof value === 'function' ? value(current?.draft ?? null) : value
        // 保存成功或明确放弃后，同时释放编辑内容和原稿。
        if (!draft) {
          return null
        }
        // 同一笔记的输入只更新草稿；首次打开和更换笔记建立新原稿。
        const original = current && current.draft.id === draft.id ? current.original : draft
        return { draft, original }
      })
    },
    [setState]
  )
  const editorDirty =
    !!state &&
    (state.draft.title !== state.original.title ||
      state.draft.content !== state.original.content ||
      JSON.stringify(state.draft.category_path ?? []) !==
        JSON.stringify(state.original.category_path ?? []))
  return { editor: state?.draft ?? null, setEditor, editorDirty }
}
