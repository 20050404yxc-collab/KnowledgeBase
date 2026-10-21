// 文件：ProjectMaterials.tsx
// 层：React 页面／组件
// 作用：在目录右侧按项目完整路径集中接收文件并统一生成项目知识。
// 说明：文件通过既有附件入口解析，勾选范围只用于当前项目的一次提交。
import { categoryPath } from '../../shared/knowledge_tree'
import { useState } from 'react'
import type { DirectoryPoint } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { api, errorText } from '../../shared/api/client'
import { projectKey } from './directory_batch'
import type { Attached } from './attachment_state'

// 文件失败信息保持可见，未完成解析不能被当成已就绪材料。
function fileStatus(file: Attached): string {
  if (file.state === 'loading') {
    return '解析中'
  }
  if (file.state === 'error') {
    return file.error ?? '解析失败'
  }
  return '已就绪'
}

// 选择文件和手输路径走同一解析流程；拖入本框的文件不会再次冒泡加入附件。
function ProjectUpload({ receive }: { receive: (paths: string[]) => Promise<void> }) {
  const { busy, guarded, setError } = useAppContext()
  const [path, setPath] = useState('')
  return (
    <div
      className="project-upload"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (busy) {
          return
        }
        try {
          void receive(api.pathsForFiles(Array.from(event.dataTransfer.files)))
        } catch (error) {
          setError(errorText(error))
        }
      }}
    >
      <p>拖入项目文件，或选择文件／输入本地路径。</p>
      <button
        disabled={!!busy}
        onClick={() => void guarded(async () => receive(await api.chooseFiles()))}
      >
        选择项目资料
      </button>
      <form
        className="project-path"
        onSubmit={(event) => {
          event.preventDefault()
          void receive([path.trim()])
        }}
      >
        <input
          aria-label="项目资料本地路径"
          placeholder="输入文件绝对路径"
          value={path}
          disabled={!!busy}
          onChange={(e) => setPath(e.target.value)}
        />
        <button disabled={!!busy || !path.trim()}>加入资料</button>
      </form>
    </div>
  )
}

// 当前项目单独持有文件选择，资料不会因选择另一个项目而自动获得使用许可。
function ProjectMaterialGroup({ points }: { points: DirectoryPoint[] }) {
  const { attachments, addFiles, busy, learnBatch, outcomes } = useAppContext()
  const [paths, setPaths] = useState<string[]>([])
  const pending = points.filter((p) => p.status !== '已有知识' && !outcomes[p.id]?.answer?.review)
  const readyIds = attachments
    .filter((a) => paths.includes(a.path) && a.state === 'ready' && a.id)
    .map((a) => a.id ?? '')
  const loading = attachments.some((a) => paths.includes(a.path) && a.state === 'loading')
  return (
    <section className="project-material-group">
      <h4>
        {categoryPath(points[0]).join(' → ') || points[0].theme} · {pending.length} 项待生成
      </h4>
      <ul>
        {[...new Set(points.map((p) => p.material_request).filter(Boolean))].map((request) => (
          <li key={request}>{request}</li>
        ))}
      </ul>
      <ProjectUpload
        receive={async (files) => {
          setPaths((current) => [...new Set([...current, ...files])])
          await addFiles(files)
        }}
      />
      <div className="project-files">
        {attachments.map((file) => (
          <label key={file.localId}>
            <input
              type="checkbox"
              disabled={!!busy}
              checked={paths.includes(file.path)}
              onChange={(event) => {
                const checked = event.target.checked
                setPaths((current) =>
                  checked
                    ? [...new Set([...current, file.path])]
                    : current.filter((p) => p !== file.path)
                )
              }}
            />
            {file.name} · {fileStatus(file)}
          </label>
        ))}
      </div>
      <p>勾选本项目使用的资料，一次提交后逐点核对并生成；不足或失败的项会单独显示。</p>
      <button
        className="primary"
        disabled={!!busy || loading || !readyIds.length || !pending.length}
        onClick={() =>
          void learnBatch(
            pending.map((p) => p.id),
            readyIds
          )
        }
      >
        补充资料并生成本项目全部知识点
      </button>
    </section>
  )
}

// 同一目录中的项目按已审核的完整路径集中显示，名称和包含项均可见。
export function ProjectMaterials() {
  const { directory } = useAppContext()
  const projects = directory?.points.filter((p) => p.project_required) ?? []
  if (!projects.length) {
    return null
  }
  return (
    <section className="project-materials" aria-label="项目待补充资料">
      <h3>项目待补充资料</h3>
      {[...new Set(projects.map(projectKey))].map((key) => (
        <ProjectMaterialGroup
          key={`${directory?.plan_id}:${key}`}
          points={projects.filter((p) => projectKey(p) === key)}
        />
      ))}
    </section>
  )
}
