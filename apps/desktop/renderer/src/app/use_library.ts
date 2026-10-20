// 文件：use_library.ts
// 层：React 交互 hook
// 作用：管理启动摘要、知识检索及资料、接口和用量列表。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useEffect, useRef, useState } from 'react'
import type { Attempt, Knowledge, Provider, Source } from '../../../../../contracts/desktop'
import { api, errorText } from '../shared/api/client'
import { isBucket } from '../../../shared/protocol_validation'

import type { Feedback } from '../shared/api/use_feedback'
import type { Navigation } from './use_navigation'

// 管理启动摘要、知识检索及资料、接口和用量列表。
// 本 hook 只持有状态，动作通过显式能力对象访问。
function useLibraryState() {
  const [items, setItems] = useState<Knowledge[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [ready, setReady] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const loadSequence = useRef(0)
  return {
    items,
    setItems,
    sources,
    setSources,
    providers,
    setProviders,
    attempts,
    setAttempts,
    ready,
    setReady,
    dataDir,
    setDataDir,
    loadSequence
  }
}
type LibraryState = ReturnType<typeof useLibraryState>

// 组合启动、检索和列表状态；旧筛选响应不能覆盖新列表。
export function useLibrary(options: Feedback & Navigation) {
  const state = useLibraryState()
  const combined = { ...options, ...state }
  const { ready, loadSequence, providers } = state
  const { section, filter } = options
  const boot = () => bootAction(combined)
  const reload = () => reloadAction(combined)
  const loadUsage = () => loadUsageAction(combined)

  useEffect(() => {
    void boot()
  }, [])
  useEffect(() => {
    if (!ready) {
      return
    }
    const timer = setTimeout(() => {
      void reload()
    }, 160)
    return () => {
      clearTimeout(timer)
      loadSequence.current++
    }
  }, [filter, section, ready])
  const activeProvider = providers.find((p) => p.active)
  return { ...state, boot, reload, loadUsage, activeProvider }
}

// 读取启动摘要，失败保留可重试状态。
async function bootAction(state: Feedback & Navigation & LibraryState) {
  const { setError, setItems, setSources, setProviders, setReady, setDataDir } = state

  setError('')
  try {
    const value = await api.request('bootstrap')
    setItems(value.knowledge)
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
  const { setError, section, filter, setItems, loadSequence } = state

  const sequence = ++loadSequence.current
  try {
    const value = await api.request('knowledge.list', {
      query: filter,
      bucket: isBucket(section) ? section : null
    })
    if (sequence === loadSequence.current) {
      setItems(value)
    }
  } catch (err) {
    setError(errorText(err))
  }
}

// 刷新当前调用记录，不触发模型请求。
async function loadUsageAction(state: Feedback & Navigation & LibraryState) {
  const { guarded, setAttempts } = state

  await guarded(async () => {
    setAttempts(await api.request('usage.list'))
  })
}

export type Library = ReturnType<typeof useLibrary>
