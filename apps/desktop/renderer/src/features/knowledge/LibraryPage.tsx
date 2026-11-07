// 文件：LibraryPage.tsx
// 层：React 知识库页面
// 作用：组合完整已入库目录、知识详情和确认式重构。
// 说明：原始资料仍在资料库管理，本页不把来源块当作知识点。
import { useState } from 'react'
import { useAppContext } from '../../app/AppContext'
import { ReadingWorkspace } from './ReadingWorkspace'
import { KnowledgeQuestion } from './KnowledgeQuestion'
import { KnowledgeWorkspace, RelatedKnowledge, WorkingStatus } from '../exploration'
import { RestructurePanel } from './RestructurePanel'
import { OrganizationSetup } from './OrganizationSetup'

// 启动重构明确说明外发范围及费用，用户点击按钮才请求模型。
export function LibraryPage() {
  const { ready, restructureDraft, setEditor, busy, recommendations } = useAppContext()
  const [organizing, setOrganizing] = useState(false)
  return (
    <section aria-label="知识库页面">
      <div className="page-heading">
        <div>
          <h1>知识库</h1>
          <p>所有知识，按多层知识树逐级整理与阅读。</p>
        </div>
        <div className="heading-actions">
          <button
            disabled={!ready || !!busy || !!restructureDraft}
            onClick={() => setOrganizing(true)}
          >
            整理知识库
          </button>
          <button disabled={!ready} onClick={() => setEditor({ title: '', content: '' })}>
            ＋ 新建知识
          </button>
        </div>
      </div>
      {organizing && <OrganizationSetup onClose={() => setOrganizing(false)} />}
      <RestructurePanel />
      <ReadingWorkspace>
        {busy && <WorkingStatus />}
        <KnowledgeWorkspace />
      </ReadingWorkspace>
      {recommendations.length > 0 && <RelatedKnowledge />}
      <KnowledgeQuestion compact />
    </section>
  )
}
