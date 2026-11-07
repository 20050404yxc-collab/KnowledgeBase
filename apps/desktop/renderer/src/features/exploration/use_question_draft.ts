// 文件：use_question_draft.ts
// 层：React 交互 hook
// 作用：恢复问题文字和来源范围，不恢复临时附件或自动发送。
// 说明：读取失败时禁用输入，保留后台原始内容供恢复。
import { useDurableText } from '../../shared/use_durable_text'
import type { Scope } from '../../../../../../contracts/desktop'

// 逐字段解析草稿，旧纯文本按混合范围恢复，不执行外部操作。
function decode(value: string | null): { query: string; scope: Scope } {
  try {
    const data: unknown = JSON.parse(value ?? 'null')
    if (
      data &&
      typeof data === 'object' &&
      'query' in data &&
      typeof data.query === 'string' &&
      'scope' in data &&
      (data.scope === 'mixed' || data.scope === 'files' || data.scope === 'knowledge')
    ) {
      return { query: data.query, scope: data.scope }
    }
  } catch {
    // 兼容此前仅保存文字的草稿格式。
  }
  return { query: value ?? '', scope: 'mixed' }
}

// 文字与范围在同一个原子快照内，恢复范围不等于恢复附件授权。
export function useQuestionDraft() {
  const storage = useDurableText('question')
  const state = decode(storage.value)
  return {
    ...state,
    setQuery: (query: string) =>
      storage.setValue((value) => JSON.stringify({ ...decode(value), query })),
    setScope: (scope: Scope) =>
      storage.setValue((value) => JSON.stringify({ ...decode(value), scope })),
    clearQuestionDraft: () => storage.setValue(null),
    questionDraftStatus: storage.status,
    questionDraftUpdated: storage.updated,
    questionDraftReady: storage.loaded,
    retryQuestionDraft: storage.retry
  }
}
