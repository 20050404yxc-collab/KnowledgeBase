// 文件：use_tree_preference.ts
// 层：React 共享交互 hook
// 作用：按页面持久保存知识目录的展示偏好。
// 说明：仅存视图名称；存储不可用时退回内存，不影响知识数据。
import { useState } from 'react'

type TreeView = 'planets' | 'list'
const PREFIX = 'knowledgebase.tree-view.'

// 只接受已知视图；旧版缺省与损坏偏好都回到紧凑列表。
function readView(page: string): TreeView {
  try {
    return localStorage.getItem(PREFIX + page) === 'planets' ? 'planets' : 'list'
  } catch {
    return 'list'
  }
}

// 页面内存缓存优先；明确点击后才写入，不在挂载时覆盖其他页面的偏好。
export function useTreePreference(page: string) {
  const [views, setViews] = useState<Record<string, TreeView>>({})
  const setTreeView = (value: TreeView) => {
    setViews((current) => ({ ...current, [page]: value }))
    try {
      localStorage.setItem(PREFIX + page, value)
    } catch {
      // 浏览器禁用持久存储时继续使用当前会话选择。
    }
  }
  return { treeView: views[page] ?? readView(page), setTreeView }
}
