// 文件：DirectoryTree.tsx
// 层：React 页面／组件
// 作用：展示两级分类与知识点复选框，支持按大类或小类批量选择。
// 说明：勾选只记录意图，右侧明确提交后才生成内容。
import type { DirectoryPoint } from '../../../../../../contracts/desktop'
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
        disabled={!!busy}
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

// 大类和小类使用现有分类字段，不重新分类或改写旧主题。
export function DirectoryTree() {
  const { directory } = useAppContext()
  const points = directory?.points ?? []
  const categories = [...new Set(points.map((p) => p.category ?? p.theme))]
  return (
    <>
      {categories.map((category) => {
        const group = points.filter((p) => (p.category ?? p.theme) === category)
        return (
          <section key={category} className="directory-group">
            <h3>{category}</h3>
            <GroupSelection title={category} points={group} />
            {[...new Set(group.map((p) => p.subcategory ?? '未细分'))].map((sub) => {
              const children = group.filter((p) => (p.subcategory ?? '未细分') === sub)
              return (
                <section key={sub} className="directory-subgroup">
                  <h4>{sub}</h4>
                  <GroupSelection title={`${category}／${sub}`} points={children} />
                  {children.map((point) => (
                    <PointRow key={point.id} point={point} />
                  ))}
                </section>
              )
            })}
          </section>
        )
      })}
    </>
  )
}
