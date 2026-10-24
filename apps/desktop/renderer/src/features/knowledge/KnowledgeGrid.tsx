// 文件：KnowledgeGrid.tsx
// 层：React 页面／组件
// 作用：展示知识卡片并触发完整知识读取。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 展示知识卡片并触发完整知识读取。
export function KnowledgeGrid() {
  const { items, selected, openItem, section } = useAppContext()
  return (
    <div className={`knowledge-grid${section === '探索' ? ' exploration-grid' : ''}`}>
      {items.map((item) => (
        <button
          className={`knowledge-card ${selected?.id === item.id ? 'chosen' : ''}`}
          key={item.id}
          onClick={() => void openItem(item.id)}
        >
          <div>
            <span className="knowledge-icon">{item.generated ? '✧' : '▤'}</span>
            <span className={`bucket bucket-${item.bucket}`}>{item.bucket}</span>
          </div>
          <h3>{item.title}</h3>
          <p>{item.content}</p>
          <footer>
            <span>
              {item.generated ? 'AI 生成' : '个人笔记'}
              {item.edited ? ' · 已编辑' : ''}
            </span>
            <span>{new Date(item.updated_at).toLocaleDateString('zh-CN')}</span>
          </footer>
        </button>
      ))}
    </div>
  )
}
