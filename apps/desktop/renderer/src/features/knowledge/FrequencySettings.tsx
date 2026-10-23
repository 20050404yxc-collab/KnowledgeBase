// 文件：FrequencySettings.tsx
// 层：React 页面／组件
// 作用：解释频率分区并提供明确的固定覆盖入口。
// 说明：阈值沿用后台规则，频率不代表掌握程度；合并组使用日由后台聚合。
import { useAppContext } from '../../app/AppContext'
import { api } from '../../shared/api/client'
import { isBucket } from '../../../../shared/protocol_validation'
import type { Bucket } from '../../../../../../contracts/desktop'

// 当前分区及固定状态直接来自后台，不以本地时间自行重新计算。
export function FrequencySettings() {
  const { selected, guarded, selectionSequence, setSelected, reload } = useAppContext()
  if (!selected) {
    return null
  }
  const reasons = {
    常用: '近 14 个自然日内，至少有 3 天打开阅读。',
    归档: '已创建至少 30 天，且近 30 天没有打开阅读。',
    在学: '尚未达到常用或自动归档条件，暂留在此继续使用。'
  }
  return (
    <section className="frequency-settings" aria-label="知识分区说明">
      <p>
        {selected.manual_bucket
          ? `已手动固定在「${selected.bucket}」，不会随使用频率移动。`
          : `自动分区「${selected.bucket}」：${reasons[selected.bucket]}`}
      </p>
      <label>
        分区方式
        <select
          aria-label="知识分区"
          value={selected.manual_bucket ?? 'auto'}
          onChange={(event) => {
            const bucket = isBucket(event.target.value) ? event.target.value : null
            void guarded(async () => {
              const sequence = selectionSequence.current
              const item = await api.request('knowledge.bucket', { id: selected.id, bucket })
              if (sequence === selectionSequence.current) {
                setSelected(item)
              }
              await reload()
            })
          }}
        >
          <option value="auto">按使用频率自动分区</option>
          {(['常用', '在学', '归档'] as Bucket[]).map((bucket) => (
            <option key={bucket} value={bucket}>
              固定在「{bucket}」
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>自动分区规则</summary>
        <p>
          近 14 天至少 3 个使用日进入常用；创建满 30 天且近 30
          天未使用才自动归档，其余在在学。同一天打开多次只计一天；合并知识按全部来源的使用日去重。
        </p>
        <p>这些分区表示使用频率，不代表已经学会或学完；需要保持位置时选择固定分区。</p>
      </details>
    </section>
  )
}
