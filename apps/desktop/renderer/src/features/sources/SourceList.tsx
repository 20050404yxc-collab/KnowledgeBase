// 文件：SourceList.tsx
// 层：React 页面／组件
// 作用：显示已保留资料的解析信息与删除入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 显示已保留资料的解析信息与删除入口。
export function SourceList() {
  const { guarded, sources, setSources, setAnswer, setSelected, setAttachments } = useAppContext()
  return (
    <div className="source-list">
      {sources.length ? (
        sources.map((source) => (
          <article className="source-row" key={source.id}>
            <span className="file-icon">▱</span>
            <div>
              <h3>{source.name}</h3>
              <p>
                {source.blocks} 个片段 · {new Date(source.created_at).toLocaleString('zh-CN')}
              </p>
              {source.warnings.length > 0 && (
                <details>
                  <summary>解析说明</summary>
                  {source.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </details>
              )}
            </div>
            <button
              className="danger-text"
              onClick={() => {
                if (
                  confirm(
                    '删除应用保存的资料副本和检索片段？已有知识及其引用摘录保留，用户原文件不会删除。'
                  )
                ) {
                  void guarded(async () => {
                    setSources(await api.request('sources.delete', { id: source.id }))
                    setAttachments((current) =>
                      current.map((a) => (a.id === source.id ? { ...a, retained: false } : a))
                    )
                    setSelected(null)
                    setAnswer(null)
                  })
                }
              }}
            >
              删除资料
            </button>
          </article>
        ))
      ) : (
        <div className="empty-state">
          <div className="empty-symbol">▱</div>
          <h3>还没有长期保留的资料</h3>
          <p>在探索页加入附件，解析后点击“保留”。临时文件不会自动进入资料库。</p>
        </div>
      )}
    </div>
  )
}
