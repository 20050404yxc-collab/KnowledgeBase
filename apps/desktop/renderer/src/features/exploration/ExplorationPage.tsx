// 文件：ExplorationPage.tsx
// 层：React 页面／组件
// 作用：组合探索输入、回答、相关知识与知识列表。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { ExplorationHeading } from './ExplorationHeading'
import { Composer } from './Composer'
import { ComposerCaption } from './ComposerCaption'
import { FirstUseGuide } from './FirstUseGuide'
import { DirectoryPanel } from './DirectoryPanel'
import { PointActions } from './PointActions'
import { ProjectMaterials } from './ProjectMaterials'
import { ProjectPanel } from './ProjectPanel'
import { BatchPanel } from './BatchPanel'
import { WorkingStatus } from './WorkingStatus'
import { AnswerPanel, KnowledgeQuestion } from '../knowledge'
import { RelatedKnowledge } from './RelatedKnowledge'
import { KnowledgeList } from '../knowledge'

// 列表打开的知识在列表下方阅读；学习目录及其生成结果保留原有位置。
export function ExplorationPage() {
  const {
    recommendations,
    visibleContent,
    selected,
    selectedPoint,
    answer,
    busy,
    questionDraft,
    directory,
    searchResult
  } = useAppContext()
  const localReading = !!selected && !selectedPoint && !answer
  return (
    <>
      <ExplorationHeading />
      <FirstUseGuide />
      <Composer />
      <ComposerCaption />
      {busy && <WorkingStatus />}
      <KnowledgeWorkspace showReading={!localReading} />
      {!localReading && (visibleContent || recommendations.length > 0) && <RelatedKnowledge />}
      <KnowledgeList />
      {localReading && <AnswerPanel />}
      {localReading && recommendations.length > 0 && <RelatedKnowledge />}
      {(selected || answer || questionDraft || directory || searchResult) && (
        <KnowledgeQuestion compact />
      )}
    </>
  )
}

// 四页复用目录与生成区，各页状态由页面键隔离，首屏无请求时不出现目录。
export function KnowledgeWorkspace({ showReading = true }: { showReading?: boolean }) {
  const { directory, searchResult, visibleContent, selectedPoint } = useAppContext()
  return (
    <div
      id="learning-results"
      tabIndex={-1}
      aria-label="学习与检索结果"
      className={directory || searchResult ? 'knowledge-workspace' : ''}
    >
      <DirectoryPanel />
      <div className="directory-detail" aria-label="知识点生成与详情">
        <BatchPanel />
        <ProjectMaterials />
        <PointActions />
        <ProjectPanel key={selectedPoint?.id} />
        {visibleContent && showReading ? (
          <AnswerPanel />
        ) : (
          (directory || searchResult) && (
            <section className="detail-placeholder">
              选择目录中的知识点查看；待学习项按需生成。
            </section>
          )
        )}
      </div>
    </div>
  )
}
