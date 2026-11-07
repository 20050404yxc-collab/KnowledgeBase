// 文件：workspace.ts
// 层：跨进程契约
// 作用：描述本地草稿与可携带数据的增量操作。
// 说明：草稿不是正式知识，备份不包含系统凭据。
export interface DraftSnapshot {
  value: string | null
  revision: number
  updated_at: string
}
export interface PortableReceipt {
  path: string
  files: number
  bytes: number
  verified: boolean
}
