// 文件：SavedKnowledgeTree.tsx
// 层：React 展示组件
// 作用：展示当前页面已保存知识的大类、小类和知识点。
// 说明：与待学习目录区分；节点只通过 hook 公开动作读取。
import { useEffect } from 'react'
import { useAppContext } from '../../app/AppContext'

// 空分支、失败重试和分页均保留在对应路径，不借用其他分区内容。
function SavedBranch({ path }: { path: string[] }) {
  const { branches, expanded, loadTree, toggleTree, openItem, selected } = useAppContext()
  const key = JSON.stringify(path)
  const branch = branches[key]
  // 展开后的子层在缓存失效时按需恢复，effect 不创建重复并发请求。
  useEffect(() => {
    if (!branch) {
      void loadTree(path)
    }
  }, [key, branch])
  return (
    <div className="saved-tree-level" role="group">
      {!branch || branch.loading ? <p role="status">正在加载分类…</p> : null}
      {branch?.error && (
        <p role="alert">
          {branch.error} <button onClick={() => void loadTree(path)}>重试</button>
        </p>
      )}
      {branch?.nodes.map((node) => {
        const next = [...path, node.label]
        const open = expanded.includes(JSON.stringify(next))
        return node.id ? (
          <button
            key={node.key}
            className={`saved-leaf ${selected?.id === node.id ? 'chosen' : ''}`}
            onClick={() => void openItem(node.id)}
          >
            {node.label}
            <small>{node.bucket}</small>
          </button>
        ) : (
          <div key={node.key}>
            <button
              className="saved-category"
              aria-expanded={open}
              onClick={() => toggleTree(next)}
            >
              {open ? '▾' : '▸'} {node.label} <small>{node.count}</small>
            </button>
            {open && <SavedBranch path={next} />}
          </div>
        )
      })}
      {branch?.next_cursor && (
        <button disabled={branch.loading} onClick={() => void loadTree(path, true)}>
          加载更多
        </button>
      )}
      {branch && !branch.loading && !branch.error && !branch.nodes.length && (
        <p>此范围暂无知识。</p>
      )}
    </div>
  )
}

// 四个页面共用结构，各自的筛选、展开和结果由页面状态隔离。
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
      <SavedBranch path={[]} />
    </section>
  )
}
