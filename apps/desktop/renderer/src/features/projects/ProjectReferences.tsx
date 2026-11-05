// 文件：ProjectReferences.tsx
// 层：React 页面／组件
// 作用：在资料库和项目补充入口管理长期项目路径引用。
// 说明：列表只取元数据；目录预览显式触发，编辑／移除不操作原件。
import { useEffect, useState } from 'react'
import type { ProjectReference, ProjectReferenceInput } from '../../../../../../contracts/projects'
import { api, errorText } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'
import { ProjectReferenceForm } from './ProjectReferenceForm'

// 页面独立持有列表和草稿，离开页面后不把晚到结果写入其他页面。
export function ProjectReferences({
  categoryPath = [],
  defaultLabel = ''
}: {
  categoryPath?: string[]
  defaultLabel?: string
}) {
  const { busy, guarded } = useAppContext()
  const [rows, setRows] = useProjectRows()
  const [editing, setEditing] = useState<ProjectReference | null>(null)
  const [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<{ id: string; entries: string[]; notice: string } | null>(
    null
  )
  // 仅本组件提交期间禁用表单，失败保留草稿，不显示虚假的保存结果。
  async function run(action: () => Promise<void>) {
    setPending(true)
    try {
      await guarded(action)
    } finally {
      setPending(false)
    }
  }
  // 保存后通知同页其他项目组刷新；草稿仍由各自表单持有。
  const save = (value: ProjectReferenceInput) =>
    run(async () => {
      setRows(await api.request('projects.save', value))
      setEditing(null)
      setPreview(null)
      window.dispatchEvent(new Event('kb-project-references-changed'))
    })
  return (
    <section className="project-references" aria-label="已登记项目路径">
      <h3>项目文件夹 · 路径引用</h3>
      <p>
        只保存标签和本地路径，不导入整个项目。后续提问使用标签，可自动关联并按需读取少量相关文件。
        “仅本次文件”范围不会自动使用已登记项目。
      </p>
      <ProjectReferenceForm
        key={editing?.revision ?? 'new'}
        current={editing}
        categoryPath={categoryPath}
        defaultLabel={defaultLabel}
        disabled={!!busy || pending}
        save={save}
        cancel={() => setEditing(null)}
      />
      {rows.map((row) => (
        <ProjectReferenceRow
          key={row.id}
          row={row}
          disabled={!!busy || pending}
          edit={() => setEditing(row)}
          preview={() =>
            void run(async () => {
              setPreview({ id: row.id, ...(await api.request('projects.tree', { id: row.id })) })
            })
          }
          remove={() =>
            void run(async () => {
              setRows(await api.request('projects.delete', { id: row.id }))
              window.dispatchEvent(new Event('kb-project-references-changed'))
              setPreview(null)
              setEditing((current) => (current?.id === row.id ? null : current))
            })
          }
        />
      ))}
      {preview && (
        <details open>
          <summary>目录预览（未读取文件正文）</summary>
          <pre>{preview.entries.join('\n')}</pre>
          <p>{preview.notice || '已完成本次有界目录发现。'}</p>
        </details>
      )}
    </section>
  )
}

// 原路径只在本机展示；移除登记前明确原件仍保留。
function ProjectReferenceRow({
  row,
  disabled,
  edit,
  preview,
  remove
}: {
  row: ProjectReference
  disabled: boolean
  edit: () => void
  preview: () => void
  remove: () => void
}) {
  return (
    <article className="source-row project-reference-row">
      <div>
        <h4>{row.label}</h4>
        <p>{row.path}</p>
        {row.category_path.length > 0 && <p>项目分组：{row.category_path.join(' → ')}</p>}
      </div>
      <button disabled={disabled} onClick={edit}>
        编辑路径／标签
      </button>
      <button disabled={disabled} onClick={preview}>
        查看目录
      </button>
      <button
        disabled={disabled}
        onClick={() => {
          if (
            confirm('移除此项目的路径登记？原项目文件和已有知识均保留，后续不再自动读取该路径。')
          ) {
            remove()
          }
        }}
      >
        移除登记
      </button>
    </article>
  )
}

// 只读取元数据；变更事件刷新各组，序号和卸载清理阻止旧响应覆盖新列表。
function useProjectRows() {
  const { setError } = useAppContext()
  const [rows, setRows] = useState<ProjectReference[]>([])
  useEffect(() => {
    let sequence = 0
    let active = true
    // 每次刷新固定自己的序号，失败或成功都只作用于最新请求。
    function reload() {
      const current = ++sequence
      api
        .request('projects.list')
        .then((value) => {
          if (active && current === sequence) {
            setRows(value)
          }
        })
        .catch((error: unknown) => {
          if (active && current === sequence) {
            setError(errorText(error))
          }
        })
    }
    window.addEventListener('kb-project-references-changed', reload)
    reload()
    return () => {
      active = false
      window.removeEventListener('kb-project-references-changed', reload)
    }
  }, [setError])
  return [rows, setRows] as const
}
