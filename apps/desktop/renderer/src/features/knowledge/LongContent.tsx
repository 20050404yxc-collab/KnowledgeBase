// 文件：LongContent.tsx
// 层：React 页面／组件
// 作用：分页阅读和编辑完整长正文或补充。
// 说明：每次只呈现一段；保存会保留其余原文并再次核验版本。
import { useEffect, useRef, useState } from 'react'
import type { Citation } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { api } from '../../shared/api/client'
import { MarkdownContent } from './MarkdownContent'
import { saveTextPage, type TextTarget } from './long_text_edit'

type Props = TextTarget & { first: string; chars: number; citations: Citation[] }

// 组件按知识版本挂载，请求序号拒绝旧分页返回，卸载后停止未提交的上传。
function useLongContent(props: Props) {
  const { guarded, reload, setSelected, setAnswer, selectionSequence } = useAppContext()
  const [page, setPage] = useState(props.first ? 0 : -1)
  const [content, setContent] = useState(props.first)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(true)
  const sequence = useRef(0)
  const pages = Math.max(1, Math.ceil(props.chars / 12000))
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      sequence.current++
    }
  }, [])
  // 切段期间保持旧显示，成功后再一起更新页码与内容。
  const read = (next: number) =>
    guarded(async () => {
      const request = ++sequence.current
      setBusy(true)
      try {
        const value = await api.request('knowledge.text', {
          action: 'read',
          id: props.id,
          version: props.version,
          supplement_id: props.supplement_id,
          page: next
        })
        if (active.current && sequence.current === request && value.content !== undefined) {
          setPage(next)
          setContent(value.content)
        }
      } finally {
        if (active.current && sequence.current === request) {
          setBusy(false)
        }
      }
    })
  // 版本冲突或上传失败时保留当前输入；成功提交后读取新的完整详情元数据。
  const save = () =>
    guarded(async () => {
      if (draft === null || busy) {
        return
      }
      setBusy(true)
      const selection = selectionSequence.current
      try {
        await saveTextPage(props, page, pages, draft, () => active.current)
        const value = await api.request('knowledge.get', { id: props.id })
        if (selection === selectionSequence.current) {
          setSelected(value)
          setAnswer(null)
        }
        await reload()
      } finally {
        if (active.current) {
          setBusy(false)
        }
      }
    })
  return { page, pages, content, draft, setDraft, busy, read, save }
}

// 分段大小只约束单次传输，不限制整篇正文长度。
export function LongContent(props: Props) {
  const state = useLongContent(props)
  const { setCitation } = useAppContext()
  return (
    <div className="long-content">
      <p>
        完整正文共 {props.chars} 字符，分 {state.pages} 段阅读；
        {state.page < 0 ? '点击加载正文。' : `当前第 ${state.page + 1} 段。`}
      </p>
      {state.page < 0 && (
        <button disabled={state.busy} onClick={() => void state.read(0)}>
          加载正文
        </button>
      )}
      {state.draft === null ? (
        <MarkdownContent
          content={state.content}
          citations={props.citations}
          onCitation={setCitation}
        />
      ) : (
        <textarea
          aria-label="本段正文"
          value={state.draft}
          disabled={state.busy}
          onChange={(event) => state.setDraft(event.target.value)}
        />
      )}
      <div className="supplement-actions">
        <button
          disabled={state.busy || state.draft !== null || state.page <= 0}
          onClick={() => void state.read(state.page - 1)}
        >
          上一段正文
        </button>
        <button
          disabled={
            state.busy || state.draft !== null || state.page < 0 || state.page + 1 >= state.pages
          }
          onClick={() => void state.read(state.page + 1)}
        >
          下一段正文
        </button>
        {state.draft === null ? (
          <button
            disabled={state.busy || state.page < 0}
            onClick={() => state.setDraft(state.content)}
          >
            编辑本段
          </button>
        ) : (
          <>
            <button disabled={state.busy} onClick={() => void state.save()}>
              保存本段
            </button>
            <button disabled={state.busy} onClick={() => state.setDraft(null)}>
              取消编辑
            </button>
          </>
        )}
      </div>
    </div>
  )
}
