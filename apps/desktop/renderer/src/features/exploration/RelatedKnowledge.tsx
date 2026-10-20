// 文件：RelatedKnowledge.tsx
// 层：React 页面／组件
// 作用：展示已有知识与需点击生成的拓展卡片。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 展示已有知识与需点击生成的拓展卡片。
export function RelatedKnowledge() {
  const { recommendations, openItem, busy, ask } = useAppContext()
  return (
    <section className="related">
      <div className="section-title">
        <h2>沿着好奇，继续探索</h2>
        <span>{recommendations.length}/3 条关联</span>
      </div>
      {recommendations.length ? (
        <div className="related-grid">
          {recommendations.map((card) => (
            <button
              key={card.title}
              className="related-card"
              disabled={!!busy}
              onClick={() =>
                card.knowledge_id ? void openItem(card.knowledge_id) : void ask(card.title, true)
              }
            >
              <small>{card.knowledge_id ? '已有知识' : '拓展学习 · 点击生成'}</small>
              <h3>
                {card.title} <span>↗</span>
              </h3>
              <p>{card.reason}</p>
              <div>{card.preview}</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="subtle">暂未形成有效关联推荐。生成接口可补充拓展；不会用无关知识凑数。</p>
      )}
    </section>
  )
}
