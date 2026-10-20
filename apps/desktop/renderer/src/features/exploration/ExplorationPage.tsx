// 文件：ExplorationPage.tsx
// 层：React 页面／组件
// 作用：组合探索输入、回答、相关知识与知识列表。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { ExplorationHeading } from './ExplorationHeading'
import { Composer } from './Composer'
import { ComposerCaption } from './ComposerCaption'
import { DirectoryPanel } from './DirectoryPanel'
import { WorkingStatus } from './WorkingStatus'
import { AnswerPanel } from '../knowledge'
import { RelatedKnowledge } from './RelatedKnowledge'
import { KnowledgeList } from '../knowledge'

// 组合探索输入、回答、相关知识与知识列表。
export function ExplorationPage() {
  const { recommendations, visibleContent, busy, directory, searchResult } = useAppContext()
  return (
    <>
      <ExplorationHeading />
      <Composer />
      <ComposerCaption />
      {busy && <WorkingStatus />}
      <div className={directory || searchResult ? 'knowledge-workspace' : ''}>
        <DirectoryPanel />
        {visibleContent ? (
          <AnswerPanel />
        ) : (
          (directory || searchResult) && (
            <section className="detail-placeholder">
              选择目录中的知识点查看；待学习项按需生成。
            </section>
          )
        )}
      </div>
      {(visibleContent || recommendations.length > 0) && <RelatedKnowledge />}
      <KnowledgeList />
    </>
  )
}
