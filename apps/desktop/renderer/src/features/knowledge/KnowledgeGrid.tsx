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
            <span
              className="knowledge-icon"
              role="img"
              aria-label={item.generated ? 'AI 生成' : '个人笔记'}
            >
              {item.generated ? (
                'AI'
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
                </svg>
              )}
            </span>
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
