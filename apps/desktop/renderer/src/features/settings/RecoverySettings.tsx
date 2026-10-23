// 文件：RecoverySettings.tsx
// 层：React 页面／组件
// 作用：展示持久回收站和知识库快照的显式恢复入口。
// 说明：数据库恢复成功后重载会话，避免继续使用旧目录和编辑草稿。
import { useEffect, useRef, useState } from 'react'
import type { ResultMap } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { api } from '../../shared/api/client'

// 面板拥有请求和加载状态；卸载后仅保留已完成存储行为，不回写旧视图。
function useRecoverySettings() {
  const { guarded, reload, busy, setMessage } = useAppContext()
  const [trash, setTrash] = useState<ResultMap['recycle.list'] | null>(null)
  const [snapshots, setSnapshots] = useState<ResultMap['recovery.list']>([])
  const [working, setWorking] = useState(false)
  const running = useRef(false)
  const mounted = useRef(true)
  // 两份摘要一起刷新；失败通过既有请求编号提示，不伪装为空数据。
  const refresh = async (page = 0) => {
    const [items, points] = await Promise.all([
      api.request('recycle.list', { page }),
      api.request('recovery.list', {})
    ])
    if (mounted.current) {
      setTrash(items)
      setSnapshots(points)
    }
  }
  useEffect(() => {
    mounted.current = true
    void guarded(() => refresh())
    return () => {
      mounted.current = false
    }
  }, [])
  // 独占本面板按钮；失败后解除锁，恢复整库成功才重新装载应用状态。
  const run = async (action: () => Promise<void>) => {
    if (running.current || busy) {
      return
    }
    running.current = true
    setWorking(true)
    await guarded(action)
    running.current = false
    if (mounted.current) {
      setWorking(false)
    }
  }
  const locked = working || !!busy
  return { trash, snapshots, locked, run, refresh, reload, setMessage }
}

// 组合回收站和快照操作；存储请求状态归上方 hook 持有。
export function RecoverySettings({ mode = 'all' }: { mode?: 'trash' | 'backup' | 'all' }) {
  const state = useRecoverySettings()
  return (
    <section className="recovery-settings" aria-label={mode === 'trash' ? '回收站' : '知识快照'}>
      {mode !== 'backup' && <TrashList {...state} />}
      {mode !== 'trash' && <SnapshotList {...state} />}
    </section>
  )
}

// 单条恢复只刷新正式知识和回收站，不清空当前会话草稿。
function TrashList({
  trash,
  locked,
  run,
  refresh,
  reload,
  setMessage
}: ReturnType<typeof useRecoverySettings>) {
  return (
    <>
      <h3>回收站</h3>
      <p>删除的知识保留在此；恢复包含正文、补充、分类与使用记录。合并组仍不可普通删除。</p>
      {trash?.items.map((item) => (
        <div className="recovery-row" key={item.id}>
          <span>
            <b>{item.title}</b>
            <small>{new Date(item.deleted_at).toLocaleString('zh-CN')}</small>
          </span>
          <button
            disabled={locked}
            onClick={() =>
              void run(async () => {
                await api.request('recycle.restore', { id: item.id })
                await reload()
                await refresh()
                setMessage(`已恢复「${item.title}」`)
              })
            }
          >
            恢复知识「{item.title}」
          </button>
        </div>
      ))}
      {trash?.total === 0 && <p>回收站为空</p>}
      {trash && (
        <div className="candidate-pages">
          <button
            disabled={locked || !trash.page}
            onClick={() => void run(() => refresh(trash.page - 1))}
          >
            上一页回收站
          </button>
          <span>
            共 {trash.total} 项 · 第 {trash.page + 1} 页
          </span>
          <button
            disabled={locked || (trash.page + 1) * 30 >= trash.total}
            onClick={() => void run(() => refresh(trash.page + 1))}
          >
            下一页回收站
          </button>
        </div>
      )}
    </>
  )
}

// 确认说明覆盖范围和重新加载的草稿风险，取消时不发送请求。
function SnapshotRow({
  point,
  locked,
  restore
}: {
  point: ResultMap['recovery.list'][number]
  locked: boolean
  restore: () => void
}) {
  return (
    <div className="recovery-row">
      <span>
        <b>
          {{ daily: '每日快照', manual: '手动快照', before: '恢复前快照' }[point.kind] ??
            point.kind}
        </b>
        <small>{new Date(point.created_at * 1000).toLocaleString('zh-CN')}</small>
        <small>{point.id}</small>
      </span>
      <button
        disabled={locked}
        onClick={() => {
          if (
            confirm(
              `恢复知识快照「${point.id}」？\n当前知识库将替换为此快照；先自动保存当前恢复点。API 配置、费用、资料副本和回收站保持现状。\n成功后重新加载页面会话，未保存的编辑、问题草稿与本次附件选择将清空，请先保存。`
            )
          ) {
            restore()
          }
        }}
      >
        恢复此知识快照
      </button>
    </div>
  )
}

// 恢复点独立展示，整库恢复成功后刷新整个会话而非保留过期编辑目标。
function SnapshotList({
  snapshots,
  locked,
  run,
  refresh,
  setMessage
}: Pick<
  ReturnType<typeof useRecoverySettings>,
  'snapshots' | 'locked' | 'run' | 'refresh' | 'setMessage'
>) {
  const { resetSession } = useAppContext()
  return (
    <>
      <h3>知识快照</h3>
      <p>
        每天首次启动自动保存，保留最近 7 个每日快照。下方显示最近 30
        个恢复点；人工和恢复前快照不自动删除。
      </p>
      <p>
        仅恢复知识、补充、分类、原文和使用记录。当前 API
        配置、用量、资料副本及回收站保持现状；不替代完整目录备份。
      </p>
      <button
        disabled={locked}
        onClick={() =>
          void run(async () => {
            await api.request('recovery.create', {})
            await refresh()
            setMessage('知识快照已创建')
          })
        }
      >
        立即创建知识快照
      </button>
      <button disabled={locked} onClick={() => void run(() => refresh())}>
        刷新恢复列表
      </button>
      {snapshots.map((point) => (
        <SnapshotRow
          key={point.id}
          point={point}
          locked={locked}
          restore={() =>
            void run(async () => {
              await api.request('recovery.restore', { id: point.id })
              resetSession()
            })
          }
        />
      ))}
    </>
  )
}
