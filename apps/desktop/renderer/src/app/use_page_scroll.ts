// 文件：use_page_scroll.ts
// 层：React 交互 hook
// 作用：为各导航页面保留独立的窗口滚动位置。
// 说明：布局阶段恢复，避免首帧显示上一页的阅读位置。
import { useLayoutEffect, useRef } from 'react'

// 导航动作在 DOM 改变前记录旧页；布局阶段在绘制前恢复新页。
export function usePageScroll(page: string) {
  const positions = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    window.scrollTo(0, positions.current.get(page) ?? 0)
  }, [page])
  return () => positions.current.set(page, window.scrollY)
}
