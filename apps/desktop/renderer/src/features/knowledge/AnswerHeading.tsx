// 文件：AnswerHeading.tsx
// 层：React 页面／组件
// 作用：显示回答标题、收录状态和手动保存入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

import { isBucket } from '../../../../shared/protocol_validation'
import type { Bucket } from '../../../../../../contracts/desktop'

// 显示回答标题、收录状态和手动保存入口。
export function AnswerHeading() {
  const {
    guarded,
    reload,
    selected,
    setSelected,
    answer,
    selectedPoint,
    section,
    selectionSequence
  } = useAppContext()
  let label = '未收录内容'
  if (selected) {
    label = selected.generated ? 'AI 学习内容' : '我的知识'
  }
  if (answer?.review) {
    label = '待核对补充'
  }
  return (
    <div className="answer-heading">
      <div>
        <span className="pill">{label}</span>
        <h2>
          {selected?.title ?? (section === '探索' ? selectedPoint?.title : null) ?? '检索与回答'}
        </h2>
      </div>
      {selected && (
        <select
          aria-label="知识分区"
          value={selected.manual_bucket ?? 'auto'}
          onChange={(event) =>
            void guarded(async () => {
              const sequence = selectionSequence.current
              const item = await api.request('knowledge.bucket', {
                id: selected.id,
                bucket: isBucket(event.target.value) ? event.target.value : null
              })
              if (sequence === selectionSequence.current) {
                setSelected(item)
              }
              void reload()
            })
          }
        >
          <option value="auto">自动 · {selected.bucket}</option>
          {(['常用', '在学', '归档'] as Bucket[]).map((bucket) => (
            <option key={bucket} value={bucket}>
              固定 · {bucket}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
