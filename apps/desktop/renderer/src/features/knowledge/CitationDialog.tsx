// 文件：CitationDialog.tsx
// 层：React 页面／组件
// 作用：显示引用位置、摘录及资料保留状态。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示引用位置、摘录及资料保留状态。
export function CitationDialog() {
  const { citation, setCitation } = useAppContext()
  if (!citation) {
    return null
  }
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <div className="modal-heading">
          <h2>{citation.name}</h2>
          <button onClick={() => setCitation(null)} aria-label="关闭引用">
            ×
          </button>
        </div>
        <p className="citation-locator">{citation.locator}</p>
        <div className="reading-text">{citation.text}</div>
        <p className="info-box">
          {citation.source_id.startsWith('knowledge') || citation.name.startsWith('知识库')
            ? '来自本地知识条目的引用摘录。'
            : citation.retained
              ? '显示引用时保存的证据摘录；完整资料已保留在应用资料库。'
              : '引用摘录已保留。完整原文未长期保存；需要时可重新加入同一文件。'}
        </p>
      </section>
    </div>
  )
}
