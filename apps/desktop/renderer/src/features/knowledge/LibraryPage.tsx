// 文件：LibraryPage.tsx
// 层：React 知识库页面
// 作用：组合完整已入库目录、知识详情和确认式重构。
// 说明：原始资料仍在资料库管理，本页不把来源块当作知识点。
import { useAppContext } from '../../app/AppContext'
import { SavedKnowledgeTree } from './SavedKnowledgeTree'
import { AnswerPanel } from './AnswerPanel'
import { ModelPicker } from '../providers'
import { RestructurePanel } from './RestructurePanel'

// 启动重构明确说明外发范围及费用，用户点击按钮才请求模型。
export function LibraryPage() {
  const { selected, answer, ready, restructureDraft, setEditor } = useAppContext()
  return (
    <section aria-label="知识库页面">
      <div className="page-heading">
        <div>
          <h1>知识库</h1>
          <p>所有知识，按多层知识树逐级整理与阅读。</p>
        </div>
        <div>
          <button disabled={!ready} onClick={() => setEditor({ title: '', content: '' })}>
            ＋ 新建知识
          </button>
        </div>
      </div>
      {!restructureDraft && <OrganizationSetup />}
      <RestructurePanel />
      <div className="library-workspace">
        <SavedKnowledgeTree />
        {(selected || answer) && <AnswerPanel />}
      </div>
    </section>
  )
}

// 日常阅读收起整理说明；启动前选择分类或内容范围并明确模型费用。
function OrganizationSetup() {
  const {
    activeProvider,
    generationOptions,
    chooseModel,
    chooseEffort,
    busy,
    ready,
    organizationMode,
    setOrganizationMode,
    planRestructure,
    setSection
  } = useAppContext()
  return (
    <details className="organization-setup">
      <summary>整理知识库</summary>
      <p>
        先调用当前模型分析知识并提出分类，概览每条最多 2400
        字符，记录用量并可能产生费用。确认方案后才保存。
      </p>
      <label>
        <input
          type="radio"
          name="organization-mode"
          checked={organizationMode === 'categories'}
          onChange={() => setOrganizationMode('categories')}
          disabled={!!busy}
        />
        只整理分类（保留正文）
      </label>
      <label>
        <input
          type="radio"
          name="organization-mode"
          checked={organizationMode === 'content'}
          onChange={() => setOrganizationMode('content')}
          disabled={!!busy}
        />
        整理分类并准备内容调整
      </label>
      <p className="subtle">
        仅分类无需生成正文。合并知识必须准备并接受完整原文整理稿；内容模式会继续调用模型，全文分片处理后逐项核对。
      </p>
      {activeProvider ? (
        <ModelPicker
          provider={activeProvider}
          value={generationOptions}
          disabled={!!busy}
          onModel={(model) => chooseModel(activeProvider, model)}
          onEffort={(effort) => chooseEffort(activeProvider, effort)}
        />
      ) : (
        <button onClick={() => setSection('设置')}>配置生成接口</button>
      )}
      <button
        className="primary"
        disabled={!ready || !!busy || !activeProvider}
        onClick={() => void planRestructure()}
      >
        生成整理方案
      </button>
    </details>
  )
}
