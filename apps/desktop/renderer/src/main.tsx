import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Answer, Attachment, Attempt, Bucket, Citation, Knowledge, Provider, Recommendation, Scope, Source } from '../../../../contracts/desktop'
import './styles.css'

const api = window.knowledgeBase
const sections = ['探索', '常用', '在学', '归档', '资料库', 'API 配置', '用量统计'] as const
type Section = typeof sections[number]
type Attached = Partial<Attachment> & { localId: string; path: string; name: string; state: 'loading' | 'ready' | 'error'; error?: string }
const icons = ['⌕', '☆', '▤', '▣', '▱', '⚙', '◷']
const blankProvider = { name: '', protocol: 'responses' as Provider['protocol'], base_url: 'https://api.openai.com/v1', model: '', key: '', input_price: '', output_price: '', currency: 'USD' }
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '操作未完成，请重试'

function App() {
  const [section, setSection] = useState<Section>('探索')
  const [items, setItems] = useState<Knowledge[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [scope, setScope] = useState<Scope>('mixed')
  const [attachments, setAttachments] = useState<Attached[]>([])
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [selected, setSelected] = useState<Knowledge | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [streamChars, setStreamChars] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const [editor, setEditor] = useState<{ id?: string; title: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [citation, setCitation] = useState<Citation | null>(null)
  const [providerForm, setProviderForm] = useState(blankProvider)
  const [pathEntry, setPathEntry] = useState<string | null>(null)
  const activeRequest = useRef<string | null>(null)
  const loadSequence = useRef(0)

  async function boot() {
    setError('')
    try {
      const value = await api.request<{ knowledge: Knowledge[]; sources: Source[]; providers: Provider[]; data_dir: string }>('bootstrap')
      setItems(value.knowledge); setSources(value.sources); setProviders(value.providers); setDataDir(value.data_dir); setReady(true)
    } catch (err) { setReady(false); setError(errorText(err)) }
  }
  async function reload() {
    const sequence = ++loadSequence.current
    try {
      const value = await api.request<Knowledge[]>('knowledge.list', { query: filter, bucket: ['常用', '在学', '归档'].includes(section) ? section : null })
      if (sequence === loadSequence.current) setItems(value)
    } catch (err) { setError(errorText(err)) }
  }
  useEffect(() => { void boot() }, [])
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => { void reload() }, 160)
    return () => { clearTimeout(timer); loadSequence.current++ }
  }, [filter, section, ready])
  useEffect(() => api.onEvent(event => {
    if (event.id !== activeRequest.current) return
    if (event.type === 'progress') setProgress(event.message ?? '')
    if (event.type === 'stream') setStreamChars(count => count + (event.delta?.length ?? 0))
  }), [])

  async function guarded(action: () => Promise<void>) {
    setError(''); setMessage('')
    try { await action() } catch (err) { setError(errorText(err)) }
  }

  async function openItem(id: string) {
    await guarded(async () => {
      const item = await api.request<Knowledge>('knowledge.get', { id })
      setSelected(item); setAnswer(null)
      setRecommendations(await api.request<Recommendation[]>('recommendations', { id }))
      void reload()
    })
  }

  async function ask(text = query, expansion = false) {
    if (!text.trim() || activeRequest.current) return
    if (!expansion && attachments.some(a => a.state === 'loading')) { setError('附件仍在解析，请等待完成或移除后提问'); return }
    const id = crypto.randomUUID()
    activeRequest.current = id; setBusy(id); setProgress('正在检索'); setStreamChars(0); setError(''); setMessage('')
    setSelected(null); setAnswer(null); setRecommendations([])
    try {
      const value = await api.request<Answer>('question', {
        query: text, scope: expansion ? 'knowledge' : (attachments.some(a => a.state === 'ready') ? scope : scope === 'files' ? 'files' : 'knowledge'),
        attachment_ids: expansion ? [] : attachments.filter(a => a.state === 'ready').map(a => a.id),
        purpose: expansion ? 'expansion' : 'question'
      }, id)
      setAnswer(value); setSelected(value.knowledge ?? null); setRecommendations(value.recommendations)
      setSection('探索'); void reload()
    } catch (err) { setError(errorText(err)) }
    finally { activeRequest.current = null; setBusy(null); setProgress('') }
  }

  async function addFiles(paths: string[]) {
    for (const path of paths.slice(0, 20)) {
      const localId = crypto.randomUUID()
      const name = path.split(/[\\/]/).pop() || path
      setAttachments(current => [...current, { localId, path, name, state: 'loading' }])
      try {
        const result = await api.request<Attachment>('attachments.add', { path }, localId)
        setAttachments(current => current.some(a => a.id === result.id && a.localId !== localId)
          ? current.filter(a => a.localId !== localId)
          : current.map(a => a.localId === localId ? { ...a, ...result, state: 'ready' } : a))
      } catch (err) {
        setAttachments(current => current.map(a => a.localId === localId ? { ...a, state: 'error', error: errorText(err) } : a))
      }
    }
  }

  async function removeAttachment(item: Attached) {
    await guarded(async () => {
      if (item.state === 'loading') await api.cancel(item.localId)
      else if (item.id) await api.request('attachments.remove', { id: item.id })
      setAttachments(current => current.filter(a => a.localId !== item.localId))
    })
  }

  async function retain(item: Attached) {
    await guarded(async () => {
      const value = await api.request<Source[]>('sources.retain', { id: item.id })
      setSources(value); setAttachments(current => current.map(a => a.id === item.id ? { ...a, retained: true } : a))
      setMessage('资料已保留；删除或修改原路径文件不会改变保存的副本')
    })
  }

  async function saveNote(event: React.FormEvent) {
    event.preventDefault()
    if (!editor || saving) return
    setSaving(true)
    await guarded(async () => {
      const item = await api.request<Knowledge>('knowledge.save', editor)
      setSelected(item); setAnswer(null); setEditor(null); setRecommendations([]); setMessage('知识已保存'); void reload()
    })
    setSaving(false)
  }

  async function loadUsage() {
    await guarded(async () => { setAttempts(await api.request<Attempt[]>('usage.list')) })
  }
  const activeProvider = providers.find(p => p.active)
  const visibleContent = answer?.content ?? selected?.content
  const visibleCitations = answer?.citations ?? selected?.citations ?? []
  const bodySection = ['探索', '常用', '在学', '归档'].includes(section)

  return <div className="app" onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault()
    if (!bodySection || busy) return
    try { void addFiles(api.pathsForFiles(Array.from(event.dataTransfer.files))) } catch (err) { setError(errorText(err)) }
  }}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">知</div><div><strong>知序</strong><small>PERSONAL KNOWLEDGE</small></div></div>
      <div className="workspace-label">我的知识空间 <span>LOCAL</span></div>
      <nav>{sections.map((name, index) => <React.Fragment key={name}>
        {index === 5 && <div className="nav-divider" />}
        <button className={`nav-item ${section === name ? 'active' : ''}`} onClick={() => {
          setSection(name); setFilter(''); if (name === '用量统计') void loadUsage()
        }}><span className="nav-icon">{icons[index]}</span>{name}{name === '在学' && <span className="nav-dot" />}</button>
      </React.Fragment>)}</nav>
      <div className="sidebar-bottom"><div className="local-indicator"><span /> 本地存储 · 由你掌控</div><small>test0.01 <span>开发测试版</span></small></div>
    </aside>
    <main>
      <header className="topbar"><span>我的知识库 <span className="crumb">/</span> <strong>{section}</strong></span><div className="connection"><i className={ready ? 'online' : ''} />{ready ? '本地后台已连接' : '后台连接中'}<span className="avatar">Y</span></div></header>
      <div className="content">
        {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}
        {message && <div className="alert success" role="status">{message}<button onClick={() => setMessage('')} aria-label="关闭提示">×</button></div>}
        {!ready && <div className="startup"><p>正在启动本地知识后台…</p><button onClick={() => void boot()}>重新连接</button></div>}
        {bodySection && <>
          <div className="page-heading"><div><div className="eyebrow">THINK · CONNECT · GROW</div><h1>{section === '探索' ? '让每一次好奇，都有所积累。' : `${section}的知识`}</h1><p>{section === '探索' ? '从一个问题开始，连接已有知识，发现新的可能。' : '按使用频率整理，随时回来继续学习。'}</p></div><button className="secondary" disabled={!ready} onClick={() => setEditor({ title: '', content: '' })}>＋ 新建知识</button></div>
          <section className="composer">
            <form onSubmit={event => { event.preventDefault(); void ask() }}>
              <label className="sr-only" htmlFor="question">输入问题</label><textarea id="question" placeholder="想了解什么？输入问题，或把文档拖到这里…" value={query} maxLength={12000}
                onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void ask() } }}
                onPaste={event => {
                  const value = event.clipboardData.getData('text').trim()
                  if (/^(?:"?[a-zA-Z]:[\\/]|"?\\\\)/.test(value) && !value.includes('\n')) { event.preventDefault(); void addFiles([value.replace(/^"|"$/g, '')]) }
                }} />
              {attachments.length > 0 && <div className="attachments">{attachments.map(item => <div key={item.localId} className={`attachment ${item.state}`}>
                <div><b>▱ {item.name}</b><small>{item.state === 'loading' ? '解析中…' : item.state === 'error' ? item.error : `${item.blocks} 个片段 · ${item.retained ? '已保留资料' : '仅本次会话'}`}</small></div>
                {item.state === 'ready' && !item.retained && <button type="button" disabled={!!busy} onClick={() => void retain(item)}>保留</button>}
                <button type="button" disabled={!!busy} onClick={() => void removeAttachment(item)} aria-label={`移除 ${item.name}`}>×</button>
                {item.warnings?.length ? <details><summary>解析说明</summary>{item.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
              </div>)}</div>}
              <div className="composer-toolbar"><div className="toolbar-left"><button type="button" className="attach-button" disabled={!ready || !!busy} onClick={() => void guarded(async () => { void addFiles(await api.chooseFiles()) })}>＋ 添加文档</button>
                <button type="button" className="text-button" disabled={!ready || !!busy} onClick={() => setPathEntry('')}>本地路径</button><span className="toolbar-separator" />
                <select aria-label="回答范围" value={scope} onChange={event => setScope(event.target.value as Scope)}><option value="mixed">本次文件＋知识库</option><option value="files">仅本次文件</option><option value="knowledge">仅知识库</option></select></div>
                {busy ? <button type="button" className="secondary" onClick={() => void api.cancel(busy)}>取消任务</button> : <button className="primary" disabled={!ready || !query.trim()}>检索并提问 <span>↗</span></button>}
              </div>
            </form>
          </section>
          <div className="composer-caption"><span>⌁ {activeProvider ? activeProvider.name + ' · ' + activeProvider.model : '本地模式 · 配置 API 后可生成学习内容'}</span><span>关键词检索 <span className="caption-dot">·</span> Ctrl + Enter 发送</span></div>
          {busy && <div className="working" role="status"><span className="spinner" />{progress}{streamChars > 0 && <small>已接收 {streamChars.toLocaleString()} 字，正在等待完整结果</small>}</div>}
          {visibleContent && <article className="answer-panel"><div className="answer-heading"><div><span className="pill">{selected?.generated ? 'AI 学习内容' : selected ? '我的知识' : '本地检索'}</span><h2>{selected?.title ?? '检索与回答'}</h2></div>{selected && <select aria-label="知识分区" value={selected.manual_bucket ?? 'auto'} onChange={event => void guarded(async () => {
            const item = await api.request<Knowledge>('knowledge.bucket', { id: selected.id, bucket: event.target.value === 'auto' ? null : event.target.value }); setSelected(item); void reload()
          })}><option value="auto">自动 · {selected.bucket}</option>{(['常用', '在学', '归档'] as Bucket[]).map(bucket => <option key={bucket} value={bucket}>固定 · {bucket}</option>)}</select>}</div>
            <div className="reading-text">{visibleContent}</div>
            {visibleCitations.length > 0 && <div className="citations"><h3>参考依据</h3>{visibleCitations.map((item, index) => <button key={item.id} onClick={() => setCitation(item)}><span>{index + 1}</span>{item.name}<small>{item.locator}</small></button>)}</div>}
            {answer?.notice && <p className="result-notice">{answer.notice}</p>}
            {selected && <footer className="note-footer"><span>{selected.generated ? `${selected.provider_name} · ${selected.model}` : '个人笔记'}{selected.edited ? ' · 已手动编辑' : ''} · {new Date(selected.updated_at).toLocaleDateString('zh-CN')}</span><div><button onClick={() => setEditor({ id: selected.id, title: selected.title, content: selected.content })}>编辑</button><button className="danger-text" onClick={() => {
              if (confirm('删除这条知识？关联使用记录会一并删除，此操作不可撤销。')) void guarded(async () => { await api.request('knowledge.delete', { id: selected.id }); setSelected(null); setAnswer(null); setRecommendations([]); void reload() })
            }}>删除</button></div></footer>}
          </article>}
          {(visibleContent || recommendations.length > 0) && <section className="related"><div className="section-title"><h2>沿着好奇，继续探索</h2><span>{recommendations.length}/3 条关联</span></div>{recommendations.length ? <div className="related-grid">{recommendations.map(card => <button key={card.title} className="related-card" disabled={!!busy} onClick={() => card.knowledge_id ? void openItem(card.knowledge_id) : void ask(card.title, true)}><small>{card.knowledge_id ? '已有知识' : '拓展学习 · 点击生成'}</small><h3>{card.title} <span>↗</span></h3><p>{card.reason}</p><div>{card.preview}</div></button>)}</div> : <p className="subtle">暂未形成有效关联推荐。生成接口可补充拓展；不会用无关知识凑数。</p>}</section>}
          <section className="knowledge-section"><div className="section-title"><h2>{section === '探索' ? '知识，正在这里生长' : `${section}列表`} <span className="count">{items.length}</span></h2><input className="inline-search" aria-label="筛选已有知识" placeholder="⌕  搜索已有知识" value={filter} onChange={event => setFilter(event.target.value)} /></div>
            {items.length ? <div className="knowledge-grid">{items.map(item => <button className={`knowledge-card ${selected?.id === item.id ? 'chosen' : ''}`} key={item.id} onClick={() => void openItem(item.id)}><div><span className="knowledge-icon">{item.generated ? '✧' : '▤'}</span><span className={`bucket bucket-${item.bucket}`}>{item.bucket}</span></div><h3>{item.title}</h3><p>{item.content}</p><footer><span>{item.generated ? 'AI 生成' : '个人笔记'}{item.edited ? ' · 已编辑' : ''}</span><span>{new Date(item.updated_at).toLocaleDateString('zh-CN')}</span></footer></button>)}</div>
              : <div className="empty-state"><div className="empty-symbol">▤</div><h3>{filter ? '没有找到匹配的知识' : '为你的第一个想法，留一个位置'}</h3><p>{filter ? '试试其他关键词；当前未启用语义检索。' : '新建一条笔记，或配置 API 后提问。完整的新知识会自动积累。'}</p><button className="secondary" onClick={() => setEditor({ title: '', content: '' })}>＋ 写下第一条知识</button></div>}
          </section>
        </>}
        {section === '资料库' && <><div className="page-heading"><div><div className="eyebrow">YOUR SOURCES</div><h1>留下值得反复阅读的资料。</h1><p>本次附件默认临时使用。主动点击“保留”后，原文件副本与文字才会留在这里。</p></div></div><div className="source-list">{sources.length ? sources.map(source => <article className="source-row" key={source.id}><span className="file-icon">▱</span><div><h3>{source.name}</h3><p>{source.blocks} 个片段 · {new Date(source.created_at).toLocaleString('zh-CN')}</p>{source.warnings.length > 0 && <details><summary>解析说明</summary>{source.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}</div><button className="danger-text" onClick={() => {
          if (confirm('删除应用保存的资料副本和检索片段？已有知识及其引用摘录保留，用户原文件不会删除。')) void guarded(async () => {
            setSources(await api.request<Source[]>('sources.delete', { id: source.id })); setAttachments(current => current.map(a => a.id === source.id ? { ...a, retained: false } : a)); setSelected(null); setAnswer(null)
          })
        }}>删除资料</button></article>) : <div className="empty-state"><div className="empty-symbol">▱</div><h3>还没有长期保留的资料</h3><p>在探索页加入附件，解析后点击“保留”。临时文件不会自动进入资料库。</p></div>}</div></>}
        {section === 'API 配置' && <><div className="page-heading"><div><div className="eyebrow">MODEL CONNECTIONS</div><h1>选择适合你的思考伙伴。</h1><p>按实际接口协议配置模型。外部调用会发送问题及选定的相关片段。</p></div></div><div className="settings-grid"><section className="panel"><h2>已保存的接口</h2>{providers.length ? providers.map(provider => <article className="provider-card" key={provider.id}><h3>{provider.name} {provider.active ? <span className="pill">使用中</span> : null}</h3><p>{provider.protocol} · {provider.model}</p><small>{provider.base_url}</small><div className="provider-actions"><button disabled={provider.active} onClick={() => void guarded(async () => setProviders(await api.request<Provider[]>('providers.select', { id: provider.id })))}>设为当前</button><button disabled={!!busy} onClick={() => {
          const id = crypto.randomUUID(); activeRequest.current = id; setBusy(id)
          void guarded(async () => { const value = await api.request<{ message: string }>('providers.test', { id: provider.id }, id); setMessage(value.message) }).finally(() => { activeRequest.current = null; setBusy(null) })
        }}>测试连接（会调用 API）</button><button className="danger-text" onClick={() => { if (confirm('删除接口配置和 Windows 中保存的凭据？知识不受影响。')) void guarded(async () => setProviders(await api.request<Provider[]>('providers.delete', { id: provider.id }))) }}>删除</button></div></article>) : <p className="subtle">尚未配置。本地知识编辑与关键词检索仍可使用。</p>}<div className="info-box">API Key 保存在 Windows 凭据管理器。生成接口连通不等于支持向量检索；本测试版仅使用关键词检索。</div></section>
          <form className="panel provider-form" onSubmit={event => { event.preventDefault(); setSaving(true); void guarded(async () => { setProviders(await api.request<Provider[]>('providers.save', providerForm)); setProviderForm(blankProvider); setMessage('配置已保存，凭据未写入普通配置文件') }).finally(() => setSaving(false)) }}><h2>添加接口</h2>
            <label>配置名称<input required maxLength={80} placeholder="例如：我的 GPT 接口" value={providerForm.name} onChange={e => setProviderForm({ ...providerForm, name: e.target.value })} /></label>
            <label>实际接口协议<select value={providerForm.protocol} onChange={e => setProviderForm({ ...providerForm, protocol: e.target.value as Provider['protocol'] })}><option value="responses">OpenAI Responses</option><option value="chat-completions">Chat Completions 兼容接口</option><option value="anthropic">Anthropic Messages</option></select></label>
            <label>基础地址（包含 /v1 等前缀）<input required type="url" value={providerForm.base_url} onChange={e => setProviderForm({ ...providerForm, base_url: e.target.value })} /></label>
            <label>模型 ID<input required maxLength={160} placeholder="填写接口支持的实际模型 ID" value={providerForm.model} onChange={e => setProviderForm({ ...providerForm, model: e.target.value })} /></label>
            <label>API Key<input required type="password" autoComplete="off" value={providerForm.key} onChange={e => setProviderForm({ ...providerForm, key: e.target.value })} /></label>
            <div className="price-inputs"><label>输入 / 百万 token<input type="number" min="0" step="any" placeholder="未知留空" value={providerForm.input_price} onChange={e => setProviderForm({ ...providerForm, input_price: e.target.value })} /></label><label>输出 / 百万 token<input type="number" min="0" step="any" placeholder="未知留空" value={providerForm.output_price} onChange={e => setProviderForm({ ...providerForm, output_price: e.target.value })} /></label><label>币种<select value={providerForm.currency} onChange={e => setProviderForm({ ...providerForm, currency: e.target.value })}>{['USD', 'CNY', 'EUR'].map(c => <option key={c}>{c}</option>)}</select></label></div><p className="subtle">价格由你填写，用于估算；不代表供应商账单。DeepSeek / Grok 等请按其实际兼容协议填写。</p><button className="primary" disabled={saving}>保存接口</button>
          </form></div></>}
        {section === '用量统计' && <><div className="page-heading"><div><div className="eyebrow">USAGE & COSTS</div><h1>每一次调用，都心中有数。</h1><p>最近 500 次调用。缺失用量显示未知，费用按请求时价格估算，各币种分别统计。</p></div><button onClick={() => void loadUsage()}>刷新记录</button></div><div className="usage-summary"><div><small>调用次数</small><strong>{attempts.length}</strong></div><div><small>成功调用</small><strong>{attempts.filter(a => a.status === 'success').length}</strong></div>{['USD', 'CNY', 'EUR'].map(currency => <div key={currency}><small>{currency} 已知费用估算</small><strong>{attempts.filter(a => a.currency === currency && a.cost !== null).reduce((sum, a) => sum + (a.cost ?? 0), 0).toFixed(6)}</strong></div>)}</div><div className="table-wrap"><table><thead><tr>{['时间 / 用途', '接口 / 模型', '结果', '输入', '输出', '耗时', '费用估算'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{attempts.map(a => <tr key={a.id}><td>{new Date(a.started_at).toLocaleString('zh-CN')}<small>{a.purpose}</small></td><td>{a.provider}<small>{a.model}</small></td><td>{a.status}</td><td>{a.input_tokens ?? '未知'}</td><td>{a.output_tokens ?? '未知'}</td><td>{a.elapsed_ms} ms</td><td>{a.cost === null ? '未知' : `${a.currency} ${a.cost.toFixed(6)}`}</td></tr>)}</tbody></table>{!attempts.length && <div className="empty-state"><h3>还没有调用记录</h3><p>本地搜索和编辑知识不会产生 API 用量。</p></div>}</div></>}
        <footer className="page-footer">知序 <span>·</span> 让知识有序，让思考自由。<details><summary>存储位置与测试版边界</summary><p>{dataDir}</p><p>MD / TXT / DOCX / 文字版 PDF；单文件 50MB，PDF 200 页，单次上下文约 28000 字。未接入 OCR、语义索引或安装包，真实接口需自行配置验证。</p></details></footer>
      </div>
    </main>
    {editor && <div className="modal-backdrop"><form className="modal editor" onSubmit={saveNote}><div className="modal-heading"><h2>{editor.id ? '编辑知识' : '新建知识'}</h2><button type="button" onClick={() => setEditor(null)} aria-label="关闭编辑">×</button></div><label>标题<input autoFocus required maxLength={160} value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })} /></label><label>知识正文<textarea required maxLength={120000} value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} placeholder="写下概念、思考、例子，或待解决的问题…" /></label><p className="subtle">内容仅保存在本地；同标题或完全相同内容会复用已有知识。</p><div className="modal-actions"><button type="button" onClick={() => setEditor(null)}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存知识'}</button></div></form></div>}
    {citation && <div className="modal-backdrop"><section className="modal"><div className="modal-heading"><h2>{citation.name}</h2><button onClick={() => setCitation(null)} aria-label="关闭引用">×</button></div><p className="citation-locator">{citation.locator}</p><div className="reading-text">{citation.text}</div><p className="info-box">{citation.source_id.startsWith('knowledge') || citation.name.startsWith('知识库') ? '来自本地知识条目的引用摘录。' : citation.retained ? '显示引用时保存的证据摘录；完整资料已保留在应用资料库。' : '引用摘录已保留。完整原文未长期保存；需要时可重新加入同一文件。'}</p></section></div>}
    {pathEntry !== null && <div className="modal-backdrop"><form className="modal" onSubmit={event => { event.preventDefault(); const value = pathEntry; setPathEntry(null); void addFiles([value]) }}><div className="modal-heading"><h2>加入本地文档</h2><button type="button" onClick={() => setPathEntry(null)} aria-label="关闭路径输入">×</button></div><label>文件绝对路径<input autoFocus required value={pathEntry} onChange={event => setPathEntry(event.target.value)} placeholder="D:\资料\笔记.md" /></label><p className="subtle">也可将本地路径直接粘贴到问题输入框，或拖入文件。网络 URL 不受支持。</p><button className="primary">解析并加入</button></form></div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
