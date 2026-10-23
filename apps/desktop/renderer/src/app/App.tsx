// 文件：App.tsx
// 层：React 页面／组件
// 作用：组合会话上下文、导航、反馈与页面布局。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api, errorText } from '../shared/api/client'
import { useAppContext } from './AppContext'

import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ExplorationPage } from '../features/exploration/ExplorationPage'
import { KnowledgePage } from '../features/knowledge/KnowledgePage'
import { isBucket } from '../../../shared/protocol_validation'
import { SourcesPage } from '../features/sources/SourcesPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { UsagePage } from '../features/usage/UsagePage'
import { PageFooter } from './PageFooter'
import { NoteEditor } from '../features/knowledge/NoteEditor'
import { CitationDialog } from '../features/knowledge/CitationDialog'
import { PathDialog } from '../features/exploration/PathDialog'
import { AppContext } from './AppContext'
import { useAppModel } from './use_app_model'
import { LibraryPage } from '../features/knowledge/LibraryPage'
import { TaskStatus } from './TaskStatus'
import { useCallback, useState } from 'react'
import { SearchPage } from '../features/search/SearchPage'
import { RecoverySettings } from '../features/settings/RecoverySettings'
import { SelectionPanel } from '../features/selection'

// 组合会话上下文、导航、反馈与页面布局。
export function App() {
  const [session, setSession] = useState(0)
  const resetSession = useCallback(() => setSession((value) => value + 1), [])
  return <AppSession key={session} resetSession={resetSession} />
}

// 恢复后重建所有页面状态，不通过窗口导航放开沙箱或保留旧知识选择。
function AppSession({ resetSession }: { resetSession: () => void }) {
  const model = useAppModel(resetSession)
  return (
    <AppContext.Provider value={model}>
      <AppShell />
    </AppContext.Provider>
  )
}
// 根布局只组合导航、页面与对话框。
function AppShell() {
  const { setError, section, editor, citation, busy, pathEntry, addFiles } = useAppContext()
  return (
    <div
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (section !== '探索' || busy) {
          return
        }
        try {
          void addFiles(api.pathsForFiles(Array.from(event.dataTransfer.files)))
        } catch (err) {
          setError(errorText(err))
        }
      }}
    >
      <Sidebar />
      <main>
        <Topbar />
        <AppContent />
        <TaskStatus />
      </main>
      <SelectionPanel />
      {editor && <NoteEditor key={section} />}
      {citation && <CitationDialog />}
      {(section === '探索' || isBucket(section)) && pathEntry !== null && <PathDialog />}
    </div>
  )
}

// 内容区负责页面选择，具体功能由各页面处理。
function AppContent() {
  const { error, setError, message, setMessage, ready, boot, section } = useAppContext()
  return (
    <div className="content">
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="关闭错误">
            ×
          </button>
        </div>
      )}
      {message && (
        <div className="alert success" role="status">
          {message}
          <button onClick={() => setMessage('')} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
      {!ready && (
        <div className="startup">
          <p>正在启动本地知识后台…</p>
          <button onClick={() => void boot()}>重新连接</button>
        </div>
      )}
      {section === '探索' && <ExplorationPage />}
      {section === '知识库' && <LibraryPage />}
      {isBucket(section) && <KnowledgePage key={section} />}
      {section === '资料库' && <SourcesPage />}
      {section === '搜索' && <SearchPage />}
      {section === '回收站' && (
        <section className="panel">
          <h1>回收站</h1>
          <RecoverySettings mode="trash" />
        </section>
      )}
      {section === '设置' && <SettingsPage />}
      {section === '用量统计' && <UsagePage />}
      <PageFooter />
    </div>
  )
}
