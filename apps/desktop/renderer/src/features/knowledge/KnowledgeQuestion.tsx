// 文件：KnowledgeQuestion.tsx
// 层：React 页面／组件
// 作用：在知识分区提供仅含输入框与确认键的提问入口。
// 说明：复用探索的目录流程、模型和范围，不复制生成逻辑。
import { useAppContext } from '../../app/AppContext'
import { ModelPicker } from '../providers'

// 草稿随页面保存；提交仅使用当前文本，不修改探索的问题输入。
export function KnowledgeQuestion() {
  const {
    questionDraft,
    setQuestionDraft,
    buildDirectory,
    busy,
    ready,
    activeProvider,
    generationOptions,
    chooseModel,
    chooseEffort,
    setSection,
    searchGlobal
  } = useAppContext()
  return (
    <section className="bucket-learning">
      <h2>继续学习</h2>
      {activeProvider ? (
        <>
          <p>
            当前接口：{activeProvider.name}
            。生成目录会调用模型并可能产生费用；知识正文按需另行生成。
          </p>
          <ModelPicker
            provider={activeProvider}
            value={generationOptions}
            disabled={!!busy}
            onModel={(value) => chooseModel(activeProvider, value)}
            onEffort={(value) => chooseEffort(activeProvider, value)}
          />
        </>
      ) : (
        <p>
          尚未配置 AI 接口，本地搜索可直接使用。
          <button onClick={() => setSection('设置')}>设置 AI 接口</button>
        </p>
      )}
      <form
        className="knowledge-question"
        aria-label="知识提问"
        onSubmit={(event) => {
          event.preventDefault()
          void buildDirectory(questionDraft)
        }}
      >
        <input
          aria-label="知识提问内容"
          placeholder="输入问题，继续探索知识…"
          maxLength={12000}
          value={questionDraft}
          disabled={!ready || !!busy}
          onChange={(event) => setQuestionDraft(event.target.value)}
          onKeyDown={(event) => {
            // 与探索一致支持 Ctrl + Enter 提交，普通 Enter 也由表单处理。
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              if (questionDraft.trim() && !busy && ready) {
                void buildDirectory(questionDraft)
              }
            }
          }}
        />
        <button className="primary" disabled={!ready || !!busy || !questionDraft.trim()}>
          {activeProvider ? '生成学习目录' : '查看本地相关内容'}
        </button>
        <button
          type="button"
          disabled={!ready || !questionDraft.trim()}
          onClick={() => void searchGlobal(questionDraft)}
        >
          搜索此问题
        </button>
      </form>
    </section>
  )
}
