// 文件：PlanetCanvas.tsx
// 层：React 展示组件
// 作用：用连续位置过渡展示星球与水平连接的知识标题。
// 说明：浏览器拥有可打断过渡；组件只拥有尺寸监听并在卸载时释放。
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { hasChildren } from '../../shared/knowledge_tree'
import { useAppContext } from '../../app/AppContext'
import { layoutPlanets, type Planet } from './planet_layout'
import type { TreeNode } from '../../../../../../contracts/desktop'

// 同一分类始终使用同一个按钮；光照与表面层不截获输入。
function PlanetButton({ planet }: { planet: Planet }) {
  const { navigateTree } = useAppContext()
  const previous = useRef<Planet | undefined>(undefined)
  const expanding =
    planet.path.length > 1 && planet.visible && !planet.focused && !previous.current?.visible
  useEffect(() => {
    previous.current = planet
  }, [planet])
  const style = {
    left: `${planet.focused ? 50 : planet.x}%`,
    top: `${planet.focused ? 50 : planet.y}%`,
    '--planet-hue': planet.hue,
    '--planet-delay': expanding ? `${400 + planet.order * 40}ms` : '0ms',
    '--planet-duration': expanding ? '260ms' : '600ms'
  } as CSSProperties
  return (
    <button
      className={`planet-node saved-category ${planet.focused ? 'planet-center' : ''} ${planet.visible ? '' : 'planet-hidden'}`}
      style={style}
      data-path={planet.key}
      aria-hidden={!planet.visible}
      tabIndex={planet.visible ? 0 : -1}
      aria-expanded={planet.focused}
      onClick={() => navigateTree(planet.path)}
    >
      <span className="planet-surface" aria-hidden="true" />
      <span className="planet-label" title={planet.node.label}>
        {planet.node.label}
        <small>{planet.node.count} 个知识点</small>
      </span>
    </button>
  )
}

// 两侧标题各有独立水平连线；正文打开仍使用现有稳定 ID。
function PlanetLeaves({ nodes }: { nodes: TreeNode[] }) {
  const { openItem, selected } = useAppContext()
  return (
    <div className="planet-leaves">
      {nodes.map((node, index) => (
        <button
          key={node.key}
          className={`saved-leaf planet-leaf ${index % 2 ? 'leaf-right' : 'leaf-left'} ${selected?.id === node.id ? 'chosen' : ''}`}
          onClick={() => void openItem(node.id)}
        >
          <span>{node.label}</span>
          <small>{node.bucket}</small>
        </button>
      ))}
    </div>
  )
}

// 实际可用宽度控制每页节点数；CSS 过渡在重定向时自然从当前帧接续。
export function PlanetCanvas() {
  const { branches, treePath, treePages, paginateTree, section, filter } = useAppContext()
  const canvas = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(4)
  const retained = useRef<{ context: string; planet?: Planet }>({ context: '' })
  const previousPath = useRef(treePath)
  const key = JSON.stringify(treePath)
  const branch = branches[key]
  const count = branch?.nodes.length ?? 0
  const pages = Math.max(1, Math.ceil(count / capacity))
  const page = Math.min(treePages[key] ?? 0, pages - 1)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setCapacity(entry.contentRect.width >= 650 ? 6 : 4)
    )
    // 观察组件实际宽度，避免详情打开后仍按窗口宽度排布。
    if (canvas.current) {
      observer.observe(canvas.current)
    }
    return () => observer.disconnect()
  }, [])
  const planets = layoutPlanets({ branches, path: treePath, pages: treePages, capacity })
  const context = JSON.stringify([section, filter])
  const center = planets.find((planet) => planet.focused)
  // 刷新期间保留已确认中心；搜索或切页不得继承其他上下文的球体。
  if (!center && retained.current.context === context && retained.current.planet?.key === key) {
    planets.push(retained.current.planet)
  }
  useEffect(() => {
    retained.current = { context, planet: center ?? planets.find((planet) => planet.focused) }
    // 返回后将键盘焦点交回刚退出的分类，隐藏元素不继续持有焦点。
    if (previousPath.current.length > treePath.length) {
      const target = JSON.stringify(previousPath.current.slice(0, treePath.length + 1))
      const buttons = canvas.current?.querySelectorAll<HTMLButtonElement>('.planet-node')
      Array.from(buttons ?? [])
        .find((button) => button.dataset.path === target)
        ?.focus({ preventScroll: true })
    }
    previousPath.current = treePath
  }, [context, key, center, treePath, planets])
  const leaves =
    branch?.nodes
      .slice(page * capacity, (page + 1) * capacity)
      .filter((node) => !hasChildren(node)) ?? []
  const mixed = !!leaves.length && !!branch?.nodes.some(hasChildren)
  return (
    <>
      <div
        ref={canvas}
        className="planet-canvas"
        data-depth={treePath.length}
        role="group"
        aria-label="星球分类导航"
      >
        {planets.map((planet) => (
          <PlanetButton key={planet.key} planet={planet} />
        ))}
        {!!leaves.length && !mixed && <PlanetLeaves key={key + page} nodes={leaves} />}
      </div>
      {mixed && (
        <div className="planet-mixed-leaves">
          <PlanetLeaves key={key + page} nodes={leaves} />
        </div>
      )}
      <div className="planet-pagination">
        <button disabled={page === 0} onClick={() => paginateTree(page - 1)}>
          上一页节点
        </button>
        <span>
          第 {page + 1} / {pages} 页 · 已加载 {count} 项{branch?.next_cursor ? '（还有更多）' : ''}
        </span>
        <button disabled={page + 1 === pages} onClick={() => paginateTree(page + 1)}>
          下一页节点
        </button>
      </div>
    </>
  )
}
