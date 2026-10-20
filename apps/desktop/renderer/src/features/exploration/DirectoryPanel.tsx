// 文件：DirectoryPanel.tsx
// 层：React 页面／组件
// 作用：按主题展示本次问题的知识点和本地检索目录。
// 说明：目录占位不等于已经生成或收录，点击已有知识只读取本地。
import type { SearchHit } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { MarkdownContent } from '../knowledge'

// 本地结果明确标识类型与摘录，分页条件保留于搜索请求中。
function LocalResults() {
  const { searchResult, localSearch, busy } = useAppContext()
  if (!searchResult) {
    return null
  }
  return (
    <section className="local-results">
      <h3>本地命中 · {searchResult.total}</h3>
      <p className="result-notice">{searchResult.notice}</p>
      {[...new Set(searchResult.items.map((item) => item.theme))].map((theme) => (
        <section key={theme}>
          <h4>{theme}</h4>
          {searchResult.items
            .filter((item) => item.theme === theme)
            .map((item) => (
              <LocalHit key={item.id} item={item} />
            ))}
        </section>
      ))}
      {!searchResult.total && <p>未找到关键词相关内容，可换词检索；不代表没有同义知识。</p>}
      {searchResult.total > 30 && (
        <div className="pagination">
          <button
            disabled={!!busy || !searchResult.page}
            onClick={() => void localSearch(searchResult.page - 1)}
          >
            上一页
          </button>
          <span>第 {searchResult.page + 1} 页</span>
          <button
            disabled={!!busy || (searchResult.page + 1) * 30 >= searchResult.total}
            onClick={() => void localSearch(searchResult.page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  )
}

// 分组后的命中仍指向稳定知识或来源，预览本身不产生模型调用。
function LocalHit({ item }: { item: SearchHit }) {
  const { openLocalItem, setCitation, busy } = useAppContext()
  return (
    <div className="directory-hit">
      <button
        disabled={!!busy}
        onClick={() => {
          // 来源片段打开引用；知识及补充都打开所属完整知识。
          if (item.citation) {
            setCitation(item.citation)
          } else {
            void openLocalItem(item.knowledge_id)
          }
        }}
      >
        <small>
          {item.theme} ·{' '}
          {item.kind === 'source' ? '资料' : item.kind === 'supplement' ? '补充' : '已有知识'}
        </small>
        <strong>{item.title}</strong>
      </button>
      <MarkdownContent content={item.excerpt} citations={[]} onCitation={setCitation} preview />
    </div>
  )
}

// 生成与保存分开呈现，补充候选必须经明确选取和预览核对。
function PointActions() {
  const { selectedPoint, targetId, setTargetId, learnPoint, reviewing, busy } = useAppContext()
  if (!selectedPoint) {
    return null
  }
  if (selectedPoint.status === '已有知识') {
    return (
      <section className="point-actions">
        <h3>{selectedPoint.title}</h3>
        <p>已保存，可在右侧阅读。后续提问可继续为这个主题补充新内容。</p>
      </section>
    )
  }
  return (
    <section className="point-actions">
      <h3>{selectedPoint.title}</h3>
      <p>{selectedPoint.facet}</p>
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

// 目录与知识详情并列，分组依据主题，频率分区仍由原知识列表管理。
export function DirectoryPanel() {
  const { directory, searchResult, selectedPoint, selectPoint, busy } = useAppContext()
  if (!directory && !searchResult) {
    return null
  }
  const themes = [...new Set(directory?.points.map((point) => point.theme) ?? [])]
  return (
    <aside className="directory-panel" aria-label="知识目录">
      <h2>知识目录</h2>
      {themes.map((theme) => (
        <section key={theme} className="directory-group">
          <h3>{theme}</h3>
          {directory?.points
            .filter((point) => point.theme === theme)
            .map((point) => (
              <button
                key={point.id}
                className={`directory-point ${selectedPoint?.id === point.id ? 'active' : ''}`}
                disabled={!!busy}
                onClick={() => void selectPoint(point)}
              >
                <strong>{point.title}</strong>
                <small>{point.status}</small>
              </button>
            ))}
        </section>
      ))}
      <PointActions />
      <LocalResults />
    </aside>
  )
}
