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
import { ProvidersPage } from '../features/providers/ProvidersPage'
import { UsagePage } from '../features/usage/UsagePage'
import { PageFooter } from './PageFooter'
import { NoteEditor } from '../features/knowledge/NoteEditor'
import { CitationDialog } from '../features/knowledge/CitationDialog'
import { PathDialog } from '../features/exploration/PathDialog'
import { AppContext } from './AppContext'
import { useAppModel } from './use_app_model'

// 组合会话上下文、导航、反馈与页面布局。
export function App() {
  const model = useAppModel()
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
      </main>
      {editor && <NoteEditor />}
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
      {isBucket(section) && <KnowledgePage key={section} />}
      {section === '资料库' && <SourcesPage />}
      {section === 'API 配置' && <ProvidersPage />}
      {section === '用量统计' && <UsagePage />}
      <PageFooter />
    </div>
  )
}
