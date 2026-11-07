// 文件：use_recent_reading.ts
// 层：React 应用交互
// 作用：记录最近八篇阅读与位置，支持显式继续和清除。
// 说明：只保存知识标识、标题和位置，不恢复模型任务或读取临时附件。
import { useEffect, useRef } from 'react'
import type { Knowledge } from '../../../../../contracts/desktop'
import { useDurableText } from '../shared/use_durable_text'

interface Recent {
  id: string
  title: string
  position: number
  updated: string
}

// 本地数据逐字段校验，恢复元数据不代表知识仍然存在。
function decode(value: string | null): Recent[] {
  try {
    const items: unknown = JSON.parse(value ?? '[]')
    if (!Array.isArray(items)) {
      return []
    }
    return items
      .filter(
        (item): item is Recent =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.position === 'number' &&
          Number.isFinite(item.position) &&
          item.position >= 0 &&
          typeof item.updated === 'string'
      )
      .slice(0, 8)
  } catch {
    return []
  }
}

// 根 hook 持有定时器；只在实际选中知识时更新，切页后不串用旧滚动回调。
export function useRecentReading(selected: Knowledge | null, page: string) {
  const storage = useDurableText('recent')
  const latest = useRef(storage)
  latest.current = storage
  useEffect(() => {
    if (
      !selected ||
      !storage.loaded ||
      !['探索', '知识库', '常用', '在学', '归档', '搜索'].includes(page)
    ) {
      return
    }
    storage.setValue((value) => {
      const items = decode(value)
      const previous = items.find((item) => item.id === selected.id)
      return JSON.stringify(
        [
          {
            id: selected.id,
            title: selected.title,
            position: previous?.position ?? 0,
            updated: new Date().toISOString()
          },
          ...items.filter((item) => item.id !== selected.id)
        ].slice(0, 8)
      )
    })
  }, [selected?.id, page, storage.loaded])
  useEffect(() => {
    if (!selected || !['探索', '知识库', '常用', '在学', '归档', '搜索'].includes(page)) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      clearTimeout(timer)
      const position = window.scrollY
      timer = setTimeout(
        () =>
          latest.current.setValue((value) =>
            JSON.stringify(
              decode(value).map((item) => (item.id === selected.id ? { ...item, position } : item))
            )
          ),
        800
      )
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', save)
    }
  }, [selected?.id, page])
  return { recentReading: decode(storage.value), clearRecentReading: () => storage.setValue(null) }
}
