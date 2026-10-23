// 文件：use_global_search.ts
// 层：React 交互 hook
// 作用：管理跨页全库搜索，不占用或取消模型生成任务。
// 说明：查询快照与请求序号拒绝过期结果，正文阅读归独立搜索页。
import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../../../../../contracts/desktop'
import type { Navigation } from '../../app/use_navigation'
import { api, errorText } from '../../shared/api/client'

// 新搜索固定全库范围，分页继续原查询，不受学习附件和分区影响。
export function useGlobalSearch(navigation: Navigation) {
  const [globalQuery, setGlobalQuery] = useState('')
  const [globalResult, setGlobalResult] = useState<SearchResult | null>(null)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const sequence = useRef(0)
  useEffect(
    () => () => {
      sequence.current++
    },
    []
  )
  const searchGlobal = async (query = globalQuery, page = 0) => {
    if (!query.trim()) {
      return
    }
    const request = ++sequence.current
    navigation.setSection('搜索')
    setGlobalLoading(true)
    setGlobalError('')
    setSearchedQuery(query)
    setGlobalQuery(query)
    setGlobalResult(null)
    try {
      const result = await api.request('knowledge.search', { query, page, scope: 'knowledge' })
      if (request === sequence.current) {
        setGlobalResult(result)
      }
    } catch (error) {
      if (request === sequence.current) {
        setGlobalError(errorText(error))
      }
    } finally {
      if (request === sequence.current) {
        setGlobalLoading(false)
      }
    }
  }
  return {
    globalSearchRevision: sequence.current,
    globalQuery,
    setGlobalQuery,
    globalResult,
    globalLoading,
    globalError,
    searchedQuery,
    searchGlobal
  }
}
