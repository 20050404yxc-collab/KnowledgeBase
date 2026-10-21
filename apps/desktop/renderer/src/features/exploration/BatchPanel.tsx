// 文件：BatchPanel.tsx
// 层：React 页面／组件
// 作用：在目录右侧集中提交多点生成，并呈现每项处理结果。
// 说明：补充预览仍由用户逐项核对，失败与缺资料不伪装成成功。
import { useAppContext } from '../../app/AppContext'

// 选择和实际生成分离；已保存与待核对预览不重复请求模型。
export function BatchPanel() {
  const {
    directory,
    checkedPoints,
    setCheckedPoints,
    learnBatch,
    outcomes,
    selectPoint,
    busy,
    cancelTask
  } = useAppContext()
  if (!directory?.points.length) {
    return null
  }
  const pending = directory.points.filter(
    (p) =>
      checkedPoints.includes(p.id) && p.status !== '已有知识' && !outcomes[p.id]?.answer?.review
  )
  return (
    <section className="batch-panel" aria-label="批量生成知识点">
      <h3>批量生成</h3>
      <p>在左侧勾选知识点，或全选任意一层的待生成项。已选 {pending.length} 项待生成。</p>
      <div className="batch-buttons">
        <button
          className="primary"
          disabled={!!busy || !pending.length}
          onClick={() => void learnBatch(pending.map((p) => p.id))}
        >
          生成所选知识点
        </button>
        <button disabled={!!busy || !checkedPoints.length} onClick={() => setCheckedPoints([])}>
          清空选择
        </button>
        {busy && <button onClick={() => void cancelTask()}>取消任务</button>}
      </div>
      {Object.values(outcomes).length > 0 && (
        <ul className="batch-results" aria-live="polite">
          {directory.points
            .filter((p) => outcomes[p.id])
            .map((point) => (
              <li key={point.id}>
                <button disabled={!!busy} onClick={() => void selectPoint(point)}>
                  {point.title}
                </button>
                <span>
                  {outcomes[point.id].answer?.knowledge ? '已保存' : outcomes[point.id].message}
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
