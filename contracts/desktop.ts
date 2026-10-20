// 文件：desktop.ts
// 层：跨进程契约
// 作用：声明操作、DTO、事件和受限桌面 API。
// 说明：保留协议字段命名，不包含运行时实现。
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
  content: string
  knowledge?: Knowledge | null
  citations: Citation[]
  recommendations: Recommendation[]
  notice: string
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
  key: string
  input_price: string | number | null
  output_price: string | number | null
  currency: string
}
export interface RequestMap {
  bootstrap: Record<string, never>
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
  'providers.test': { id: string }
  'usage.list': Record<string, never>
  question: { query: string; scope: Scope; attachment_ids: string[]; purpose: string }
  recommendations: { id: string }
}
export interface ResultMap {
  bootstrap: Bootstrap
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
