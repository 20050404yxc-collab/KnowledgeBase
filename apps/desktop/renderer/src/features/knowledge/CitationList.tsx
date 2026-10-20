// 文件：CitationList.tsx
// 层：React 页面／组件
// 作用：列出可打开摘录详情的来源引用。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 列出可打开摘录详情的来源引用。
export function CitationList() {
  const { setCitation, visibleCitations } = useAppContext()
  return (
    <div className="citations">
      <h3>参考依据</h3>
      {visibleCitations.map((item, index) => (
        <button key={item.id} onClick={() => setCitation(item)}>
          <span>{index + 1}</span>
          {item.name}
          <small>{item.locator}</small>
        </button>
      ))}
    </div>
  )
}
