// 文件：AnswerPanel.tsx
// 层：React 页面／组件
// 作用：安全显示当前回答正文与引用入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { AnswerHeading } from './AnswerHeading'
import { CitationList } from './CitationList'
import { OriginalSources } from './OriginalSources'
import { NoteFooter } from './NoteFooter'
import { MarkdownContent } from './MarkdownContent'
import { SupplementList } from './SupplementList'
import { LongContent } from './LongContent'
import { MoveKnowledge } from './MoveKnowledge'
import { FrequencySettings } from './FrequencySettings'

// 安全显示当前回答正文与引用入口。
export function AnswerPanel() {
  const { answer, selected, visibleContent, visibleCitations, setCitation } = useAppContext()
  return (
    <article className="answer-panel">
      <AnswerHeading />
      {selected && !answer?.review && <MoveKnowledge key={selected.id + selected.version} />}
      {selected && !answer?.review && <FrequencySettings />}
      {(!answer || answer.content === selected?.content) &&
      selected?.content_chars &&
      selected.version ? (
        <LongContent
          key={`${selected.id}:${selected.version}`}
          id={selected.id}
          version={selected.version}
          title={selected.title}
          first={selected.content}
          chars={selected.content_chars}
          citations={selected.citations}
        />
      ) : (
        <MarkdownContent
          source={
            selected?.version && (!answer || answer.content === selected.content)
              ? { kind: 'knowledge', id: selected.id, version: selected.version }
              : undefined
          }
          content={visibleContent ?? ''}
          citations={visibleCitations}
          onCitation={setCitation}
        />
      )}
      {selected && <SupplementList />}
      {visibleCitations.length > 0 && <CitationList />}
      {answer?.notice && <p className="result-notice">{answer.notice}</p>}
      {selected && <OriginalSources />}
      {selected && <NoteFooter />}
    </article>
  )
}
