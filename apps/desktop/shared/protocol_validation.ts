// 文件：protocol_validation.ts
// 层：桌面宿主／协议边界
// 作用：校验 IPC、后台消息及操作结果的未知数据。
// 说明：每个 DTO 字段均由对应校验器覆盖，不信任 JSON 类型断言。
import {
  isLibraryTree,
  isRestructureSummary,
  isRestructurePreview,
  isRestructureReceipt
} from './library_validation'
import type {
  ModelPrice,
  UsageSummary,
  StoragePaths,
  Answer,
  ProjectContext,
  PublicProject,
  Supplement,
  SearchHit,
  SearchResult,
  DirectoryPoint,
  QuestionPlan,
  Attachment,
  Attempt,
  Bootstrap,
  Bucket,
  Citation,
  Knowledge,
  Operation,
  Provider,
  Recommendation,
  ResultMap,
  Source,
  WorkerEvent,
  WorkerMessage
} from '../../../contracts/desktop'

type Check<T> = (value: unknown) => value is T

// 协议对象必须是非空、非数组的记录。
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 基本类型校验不做隐式转换，防止损坏数据伪装成有效结果。
const string: Check<string> = (value): value is string => typeof value === 'string'
const boolean: Check<boolean> = (value): value is boolean => typeof value === 'boolean'
const number: Check<number> = (value): value is number =>
  typeof value === 'number' && Number.isFinite(value)
// 字符数和页码禁止负数、小数及不安全整数。
const count: Check<number> = (value): value is number =>
  number(value) && Number.isSafeInteger(value) && value >= 0

// 集合逐项校验，空集合保持合法。
function array<T>(check: Check<T>): Check<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(check)
}

// 持久化的未知用量与可选字段保持空值语义。
function nullable<T>(check: Check<T>): Check<T | null> {
  return (value): value is T | null => value === null || check(value)
}

// 可选字段缺失时合法，出现时仍完整验证。
function optional<T>(check: Check<T>): Check<T | undefined> {
  return (value): value is T | undefined => value === undefined || check(value)
}

// 映射类型要求所有 DTO 字段都有校验器；额外字段不进入信任依据。
function object<T>(fields: { [K in keyof T]-?: Check<T[K]> }): Check<T> {
  return (value): value is T =>
    isRecord(value) &&
    Object.entries<Check<unknown>>(fields).every(([key, check]) => check(value[key]))
}

// 分区值与界面选项使用同一明确集合。
export const isBucket: Check<Bucket> = (value): value is Bucket =>
  value === '常用' || value === '在学' || value === '归档'
const citation = object<Citation>({
  id: string,
  source_id: string,
  name: string,
  locator: string,
  text: string,
  retained: optional(boolean)
})
const supplement = object<Supplement>({
  id: string,
  knowledge_id: string,
  title: string,
  content: string,
  content_chars: optional(count),
  created_at: string,
  updated_at: string,
  citations: array(citation),
  model: string,
  provider_name: string,
  edited: boolean
})
const kind: Check<SearchHit['kind']> = (value): value is SearchHit['kind'] =>
  value === 'knowledge' || value === 'supplement' || value === 'source'
const searchHit = object<SearchHit>({
  category: optional(string),
  subcategory: optional(string),
  id: string,
  kind,
  knowledge_id: string,
  title: string,
  theme: string,
  excerpt: string,
  citation: optional(citation)
})
const searchResult = object<SearchResult>({
  items: array(searchHit),
  total: number,
  page: number,
  notice: string
})
const directoryPoint = object<DirectoryPoint>({
  category: optional(string),
  subcategory: optional(string),
  reason: optional(string),
  project_required: optional(boolean),
  project_revision: optional(string),
  material_request: optional(string),
  search_terms: optional(string),
  id: string,
  title: string,
  theme: string,
  facet: string,
  target_id: string,
  status: string,
  citation_ids: array(string),
  candidates: array(object({ id: string, title: string, theme: string }))
})
const questionPlan = object<QuestionPlan>({
  excluded: optional(array(object({ title: string, decision: string, reason: string }))),
  plan_id: string,
  points: array(directoryPoint),
  search: searchResult,
  notice: string
})
const knowledge = object<Knowledge>({
  category: optional(string),
  subcategory: optional(string),
  id: string,
  title: string,
  content: string,
  content_chars: optional(count),
  created_at: string,
  updated_at: string,
  generated: boolean,
  edited: boolean,
  bucket: isBucket,
  manual_bucket: nullable(isBucket),
  citations: array(citation),
  model: optional(nullable(string)),
  provider_name: optional(nullable(string)),
  theme: optional(string),
  version: optional(string),
  supplements: optional(array(supplement)),
  canonical_id: optional(string),
  original_sources: optional(
    array(object({ source_id: string, version: string, title: string, chunks: number }))
  ),
  read_only: optional(boolean),
  original_locator: optional(string),
  original_page: optional(number),
  original_total: optional(number)
})
const attachment = object<Attachment>({
  id: string,
  name: string,
  fingerprint: string,
  blocks: number,
  warnings: array(string),
  retained: boolean
})
const source = object<Source>({
  id: string,
  name: string,
  created_at: string,
  blocks: number,
  warnings: array(string)
})
const recommendation = object<Recommendation>({
  title: string,
  reason: string,
  preview: string,
  knowledge_id: optional(string)
})
const protocol: Check<Provider['protocol']> = (value): value is Provider['protocol'] =>
  value === 'responses' || value === 'chat-completions' || value === 'anthropic'
