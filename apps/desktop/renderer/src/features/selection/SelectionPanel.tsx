// 文件：SelectionPanel.tsx
// 层：React 页面／组件
// 作用：展示当前页选区会话、免费本地候选和明确的模型回退。
// 说明：回复完整后才允许保存；会话切换不改写来源快照。
import type { SelectionTurn } from '../../../../../../contracts/selection'
import type { Attempt } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { MarkdownContent } from '../knowledge'
import { ModelPicker } from '../providers'
import { SelectionCapture } from './SelectionCapture'
import type { ChatEntry } from './use_selection_questions'

// 收起仅隐藏当前面板；按发起页重新进入原会话。
export function SelectionPanel() {
  const { selectionChat: chat, section } = useAppContext()
  const entries = chat.entries.filter((item) => item.owner === section)
  const entry = entries.find((item) => item.session.id === chat.active[section]) ?? entries.at(-1)
  if (!chat.visible || (!entries.length && !chat.openingError)) {
    return entries.length ? (
      <button className="selection-reopen" onClick={() => chat.setVisible(true)}>
        选区问答（{entries.length}）
      </button>
    ) : null
  }
  return (
    <aside className="selection-panel" aria-label="选区问答">
      <div className="section-title">
        <h2>选区问答</h2>
        <button onClick={() => chat.setVisible(false)}>收起问答</button>
      </div>
      {chat.openingError && <p role="alert">{chat.openingError}</p>}
      {!!entries.length && (
        <label>
          当前会话
          <select
            aria-label="选区会话"
            value={entry?.session.id}
            onChange={(event) =>
              chat.setActive((items) => ({ ...items, [section]: event.target.value }))
            }
          >
            {entries.map((item, index) => (
              <option key={item.session.id} value={item.session.id}>
                {index + 1} · {item.session.source_title}
              </option>
            ))}
          </select>
        </label>
      )}
      {entry && <SelectionConversation entry={entry} />}
      {entry?.preview && <SelectionCapture entry={entry} />}
    </aside>
  )
}

// 当前问题输入和错误均归会话所有；发送后历史在下方依次保留。
function SelectionConversation({ entry }: { entry: ChatEntry }) {
  const { selectionChat: chat, busy, progress, streamChars, cancelTask } = useAppContext()
  const id = entry.session.id
  return (
    <>
      <p className="subtle">
        {entry.session.source_title} · {entry.session.locator}
      </p>
      <blockquote className="selection-quote">{entry.session.quote}</blockquote>
      <small>{entry.session.notice}</small>
      <SelectionModel />
      <div className="selection-turns">
        {entry.session.turns.map((turn) => (
          <SelectionReply key={turn.id} turn={turn} entry={entry} />
        ))}
      </div>
      {entry.error && (
        <p className="alert error" role="alert">
          {entry.error}
        </p>
      )}
      <form
        className="selection-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void chat.ask(entry, {
            action: 'lookup',
            turn_id: crypto.randomUUID(),
            question: entry.draft
          })
        }}
      >
        <label>
          继续提问
          <textarea
            aria-label="选区问题"
            value={entry.draft}
            maxLength={12000}
            onChange={(event) => chat.patch(id, { draft: event.target.value })}
            placeholder="想理解什么？可以接着上文追问。"
          />
        </label>
        <small>先免费搜索本地知识；成功检索无结果时自动询问当前模型。模型调用可能产生费用。</small>
        <button className="primary" disabled={!!busy || !entry.draft.trim()}>
          发送问题
        </button>
      </form>
      {busy && (
        <p role="status">
          {progress} {streamChars ? `· 已接收 ${streamChars} 字符，等待完整回复` : ''}
          <button onClick={() => void cancelTask()}>取消当前任务</button>
        </p>
      )}
      <button
        className="danger-text"
        disabled={!!busy || chat.savingId === id}
        onClick={() => {
          if (confirm('结束这个会话？未入库的聊天将移除，已保存知识保留。')) {
            void chat.close(entry)
          }
        }}
      >
        结束此会话
      </button>
    </>
  )
}

// 与现有入口共用临时模型选择；没有配置时仍可免费查询已有知识。
function SelectionModel() {
  const { activeProvider, generationOptions, busy, chooseModel, chooseEffort, setSection } =
    useAppContext()
  return activeProvider ? (
    <details className="selection-model">
      <summary>
        当前模型：{generationOptions.model || activeProvider.model || '待选择'} ·{' '}
        {activeProvider.name}
      </summary>
      <ModelPicker
        provider={activeProvider}
        value={generationOptions}
        disabled={!!busy}
        onModel={(model) => chooseModel(activeProvider, model)}
        onEffort={(effort) => chooseEffort(activeProvider, effort)}
      />
    </details>
  ) : (
    <p className="subtle">
      尚未配置模型，本地搜索仍可使用。
      <button onClick={() => setSection('设置')}>设置问答模型</button>
    </p>
  )
}

