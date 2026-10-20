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
// 树节点只能含摘要，正文通过已有详情入口读取。
export function isLibraryTree(value: unknown): value is LibraryTree {
  return (
    record(value) &&
    strings(value, ['revision', 'next_cursor']) &&
    counts(value, ['total']) &&
    rows(
      value.nodes,
      (item) => strings(item, ['key', 'label', 'id', 'bucket']) && counts(item, ['count'])
    )
  )
}
// 重构阶段必须属于有限状态集合，避免损坏结果触发无界推进。
export function isRestructureSummary(value: unknown): value is RestructureSummary {
  return (
    record(value) &&
    strings(value, ['draft_id', 'revision', 'status']) &&
    ['planning', 'outline', 'preparing', 'ready', 'applied'].includes(String(value.status)) &&
    counts(value, ['total', 'covered', 'classified', 'prepared', 'suggestions'])
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
        Array.isArray(item.old_path) &&
        item.old_path.every((part) => typeof part === 'string')
    ) &&
    rows(
      value.suggestions,
      (item) =>
        strings(item, ['id', 'title', 'mode', 'original', 'content', 'reason', 'diff']) &&
        ['replace', 'append'].includes(String(item.mode))
    )
  )
}
// 应用收据只确认实际已提交结果。
export function isRestructureReceipt(value: unknown): value is RestructureReceipt {
  return (
    record(value) &&
    typeof value.applied === 'boolean' &&
    counts(value, ['count']) &&
    strings(value, ['backup'])
  )
}