const modelPrice = object<ModelPrice>({
  model: string,
  input_price: nullable(number),
  output_price: nullable(number),
  currency: string
})
const usageSummary = object<UsageSummary>({
  calls: number,
  successful: number,
  input_tokens: nullable(number),
  output_tokens: nullable(number),
  total_tokens: nullable(number),
  missing_input: number,
  missing_output: number,
  currencies: array(
    object({
      currency: string,
      cost: nullable(number),
      estimated: number,
      unknown: number
    })
  )
})
// 路径只由宿主返回，渲染层不能传入任意目录。
export const isStoragePaths = object<StoragePaths>({
  data: string,
  logs: string,
  sources: string,
  database: string
})
const provider = object<Provider>({
  model_prices: optional(array(modelPrice)),
  id: string,
  name: string,
  protocol,
  base_url: string,
  model: string,
  models: array(string),
  has_key: boolean,
  active: boolean,
  input_price: nullable(number),
  output_price: nullable(number),
  currency: string
})
const attempt = object<Attempt>({
  id: string,
  purpose: string,
  provider: string,
  model: string,
  status: string,
  started_at: string,
  elapsed_ms: number,
  input_tokens: nullable(number),
  output_tokens: nullable(number),
  cost: nullable(number),
  currency: string,
  input_price: nullable(number),
  output_price: nullable(number)
})
const publicProject = object<PublicProject>({
  id: string,
  name: string,
  url: string,
  locator: string,
  excerpt: string,
  retrieved_at: string
})
const projectContext = object<ProjectContext>({
  status: string,
  revision: string,
  message: string,
  material_request: string,
  search_terms: string,
  candidates: array(publicProject)
})
const answer = object<Answer>({
  project: optional(projectContext),
  content: string,
  knowledge: optional(nullable(knowledge)),
  citations: array(citation),
  recommendations: array(recommendation),
  notice: string,
  review: optional(boolean)
})
const bootstrap = object<Bootstrap>({
  version: string,
  data_dir: string,
  knowledge: array(knowledge),
  sources: array(source),
  providers: array(provider),
  notice: string
})
// 长文结果必须属于读取、暂存或提交终态，不能接受空对象冒充成功。
const textFields = object<ResultMap['knowledge.text']>({
  content: optional(string),
  version: optional(string),
  page: optional(count),
  pages: optional(count),
  edit_id: optional(string),
  offset: optional(count),
  saved: optional(boolean),
  discarded: optional(boolean),
  id: optional(string)
})
const textResult: Check<ResultMap['knowledge.text']> = (
  value
): value is ResultMap['knowledge.text'] =>
  textFields(value) &&
  ((value.content !== undefined &&
    value.version !== undefined &&
    value.page !== undefined &&
    value.pages !== undefined &&
    value.pages > value.page) ||
    (value.edit_id !== undefined && value.offset !== undefined) ||
    (value.saved === true && value.id !== undefined) ||
    value.discarded === true)
const results: { [K in Operation]: Check<ResultMap[K]> } = {
  'knowledge.tree': isLibraryTree,
  'library.restructure.plan': isRestructureSummary,
  'library.restructure.prepare': isRestructureSummary,
  'library.restructure.preview': isRestructurePreview,
  'library.restructure.apply': isRestructureReceipt,
  'library.restructure.discard': object({ discarded: boolean }),
  bootstrap,
  'knowledge.search': searchResult,
  'question.plan': questionPlan,
  'knowledge.learn': answer,
  'supplements.save': knowledge,
  'supplements.delete': knowledge,
  'knowledge.list': array(knowledge),
  'knowledge.text': textResult,
  'knowledge.get': knowledge,
  'knowledge.save': knowledge,
  'knowledge.delete': object({ deleted: boolean }),
  'knowledge.bucket': knowledge,
  'attachments.add': attachment,
  'attachments.remove': object({ removed: boolean }),
  'sources.list': array(source),
  'sources.retain': array(source),
  'sources.delete': array(source),
  'providers.save': array(provider),
  'providers.delete': array(provider),
  'providers.select': array(provider),
  'providers.test': object({ message: string }),
  'providers.models': object({ models: array(string), partial: boolean }),
  'usage.summary': usageSummary,
  'usage.list': array(attempt),
  question: answer,
  recommendations: array(recommendation)
}

// 操作白名单来自完整结果表，不允许任意后端方法名透传。
export function isOperation(value: unknown): value is Operation {
  return typeof value === 'string' && Object.hasOwn(results, value)
}

// 泛型结果通过相应谓词缩窄，避免对未知值直接断言。
export function decodeResult<K extends Operation>(operation: K, value: unknown): ResultMap[K] {
  const check: Check<ResultMap[K]> = results[operation]
  if (!check(value)) {
    throw new Error('后台结果格式无效，请重试')
  }
  return value
}

// 进度事件必须有请求标识和与事件种类相符的文本。
export function isWorkerEvent(value: unknown): value is WorkerEvent {
  return (
    isRecord(value) &&
    string(value.id) &&
    ((value.type === 'progress' && string(value.message)) ||
      (value.type === 'stream' && string(value.delta)))
  )
}

// 只接受已知消息种类，损坏协议由进程桥接终止并结算挂起任务。
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!isRecord(value)) {
    return false
  }
  if (value.type === 'ready') {
    return string(value.version)
  }
  if (value.type === 'result') {
    return string(value.id) && Object.hasOwn(value, 'result')
  }
  if (value.type === 'error') {
    return optional(string)(value.id) && string(value.error)
  }
  return isWorkerEvent(value)
}
