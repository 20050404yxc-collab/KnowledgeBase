// 文件：AnswerPanel.tsx
// 层：React 页面／组件
// 作用：安全显示当前回答正文与引用入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { AnswerHeading } from './AnswerHeading'
import { CitationList } from './CitationList'
import { NoteFooter } from './NoteFooter'

// 安全显示当前回答正文与引用入口。
export function AnswerPanel() {
  const { answer, selected, visibleContent, visibleCitations } = useAppContext()
  return (
    <article className="answer-panel">
      <AnswerHeading />
      <div className="reading-text">{visibleContent}</div>
      {visibleCitations.length > 0 && <CitationList />}
      {answer?.notice && <p className="result-notice">{answer.notice}</p>}
      {selected && <NoteFooter />}
    </article>
  )
}
