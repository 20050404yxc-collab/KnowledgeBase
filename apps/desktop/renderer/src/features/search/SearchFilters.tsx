// 文件：SearchFilters.tsx
// 层：React 搜索交互
// 作用：显式提交本地关键词搜索的类型和分类筛选。
// 说明：修改条件不自动发请求，分页继续已提交条件。
import { useAppContext } from '../../app/AppContext'

// 选项逐项收窄，避免任意字符串进入跨进程类型。
export function SearchFilters() {
  const {
    searchKind,
    setSearchKind,
    searchCategory,
    setSearchCategory,
    globalLoading,
    searchedQuery,
    searchGlobal
  } = useAppContext()
  return (
    <form
      className="search-filters"
      onSubmit={(event) => {
        event.preventDefault()
        void searchGlobal(searchedQuery)
      }}
    >
      <label>
        内容类型
        <select
          aria-label="搜索内容类型"
          value={searchKind}
          onChange={(event) => {
            const value = event.target.value
            if (
              value === 'all' ||
              value === 'knowledge' ||
              value === 'supplement' ||
              value === 'source'
            ) {
              setSearchKind(value)
            }
          }}
        >
          <option value="all">全部内容</option>
          <option value="knowledge">知识正文</option>
          <option value="supplement">知识补充</option>
          <option value="source">保留资料</option>
        </select>
      </label>
      <label>
        分类包含
        <input
          aria-label="搜索分类"
          value={searchCategory}
          maxLength={160}
          onChange={(event) => setSearchCategory(event.target.value)}
          placeholder="不填则搜索所有分类"
        />
      </label>
      <button disabled={globalLoading || !searchedQuery}>应用筛选</button>
    </form>
  )
}
