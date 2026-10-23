// 文件：KnowledgeQuestion.tsx
// 层：React 页面／组件
// 作用：为探索、知识库与频率分区提供共用的阅读提问栏。
// 说明：草稿和学习结果按页隔离；复用已有目录流程，不自动调用模型。
import { useAppContext } from '../../app/AppContext'
import { ModelPicker } from '../providers'

// 无可用附件时现有流程回退到知识库；此处按相同规则解释实际范围。
const SCOPE_LABELS = {
  files: '仅本次文件',
  mixed: '知识库与本次文件',
  knowledge: '知识库'
}

// 阅读提问在底部吸附；模型设置按需展开，生成时让出任务状态条的位置。
export function KnowledgeQuestion({ compact = false }: { compact?: boolean }) {
  const { busy, activeProvider } = useAppContext()
  return (
    <section
      className={compact ? 'bucket-learning reading-question' : 'bucket-learning'}
      aria-label="继续提问"
      aria-busy={!!busy}
    >
      <h2>继续提问</h2>
      {compact ? (
        <details className="reading-question-settings">
          <summary>
            {activeProvider
              ? `当前接口：${activeProvider.name} · 模型与范围（生成可能产生费用）`
              : '尚未配置 AI 接口 · 可搜索本地知识'}
          </summary>
          <QuestionSettings />
        </details>
      ) : (
        <QuestionSettings />
      )}
      <QuestionForm />
    </section>
  )
}

// 显示实际使用的模型、证据范围和费用含义，不隐式附加当前阅读正文。
function QuestionSettings() {
  const {
    busy,
    activeProvider,
    generationOptions,
    chooseModel,
    chooseEffort,
    setSection,
    attachments,
    scope
  } = useAppContext()
  const effectiveScope =
    scope !== 'files' && !attachments.some((item) => item.state === 'ready' && item.id)
      ? 'knowledge'
      : scope
  return activeProvider ? (
    <>
      <p>
        生成目录会调用模型并可能产生费用；知识正文按需另行生成。 沿用当前学习范围：
        {SCOPE_LABELS[effectiveScope]}（{attachments.length} 个附件）。本地搜索不调用模型。
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
  )
}

// 提交当前页草稿，不覆盖探索主输入；失败后草稿及重试入口继续保留。
function QuestionForm() {
  const {
    questionDraft,
    setQuestionDraft,
    buildDirectory,
    busy,
    ready,
    activeProvider,
    searchGlobal
  } = useAppContext()
  return (
    <form
      className="knowledge-question"
      aria-label="知识提问"
      onSubmit={(event) => {
        event.preventDefault()
        // 表单与快捷键遵守相同提交条件，空白问题不发起流程。
        if (questionDraft.trim() && !busy && ready) {
          void buildDirectory(questionDraft)
        }
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
          // Ctrl / Command + Enter 与普通表单提交共用同一入口。
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
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
  )
}
