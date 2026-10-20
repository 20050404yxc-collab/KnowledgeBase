// 文件：KnowledgeQuestion.tsx
// 层：React 页面／组件
// 作用：在知识分区提供仅含输入框与确认键的提问入口。
// 说明：复用探索的目录流程、模型和范围，不复制生成逻辑。
import { useAppContext } from '../../app/AppContext'

// 草稿随页面保存；提交仅使用当前文本，不修改探索的问题输入。
export function KnowledgeQuestion() {
  const { questionDraft, setQuestionDraft, buildDirectory, busy, ready } = useAppContext()
  return (
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
        确认
      </button>
    </form>
  )
}
