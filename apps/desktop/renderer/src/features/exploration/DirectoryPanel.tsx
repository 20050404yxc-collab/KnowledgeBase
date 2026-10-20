// 文件：DirectoryPanel.tsx
// 层：React 页面／组件
// 作用：按主题展示本次问题的知识点和本地检索目录。
// 说明：目录占位不等于已经生成或收录，点击已有知识只读取本地。
import type { SearchHit } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { MarkdownContent } from '../knowledge'
import { DirectoryTree } from './DirectoryTree'

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

// 目录只提供浏览和选择，生成、资料与结果统一放在右侧。
export function DirectoryPanel() {
  const { directory, searchResult } = useAppContext()
  if (!directory && !searchResult) {
    return null
  }
  return (
    <aside className="directory-panel" aria-label="知识目录">
      <h2>知识目录</h2>
      <DirectoryTree />
      {directory?.excluded?.length ? (
        <section className="excluded-points">
          <h3>未纳入学习</h3>
          {directory.excluded.map((p, i) => (
            <p key={i}>
              <strong>{p.title}</strong> · {p.decision === 'clarify' ? '待澄清' : '已排除'}：
              {p.reason}
            </p>
          ))}
        </section>
      ) : null}
      <LocalResults />
    </aside>
  )
}
