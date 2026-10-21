// 文件：knowledge_tree.ts
// 层：React 共享展示计算
// 作用：统一读取完整知识路径与节点展开能力。
// 说明：只适配已验证 DTO，不重新分类或读取后台。
import type { TreeNode } from '../../../../../contracts/library'

// 新字段优先；旧结果保留原两级显示，不猜测主题中的分隔符。
export function categoryPath(item: {
  category_path?: string[]
  category?: string
  subcategory?: string
  theme?: string
}) {
  return (
    item.category_path ?? [item.category, item.subcategory].filter((part): part is string => !!part)
  )
}

// 旧树没有能力标记，只有空正文标识的节点可展开。
export function hasChildren(node: TreeNode) {
  return node.children ?? !node.id
}
