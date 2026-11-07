// 文件：SearchExcerpt.tsx
// 层：React 搜索展示
// 作用：以纯文本高亮摘录中的关键词。
// 说明：不把来源摘录作为 HTML 插入，不改变原始正文。
export function SearchExcerpt({ text, query }: { text: string; query: string }) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const expression = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  // 空查询只展示文本，避免空模式制造无界匹配。
  if (!expression) {
    return <p>{text}</p>
  }
  const pattern = new RegExp(`(${expression})`, 'gi')
  return (
    <p className="search-excerpt">
      {text
        .split(pattern)
        .map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part))}
    </p>
  )
}
