// 文件：Composer.tsx
// 层：React 页面／组件
// 作用：组合问题输入、附件列表与提交工具栏。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { QuestionInput } from './QuestionInput'
import { AttachmentList } from './AttachmentList'
import { ComposerToolbar } from './ComposerToolbar'
import { useEffect, useRef } from 'react'

// 显式跳转和前台新结果可聚焦阅读；切页挂载已有结果不抢占恢复的滚动位置。
function showResults() {
  const target = document.getElementById('learning-results')
  target?.scrollIntoView({ block: 'start' })
  target?.focus({ preventScroll: true })
}

// 组合问题输入、附件列表与提交工具栏。
export function Composer() {
  const {
    attachments,
    answerQuestion,
    query,
    composerCollapsed,
    setComposerCollapsed,
    resultArrival
  } = useAppContext()
  const previous = useRef(resultArrival)
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    // 新结果只在输入区仍可见时引导阅读；后台完成及正在阅读下方内容时不抢滚动。
    if (previous.current !== resultArrival) {
      previous.current = resultArrival
      const rect = section.current?.getBoundingClientRect()
      if (composerCollapsed && rect && rect.bottom > 0 && rect.top < window.innerHeight) {
        showResults()
      }
    }
  }, [resultArrival, composerCollapsed])
  return (
    <section className="composer" ref={section}>
      {composerCollapsed && (
        <div className="composer-summary">
          <span>
            本次问题：{query || '本地检索'} · {attachments.length} 个附件
          </span>
          <button
            onClick={() => setComposerCollapsed(false)}
            aria-expanded={false}
            aria-controls="question-form"
          >
            修改问题与附件
          </button>
          <button onClick={showResults}>查看结果</button>
        </div>
      )}
      <form
        id="question-form"
        hidden={composerCollapsed}
        onSubmit={(event) => {
          event.preventDefault()
          void answerQuestion()
        }}
      >
        <label className="sr-only" htmlFor="question">
          输入问题
        </label>
        <QuestionInput />
        {attachments.length > 0 && <AttachmentList />}
        <ComposerToolbar />
      </form>
      <p className="learning-guide" hidden={composerCollapsed}>
        先搜索相关知识，再由 AI 结合最多五段摘录回答；无相关内容时直接回答。满意后可预览保存。
      </p>
      {!composerCollapsed && resultArrival > 0 && (
        <button
          onClick={() => setComposerCollapsed(true)}
          aria-expanded={true}
          aria-controls="question-form"
        >
          收起输入区
        </button>
      )}
    </section>
  )
}
