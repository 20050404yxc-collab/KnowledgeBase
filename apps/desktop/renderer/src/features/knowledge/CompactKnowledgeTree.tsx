// 文件：CompactKnowledgeTree.tsx
// 层：React 展示组件
// 作用：以紧凑列表浏览当前完整目录分支。
// 说明：复用树缓存与游标；展开分类不读取正文，节点正文另设阅读入口。
import { useAppContext } from '../../app/AppContext'
import { hasChildren } from '../../shared/knowledge_tree'

// 按后台稳定顺序展示已加载项；更多项由共用状态栏加载，不使用截断知识列表。
export function CompactKnowledgeTree() {
  const { branches, treePath, navigateTree, openItem, selected } = useAppContext()
  const branch = branches[JSON.stringify(treePath)]
  return (
    <>
      <div className="compact-tree" role="list" aria-label="紧凑知识目录" tabIndex={0}>
        {branch?.nodes.map((node) => (
          <div className="compact-tree-row" role="listitem" key={node.key}>
            {hasChildren(node) ? (
              <button
                className="compact-tree-main"
                onClick={() => navigateTree([...treePath, node.label])}
                aria-label={`展开分类：${node.label}`}
              >
                <span>{node.label}</span>
                <small>{node.count} 个知识点 · 展开 ›</small>
              </button>
            ) : (
              <button
                className={`compact-tree-main ${selected?.id === node.id ? 'chosen' : ''}`}
                onClick={() => void openItem(node.id)}
                aria-label={`阅读知识：${node.label}`}
              >
                <span>{node.label}</span>
                <small>{node.bucket} · 阅读</small>
              </button>
            )}
            {hasChildren(node) && node.id && (
              <button onClick={() => void openItem(node.id)} aria-label={`阅读节点：${node.label}`}>
                阅读本节点
              </button>
            )}
          </div>
        ))}
      </div>
      {!!branch?.nodes.length && (
        <p className="subtle">
          已加载 {branch.nodes.length} 项{branch.next_cursor ? '，下方可加载更多。' : '。'}
        </p>
      )}
    </>
  )
}
