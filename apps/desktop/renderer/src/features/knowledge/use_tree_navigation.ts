// 文件：use_tree_navigation.ts
// 层：React 交互 hook
// 作用：管理页面独立的星球焦点、分页和失效回退。
// 说明：完整验证祖先后再加载后代，不根据不完整分页判定分类不存在。
import { useEffect } from 'react'
import { usePageState } from '../../shared/use_page_state'
import type { Branch } from './use_saved_tree'

const EMPTY_NAVIGATION = { query: '', path: [] as string[], pages: {} as Record<string, number> }
interface Options {
  page: string
  query: string
  branches: Record<string, Branch>
  load: (path: string[], more?: boolean) => Promise<void>
}

// 筛选立即重置；数据刷新仅回退确已消失的路径，保留可恢复的错误。
export function useTreeNavigation({ page, query, branches, load }: Options) {
  const [navigation, setNavigation] = usePageState(page, EMPTY_NAVIGATION)
  const treePath = navigation.query === query ? navigation.path : []
  const treePages = navigation.query === query ? navigation.pages : {}
  useEffect(() => {
    // 将搜索重置写回页面快照，清空搜索也不能复活旧路径。
    if (navigation.query !== query) {
      setNavigation({ query, path: [], pages: {} })
      return
    }
    // 其他页面不发起目录请求；页面快照仍由根 hook 保存。
    if (!['知识库', '常用', '在学', '归档'].includes(page)) {
      return
    }
    for (let depth = 0; depth <= treePath.length; depth++) {
      const parent = treePath.slice(0, depth)
      const branch = branches[JSON.stringify(parent)]
      // 缓存失效逐层恢复，不并发读取未经验证的后代。
      if (!branch) {
        void load(parent)
        return
      }
      if (branch.loading || branch.error || depth === treePath.length) {
        return
      }
      // 祖先可能还在下一页；读完后才允许回退。
      if (!branch.nodes.some((node) => !node.id && node.label === treePath[depth])) {
        if (branch.next_cursor) {
          void load(parent, true)
        } else {
          setNavigation((current) => ({ ...current, path: parent }))
        }
        return
      }
    }
  }, [page, query, branches, navigation, load, setNavigation])
  function navigateTree(path: string[]) {
    setNavigation((current) => ({
      query,
      path,
      pages: current.query === query ? current.pages : {}
    }))
  }
  function paginateTree(index: number) {
    setNavigation({
      query,
      path: treePath,
      pages: { ...treePages, [JSON.stringify(treePath)]: index }
    })
  }
  return { treePath, treePages, navigateTree, paginateTree }
}
