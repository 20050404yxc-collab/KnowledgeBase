// 文件：SettingsPage.tsx
// 层：React 页面／组件
// 作用：集中展示 API 配置和实际存储、日志位置。
// 说明：路径只读；打开目录通过受限桌面能力执行。
import { useEffect, useState } from 'react'
import type { StoragePaths, StorageDirectory } from '../../../../../../contracts/desktop'
import { ProviderSettings } from '../providers'
import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'
import { BackupGuide } from './BackupGuide'
import { RecoverySettings } from './RecoverySettings'
import { MemorySettings } from './MemorySettings'

const SETTINGS_TABS = [
  ['api', 'API 配置'],
  ['storage', '存储与日志'],
  ['backup', '备份与恢复'],
  ['memory', '记忆与检索']
] as const

// 页内切换保持未保存接口草稿的状态，离开 API 表单仍取消模型发现。
export function SettingsPage() {
  const [tab, setTab] = useState('api')
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <h1>设置</h1>
          <p>管理模型接口、可选价格，以及本地存储与日志位置。</p>
        </div>
      </div>
      <SettingsTabs tab={tab} setTab={setTab} />
      <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-${tab}`}>
        {tab === 'api' && (
          <>
            <QuickStart />
            <ProviderSettings />
          </>
        )}
        {tab === 'storage' && <StorageSettings />}
        {tab === 'memory' && <MemorySettings />}
        {tab === 'backup' && (
          <section className="panel">
            <BackupGuide />
            <RecoverySettings mode="backup" />
          </section>
        )}
      </div>
    </>
  )
}

// 设置页使用单一 Tab 焦点；方向键循环切换，Home / End 到达边界。
function SettingsTabs({ tab, setTab }: { tab: string; setTab: (value: string) => void }) {
  return (
    <div className="settings-tabs" role="tablist" aria-label="设置分类">
      {SETTINGS_TABS.map(([value, label], index) => (
        <button
          key={value}
          id={`settings-${value}`}
          role="tab"
          aria-controls="settings-panel"
          aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => setTab(value)}
          onKeyDown={(event) => {
            // 只消费 Tab 导航键，保留浏览器其他快捷键与普通 Tab 移动。
            const next = nextSettingsTab(event.key, index)
            if (next !== null) {
              event.preventDefault()
              setTab(SETTINGS_TABS[next][0])
              document.getElementById(`settings-${SETTINGS_TABS[next][0]}`)?.focus()
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// 只为受支持的导航键计算有效索引，不把任意按键当作数组偏移。
function nextSettingsTab(key: string, index: number): number | null {
  // Home / End 直接定位首尾，不受当前索引影响。
  if (key === 'Home') {
    return 0
  }
  if (key === 'End') {
    return SETTINGS_TABS.length - 1
  }
  // 左右方向循环导航；其他键交回浏览器处理。
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    const offset = key === 'ArrowRight' ? 1 : -1
    return (index + offset + SETTINGS_TABS.length) % SETTINGS_TABS.length
  }
  return null
}

// 未启用模型时给出完整起步路径；本地记录与搜索始终可用，不读取或提交密钥。
function QuickStart() {
  const { ready, activeProvider, setSection } = useAppContext()
  if (!ready || activeProvider) {
    return null
  }
  return (
    <aside className="quick-start" aria-labelledby="quick-start-title">
      <h2 id="quick-start-title">快速开始：让 AI 帮你整理与学习</h2>
      <p>
        知序把笔记、资料和学习结果保存在本地。配置自己的 AI 接口后，可直接提问或先生成学习目录。
      </p>
      <ol>
        <li>选择接口模板或填写兼容地址</li>
        <li>填写 API Key 和模型，保存并启用接口</li>
        <li>返回探索，选择知识来源后提问；模型调用可能产生费用</li>
      </ol>
      <div className="first-use-actions">
        <button
          className="primary"
          onClick={() => document.querySelector<HTMLElement>('.provider-form input')?.focus()}
        >
          开始配置 AI 接口
        </button>
        <button onClick={() => setSection('知识库')}>先使用本地知识库</button>
      </div>
      <p>暂不配置也可以新建笔记、阅读和全文检索。</p>
    </aside>
  )
}

// 异步读取只在本面板有效时显示；失败通过既有反馈显示请求编号。
function StorageSettings() {
  const [paths, setPaths] = useState<StoragePaths | null>(null)
  const { guarded } = useAppContext()
  useEffect(() => {
    let current = true
    void guarded(async () => {
      const value = await api.storagePaths()
      // 面板卸载后的晚到结果不再更新路径状态。
      if (current) {
        setPaths(value)
      }
    })
    return () => {
      current = false
    }
  }, [])
  return (
    <section className="panel storage-settings">
      <h2>本地存储与日志</h2>
      <p className="subtle">显示当前实际使用的位置，支持在文件管理器中打开目录。</p>
      {paths ? (
        <>
          <PathRow label="本地数据目录" path={paths.data} directory="data" />
          <PathRow label="知识数据库" path={paths.database} />
          <PathRow label="资料副本目录" path={paths.sources} directory="sources" />
          <PathRow label="日志目录" path={paths.logs} directory="logs" />
          <p className="subtle">
            每次启动新建日志，按日期和当天序号命名；自动清理超过 14 天的日志。
          </p>
          <p className="info-box">
            API Key 保存在 Windows 凭据管理器，普通配置不保存密钥。当前目录只读展示。
          </p>
        </>
      ) : (
        <p role="status">正在读取存储位置…</p>
      )}
    </section>
  )
}

// 按固定目录标识打开，不将显示的路径作为可执行输入。
function PathRow({
  label,
  path,
  directory
}: {
  label: string
  path: string
  directory?: StorageDirectory
}) {
  const { guarded } = useAppContext()
  const [opening, setOpening] = useState(false)
  const open = async () => {
    if (!directory || opening) {
      return
    }
    setOpening(true)
    await guarded(() => api.openDirectory(directory))
    setOpening(false)
  }
  return (
    <div className="storage-row">
      <div>
        <b>{label}</b>
        <code>{path}</code>
      </div>
      {directory && (
        <button disabled={opening} onClick={() => void open()} aria-label={`打开${label}`}>
          打开目录
        </button>
      )}
    </div>
  )
}
