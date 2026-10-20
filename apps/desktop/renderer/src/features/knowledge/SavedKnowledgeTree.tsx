// 文件：SavedKnowledgeTree.tsx
// 层：React 展示组件
// 作用：组合星球分类导航、路径返回、加载反馈及完整分页。
// 说明：焦点和数据归页面 hook，分类浏览不读取正文或改变使用日。
import { useAppContext } from '../../app/AppContext'
import { PlanetCanvas } from './PlanetCanvas'

// 路径使用真实按钮，键盘与鼠标拥有相同的进入和返回入口。
function TreeBreadcrumbs() {
  const { treePath, navigateTree } = useAppContext()
  return (
    <nav className="planet-breadcrumbs" aria-label="知识分类路径">
      <button disabled={!treePath.length} onClick={() => navigateTree(treePath.slice(0, -1))}>
        返回上层
      </button>
      <button onClick={() => navigateTree([])}>全部分类</button>
      {treePath.map((label, index) => (
        <button
          key={index}
          aria-current={index === treePath.length - 1 ? 'location' : undefined}
          onClick={() => navigateTree(treePath.slice(0, index + 1))}
        >
          / {label}
        </button>
      ))}
    </nav>
  )
}

// 错误保留中心与返回入口；后台分页继续沿用当前分支游标。
function TreeStatus() {
  const { branches, treePath, loadTree } = useAppContext()
  const failedPath = treePath
    .map((_, index) => treePath.slice(0, index))
    .find((path) => branches[JSON.stringify(path)]?.error)
  const statusPath = failedPath ?? treePath
  const branch = branches[JSON.stringify(statusPath)]
  return (
    <div className="planet-status" aria-live="polite">
      {(!branch || branch.loading) && <p role="status">正在加载分类…</p>}
      {branch?.error && (
        <p role="alert">
          {branch.error}{' '}
          <button onClick={() => void loadTree(statusPath, !!branch.next_cursor)}>重试</button>
        </p>
      )}
      {branch && !branch.loading && !branch.error && !branch.nodes.length && (
        <p>此范围暂无知识。</p>
      )}
      {branch?.next_cursor && (
        <button disabled={branch.loading} onClick={() => void loadTree(treePath, true)}>
          加载更多
        </button>
      )}
    </div>
  )
}

// 四个页面共用结构；切页后从页面快照恢复，不额外播放入场。
export function SavedKnowledgeTree() {
  const { section, filter, setFilter, branches } = useAppContext()
  return (
    <section className="saved-tree" aria-label={`${section}已有知识目录`}>
      <div className="section-title">
        <h2>
          已有知识目录 <span className="count">{branches['[]']?.total ?? '…'}</span>
        </h2>
        <input
          aria-label="筛选已有知识"
          placeholder={section === '知识库' ? '搜索全部知识' : '搜索本区知识'}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <TreeBreadcrumbs />
      <PlanetCanvas />
      <TreeStatus />
    </section>
  )
}
