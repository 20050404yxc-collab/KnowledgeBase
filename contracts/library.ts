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
  status: 'planning' | 'outline' | 'preparing' | 'ready' | 'applied'
  total: number
  covered: number
  classified: number
  prepared: number
  suggestions: number
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
}
export interface RestructurePreview {
  outline: OutlinePoint[]
  suggestions: ContentSuggestion[]
  total: number
  page: number
}
export interface RestructureReceipt {
  applied: boolean
  count: number
  backup: string
}
