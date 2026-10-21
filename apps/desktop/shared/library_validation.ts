// 文件：library_validation.ts
// 层：桌面宿主／协议边界
// 作用：逐字段验证全库树和重构结果。
// 说明：不信任模型或跨进程返回的类型声明。
import type {
  LibraryTree,
  RestructureSummary,
  RestructurePreview,
  RestructureReceipt
} from '../../../contracts/library'

// 以下记录只能由字段校验后作为 DTO 使用。
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
// 字符串字段逐个验证，不接受数字隐式转换。
function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string')
}
// 数量和分页仅接受非负整数。
function counts(value: Record<string, unknown>, keys: string[]) {
  return keys.every(
    (key) =>
      typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && Number(value[key]) >= 0
  )
}
// 集合不允许未验证的成员进入视图。
function rows(value: unknown, check: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.every((item) => record(item) && check(item))
}
// 新字段可缺失以兼容旧样例，出现后必须执行完整校验。
function optional(value: unknown, check: (value: unknown) => boolean) {
  return value === undefined || check(value)
}
// 文本集合不接受混合类型。
function stringList(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
// 完整父级数组有界且每层非空；缺失时仍兼容旧两级结果。
export function isCategoryPath(value: unknown): value is string[] {
  return (
    stringList(value) &&
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every((part: string) => part.trim().length > 0 && Array.from(part).length <= 80)
  )
}
// 引文必须携带来源标识、定位和逐字摘录。
function evidence(value: Record<string, unknown>) {
  return (
    strings(value, ['kind', 'reason', 'left', 'right']) &&
    ['overlap', 'unique', 'conflict'].every((key) =>
      rows(value[key], (quote) => strings(quote, ['source_id', 'locator', 'quote']))
    )
  )
}
// 重复决定必须来自有限集合，不能被未知字符串伪装为已确认。
function duplicate(value: Record<string, unknown>) {
  return (
    strings(value, [
      'id',
      'kind',
      'decision',
      'reason',
      'target_id',
      'title',
      'category',
      'subcategory'
    ]) &&
    ['pending', 'equivalent', 'partial-overlap', 'related', 'conflict'].includes(
      String(value.kind)
    ) &&
    ['undecided', 'keep', 'merge'].includes(String(value.decision)) &&
    optional(value.category_path, isCategoryPath) &&
    stringList(value.sources) &&
    typeof value.bucket_decided === 'boolean' &&
    (value.manual_bucket === null ||
      ['常用', '在学', '归档'].includes(String(value.manual_bucket))) &&
    counts(value, ['checked', 'evidence_total', 'evidence_page']) &&
    rows(value.evidence, evidence)
  )
}
// 树节点只能含摘要，正文通过已有详情入口读取。
export function isLibraryTree(value: unknown): value is LibraryTree {
  return (
    record(value) &&
    strings(value, ['revision', 'next_cursor']) &&
    counts(value, ['total']) &&
    optional(value.content_id, (item) => typeof item === 'string') &&
    rows(
      value.nodes,
      (item) =>
        strings(item, ['key', 'label', 'id', 'bucket']) &&
        counts(item, ['count']) &&
        optional(item.children, (part) => typeof part === 'boolean')
    )
  )
}
// 重构阶段必须属于有限状态集合，避免损坏结果触发无界推进。
export function isRestructureSummary(value: unknown): value is RestructureSummary {
  return (
    record(value) &&
    strings(value, ['draft_id', 'revision', 'status']) &&
    ['planning', 'outline', 'preparing', 'ready', 'applied', 'paused'].includes(
      String(value.status)
    ) &&
    counts(value, ['total', 'covered', 'classified', 'prepared', 'suggestions']) &&
    optional(value.phase, (item) => typeof item === 'string') &&
    optional(value.errors, stringList) &&
    optional(value.feedback_history, stringList) &&
    ['target_count', 'groups', 'undecided'].every(
      (key) => value[key] === undefined || counts(value, [key])
    ) &&
    optional(value.workers, (item) =>
      rows(item, (worker) => strings(worker, ['agent']) && counts(worker, ['covered']))
    )
  )
}
// 差异文本只作安全文本展示，原路径必须是字符串集合。
export function isRestructurePreview(value: unknown): value is RestructurePreview {
  return (
    record(value) &&
    counts(value, ['total', 'page']) &&
    rows(
      value.outline,
      (item) =>
        strings(item, ['id', 'title', 'category', 'subcategory', 'reason']) &&
        optional(item.category_path, isCategoryPath) &&
        Array.isArray(item.old_path) &&
        item.old_path.every((part) => typeof part === 'string')
    ) &&
    rows(
      value.suggestions,
      (item) =>
        strings(item, ['id', 'title', 'mode', 'original', 'content', 'reason', 'diff']) &&
        ['replace', 'append'].includes(String(item.mode)) &&
        ['text_page', 'text_pages'].every(
          (key) => item[key] === undefined || counts(item, [key])
        ) &&
        optional(item.target_id, (part) => typeof part === 'string') &&
        optional(
          item.kind,
          (part) => part === 'original-extraction' || part === 'model-explanation'
        ) &&
        optional(item.provenance, (part) =>
          rows(
            part,
            (source) =>
              strings(source, ['source_id', 'version', 'locator']) && counts(source, ['section'])
          )
        )
    ) &&
    optional(value.kind, (part) =>
      ['outline', 'suggestions', 'records', 'duplicates', 'sources', 'summary'].includes(
        String(part)
      )
    ) &&
    optional(value.summary, isRestructureSummary) &&
    optional(value.records, (part) =>
      rows(
        part,
        (item) =>
          strings(item, [
            'draft_id',
            'revision',
            'source_id',
            'title',
            'version',
            'agent',
            'locator',
            'status',
            'summary',
            'error',
            'call_id'
          ]) &&
          optional(item.sampled, stringList) &&
          optional(item.omitted, stringList) &&
          ['sampled_chars', 'total_chars', 'ranges_page', 'ranges_pages'].every(
            (key) => item[key] === undefined || counts(item, [key])
          ) &&
          counts(item, ['generation']) &&
          stringList(item.attempt_ids) &&
          stringList(item.candidates) &&
          stringList(item.path)
      )
    ) &&
    optional(value.sources, (part) =>
      rows(part, (item) =>
        strings(item, ['source_id', 'title', 'version', 'target_id', 'locator', 'content'])
      )
    ) &&
    optional(value.duplicates, (part) => rows(part, duplicate))
  )
}
// 应用收据只确认实际已提交结果。
export function isRestructureReceipt(value: unknown): value is RestructureReceipt {
  return (
    record(value) &&
    typeof value.applied === 'boolean' &&
    counts(value, ['count']) &&
    strings(value, ['backup']) &&
    ['source_count', 'target_count', 'groups'].every(
      (key) => value[key] === undefined || counts(value, [key])
    )
  )
}
