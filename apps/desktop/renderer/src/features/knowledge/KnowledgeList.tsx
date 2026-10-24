// 文件：KnowledgeList.tsx
// 层：React 页面／组件
// 作用：组合知识列表、空状态及新建入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { KnowledgeGrid } from './KnowledgeGrid'

// 组合知识列表、空状态及新建入口。
export function KnowledgeList() {
  const { section, filter, setFilter, items, setEditor, listLoading, setSection } = useAppContext()
  return (
    <section className="knowledge-section">
      <div className="section-title">
        <h2>
          {section === '探索' ? '为你精选 · 常问常看优先' : `${section}列表`}{' '}
          <span className="count">{items.length}</span>
        </h2>
        {section === '探索' && <button onClick={() => setSection('知识库')}>查看全部知识</button>}
        <input
          className="inline-search"
          aria-label="筛选已有知识"
          placeholder="⌕  筛选当前列表"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {listLoading ? (
        <p role="status">正在加载本页知识…</p>
      ) : items.length ? (
        <KnowledgeGrid />
      ) : (
        <div className="empty-state">
          <div className="empty-symbol">▤</div>
          <h3>{filter ? '没有找到匹配的知识' : '为你的第一个想法，留一个位置'}</h3>
          <p>
            {filter
              ? '试试其他关键词，或进入全部知识搜索。'
              : '新建笔记，或配置 API 后提问并预览保存回答。'}
          </p>
          {filter ? (
            <button className="secondary" onClick={() => setFilter('')}>
              清除筛选
            </button>
          ) : (
            <button className="secondary" onClick={() => setEditor({ title: '', content: '' })}>
              ＋ 写下第一条知识
            </button>
          )}
        </div>
      )}
    </section>
  )
}
