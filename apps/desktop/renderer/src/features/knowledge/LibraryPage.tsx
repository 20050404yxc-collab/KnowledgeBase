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
        重构会分段读取全部知识正文与补充，调用当前所选模型概括要点并整理分类，产生调用记录。先确认目录，再查看内容差异；最终确认前原库不变。
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
