// 文件：use_durable_text.ts
// 层：React 共享交互状态
// 作用：按固定槽位加载、串行写入草稿，并明确报告恢复状态。
// 说明：仅收到后台原子写入回执后显示已保护，失败保留当前输入。
import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { api, errorText } from './api/client'

interface Slot {
  value: string | null
  revision: number
  loaded: boolean
  updated: string
  status: string
  writing: boolean
  dirty: boolean
  timer?: ReturnType<typeof setTimeout>
}

// 每个槽位单独持有版本与定时器；异步回调始终写回原槽位。
export function useDurableText(slot: string) {
  const slots = useRef(new Map<string, Slot>())
  const [, refresh] = useState(0)
  const mounted = useRef(true)
  const notify = () => {
    if (mounted.current) {
      refresh((value) => value + 1)
    }
  }
  let state = slots.current.get(slot)
  if (!state) {
    state = {
      value: null,
      revision: 0,
      loaded: false,
      updated: '',
      status: '正在读取草稿',
      writing: false,
      dirty: false
    }
    slots.current.set(slot, state)
  }
  const current = state
  useEffect(() => {
    mounted.current = true
    // 当前窗口失去前台时尽早提交已有输入，不承诺未收到回执的内容可恢复。
    const protect = () =>
      slots.current.forEach((entry, key) => {
        clearTimeout(entry.timer)
        void flushSlot(key, entry, notify)
      })
    window.addEventListener('blur', protect)
    return () => {
      mounted.current = false
      // 不把卸载当作持久成功；只清理本 hook 创建的计时器。
      slots.current.forEach((entry) => clearTimeout(entry.timer))
      window.removeEventListener('blur', protect)
    }
  }, [])
  useEffect(() => {
    if (current.loaded) {
      return
    }
    void loadSlot(slot, current, notify)
  }, [slot])
  const setValue = (value: SetStateAction<string | null>) => {
    // 读取未完成时不替换恢复内容；界面可以稍后重试打开。
    if (!current.loaded) {
      return
    }
    current.value = typeof value === 'function' ? value(current.value) : value
    current.dirty = true
    current.status = '尚未保护，正在保存草稿…'
    clearTimeout(current.timer)
    current.timer = setTimeout(() => void flushSlot(slot, current, notify), 400)
    notify()
  }
  return {
    value: current.value,
    setValue,
    loaded: current.loaded,
    status: current.status,
    updated: current.updated,
    retry: () => void retrySlot(slot, current, notify)
  }
}

// 冲突只经显式确认替换磁盘草稿；其他失败照常重试，未修改快照可以重新读取。
async function retrySlot(slot: string, state: Slot, notify: () => void) {
  if (state.writing) {
    return
  }
  if (!state.dirty) {
    return loadSlot(slot, state, notify)
  }
  if (state.status.includes('版本冲突')) {
    if (
      !confirm('磁盘草稿已有较新版本。用本窗口输入替换该草稿？建议先创建备份；正式知识不受影响。')
    ) {
      return
    }
    state.writing = true
    try {
      const latest = await api.request('workspace.read', { slot })
      state.revision = latest.revision
    } catch (error) {
      state.status = `草稿未写入，输入仍在本窗口：${errorText(error)}`
      notify()
      return
    } finally {
      state.writing = false
    }
  }
  await flushSlot(slot, state, notify)
}

// 损坏或读取失败不当成空草稿；不进行可能覆盖旧版的写入。
async function loadSlot(slot: string, state: Slot, notify: () => void) {
  try {
    const result = await api.request('workspace.read', { slot })
    // 重读期间新输入仍归本窗口，不用晚到的磁盘快照替换它。
    if (state.dirty) {
      return
    }
    state.value = result.value
    state.revision = result.revision
    state.updated = result.updated_at
    state.loaded = true
    state.status = result.value ? '已恢复本地草稿；临时附件需重新添加' : ''
  } catch (error) {
    state.status = errorText(error)
  }
  notify()
}

// 同槽位只允许一个写请求；输入变化时先等待回执，再写最新值。
async function flushSlot(slot: string, state: Slot, notify: () => void) {
  if (!state.loaded) {
    return loadSlot(slot, state, notify)
  }
  if (state.writing || !state.dirty) {
    return
  }
  state.writing = true
  const value = state.value
  try {
    const result = await api.request('workspace.write', { slot, value, revision: state.revision })
    state.revision = result.revision
    state.updated = result.updated_at
    state.dirty = state.value !== value
    state.status = state.dirty ? '正在保存最新草稿…' : value ? '草稿已在本地保护' : ''
    state.writing = false
    notify()
    if (state.dirty) {
      await flushSlot(slot, state, notify)
    }
  } catch (error) {
    state.writing = false
    state.status = `草稿未写入，输入仍在本窗口：${errorText(error)}`
    notify()
  }
}
