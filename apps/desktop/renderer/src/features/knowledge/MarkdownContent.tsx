// 文件：MarkdownContent.tsx
// 层：React 纯展示组件
// 作用：安全渲染 Markdown 并将有效证据标记转换为引用入口。
// 说明：不启用 HTML，不加载远程媒体，代码节点不转换引用。
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Citation } from '../../../../../../contracts/desktop'

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

// 只遍历普通文本节点，代码与现有链接中的标记保持原样。
function citationPlugin(citations: Citation[]) {
  const indexes = new Map(citations.map((item, index) => [item.id, index]))
  return () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || ['code', 'inlineCode', 'link', 'html'].includes(node.type)) {
        return
      }
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child)
          return [child]
        }
        const result: MarkdownNode[] = []
        let offset = 0
        for (const match of child.value.matchAll(/\[([^\]\n]+)\]/g)) {
          const index = indexes.get(match[1])
          if (index === undefined) {
            continue
          }
          result.push({ type: 'text', value: child.value.slice(offset, match.index) })
          result.push({
            type: 'link',
            url: `#kb-citation-${index}`,
            children: [{ type: 'text', value: `引用 ${index + 1}` }]
          })
          offset = match.index + match[0].length
        }
        result.push({ type: 'text', value: child.value.slice(offset) })
        return result
      })
    }
    visit(tree)
  }
}

// Markdown 原文保留在数据层；危险 URL 由库过滤，来源 HTML 永不执行。
export function MarkdownContent({
  content,
  citations,
  onCitation,
  preview = false
}: {
  content: string
  citations: Citation[]
  onCitation: (citation: Citation) => void
  preview?: boolean
}) {
  return (
    <div className="reading-text markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, citationPlugin(citations)]}
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          img: ({ alt }) => <span className="media-placeholder">[图片：{alt || '未加载'}]</span>,
          a: ({ href, children }) => {
            if (preview || !href) {
              return <span>{children}</span>
            }
            const match = href?.match(/^#kb-citation-(\d+)$/)
            const citation = match ? citations[Number(match[1])] : undefined
            // 自定义引用只对应本段真实证据；外部链接保持安全协议与隔离窗口。
            if (citation) {
              return (
                <button className="inline-citation" onClick={() => onCitation(citation)}>
                  {children}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
