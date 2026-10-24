// 文件：memory.ts
// 层：跨进程契约
// 作用：声明本地偏好、兴趣汇总与语义资源状态。
// 说明：不传输原始问题、任意偏好指令或模型执行代码。
export interface MemorySettings {
  preferences_enabled: boolean
  questions_enabled: boolean
  reading_enabled: boolean
  language: '中文' | 'English' | '跟随问题'
  detail: '简洁' | '适中' | '详细'
  examples: '按需' | '多举例' | '少举例'
}
export interface MemoryState {
  settings: MemorySettings
  topics: { topic: string; kind: string; count: number; last_used: string }[]
  reading_days: number
}
export interface SemanticStatus {
  documents: number
  indexed: number
  vectors: number
  ready: boolean
  working: boolean
  model: string
  resource_bytes: number
}
