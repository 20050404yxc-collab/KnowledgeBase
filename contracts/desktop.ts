// 文件：desktop.ts
// 层：跨进程契约
// 作用：声明操作、DTO、事件和受限桌面 API。
// 说明：保留协议字段命名，不包含运行时实现。
import type {
  LibraryTree,
  DraftReference,
  RestructureSummary,
  RestructurePreview,
  RestructureReceipt
} from './library'
export type {
  LibraryTree,
  TreeNode,
  DraftReference,
  RestructureSummary,
  RestructurePreview,
  RestructureReceipt,
  OutlinePoint,
  ContentSuggestion
} from './library'
export type Bucket = '常用' | '在学' | '归档'
export type Scope = 'mixed' | 'files' | 'knowledge'
export interface Citation {
  id: string
  source_id: string
  name: string
  locator: string
  text: string
  retained?: boolean
}
export interface Knowledge {
  category?: string
  subcategory?: string
  id: string
  title: string
  content: string
  created_at: string
  updated_at: string
  generated: boolean
  edited: boolean
  bucket: Bucket
  manual_bucket: Bucket | null
  citations: Citation[]
  model?: string | null
  provider_name?: string | null
  theme?: string
  version?: string
  supplements?: Supplement[]
}
export interface Supplement {
  id: string
  knowledge_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
  citations: Citation[]
  model: string
  provider_name: string
  edited: boolean
}
export interface SearchHit {
  category?: string
  subcategory?: string
  id: string
  kind: 'knowledge' | 'supplement' | 'source'
  knowledge_id: string
  title: string
  theme: string
  excerpt: string
  citation?: Citation
}
export interface SearchResult {
  items: SearchHit[]
  total: number
  page: number
  notice: string
}
export interface DirectoryPoint {
  category?: string
  subcategory?: string
  reason?: string
  project_required?: boolean
  project_revision?: string
  material_request?: string
  search_terms?: string
  id: string
  title: string
  theme: string
  facet: string
  target_id: string
  status: string
  citation_ids: string[]
  candidates: { id: string; title: string; theme: string }[]
}
export interface QuestionPlan {
  excluded?: { title: string; decision: string; reason: string }[]
  plan_id: string
  points: DirectoryPoint[]
  search: SearchResult
  notice: string
}
export interface LearnInput extends GenerationOptions {
  plan_id: string
  point_id: string
  action:
    | 'learn'
    | 'supplement'
    | 'confirm'
    | 'separate'
    | 'materials'
    | 'public-search'
    | 'public-select'
    | 'revoke'
  target_id?: string
  attachment_ids?: string[]
  consent?: boolean
  public_scope?: boolean
  public_only?: boolean
  search_terms?: string
  revision?: string
  candidate_id?: string
}
export interface PublicProject {
  id: string
  name: string
  url: string
  locator: string
  excerpt: string
  retrieved_at: string
}
export interface ProjectContext {
  status: string
  revision: string
  message: string
  material_request: string
  search_terms: string
  candidates: PublicProject[]
}
export interface SupplementInput {
  id: string
  knowledge_id: string
  version: string
  title?: string
  content?: string
}
export interface Attachment {
  id: string
  name: string
  fingerprint: string
  blocks: number
  warnings: string[]
  retained: boolean
}
export interface Source {
  id: string
  name: string
  created_at: string
  blocks: number
  warnings: string[]
}
export interface Recommendation {
  title: string
  reason: string
  preview: string
  knowledge_id?: string
}
export interface Provider {
  id: string
  name: string
  protocol: 'responses' | 'chat-completions' | 'anthropic'
  base_url: string
  model: string
  models: string[]
  has_key: boolean
  active: boolean
  input_price: number | null
  output_price: number | null
  currency: string
}
export interface Attempt {
  id: string
  purpose: string
  provider: string
  model: string
  status: string
  started_at: string
  elapsed_ms: number
  input_tokens: number | null
  output_tokens: number | null
  cost: number | null
  currency: string
  input_price: number | null
  output_price: number | null
}
export interface Answer {
  project?: ProjectContext
  content: string
  knowledge?: Knowledge | null
  citations: Citation[]
  recommendations: Recommendation[]
  notice: string
  review?: boolean
}
export interface WorkerEvent {
  id: string
  type: 'progress' | 'stream'
  message?: string
  delta?: string
}
export interface DesktopAPI {
  version: string
  // 操作名决定参数和结果类型；外部数据仍由桥接运行时校验。
  request<K extends Operation>(
    operation: K,
    params?: RequestMap[K],
    id?: string
  ): Promise<ResultMap[K]>
  cancel(id: string): Promise<void>
  chooseFiles(): Promise<string[]>
  pathsForFiles(files: File[]): string[]
  onEvent(callback: (event: WorkerEvent) => void): () => void
  reportDiagnostic(report: RendererDiagnostic): void
}
// 仅传输有界诊断元数据；不允许正文、密钥、任意日志消息和文件写入。
export interface RendererDiagnostic {
  event:
    | 'ready'
    | 'error'
    | 'rejection'
    | 'react_error'
    | 'request_start'
    | 'request_completed'
    | 'request_failed'
    | 'cancel'
    | 'files_failed'
    | 'feedback_error'
  request_id?: string
  operation?: Operation
  elapsed_ms?: number
  error_type?: string
  frames?: string[]
  reason?: 'request_failed' | 'attachments_pending' | 'task_running' | 'local_error'
}
export interface Bootstrap {
  version: string
  data_dir: string
  knowledge: Knowledge[]
  sources: Source[]
  providers: Provider[]
  notice: string
}
export interface NoteInput {
  id?: string
  title: string
  content: string
}
export interface ProviderInput {
  id?: string
  name: string
  protocol: Provider['protocol']
  base_url: string
  model: string
  models?: string[]
  prices_confirmed?: boolean
  key: string
  input_price: string | number | null
  output_price: string | number | null
  currency: string
}
export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high'
export interface GenerationOptions {
  provider_id?: string
  model?: string
  reasoning_effort?: ReasoningEffort
}
export interface ModelDiscovery {
  id?: string
  protocol: Provider['protocol']
  base_url: string
  key: string
}
export interface ModelCatalog {
  models: string[]
  partial: boolean
}
export interface RequestMap {
  'knowledge.tree': { query?: string; bucket?: Bucket | null; path?: string[]; cursor?: string }
  'library.restructure.plan': GenerationOptions & {
    draft_id?: string
    revision?: string
    feedback?: string
    advance?: boolean
  }
  'library.restructure.prepare': DraftReference
  'library.restructure.preview': DraftReference & { kind: 'outline' | 'suggestions'; page?: number }
  'library.restructure.apply': DraftReference & { selected: string[] }
  'library.restructure.discard': DraftReference
  bootstrap: Record<string, never>
  'knowledge.search': {
    query: string
    page?: number
    bucket?: Bucket | null
    scope?: Scope
    attachment_ids?: string[]
  }
  'question.plan': RequestMap['question']
  'knowledge.learn': LearnInput
  'supplements.save': SupplementInput
  'supplements.delete': SupplementInput
  'knowledge.list': { query?: string; bucket?: Bucket | null }
  'knowledge.get': { id: string }
  'knowledge.save': NoteInput
  'knowledge.delete': { id: string }
  'knowledge.bucket': { id: string; bucket: Bucket | null }
  'attachments.add': { path: string }
  'attachments.remove': { id: string }
  'sources.list': Record<string, never>
  'sources.retain': { id: string }
  'sources.delete': { id: string }
  'providers.save': ProviderInput
  'providers.delete': { id: string }
  'providers.select': { id: string }
  'providers.test': { id: string } & GenerationOptions
  'providers.models': ModelDiscovery
  'usage.list': Record<string, never>
  question: {
    query: string
    scope: Scope
    attachment_ids: string[]
    purpose: string
  } & GenerationOptions
  recommendations: { id: string }
}
export interface ResultMap {
  'knowledge.tree': LibraryTree
  'library.restructure.plan': RestructureSummary
  'library.restructure.prepare': RestructureSummary
  'library.restructure.preview': RestructurePreview
  'library.restructure.apply': RestructureReceipt
  'library.restructure.discard': { discarded: boolean }
  bootstrap: Bootstrap
  'knowledge.search': SearchResult
  'question.plan': QuestionPlan
  'knowledge.learn': Answer
  'supplements.save': Knowledge
  'supplements.delete': Knowledge
  'knowledge.list': Knowledge[]
  'knowledge.get': Knowledge
  'knowledge.save': Knowledge
  'knowledge.delete': { deleted: boolean }
  'knowledge.bucket': Knowledge
  'attachments.add': Attachment
  'attachments.remove': { removed: boolean }
  'sources.list': Source[]
  'sources.retain': Source[]
  'sources.delete': Source[]
  'providers.save': Provider[]
  'providers.delete': Provider[]
  'providers.select': Provider[]
  'providers.test': { message: string }
  'providers.models': ModelCatalog
  'usage.list': Attempt[]
  question: Answer
  recommendations: Recommendation[]
}
export type Operation = keyof RequestMap
export type WorkerMessage =
  | { type: 'ready'; version: string }
  | { type: 'result'; id: string; result: unknown }
  | { type: 'error'; id?: string; error: string }
  | WorkerEvent

declare global {
  interface Window {
    knowledgeBase: DesktopAPI
  }
}
