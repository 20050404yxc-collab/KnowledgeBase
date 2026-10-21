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
  const {
    selected,
    answer,
    ready,
    busy,
    restructureDraft,
    planRestructure,
    setEditor,
    activeProvider,
    generationOptions,
    chooseModel,
    chooseEffort
  } = useAppContext()
  return (
    <section aria-label="知识库页面">
      <div className="page-heading">
        <div>
          <h1>知识库</h1>
          <p>所有知识，按大类、小类和知识点整理。</p>
        </div>
        <div>
          <button
            disabled={!ready || !!busy || !!restructureDraft}
            onClick={() => void planRestructure()}
          >
            重构知识库
          </button>
          <button disabled={!ready} onClick={() => setEditor({ title: '', content: '' })}>
            ＋ 新建知识
          </button>
        </div>
      </div>
      <p className="result-notice">
        先粗略浏览知识并提出目标结构，概览最多 2400
        字符；确认结构后再根据完整原文重组正文，正文不设总字符上限。会调用当前模型并记录用量，最后核对内容并保存。
      </p>
      {activeProvider && (
        <ModelPicker
          provider={activeProvider}
          value={generationOptions}
          disabled={!!busy || !!restructureDraft}
          onModel={(model) => chooseModel(activeProvider, model)}
          onEffort={(effort) => chooseEffort(activeProvider, effort)}
        />
      )}
      <RestructurePanel />
      <div className="library-workspace">
        <SavedKnowledgeTree />
        {(selected || answer) && <AnswerPanel />}
      </div>
    </section>
  )
}
