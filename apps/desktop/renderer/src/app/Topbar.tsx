// 文件：Topbar.tsx
// 层：React 页面／组件
// 作用：显示当前分区名称及知识筛选输入。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from './AppContext'

// 显示当前分区名称及知识筛选输入。
export function Topbar() {
  const { section, ready, globalQuery, setGlobalQuery, searchGlobal } = useAppContext()
  return (
    <header className="topbar">
      <span>
        我的知识库 <span className="crumb">/</span> <strong>{section}</strong>
      </span>
      <form
        className="global-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          void searchGlobal()
        }}
      >
        <input
          aria-label="搜索知识与资料"
          placeholder="搜索知识与资料…"
          value={globalQuery}
          maxLength={12000}
          onChange={(event) => setGlobalQuery(event.target.value)}
        />
        <button disabled={!ready || !globalQuery.trim()}>搜索全库</button>
      </form>
      <div className="connection">
        <i className={ready ? 'online' : ''} />
        {ready ? '本地后台已连接' : '后台连接中'}
        <span className="avatar">Y</span>
      </div>
    </header>
  )
}
