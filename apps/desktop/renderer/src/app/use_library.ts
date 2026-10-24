// 文件：use_library.ts
// 层：React 交互 hook
// 作用：管理启动摘要、知识检索及资料、接口和用量列表。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useEffect, useRef, useState } from 'react'
import type {
  Attempt,
  Knowledge,
  Provider,
  Source,
  UsageSummary
} from '../../../../../contracts/desktop'
import { api, errorText } from '../shared/api/client'
import { isBucket } from '../../../shared/protocol_validation'

import type { Feedback } from '../shared/api/use_feedback'
import type { Navigation } from './use_navigation'

// 管理启动摘要、知识检索及资料、接口和用量列表。
// 本 hook 只持有状态，动作通过显式能力对象访问。
function useLibraryState() {
  const [pageLists, setPageLists] = useState<Record<string, { key: string; items: Knowledge[] }>>(
    {}
  )
  const [failedKey, setFailedKey] = useState('')
  const currentListKey = useRef('')
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [ready, setReady] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const loadSequence = useRef(0)
  const [dataRevision, setDataRevision] = useState(0)
  return {
    pageLists,
    setPageLists,
    failedKey,
    setFailedKey,
    currentListKey,
    sources,
    setSources,
    providers,
    setProviders,
    attempts,
    setAttempts,
    usageSummary,
    setUsageSummary,
    ready,
    setReady,
    dataDir,
    setDataDir,
    loadSequence,
    dataRevision,
    setDataRevision
  }
}
type LibraryState = ReturnType<typeof useLibraryState>

// 组合启动、检索和列表状态；旧筛选响应不能覆盖新列表。
export function useLibrary(options: Feedback & Navigation) {
  const state = useLibraryState()
  const combined = { ...options, ...state }
  const { ready, loadSequence, providers } = state
  const { section, filter } = options
  state.currentListKey.current = JSON.stringify([section, filter])
  const boot = () => bootAction(combined)
  const reload = () => {
    state.setDataRevision((value) => value + 1)
    return reloadAction(combined)
  }
  const loadUsage = () => loadUsageAction(combined)

  useEffect(() => {
    void boot()
  }, [])
  useEffect(() => {
    if (!ready) {
      return
    }
    const timer = setTimeout(() => {
      void reloadAction(combined)
    }, 160)
    return () => {
      clearTimeout(timer)
      loadSequence.current++
    }
  }, [filter, section, ready])
  const activeProvider = providers.find((p) => p.active)
  const currentKey = JSON.stringify([section, filter])
  const listLoading = state.pageLists[section]?.key !== currentKey && state.failedKey !== currentKey
  return {
    ...state,
    items: state.pageLists[section]?.key === currentKey ? state.pageLists[section].items : [],
    listLoading,
    boot,
    reload,
    loadUsage,
    activeProvider
  }
}

// 读取启动摘要，失败保留可重试状态。
async function bootAction(state: Feedback & Navigation & LibraryState) {
  const {
    setError,
    setPageLists,
    section,
    filter,
    setSources,
    setProviders,
    setReady,
    setDataDir
  } = state

  setError('')
  try {
    const value = await api.request('bootstrap')
    // 启动摘要只适合探索无筛选列表，不能将全库摘要放进其他分区。
    if (section === '探索' && !filter) {
      setPageLists((current) => ({
        ...current,
        [section]: { key: JSON.stringify([section, filter]), items: value.knowledge }
      }))
    }
    setSources(value.sources)
    setProviders(value.providers)
    setDataDir(value.data_dir)
    setReady(true)
  } catch (err) {
    setReady(false)
    setError(errorText(err))
  }
}

// 只接纳当前筛选条件对应的最后一次响应。
async function reloadAction(state: Feedback & Navigation & LibraryState) {
  const { setError, section, filter, loadSequence, currentListKey, setPageLists, setFailedKey } =
    state
  const key = JSON.stringify([section, filter])
  // 旧页面的保存回调只能触发原页面刷新，不能抢走当前列表请求。
  if (key !== currentListKey.current) {
    return
  }

  const sequence = ++loadSequence.current
  setFailedKey('')
  try {
    const value =
      section === '探索'
        ? await api.request('exploration.list', { query: filter })
        : await api.request('knowledge.list', {
            query: filter,
            bucket: isBucket(section) ? section : null
          })
    if (sequence === loadSequence.current && key === currentListKey.current) {
      setPageLists((current) => ({ ...current, [section]: { key, items: value } }))
    }
  } catch (err) {
    // 过期失败与成功一样不能覆盖新页面。
    if (sequence === loadSequence.current && key === currentListKey.current) {
      setError(errorText(err))
      setFailedKey(key)
    }
  }
}

// 刷新当前调用记录，不触发模型请求。
async function loadUsageAction(state: Feedback & Navigation & LibraryState) {
  const { guarded, setAttempts, setUsageSummary } = state

  await guarded(async () => {
    const [attempts, summary] = await Promise.all([
      api.request('usage.list'),
      api.request('usage.summary')
    ])
    setAttempts(attempts)
    setUsageSummary(summary)
  })
}

export type Library = ReturnType<typeof useLibrary>
