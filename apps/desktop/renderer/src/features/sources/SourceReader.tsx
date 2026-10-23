// 文件：SourceReader.tsx
// 层：React 页面／组件
// 作用：按来源位置分页阅读已保留资料，不依赖原文件。
// 说明：关闭或翻页使旧请求失效；原文以安全 Markdown 显示。
import { useEffect, useRef, useState } from 'react'
import type { ResultMap } from '../../../../../../contracts/desktop'
import { api, errorText } from '../../shared/api/client'
import { MarkdownContent } from '../knowledge'

// 每次翻页拥有独立序号，失败可重试；没有成功数据时不显示空内容成功状态。
export function SourceReader({ id, close }: { id: string; close: () => void }) {
  const [result, setResult] = useState<ResultMap['sources.read'] | null>(null)
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  useEffect(() => {
    const request = ++sequence.current
    setResult(null)
    setError('')
    void api
      .request('sources.read', { id, page })
      .then((value) => {
        if (sequence.current === request) {
          setResult(value)
        }
      })
      .catch((err) => {
        if (sequence.current === request) {
          setError(errorText(err))
        }
      })
    return () => {
      sequence.current++
    }
  }, [id, page, retry])
  return (
    <section className="panel source-reader" aria-label="资料阅读">
      <div className="section-title">
        <h2>{result?.name ?? '资料内容'}</h2>
        <button onClick={close}>关闭资料阅读</button>
      </div>
      <p className="subtle">应用保存的解析文本；图片和未解析的版式不包含在内。</p>
      {!result && !error && <p role="status">正在读取资料…</p>}
      {error && (
        <p role="alert">
          {error} <button onClick={() => setRetry(retry + 1)}>重试读取</button>
        </p>
      )}
      {result?.items.map((item) => (
        <div key={item.id}>
          <h3>{item.locator}</h3>
          <MarkdownContent
            source={{ kind: 'source', id, page, block_id: item.id }}
            content={item.text || '此处没有可读文字。'}
            citations={[]}
            onCitation={() => {}}
          />
        </div>
      ))}
      {result && (
        <nav className="pagination" aria-label="资料内容分页">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            上一段资料
          </button>
          <span>
            第 {page + 1} / {result.pages} 段
          </span>
          <button disabled={page + 1 >= result.pages} onClick={() => setPage(page + 1)}>
            下一段资料
          </button>
        </nav>
      )}
    </section>
  )
}
