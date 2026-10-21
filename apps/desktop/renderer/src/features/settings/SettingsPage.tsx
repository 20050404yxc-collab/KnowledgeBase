// 文件：SettingsPage.tsx
// 层：React 页面／组件
// 作用：集中展示 API 配置和实际存储、日志位置。
// 说明：路径只读；打开目录通过受限桌面能力执行。
import { useEffect, useState } from 'react'
import type { StoragePaths, StorageDirectory } from '../../../../../../contracts/desktop'
import { ProviderSettings } from '../providers'
import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

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
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        <button role="tab" aria-selected={tab === 'api'} onClick={() => setTab('api')}>
          API 配置
        </button>
        <button role="tab" aria-selected={tab === 'storage'} onClick={() => setTab('storage')}>
          存储与日志
        </button>
      </div>
      {tab === 'api' ? <ProviderSettings /> : <StorageSettings />}
    </>
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
