// 文件：ProjectPanel.tsx
// 层：React 页面／组件
// 作用：索要项目材料并提供明确的公开示例检索与选择入口。
// 说明：只有用户按钮动作发出许可，附件或模型输出不表示同意。
import { useState } from 'react'
import { useAppContext } from '../../app/AppContext'

// 各知识点分别维护可编辑检索词和范围选择；更换输入撤销旧许可。
export function ProjectPanel() {
  const { selectedPoint, projectContext, attachments, scope, busy, learnPoint } = useAppContext()
  const [terms, setTerms] = useState(selectedPoint?.search_terms ?? '')
  const [publicScope, setPublicScope] = useState(false)
  if (!selectedPoint?.project_required) {
    return null
  }
  const readyIds = attachments.filter((a) => a.state === 'ready' && a.id).map((a) => a.id ?? '')
  return (
    <section className="project-context" aria-label="项目资料与公开示例">
      <h4>需要项目依据</h4>
      <p>{selectedPoint.material_request}</p>
      <button
        disabled={!!busy || !readyIds.length}
        onClick={() => void learnPoint('materials', { attachment_ids: readyIds })}
      >
        核对当前附件是否足够
      </button>
      <p>{projectContext?.message ?? '请在探索输入区加入相关项目资料。通用概念可单独拆分学习。'}</p>
      <label>
        公开项目检索词
        <input
          aria-label="公开项目检索词"
          value={terms}
          disabled={!!busy}
          maxLength={120}
          onChange={(e) => {
            setTerms(e.target.value)
            void learnPoint('revoke')
          }}
        />
      </label>
      {scope === 'files' && (
        <label>
          <input
            type="checkbox"
            checked={publicScope}
            disabled={!!busy}
            onChange={(e) => {
              setPublicScope(e.target.checked)
              void learnPoint('revoke')
            }}
          />
          同意本知识点增加公开项目来源
        </label>
      )}
      <p>
        将这些检索词发送到 GitHub，最多读取 3 个仓库的 README。公开示例不代表你的项目或工作经历。
      </p>
      <button
        disabled={
          !!busy ||
          !projectContext?.revision ||
          !terms.trim() ||
          (scope === 'files' && !publicScope)
        }
        onClick={() =>
          void learnPoint('public-search', {
            consent: true,
            search_terms: terms,
            public_scope: publicScope,
            revision: projectContext?.revision ?? selectedPoint.project_revision
          })
        }
      >
        同意按上述词检索公开项目
      </button>
      <PublicCandidates />
      {projectContext && (
        <button disabled={!!busy} onClick={() => void learnPoint('revoke')}>
          撤销公开项目授权
        </button>
      )}
    </section>
  )
}

// 候选仅来自本次已授权检索，选择不触发另一轮搜索。
function PublicCandidates() {
  const { projectContext, busy, learnPoint } = useAppContext()
  return (
    <>
      {projectContext?.candidates.map((c) => (
        <article key={c.id} className="public-project">
          <h4>
            <a href={c.url} target="_blank" rel="noreferrer noopener">
              {c.name}
            </a>
          </h4>
          <small>
            {c.locator} · {c.retrieved_at}
          </small>
          <pre>{c.excerpt.slice(0, 500)}</pre>
          <button
            disabled={!!busy || projectContext.status !== 'candidates'}
            onClick={() =>
              void learnPoint('public-select', {
                candidate_id: c.id,
                revision: projectContext.revision
              })
            }
          >
            选择此公开示例
          </button>
        </article>
      ))}
    </>
  )
}
