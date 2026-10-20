// 文件：PointActions.tsx
// 层：React 页面／组件
// 作用：在目录右侧展示当前知识点的生成及归属核对操作。
// 说明：待学习项也有独立操作面板，已有内容仍需明确确认补充。
import { useAppContext } from '../../app/AppContext'

// 生成与保存分开呈现，补充候选必须经明确选取和预览核对。
export function PointActions() {
  const { selectedPoint, targetId, setTargetId, learnPoint, reviewing, busy } = useAppContext()
  if (!selectedPoint) {
    return null
  }
  if (selectedPoint.status === '已有知识') {
    return (
      <section className="point-actions">
        <h3>{selectedPoint.title}</h3>
        <p>已保存，可在下方阅读。后续提问可继续为这个主题补充新内容。</p>
      </section>
    )
  }
  return (
    <section className="point-actions">
      <h3>{selectedPoint.title}</h3>
      <p>{selectedPoint.facet}</p>
      <p className="result-notice">{selectedPoint.reason}</p>
      {selectedPoint.candidates.length > 0 && (
        <label>
          关联到已有知识
          <select
            aria-label="补充目标"
            value={targetId}
            disabled={!!busy || reviewing}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">不关联，作为独立知识</option>
            {selectedPoint.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.theme}／{candidate.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {reviewing ? (
        <>
          <p>请核对下面的补充预览、归属和结论差异。原笔记不会被覆盖。</p>
          <button
            className="primary"
            disabled={!!busy || !targetId}
            onClick={() => void learnPoint('confirm')}
          >
            确认归属并保存补充
          </button>
          <button disabled={!!busy} onClick={() => void learnPoint('separate')}>
            保留为独立知识
          </button>
        </>
      ) : (
        <>
          <button
            className="primary"
            disabled={!!busy || selectedPoint.status === '已有知识'}
            onClick={() => void learnPoint(targetId ? 'supplement' : 'learn')}
          >
            {targetId ? '生成补充' : '学习这个知识点'}
          </button>
          <p className="result-notice">按需调用所选模型，完整校验后保存；补充先预览核对。</p>
        </>
      )}
    </section>
  )
}
