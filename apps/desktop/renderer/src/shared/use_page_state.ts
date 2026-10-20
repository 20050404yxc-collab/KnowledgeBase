// 文件：use_page_state.ts
// 层：React 共享交互状态
// 作用：按页面保存状态，并将异步 setter 固定到发起页面。
// 说明：旧页面回调只能更新自己的快照，不能写入当前其他页面。
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

// 页面键参与读取与更新，缺少快照时显示该页初始值。
export function usePageState<T>(page: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [pages, setPages] = useState<Record<string, T>>({})
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (value) => {
      setPages((current) => ({
        ...current,
        [page]:
          typeof value === 'function'
            ? (value as (previous: T) => T)(current[page] ?? initial)
            : value
      }))
    },
    [page, initial]
  )
  return [pages[page] ?? initial, setValue]
}
