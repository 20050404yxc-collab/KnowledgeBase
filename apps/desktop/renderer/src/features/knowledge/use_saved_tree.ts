// 文件：use_saved_tree.ts
// 层：React 交互 hook
// 作用：按页管理已入库分层树、星球导航与有界分页。
// 说明：筛选版本隔离迟到响应；目录读取不增加使用日。
import { useRef } from 'react'
import type { LibraryTree } from '../../../../../../contracts/desktop'
import { isBucket } from '../../../../shared/protocol_validation'
import { usePageState } from '../../shared/use_page_state'
import { api, errorText } from '../../shared/api/client'
import { useTreeNavigation } from './use_tree_navigation'

export interface Branch extends LibraryTree {
  loading: boolean
  error: string
}
const EMPTY_BRANCH: Branch = {
  nodes: [],
  total: 0,
  revision: '',
  next_cursor: '',
  loading: false,
  error: ''
}
const EMPTY_CACHE: { key: string; branches: Record<string, Branch> } = { key: '', branches: {} }

// 缓存与导航归根会话持有；筛选、日期或数据版本变化使对应页面缓存失效。
export function useSavedTree(page: string, query: string, revision: number) {
  const [cache, setCache] = usePageState(page, EMPTY_CACHE)
  const pending = useRef(new Set<string>())
  const contexts = useRef<Record<string, string>>({})
  const day = new Date().toLocaleDateString()
  const context = JSON.stringify([page, query, revision, day])
  contexts.current[page] = context
  const branches = cache.key === context ? cache.branches : {}
  const navigation = useTreeNavigation({ page, query, branches, load })
  // 每个路径独立分页；发起页 setter 允许隐藏页接收自己的结果。
  async function load(path: string[], more = false) {
    const key = JSON.stringify(path)
    const requestKey = context + key
    if (pending.current.has(requestKey)) {
      return
    }
    pending.current.add(requestKey)
    update({ ...(branches[key] ?? EMPTY_BRANCH), loading: true, error: '' })
    try {
      const result = await api.request('knowledge.tree', {
        path,
        query,
        bucket: isBucket(page) ? page : null,
        cursor: more ? branches[key]?.next_cursor : ''
      })
      update({
        ...result,
        loading: false,
        error: '',
        nodes: more ? [...(branches[key]?.nodes ?? []), ...result.nodes] : result.nodes
      })
    } catch (error) {
      // 保留已加载节点，错误页可重试同一游标。
      update({ ...(branches[key] ?? EMPTY_BRANCH), loading: false, error: errorText(error) })
    } finally {
      pending.current.delete(requestKey)
    }
    // 过滤已经变化时丢弃迟到结果，不清空其他页面快照。
    function update(branch: Branch) {
      if (contexts.current[page] === context) {
        setCache((current) => ({
          key: context,
          branches: {
            ...(current.key === context ? current.branches : {}),
            [key]: branch
          }
        }))
      }
    }
  }
  return { branches, loadTree: load, ...navigation }
}
