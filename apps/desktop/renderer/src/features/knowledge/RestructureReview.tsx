// 文件：RestructureReview.tsx
// 层：React 展示组件
// 作用：展示代理覆盖、来源映射和逐组重复决定。
// 说明：模型可预填拟合并结构；全文核验与正式应用仍须确认。
import { useState } from 'react'
import type {
  AnalysisRecord,
  DuplicateGroup,
  OutlinePoint,
  PreviewKind
} from '../../../../../../contracts/library'
import { useAppContext } from '../../app/AppContext'

// 记录、来源及重复组分别分页，原文不会挤在一个大协议帧中。
export function RestructureReview() {
  const model = useAppContext()
  const { restructureDraft: draft, restructurePreview: preview } = model
  return (
    <section aria-label="重构覆盖与来源核对">
      <p>
        {draft?.workers
          ?.map((worker) => `代理 ${worker.agent}：完成 ${worker.covered}`)
          .join(' · ')}{' '}
        · 目标 {draft?.target_count} · 未选择的候选 {draft?.undecided}（默认保持独立）
      </p>
      {draft?.errors?.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
      <nav aria-label="重构证据">
        {(
          [
            ['records', '查看分析记录'],
            ['duplicates', '核对重复组'],
            ['sources', '查看完整来源']
          ] as const
        ).map(([kind, label]) => (
          <button key={kind} onClick={() => void model.previewRestructure(kind, 0)}>
            {label}
          </button>
        ))}
      </nav>
      {preview.records?.map((record) => (
        <div key={record.source_id + record.locator}>
          <strong>
            代理 {record.agent} · {record.title} · {record.status}
          </strong>
          <p>
            {record.source_id} · {record.version} · {record.locator} · 第 {record.generation} 次领取
          </p>
          <p>
            分类 {record.path.join(' → ')} · 候选 {record.candidates.join('、')}
          </p>
          <pre>{record.summary}</pre>
          <OverviewRanges record={record} />
          <p role={record.error ? 'alert' : undefined}>{record.error}</p>
          <p>
            调用 {record.call_id} · 实际尝试 {record.attempt_ids.join('、') || '无实际调用记录'}
          </p>
        </div>
      ))}
      {preview.sources?.map((source) => (
        <div key={source.source_id + source.locator}>
          <strong>{source.title}</strong>
          <p>
            {source.source_id} → {source.target_id}
          </p>
          <p>
            {source.version} · {source.locator}
          </p>
          <pre>{source.content}</pre>
        </div>
      ))}
      {preview.duplicates?.map((group) => (
        <DuplicateDecision key={group.id + draft?.revision} group={group} />
      ))}
      {preview.kind && ['records', 'duplicates', 'sources'].includes(preview.kind) && (
        <ReviewPages kind={preview.kind} />
      )}
      {draft?.status === 'outline' && <CandidateInput />}
      <p>
        同小类知识会按内容比较并提出拟合并方案；仅相关知识保持独立。调用分别计费，未知用量不估算；仍需核对语义遗漏。
      </p>
    </section>
  )
}

// 概览完成只说明抽样完成，具体未读范围仍可核对。
function OverviewRanges({ record }: { record: AnalysisRecord }) {
  const { restructurePreview: preview, previewRestructure } = useAppContext()
  const page = record.ranges_page ?? 0
  const pages = record.ranges_pages ?? 1
  return (
    <>
      <p>
        概览取样 {record.sampled_chars} / {record.total_chars} 字符；
        {record.sampled_chars !== record.total_chars
          ? '存在未读范围，确认结构后才逐段处理全文。'
          : '本条已完整展示。'}
      </p>
      <details>
        <summary>取样与未读范围</summary>
        <p>已取样：{record.sampled?.join('；')}</p>
        <p>未读取：{record.omitted?.join('；') || '无'}</p>
        {pages > 1 && (
          <div>
            <button
              disabled={page === 0}
              onClick={() => void previewRestructure('records', preview.page, 0, page - 1)}
            >
              上一页范围
            </button>
            <span>
              范围 {page + 1}/{pages}
            </span>
            <button
              disabled={page + 1 >= pages}
              onClick={() => void previewRestructure('records', preview.page, 0, page + 1)}
            >
              下一页范围
            </button>
          </div>
        )}
      </details>
    </>
  )
}

// 原文证据逐块可达；切换证据页不会改变组决定。
function EvidencePages({ group }: { group: DuplicateGroup }) {
  const { restructurePreview: preview, previewRestructure } = useAppContext()
  return (
    <div>
      {group.evidence.map((evidence, index) => (
        <div key={index}>
          <p>
            {evidence.kind} · {evidence.reason}
          </p>
          {(['overlap', 'unique', 'conflict'] as const).map((kind) => (
            <div key={kind}>
              <strong>{{ overlap: '重叠', unique: '独有', conflict: '冲突' }[kind]}</strong>
              {evidence[kind].map((quote, i) => (
                <blockquote key={i}>
                  <p>{quote.quote}</p>
                  <small>
                    {quote.source_id} · {quote.locator}
                  </small>
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      ))}
      <button
        disabled={!group.evidence_page}
        onClick={() => void previewRestructure('duplicates', preview.page, group.evidence_page - 1)}
      >
        上一条证据
      </button>
      <span>
        证据 {group.evidence_page + 1}/{group.evidence_total}
      </span>
      <button
        disabled={group.evidence_page + 1 >= group.evidence_total}
        onClick={() => void previewRestructure('duplicates', preview.page, group.evidence_page + 1)}
      >
        下一条证据
      </button>
    </div>
  )
}

// 合并的保留点、标题、路径和分区全部显式输入，不沿用隐含默认决定。
function DuplicateDecision({ group }: { group: DuplicateGroup }) {
  const { reviewRestructure, busy } = useAppContext()
  const [target, setTarget] = useState(group.target_id)
  const [title, setTitle] = useState(group.title)
  const [category, setCategory] = useState(group.category)
  const [subcategory, setSubcategory] = useState(group.subcategory)
  const [bucket, setBucket] = useState(group.bucket_decided ? (group.manual_bucket ?? 'auto') : '')
  return (
    <section aria-label="重复组决定">
      <h4>
        {group.kind} · {group.decision}
      </h4>
      <p>{group.sources.join('、')}</p>
      <p>{group.reason}</p>
      <EvidencePages group={group} />
      <label>
        保留知识标识
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">请选择</option>
          {group.sources.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      <MergeFields
        value={{ title, category, subcategory, bucket }}
        setters={{ setTitle, setCategory, setSubcategory, setBucket }}
      />
      <button
        disabled={!!busy}
        onClick={() =>
          void reviewRestructure({ action: 'decision', id: group.id, decision: 'keep' })
        }
      >
        保持独立，不合并
      </button>
      <button
        disabled={
          !!busy ||
          !['pending', 'equivalent', 'partial-overlap'].includes(group.kind) ||
          !target ||
          !title ||
          !category ||
          !subcategory ||
          !bucket
        }
        onClick={() =>
          void reviewRestructure({
            action: 'decision',
            id: group.id,
            decision: 'merge',
            target_id: target,
            title,
            category,
            subcategory,
            manual_bucket: bucket === 'auto' ? null : bucket
          })
        }
      >
        确认本组合并结构
      </button>
      <button
        disabled={!!busy}
        onClick={() =>
          void reviewRestructure({ action: 'decision', id: group.id, decision: 'undecided' })
        }
      >
        撤销本组决定
      </button>
    </section>
  )
}

// 误标可重新送回核验，人工补候选也不能跳过原文证据检查。
function CandidateInput() {
  const [ids, setIds] = useState('')
  const { reviewRestructure, busy } = useAppContext()
  return (
    <label>
      补充或重新核验候选（逗号分隔知识标识）
      <input value={ids} onChange={(e) => setIds(e.target.value)} />
      <button
        disabled={!!busy || !ids.trim()}
        onClick={() =>
          void reviewRestructure({
            action: 'candidate',
            sources: ids
              .split(/[,，]/)
              .map((id) => id.trim())
              .filter(Boolean)
          })
        }
      >
        添加拟合并候选（确认后核验全文）
      </button>
    </label>
  )
}

// 三种证据预览共用每页一条的有界大小。
function ReviewPages({ kind }: { kind: PreviewKind }) {
  const { restructurePreview: preview, previewRestructure } = useAppContext()
  return (
    <div className="pagination">
      <button
        disabled={!preview.page}
        onClick={() => void previewRestructure(kind, preview.page - 1)}
      >
        上一页
      </button>
      <span>
        第 {preview.page + 1} 页 · 共 {preview.total} 项
      </span>
      <button
        disabled={preview.page + 1 >= preview.total}
        onClick={() => void previewRestructure(kind, preview.page + 1)}
      >
        下一页
      </button>
    </div>
  )
}

// 不合并同名来源时可分别纠正路径和标题，避免只剩重新让模型猜的入口。
export function OutlineEdit({ point }: { point: OutlinePoint }) {
  const { reviewRestructure, busy } = useAppContext()
  const [title, setTitle] = useState(point.title)
  const [category, setCategory] = useState(point.category)
  const [subcategory, setSubcategory] = useState(point.subcategory)
  return (
    <details>
      <summary>调整标题与位置</summary>
      <label>
        标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        大类
        <input value={category} onChange={(e) => setCategory(e.target.value)} />
      </label>
      <label>
        小类
        <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} />
      </label>
      <button
        disabled={!!busy}
        onClick={() =>
          void reviewRestructure({ action: 'point', id: point.id, title, category, subcategory })
        }
      >
        保存本项结构
      </button>
    </details>
  )
}

// 可编辑目标字段集中展示，避免重复组决定组件承担所有输入排版。
function MergeFields({
  value,
  setters
}: {
  value: { title: string; category: string; subcategory: string; bucket: string }
  setters: {
    setTitle: (value: string) => void
    setCategory: (value: string) => void
    setSubcategory: (value: string) => void
    setBucket: (value: string) => void
  }
}) {
  const { title, category, subcategory, bucket } = value
  const { setTitle, setCategory, setSubcategory, setBucket } = setters
  return (
    <div>
      {' '}
      <label>
        合并后标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        大类
        <input value={category} onChange={(e) => setCategory(e.target.value)} />
      </label>
      <label>
        小类
        <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} />
      </label>
      <label>
        手工分区
        <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
          <option value="">请选择</option>
          <option value="auto">自动分区</option>
          {['常用', '在学', '归档'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
