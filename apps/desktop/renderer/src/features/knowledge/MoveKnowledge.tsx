// 文件：MoveKnowledge.tsx
// 层：React 交互组件
// 作用：在阅读详情内直接修改知识分类，不调用模型或上传正文。
// 说明：请求携带打开时的版本，失败保留输入，切页或换知识拒绝迟到视图更新。
import { useEffect, useRef, useState } from 'react'
import { useAppContext } from '../../app/AppContext'
import { api, errorText } from '../../shared/api/client'
import { CategoryPicker } from './CategoryPicker'

// 移动草稿属于当前详情；换知识时由父级 key 重建，卸载只停止更新视图。
export function MoveKnowledge() {
  const { selected, setSelected, setAnswer, reload, setMessage, selectionSequence } =
    useAppContext()
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState(selected?.category_path ?? [])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  if (!selected?.version) {
    return null
  }
  const submit = async () => {
    setSaving(true)
    setError('')
    const sequence = selectionSequence.current
    try {
      const item = await api.request('knowledge.move', {
        id: selected.id,
        version: selected.version ?? '',
        category_path: path
      })
      await reload()
      // 已提交内容照常刷新，只有仍停留原详情时才更改阅读和移动面板。
      if (mounted.current && sequence === selectionSequence.current) {
        setSelected(item)
        setAnswer(null)
        setOpen(false)
        setMessage(`已移动到：${item.category_path?.join(' → ') || '未分类'}`)
      }
    } catch (err) {
      if (mounted.current) {
        setError(errorText(err))
      }
    } finally {
      if (mounted.current) {
        setSaving(false)
      }
    }
  }
  return (
    <section className="move-knowledge" aria-label="移动知识分类">
      <span>位置：{selected.category_path?.join(' → ') || selected.theme || '未分类'}</span>
      <button
        onClick={() => {
          setPath(selected.category_path ?? [])
          setOpen(!open)
          setError('')
        }}
        disabled={saving}
        aria-expanded={open}
      >
        移动分类
      </button>
      {open && (
        <div>
          <fieldset disabled={saving}>
            <CategoryPicker value={path} onChange={setPath} />
          </fieldset>
          {error && <p role="alert">{error}；分类输入已保留。</p>}
          <button
            disabled={saving || path.some((part) => !part.trim())}
            onClick={() => void submit()}
          >
            {saving ? '移动中…' : '确认移动（不调用 AI）'}
          </button>
          <button disabled={saving} onClick={() => setOpen(false)}>
            取消移动
          </button>
        </div>
      )}
    </section>
  )
}
