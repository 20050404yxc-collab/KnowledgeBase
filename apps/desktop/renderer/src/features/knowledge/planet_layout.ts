// 文件：planet_layout.ts
// 层：React 展示计算
// 作用：确定稳定星球身份、可见分页和不碰撞的节点位置。
// 说明：只计算展示，不读取接口或改变分类。
import type { TreeNode } from '../../../../../../contracts/desktop'
import { hasChildren } from '../../shared/knowledge_tree'
import type { Branch } from './use_saved_tree'

export interface Planet {
  key: string
  path: string[]
  node: TreeNode
  x: number
  y: number
  visible: boolean
  focused: boolean
  hue: number
  order: number
}

// 分类路径决定表面色调，避免重绘和进入时更换星球身份。
function stableHue(key: string) {
  let hash = 0
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return 165 + (hash % 100)
}

// 根层按网格、子层按椭圆排布；归一坐标随容器改变连续重定向。
function position(index: number, count: number, root: boolean, capacity: number) {
  if (root) {
    const columns = capacity === 6 ? 3 : 2
    return {
      x: ((index % columns) + 0.5) * (100 / columns),
      y: 27 + Math.floor(index / columns) * 46
    }
  }
  const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2
  return { x: 50 + 35 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) }
}

// 保持已缓存分类的 DOM 身份；隐藏节点不参与输入，返回时可从现坐标接续。
export function layoutPlanets(options: {
  branches: Record<string, Branch>
  path: string[]
  pages: Record<string, number>
  capacity: number
}) {
  const { branches, path, pages, capacity } = options
  const planets: Planet[] = []
  for (const [parentKey, branch] of Object.entries(branches)) {
    const parent: string[] = JSON.parse(parentKey)
    const page = Math.min(
      pages[parentKey] ?? 0,
      Math.max(0, Math.ceil(branch.nodes.length / capacity) - 1)
    )
    const start = page * capacity
    for (const [index, node] of branch.nodes.entries()) {
      // 知识标题由水平连线区域展示，不能冒充分类球体。
      if (!hasChildren(node)) {
        continue
      }
      const nodePath = [...parent, node.label]
      const key = JSON.stringify(nodePath)
      const focused = key === JSON.stringify(path)
      const visible =
        focused ||
        (parentKey === JSON.stringify(path) && index >= start && index < start + capacity)
      const point = position(
        index - start,
        Math.min(capacity, branch.nodes.length - start),
        !parent.length,
        capacity
      )
      planets.push({
        key,
        path: nodePath,
        node,
        x: visible ? point.x : 50,
        y: visible ? point.y : 50,
        visible,
        focused,
        hue: stableHue(key),
        order: Math.max(0, index - start)
      })
    }
  }
  return planets
}
