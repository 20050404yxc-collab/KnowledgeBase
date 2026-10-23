// 文件：SearchPage.tsx
// 层：React 页面／组件
// 作用：展示全库本地搜索结果及独立阅读区。
// 说明：搜索知识、补充与资料；阅读结果不会改变其他页面的问题和生成任务。
import { useAppContext } from '../../app/AppContext'
import { AnswerPanel, MarkdownContent } from '../knowledge'

// 结果与阅读分别展示；分页使用已提交查询，不使用正在输入的文字。
export function SearchPage() {
  const {
    globalResult: result,
    globalLoading,
    globalError,
    searchedQuery,
    searchGlobal,
    openItem,
    setCitation,
    selected,
    ready
  } = useAppContext()
  return (
    <section className="search-page" aria-label="搜索全库结果">
      <div className="page-heading">
        <div>
          <h1>搜索全库</h1>
          <p>搜索所有已保存知识、补充与资料，不调用模型，也不受 AI 学习范围影响。</p>
        </div>
      </div>
      {globalLoading && <p role="status">正在搜索「{searchedQuery}」…</p>}
      {globalError && (
        <p role="alert">
          {globalError}{' '}
          <button disabled={!ready} onClick={() => void searchGlobal(searchedQuery)}>
            重试搜索
          </button>
        </p>
      )}
      {result && (
        <div className="global-search-results">
          <h2>
            「{searchedQuery}」· {result.total} 条结果
          </h2>
          <p className="subtle">{result.notice}</p>
          {!result.total && <p>没有找到匹配内容。可尝试其他关键词；当前不提供同义语义检索。</p>}
          {result.items.map((hit) => (
            <article key={hit.id} className="global-search-hit">
              <button
                onClick={() =>
                  hit.citation ? setCitation(hit.citation) : void openItem(hit.knowledge_id)
                }
              >
                <strong>{hit.title}</strong>
                <small>
                  {hit.kind === 'source' ? '资料' : hit.kind === 'supplement' ? '补充' : '知识'} ·{' '}
                  {hit.theme}
                </small>
              </button>
              <MarkdownContent
                content={hit.excerpt}
                citations={[]}
                onCitation={setCitation}
                preview
              />
            </article>
          ))}
          <SearchPagination />
        </div>
      )}
      {selected && <AnswerPanel />}
    </section>
  )
}

// 分页继续已提交的查询，与输入框临时修改隔离。
function SearchPagination() {
  const { globalResult: result, globalLoading, searchedQuery, searchGlobal } = useAppContext()
  if (!result) {
    return null
  }
  return (
    <>
      {result.total > 30 && (
        <nav className="pagination" aria-label="全库搜索分页">
          <button
            disabled={globalLoading || !result.page}
            onClick={() => void searchGlobal(searchedQuery, result.page - 1)}
          >
            上一页搜索
          </button>
          <span>
            第 {result.page + 1} / {Math.ceil(result.total / 30)} 页
          </span>
          <button
            disabled={globalLoading || (result.page + 1) * 30 >= result.total}
            onClick={() => void searchGlobal(searchedQuery, result.page + 1)}
          >
            下一页搜索
          </button>
        </nav>
      )}
    </>
  )
}
