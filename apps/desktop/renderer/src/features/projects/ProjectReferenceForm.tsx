// 文件：ProjectReferenceForm.tsx
// 层：React 页面／组件
// 作用：编辑项目标签及本地目录路径，不在界面枚举或加载文件。
// 说明：选择和拖放只取得根路径，合法性由后台验证。
import { useState } from 'react'
import type { ProjectReference, ProjectReferenceInput } from '../../../../../../contracts/projects'
import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

interface ReferenceFormProps {
  current: ProjectReference | null
  categoryPath: string[]
  defaultLabel: string
  disabled: boolean
  save: (value: ProjectReferenceInput) => Promise<void>
  cancel: () => void
}

// 每次编辑按登记版本重新挂载，避免把另一个项目的草稿提交到当前标识。
export function ProjectReferenceForm({
  current,
  categoryPath,
  defaultLabel,
  disabled,
  save,
  cancel
}: ReferenceFormProps) {
  const { guarded } = useAppContext()
  const [label, setLabel] = useState(current?.label ?? defaultLabel)
  const [path, setPath] = useState(current?.path ?? '')
  return (
    <form
      className="project-reference-form"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (disabled) {
          return
        }
        void guarded(async () => {
          const paths = api.pathsForFiles(Array.from(event.dataTransfer.files))
          if (paths.length !== 1) {
            throw new Error('请一次拖入一个项目文件夹')
          }
          setPath(paths[0])
        })
      }}
      onSubmit={(event) => {
        event.preventDefault()
        void save({
          id: current?.id,
          label,
          path,
          category_path: current?.category_path ?? categoryPath
        })
      }}
    >
      <ReferenceField
        title="项目标签"
        name="项目路径标签"
        value={label}
        disabled={disabled}
        placeholder="填写易区分的项目名，后续提问使用此标签"
        change={setLabel}
      />
      <ReferenceField
        title="本地文件夹路径"
        name="项目文件夹路径"
        value={path}
        disabled={disabled}
        placeholder="输入绝对路径，或把文件夹拖到这里"
        change={setPath}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          void guarded(async () => {
            const selected = await api.chooseFolder()
            if (selected) {
              setPath(selected)
            }
          })
        }
      >
        选择项目文件夹
      </button>
      <button disabled={disabled || label.trim().length < 2 || !path.trim()}>保存项目路径</button>
      {current && (
        <button type="button" disabled={disabled} onClick={cancel}>
          取消编辑
        </button>
      )}
    </form>
  )
}

// 输入只保存表单草稿，不触发目录扫描或正文解析。
function ReferenceField({
  title,
  name,
  value,
  disabled,
  placeholder,
  change
}: {
  title: string
  name: string
  value: string
  disabled: boolean
  placeholder: string
  change: (value: string) => void
}) {
  return (
    <label>
      {title}
      <input
        aria-label={name}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => change(event.target.value)}
      />
    </label>
  )
}
