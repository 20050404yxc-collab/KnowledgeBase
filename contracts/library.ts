// 文件：library.ts
// 层：跨进程契约
// 作用：声明完整目录和确认式重构的分页数据。
// 说明：不包含后台会话、数据库或模型实现。
export interface TreeNode {
  key: string
  label: string
  count: number
  id: string
  bucket: string
}
export interface LibraryTree {
  nodes: TreeNode[]
  total: number
  revision: string
  next_cursor: string
}
export interface DraftReference {
  draft_id: string
  revision: string
}
export interface RestructureSummary extends DraftReference {
  status: 'planning' | 'outline' | 'preparing' | 'ready' | 'applied' | 'paused'
  total: number
  covered: number
  classified: number
  prepared: number
  suggestions: number
  phase?: string
  errors?: string[]
  target_count?: number
  groups?: number
  undecided?: number
  workers?: { agent: string; covered: number }[]
}
export interface OutlinePoint {
  id: string
  title: string
  old_path: string[]
  category: string
  subcategory: string
  reason: string
}
export interface ContentSuggestion {
  id: string
  title: string
  mode: 'replace' | 'append'
  original: string
  content: string
  reason: string
  diff: string
  target_id?: string
  kind?: 'original-extraction' | 'model-explanation'
  provenance?: { source_id: string; version: string; locator: string; section: number }[]
}
export type PreviewKind =
  | 'outline'
  | 'suggestions'
  | 'records'
  | 'duplicates'
  | 'sources'
  | 'summary'
export interface AnalysisRecord {
  draft_id: string
  revision: string
  candidates: string[]
  path: string[]
  source_id: string
  title: string
  version: string
  agent: string
  generation: number
  locator: string
  status: string
  summary: string
  error: string
  attempt_ids: string[]
  call_id: string
}
export interface SourcePreview {
  source_id: string
  title: string
  version: string
  target_id: string
  locator: string
  content: string
}
export interface EvidenceQuote {
  source_id: string
  locator: string
  quote: string
}
export interface DuplicateEvidence {
  kind: string
  reason: string
  left: string
  right: string
  overlap: EvidenceQuote[]
  unique: EvidenceQuote[]
  conflict: EvidenceQuote[]
}
export interface DuplicateGroup {
  id: string
  sources: string[]
  decision: 'undecided' | 'keep' | 'merge'
  kind: 'pending' | 'equivalent' | 'partial-overlap' | 'related' | 'conflict'
  reason: string
  checked: number
  target_id: string
  title: string
  category: string
  subcategory: string
  manual_bucket: string | null
  bucket_decided: boolean
  evidence: DuplicateEvidence[]
  evidence_total: number
  evidence_page: number
}
export type StructureReview =
  | { action: 'point'; id: string; title: string; category: string; subcategory: string }
  | { action: 'candidate'; sources: string[] }
  | { action: 'decision'; id: string; decision: 'keep' | 'undecided' }
  | {
      action: 'decision'
      id: string
      decision: 'merge'
      target_id: string
      title: string
      category: string
      subcategory: string
      manual_bucket: string | null
    }
export interface RestructurePreview {
  outline: OutlinePoint[]
  suggestions: ContentSuggestion[]
  total: number
  page: number
  kind?: PreviewKind
  summary?: RestructureSummary
  records?: AnalysisRecord[]
  duplicates?: DuplicateGroup[]
  sources?: SourcePreview[]
}
export interface RestructureReceipt {
  applied: boolean
  count: number
  backup: string
  source_count?: number
  target_count?: number
  groups?: number
}
