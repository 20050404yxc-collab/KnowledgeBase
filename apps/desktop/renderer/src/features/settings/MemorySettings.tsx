// 文件：MemorySettings.tsx
// 层：React 页面／组件
// 作用：管理明确偏好、兴趣摘要和显式本地语义资源任务。
// 说明：模型准备可取消，离开面板不把晚到结果写入已卸载视图。
import { useEffect, useRef, useState } from 'react'
import type {
  MemorySettings as Preferences,
  MemoryState,
  SemanticStatus
} from '../../../../../../contracts/memory'
import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 请求所有权限于当前面板；模型任务与其他生成入口共用应用任务锁。
function useMemorySettings() {
  const app = useAppContext()
  const [memory, setMemory] = useState<MemoryState | null>(null)
  const [semantic, setSemantic] = useState<SemanticStatus | null>(null)
  const mounted = useRef(true)
  const refresh = async () => {
    const [m, s] = await Promise.all([api.request('memory.get'), api.request('semantic.status')])
    if (mounted.current) {
      setMemory(m)
      setSemantic(s)
    }
  }
  useEffect(() => {
    mounted.current = true
    void app.guarded(refresh)
    return () => {
      mounted.current = false
    }
  }, [])
  // 每次只提交实际改动字段，避免旧完整表单覆盖较新设置。
  const update = (value: Partial<Preferences>) =>
    app.runTask(async () => {
      const result = await app.taskRequest('memory.update', value)
      if (mounted.current) {
        setMemory(result)
      }
      await app.reload()
    })
  const clear = (scope: 'questions' | 'reading' | 'all') => {
    if (
      !confirm(
        scope === 'all'
          ? '清空全部偏好和兴趣统计？知识与聊天不受影响。'
          : '清空这类兴趣统计？知识不受影响。'
      )
    ) {
      return
    }
    void app.runTask(async () => {
      const result = await app.taskRequest('memory.clear', { scope })
      if (mounted.current) {
        setMemory(result)
      }
      await app.reload()
    })
  }
  const build = (prepare: boolean) =>
    app.runTask(async () => {
      try {
        const result = await app.taskRequest(prepare ? 'semantic.prepare' : 'semantic.rebuild', {})
        if (mounted.current) {
          setSemantic(result)
        }
      } finally {
        await refresh()
      }
    })
  return { memory, semantic, update, clear, build, locked: !!app.busy }
}

// 明确偏好独立开关，题型汇总只用于本地推荐，不向外发送统计。
export function MemorySettings() {
  const state = useMemorySettings()
  const { memory, locked } = state
  return (
    <section className="panel memory-settings" aria-label="记忆与检索">
      <h2>本地长期记忆</h2>
      <p>偏好与兴趣保存在这台电脑。仅记录主题、题型和阅读天数，不保存原始问题或聊天。</p>
      {memory ? (
        <>
          <PreferenceControls settings={memory.settings} update={state.update} locked={locked} />
          <h3>常问主题与题型</h3>
          <ul>
            {memory.topics.map((item) => (
              <li key={`${item.topic}:${item.kind}`}>
                {item.topic} · {item.kind} · {item.count} 次 · 最近 {item.last_used}
              </li>
            ))}
          </ul>
          {!memory.topics.length && <p>暂无提问统计；无可靠主题的问法记为未分类。</p>}
          <p>累计主动阅读 {memory.reading_days} 天次，同一知识每天计一次。</p>
          <p>探索页按近期常问、常看排序，最多三排；全部内容可进入知识库查看。</p>
          <button disabled={locked} onClick={() => state.clear('questions')}>
            清空提问统计
          </button>
          <button disabled={locked} onClick={() => state.clear('reading')}>
            清空阅读统计
          </button>
          <button disabled={locked} onClick={() => state.clear('all')}>
            清空全部记忆
          </button>
        </>
      ) : (
        <p role="status">正在读取记忆…</p>
      )}
      <SemanticControls {...state} />
    </section>
  )
}

// 固定选项不接受任意系统指令，直接问题的明确要求优先。
function PreferenceControls({
  settings,
  update,
  locked
}: {
  settings: Preferences
  update: (value: Partial<Preferences>) => Promise<void>
  locked: boolean
}) {
  return (
    <fieldset disabled={locked}>
      <legend>记录与回答偏好</legend>
      {(['preferences_enabled', 'questions_enabled', 'reading_enabled'] as const).map(
        (key, index) => (
          <label key={key} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => void update({ [key]: event.target.checked })}
            />
            {['使用回答偏好', '记录提问主题与题型', '记录主动阅读'][index]}
          </label>
        )
      )}
      {(['language', 'detail', 'examples'] as const).map((key, index) => (
        <label key={key}>
          {['语言', '详略', '示例'][index]}
          <select
            aria-label={['偏好语言', '回答详略', '示例偏好'][index]}
            value={settings[key]}
            onChange={(event) => {
              const value = event.target.value
              // 只从已声明选项获取对应字面量，防止字符串断言绕过契约。
              const choice = preferenceChoices[key].find((item) => item === value)
              if (choice) {
                void update({ [key]: choice })
              }
            }}
          >
            {preferenceChoices[key].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  )
}

const preferenceChoices = {
  language: ['中文', 'English', '跟随问题'],
  detail: ['简洁', '适中', '详细'],
  examples: ['按需', '多举例', '少举例']
} as const

// 显式下载固定资源并校验后建索引，普通问题和状态刷新不访问模型托管站。
function SemanticControls({ semantic, build, locked }: ReturnType<typeof useMemorySettings>) {
  return (
    <div className="semantic-settings">
      <h2>本地语义检索</h2>
      <p>BGE-small-zh-v1.5 INT8 · CPU 离线运行 · 模型资源约 24.34 MB（小于 100 MB）。</p>
      <p>先检索，再向 AI 发送最多五段相关摘录。模型未准备或索引缺失时，自动使用关键词并提示。</p>
      <p>首次准备需要联网下载；知识变动后可重建索引。相似度表示相关性，不代表答案正确。</p>
      {semantic && (
        <p role="status">
          {semantic.ready ? '模型文件已就绪' : '模型尚未准备'} · 已索引 {semantic.indexed}/
          {semantic.documents} 个来源 · {semantic.vectors} 个片段
        </p>
      )}
      <button disabled={locked} onClick={() => void build(true)}>
        准备 INT8 模型并建索引
      </button>
      <button disabled={locked || !semantic?.ready} onClick={() => void build(false)}>
        重建语义索引
      </button>
    </div>
  )
}
