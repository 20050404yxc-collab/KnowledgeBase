// 文件：SelectionCapture.tsx
// 层：React 页面／组件
// 作用：确认可独立阅读的回答正文，选择分类或非覆盖补充目标。
// 说明：预览不调用模型，版本冲突和提交失败保留草稿。
import { useEffect, useRef, useState } from 'react'
import type { Knowledge, SearchResult } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { api, errorText } from '../../shared/api/client'
import { CategoryPicker } from '../knowledge'
import type { CaptureDraft, ChatEntry } from './use_selection_questions'
import { updateCapture } from './selection_state'

// 保存编辑保留在根会话中，关闭预览可返回聊天，失败不会清空内容。
export function SelectionCapture({ entry }: { entry: ChatEntry }) {
  const { selectionChat: chat } = useAppContext()
  const [choosing, setChoosing] = useState(false)
  const draft = entry.preview
  if (!draft) {
    return null
  }
  const saving = chat.savingId === entry.session.id
  const update = (value: Partial<CaptureDraft>) =>
    chat.patch(entry.session.id, (current) => updateCapture(current, value))
  return (
    <div className="modal-backdrop selection-capture-backdrop">
      <section
        className="modal selection-capture"
        role="dialog"
        aria-modal="true"
        aria-label="保存选区回答"
      >
        <h2>确认入库内容</h2>
        <p className="subtle">
          包含本轮问题、阅读背景、必要前文和回答。请核对和编辑；保存后可被本地搜索复用。
        </p>
        {entry.error && (
          <p role="alert" className="alert error">
            {entry.error}
          </p>
        )}
        <fieldset disabled={saving}>
          <label>
            知识标题
            <input
              aria-label="问答入库标题"
              maxLength={160}
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
            />
          </label>
          <label>
            完整正文
            <textarea
              aria-label="问答入库正文"
              value={draft.content}
              onChange={(event) => update({ content: event.target.value })}
            />
          </label>
          <TargetPicker
            key={entry.session.id + draft.turn}
            target={draft.target}
            choose={(target) => update({ target })}
            onBusy={setChoosing}
          />
          {!draft.target && (
            <CategoryPicker value={draft.path} onChange={(path) => update({ path })} />
          )}
          {draft.target && (
            <p>追加到：{draft.target.title}。原笔记保留；并发修改时会拒绝保存，请重新选择目标。</p>
          )}
        </fieldset>
        <div className="modal-actions">
          <button disabled={saving} onClick={() => chat.patch(entry.session.id, { preview: null })}>
            返回问答
          </button>
          <button
            className="primary"
            disabled={saving || choosing || !draft.title.trim() || !draft.content.trim()}
            onClick={() => void chat.capture(entry)}
          >
            {saving ? '正在保存…' : '确认保存回答'}
          </button>
        </div>
      </section>
    </div>
  )
}

// 显式搜索并选择完整目标版本；换词、关闭和卸载会使旧查询返回失效。
function TargetPicker({
  target,
  choose,
  onBusy
}: {
  target: Knowledge | null
  choose: (target: Knowledge | null) => void
  onBusy: (busy: boolean) => void
}) {
  const { query, result, error, busy, search, select, changeQuery } = useTargetPicker(choose)
  // 读取目标未完成时阻止确认保存；卸载解除等待，既有草稿不受影响。
  useEffect(() => {
    onBusy(busy)
    return () => onBusy(false)
  }, [busy, onBusy])
  return (
    <div className="selection-target">
      <label>
        或者追加到已有知识
        <input
          aria-label="搜索补充目标"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="搜索标题或关键词"
        />
      </label>
      <button disabled={busy} onClick={() => void search()}>
        搜索补充目标
      </button>
      {target && <button onClick={() => choose(null)}>取消目标，改为新建</button>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <small>找到 {result.total} 条相关内容</small>
          {result.items.map((hit) => (
            <button disabled={busy} key={hit.id} onClick={() => void select(hit.knowledge_id)}>
              追加到：{hit.title}
            </button>
          ))}
          <nav className="pagination">
            <button
              disabled={busy || result.page === 0}
              onClick={() => void search(result.page - 1)}
            >
              上一页目标
            </button>
            <button
              disabled={busy || (result.page + 1) * 30 >= result.total}
              onClick={() => void search(result.page + 1)}
            >
              下一页目标
            </button>
          </nav>
        </div>
      )}
    </div>
  )
}

// 目标查询状态独立于保存草稿；卸载只使回调失效，不修改已有知识。
function useTargetPicker(choose: (target: Knowledge | null) => void) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  useEffect(
    () => () => {
      sequence.current++
    },
    []
  )
  // 此处只读本地知识；选中时读取当前版本，防止陈旧结果误追加。
  async function search(page = 0) {
    const request = ++sequence.current
    setBusy(true)
    try {
      const value = await api.request('knowledge.search', { query, page, scope: 'knowledge' })
      if (request === sequence.current) {
        setResult(value)
        setError('')
      }
    } catch (err) {
      if (request === sequence.current) {
        setError(errorText(err))
      }
    } finally {
      if (request === sequence.current) {
        setBusy(false)
      }
    }
  }
  // 只有成功读取当前知识版本后才设置补充目标，失败不改变原选择。
  async function select(id: string) {
    const request = ++sequence.current
    setBusy(true)
    try {
      const item = await api.request('knowledge.get', { id })
      if (request === sequence.current) {
        choose(item)
        setError('')
        setResult(null)
      }
    } catch (err) {
      if (request === sequence.current) {
        setError(errorText(err))
      }
    } finally {
      if (request === sequence.current) {
        setBusy(false)
      }
    }
  }
  const changeQuery = (value: string) => {
    sequence.current++
    setBusy(false)
    setQuery(value)
    setResult(null)
  }
  return { query, result, error, busy, search, select, changeQuery }
}
