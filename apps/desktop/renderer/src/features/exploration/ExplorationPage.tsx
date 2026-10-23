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
import { AnswerPanel } from '../knowledge'
import { RelatedKnowledge } from './RelatedKnowledge'
import { KnowledgeList } from '../knowledge'

// 组合探索输入、回答、相关知识与知识列表。
export function ExplorationPage() {
  const { recommendations, visibleContent, busy } = useAppContext()
  return (
    <>
      <ExplorationHeading />
      <FirstUseGuide />
      <Composer />
      <ComposerCaption />
      {busy && <WorkingStatus />}
      <KnowledgeWorkspace />
      {(visibleContent || recommendations.length > 0) && <RelatedKnowledge />}
      <KnowledgeList />
    </>
  )
}

// 四页复用目录与生成区，各页状态由页面键隔离，首屏无请求时不出现目录。
export function KnowledgeWorkspace() {
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
    </div>
  )
}
