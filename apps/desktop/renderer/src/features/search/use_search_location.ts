// 文件：use_search_location.ts
// 层：React 搜索交互
// 作用：将已打开搜索命中定位到完整长文的对应段落。
// 说明：只响应当前搜索页目标，编辑时不替换输入。
import { useEffect, useRef } from 'react'
import { useAppContext } from '../../app/AppContext'

// 读取完成后定位当前段；组件卸载会由正文读取 hook 拒绝过期结果。
export function useSearchLocation(
  id: string,
  supplement: string | undefined,
  editing: boolean,
  read: (page: number) => Promise<void>
) {
  const { searchFocus, section } = useAppContext()
  const latest = useRef(read)
  latest.current = read
  useEffect(() => {
    if (section !== '搜索' || !searchFocus || editing || searchFocus.knowledge_id !== id) {
      return
    }
    const key = supplement ? `supplement:${supplement}` : `knowledge:${id}`
    if (searchFocus.id !== key) {
      return
    }
    // 后台返回命中所在正文页；无字段的兼容结果从首段开始。
    void latest.current(searchFocus.text_page ?? 0)
  }, [searchFocus, section, id, supplement, editing])
}
