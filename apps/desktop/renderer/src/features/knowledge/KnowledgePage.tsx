// 文件：KnowledgePage.tsx
// 层：React 知识分区页面
// 作用：只组合当前频率分区的列表与主动打开的知识详情。
// 说明：探索输入、目录和推荐不挂载在知识分区。
import { useAppContext } from '../../app/AppContext'
import { KnowledgeList } from './KnowledgeList'
import { AnswerPanel } from './AnswerPanel'

// 首屏先呈现本页列表，详情由本页阅读状态决定。
export function KnowledgePage() {
  const { section, selected, ready, setEditor } = useAppContext()
  return (
    <section aria-label={`${section}页面`}>
      <div className="page-heading">
        <div>
          <h1>{section}的知识</h1>
          <p>按使用频率整理，随时回来继续学习。</p>
        </div>
        <button
          className="secondary"
          disabled={!ready}
          onClick={() => setEditor({ title: '', content: '' })}
        >
          ＋ 新建知识
        </button>
      </div>
      <KnowledgeList />
      {selected && <AnswerPanel />}
    </section>
  )
}
