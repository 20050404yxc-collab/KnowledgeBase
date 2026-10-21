// 文件：DirectoryTree.tsx
// 层：React 页面／组件
// 作用：递归展示完整知识树，支持按任意节点批量选择。
// 说明：勾选只记录意图，右侧明确提交后才生成内容。
import type { DirectoryPoint } from '../../../../../../contracts/desktop'
import { categoryPath } from '../../shared/knowledge_tree'
import { useAppContext } from '../../app/AppContext'

// 分类全选只作用于未保存项，已保存内容不会再次收费生成。
function GroupSelection({ title, points }: { title: string; points: DirectoryPoint[] }) {
  const { checkedPoints, setCheckedPoints, busy } = useAppContext()
  const ids = points.filter((p) => p.status !== '已有知识').map((p) => p.id)
  const count = ids.filter((id) => checkedPoints.includes(id)).length
  return (
    <label className="group-selection">
      <input
        type="checkbox"
        aria-label={`全选 ${title}`}
        disabled={!!busy || !ids.length}
        checked={!!ids.length && count === ids.length}
        ref={(node) => {
          if (node) {
            node.indeterminate = count > 0 && count < ids.length
          }
        }}
        onChange={(event) => {
          const checked = event.target.checked
          setCheckedPoints((current) =>
            checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))
          )
        }}
      />
      全选待生成项
    </label>
  )
}

// 阅读按钮与复选框分离，打开详情不会改动待生成的选择集合。
function PointRow({ point }: { point: DirectoryPoint }) {
  const { selectedPoint, selectPoint, checkedPoints, setCheckedPoints, outcomes, busy } =
    useAppContext()
  return (
    <div className="directory-row">
      <input
        type="checkbox"
        aria-label={`选择 ${point.title}`}
        disabled={!!busy || point.status === '已有知识'}
        checked={point.status !== '已有知识' && checkedPoints.includes(point.id)}
        onChange={(event) => {
          const checked = event.target.checked
          setCheckedPoints((current) =>
            checked ? [...new Set([...current, point.id])] : current.filter((id) => id !== point.id)
          )
        }}
      />
      <button
        className={`directory-point ${selectedPoint?.id === point.id ? 'active' : ''}`}
        onClick={() => void selectPoint(point)}
      >
        <strong>{point.title}</strong>
        <small>
          {point.status === '已有知识'
            ? point.status
            : (outcomes[point.id]?.message ?? point.status)}
        </small>
      </button>
    </div>
  )
}

interface DirectoryNode {
  path: string[]
  points: DirectoryPoint[]
  own: DirectoryPoint[]
  children: Map<string, DirectoryNode>
}

// 父级路径加知识标题构成完整位置，同一节点可同时有可读项与子节点。
function directoryNodes(points: DirectoryPoint[]) {
  const root: DirectoryNode = { path: [], points, own: [], children: new Map() }
  for (const point of points) {
    const parents = categoryPath(point)
    const route = [...(parents.length ? parents : [point.theme, '未细分']), point.title]
    let node = root
    for (const label of route) {
      let child = node.children.get(label)
      // 第一次遇到该路径时建立容器，后续知识复用同一节点。
      if (!child) {
        child = { path: [...node.path, label], points: [], own: [], children: new Map() }
        node.children.set(label, child)
      }
      node = child
      node.points.push(point)
    }
    node.own.push(point)
  }
  return [...root.children.values()]
}

// 每层分别提供阅读和后代选择，展开结构不生成正文或改变选择意图。
function DirectoryBranch({ node }: { node: DirectoryNode }) {
  if (!node.children.size) {
    return (
      <>
        {node.own.map((point) => (
          <PointRow key={point.id} point={point} />
        ))}
      </>
    )
  }
  return (
    <section
      className={node.path.length === 1 ? 'directory-group' : 'directory-subgroup'}
      data-depth={node.path.length}
    >
      {node.path.length === 1 ? <h3>{node.path.at(-1)}</h3> : <h4>{node.path.at(-1)}</h4>}
      <GroupSelection title={node.path.join('／')} points={node.points} />
      {node.own.map((point) => (
        <PointRow key={point.id} point={point} />
      ))}
      {[...node.children.values()].map((child) => (
        <DirectoryBranch key={JSON.stringify(child.path)} node={child} />
      ))}
    </section>
  )
}

// 分类深度由已校验路径决定，不把第三级强行当作叶子。
export function DirectoryTree() {
  const { directory } = useAppContext()
  return (
    <>
      {directoryNodes(directory?.points ?? []).map((node) => (
        <DirectoryBranch key={JSON.stringify(node.path)} node={node} />
      ))}
    </>
  )
}
