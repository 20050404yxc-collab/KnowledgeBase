// 文件：selection.ts
// 层：跨进程契约
// 作用：描述选区问答、候选复用和确认入库的数据。
// 说明：会话仅存于运行期；知识和调用记录通过原有存储持久化。
import type { Attempt, Citation, GenerationOptions, SearchHit } from './desktop'

export interface SelectionSource {
  kind: 'knowledge' | 'supplement' | 'source'
  id: string
  version?: string
  supplement_id?: string
  page?: number
  block_id?: string
}

export interface SelectionTurn {
  id: string
  question: string
  state: 'local' | 'answered' | 'unconfigured' | 'failed' | 'cancelled' | 'lookup-failed'
  candidates: SearchHit[]
  total: number
  page: number
  content: string
  title: string
  citations: Citation[]
  model: string
  provider_name: string
  attempts: Attempt[]
  notice: string
  saved_id: string | null
}

export interface SelectionSession {
  id: string
  source: SelectionSource
  source_title: string
  locator: string
  quote: string
  category_path: string[]
  turns: SelectionTurn[]
  notice: string
}

export interface SelectionAsk extends GenerationOptions {
  session_id: string
  turn_id: string
  action: 'lookup' | 'generate' | 'page'
  question?: string
  page?: number
  candidate_id?: string
}

export interface SelectionCapture {
  session_id: string
  turn_id: string
  title: string
  content: string
  category_path: string[]
  target_id?: string
  version?: string
}
