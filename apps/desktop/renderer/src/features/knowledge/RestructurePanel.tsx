// 文件：RestructurePanel.tsx
// 层：React 展示组件
// 作用：展示重构目录、逐项内容差异与两阶段确认动作。
// 说明：所有模型文本按普通文本显示，不执行 HTML 或来源指令。
import { useAppContext } from '../../app/AppContext'
import { OutlineEdit, RestructureReview } from './RestructureReview'

// 目录预览保留旧路径与理由，分页不隐含用户同意。
function OutlinePreview() {
  const { restructurePreview: preview, previewRestructure } = useAppContext()
  return (
    <section aria-label="重构目录预览">
      <h3>第 1 步：确认重构后的目录</h3>
      {preview.outline.map((point) => (
        <div className="outline-change" key={point.id}>
          <strong>
            {point.category} → {point.subcategory} → {point.title}
          </strong>
          <p>
            原位置：{point.old_path.join(' → ')} · {point.reason}
          </p>
          <OutlineEdit
            key={point.id + point.title + point.category + point.subcategory}
            point={point}
          />
        </div>
      ))}
      <PreviewPages kind="outline" size={30} />
      <button onClick={() => void previewRestructure('outline', 0)}>查看目录首页</button>
    </section>
  )
}

// 两种预览使用各自分页大小，避免把正文结果当作目录页数。
function PreviewPages({ kind, size }: { kind: 'outline' | 'suggestions'; size: number }) {
  const { restructurePreview: preview, previewRestructure } = useAppContext()
  return (
    <div className="pagination">
      <button
        disabled={!preview.page}
        onClick={() => void previewRestructure(kind, preview.page - 1)}
      >
        上一页
      </button>
      <span>
        第 {preview.page + 1} 页 · 共 {preview.total} 项
      </span>
      <button
        disabled={(preview.page + 1) * size >= preview.total}
        onClick={() => void previewRestructure(kind, preview.page + 1)}
      >
        下一页
      </button>
    </div>
  )
}

// 默认不勾选任何更新，手工笔记只展示另附建议。
function SuggestionPreview() {
  const { restructurePreview: preview, selectedUpdates, setSelectedUpdates } = useAppContext()
  return (
    <section aria-label="重构内容差异">
      <h3>第 2 步：选择内容更新</h3>
      <p>未勾选的内容不更新。手工正文与补充原样保留。</p>
      {preview.suggestions.map((item) => (
        <div className="content-change" key={item.id}>
          <label>
            <input
              type="checkbox"
              checked={selectedUpdates.includes(item.id)}
              onChange={(event) => {
                const checked = event.target.checked
                setSelectedUpdates((values) =>
                  checked
                    ? [...new Set([...values, item.id])]
                    : values.filter((id) => id !== item.id)
                )
              }}
            />
            {item.title} ·{' '}
            {item.kind === 'model-explanation'
              ? '模型补充解释（未独立核实）'
              : item.mode === 'replace'
                ? '原文提取，替换未编辑的生成正文'
                : '原文提取，原文保留并追加整理'}
          </label>
          <p>{item.reason}</p>
          {item.provenance?.map((source, index) => (
            <p key={index}>
              来源 {source.source_id} · 版本 {source.version} · {source.locator}
            </p>
          ))}
          <div className="content-comparison">
            <div>
              <h4>原文</h4>
              <pre>{item.original || '原文保持不变；本项仅追加建议'}</pre>
            </div>
            <div>
              <h4>建议</h4>
              <pre>{item.content}</pre>
            </div>
          </div>
          <details>
            <summary>查看逐行差异</summary>
            <pre>{item.diff}</pre>
          </details>
        </div>
      ))}
      {!preview.total && <p>本次无需更新正文，可以仅应用目录。</p>}
      <PreviewPages kind="suggestions" size={1} />
    </section>
  )
}

// 状态按钮严格区分规划、确认目录、继续准备与最终应用。
export function RestructurePanel() {
  const model = useAppContext()
  const { restructureDraft: draft, busy, restructureFeedback, setRestructureFeedback } = model
  if (!draft) {
    return null
  }
  return (
    <section className="restructure-panel" aria-label="知识库重构">
      <h2>重构知识库</h2>
      <p>
        概览 {draft.covered}/{draft.total} · 已归类 {draft.classified}/{draft.total} · 已准备更新{' '}
        {draft.prepared}/{draft.target_count ?? draft.total}
      </p>
      <RestructureReview />
      {(draft.status === 'planning' ||
        draft.status === 'preparing' ||
        draft.status === 'paused') && (
        <button disabled={!!busy} onClick={() => void model.resumeRestructure()}>
          继续未完成阶段
        </button>
      )}
      {draft.status === 'outline' && (
        <>
          <OutlinePreview />
          <label>
            目录调整意见
            <input
              value={restructureFeedback}
              disabled={!!busy}
              onChange={(event) => setRestructureFeedback(event.target.value)}
            />
          </label>
          <button disabled={!!busy} onClick={() => void model.planRestructure()}>
            按意见重新规划
          </button>
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => void model.prepareRestructure()}
          >
            确认目录，准备内容调整
          </button>
        </>
      )}
      {draft.status === 'ready' && (
        <>
          <button onClick={() => void model.previewRestructure('outline', 0)}>复查目录</button>
          <button onClick={() => void model.previewRestructure('suggestions', 0)}>
            查看内容差异
          </button>
          {model.restructurePreview.kind === 'outline' ? (
            <OutlinePreview />
          ) : model.restructurePreview.kind === 'suggestions' ? (
            <SuggestionPreview />
          ) : null}
          <button
            disabled={!!busy || (!!draft.groups && draft.target_count !== draft.classified)}
            onClick={() => void model.applyRestructure(true)}
          >
            仅应用目录
          </button>
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => void model.applyRestructure(false)}
          >
            确认目录并应用所选更新（{model.selectedUpdates.length}）
          </button>
        </>
      )}
      {draft.status === 'applied' && <p role="status">重构已保存，目录与搜索已同步。</p>}
      <button disabled={!!busy} onClick={() => void model.discardRestructure()}>
        {draft.status === 'applied' ? '关闭重构结果' : '取消并丢弃草案'}
      </button>
    </section>
  )
}