// 本地命中和模型回复明确标注；任何时候都不把片段包装成已验证答案。
function SelectionReply({ turn, entry }: { turn: SelectionTurn; entry: ChatEntry }) {
  const { selectionChat: chat, busy, setCitation } = useAppContext()
  return (
    <section className="selection-turn" aria-label="问答轮次">
      <h3>问：{turn.question}</h3>
      <p className="subtle">{turn.notice}</p>
      {!!turn.total && <LocalCandidates turn={turn} entry={entry} />}
      {turn.state === 'answered' ? (
        <>
          <small>
            模型回复 · {turn.provider_name} · {turn.model}
          </small>
          <MarkdownContent
            content={turn.content}
            citations={turn.citations}
            onCitation={setCitation}
          />
          <button
            disabled={!!busy || !!turn.saved_id}
            onClick={() => void chat.preview(entry, turn.id)}
          >
            {turn.saved_id ? '已入库' : '预览并保存回答'}
          </button>
        </>
      ) : (
        <button
          disabled={!!busy}
          onClick={() => void chat.ask(entry, { action: 'generate', turn_id: turn.id })}
        >
          {turn.state === 'local' ? '未解决，询问模型' : '询问模型／重试'}
        </button>
      )}
      {turn.state === 'lookup-failed' && (
        <button
          disabled={!!busy}
          onClick={() => void chat.ask(entry, { action: 'lookup', turn_id: turn.id })}
        >
          重新本地检索
        </button>
      )}
      {!!turn.attempts.length && <AttemptDetails attempts={turn.attempts} />}
    </section>
  )
}

// 每次调用独立展示已知用量和费用，缺失值保持未知，取消不推断免费。
function AttemptDetails({ attempts }: { attempts: Attempt[] }) {
  const states: Record<string, string> = {
    success: '响应完成',
    failed: '调用失败',
    cancelled: '已取消',
    interrupted: '已中断',
    running: '调用中'
  }
  return (
    <div className="selection-attempts">
      <small>实际调用 {attempts.length} 次</small>
      {attempts.map((item) => (
        <small key={item.id}>
          {states[item.status] ?? item.status} · 输入 {item.input_tokens ?? '未知'} / 输出{' '}
          {item.output_tokens ?? '未知'} token · 费用{' '}
          {item.cost === null ? '未知' : `${item.cost} ${item.currency}`}
        </small>
      ))}
    </div>
  )
}

// 候选分页覆盖全库，只有点击“携带摘录”才向模型发送对应片段。
function LocalCandidates({ turn, entry }: { turn: SelectionTurn; entry: ChatEntry }) {
  const { selectionChat: chat, busy, openItem } = useAppContext()
  return (
    <div className="selection-candidates">
      <strong>本地相关内容 · 共 {turn.total} 条 · 免费</strong>
      {turn.candidates.map((hit) => (
        <article key={hit.id}>
          <button disabled={!!busy} onClick={() => void openItem(hit.knowledge_id)}>
            {hit.title}
            {hit.kind === 'supplement' ? ' · 补充' : ''}
          </button>
          <small>{hit.category_path?.join(' → ') || hit.theme}</small>
          <p>{hit.excerpt}</p>
          {turn.state !== 'answered' && (
            <button
              disabled={!!busy}
              onClick={() =>
                void chat.ask(entry, { action: 'generate', turn_id: turn.id, candidate_id: hit.id })
              }
            >
              携带此摘录询问模型
            </button>
          )}
        </article>
      ))}
      <nav className="pagination" aria-label="相关知识分页">
        <button
          disabled={!!busy || turn.page === 0}
          onClick={() =>
            void chat.ask(entry, { action: 'page', turn_id: turn.id, page: turn.page - 1 })
          }
        >
          上页结果
        </button>
        <span>
          {turn.page + 1} / {Math.max(1, Math.ceil(turn.total / 10))}
        </span>
        <button
          disabled={!!busy || (turn.page + 1) * 10 >= turn.total}
          onClick={() =>
            void chat.ask(entry, { action: 'page', turn_id: turn.id, page: turn.page + 1 })
          }
        >
          下页结果
        </button>
      </nav>
    </div>
  )
}
