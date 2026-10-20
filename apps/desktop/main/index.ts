// 文件：index.ts
// 层：Electron 启动装配
// 作用：连接窗口、受限 IPC 和 Python 桥接。
// 说明：保持单实例和既有用户数据位置。
import { app, dialog, type BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { registerIpc } from './ipc_gateway'
import { createWindow } from './window_manager'
import { registerStorageIpc } from './storage_settings'
import { WorkerBridge } from './worker_bridge'
import { configureDiagnostics, diagnostic, flushDiagnostics } from './diagnostics'

app.setName('KnowledgeBase')
let window: BrowserWindow | null = null
let bridge: WorkerBridge | undefined
let quitting = false
// 应用就绪后装配；窗口关闭触发后台有界退出。
function startDesktop(): void {
  diagnostic('desktop.ready')
  bridge = new WorkerBridge(
    resolve(__dirname, '../..'),
    process.env.KB_DATA_DIR || app.getPath('userData'),
    (event) => window?.webContents.send('kb:event', event)
  )
  registerIpc(() => window, bridge)
  registerStorageIpc(() => window, process.env.KB_DATA_DIR || app.getPath('userData'))
  window = createWindow()
  window.on('closed', () => {
    diagnostic('window.closed')
    window = null
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 取得单实例锁后才拥有日志文件，第二个启动器不能竞争轮转。
  configureDiagnostics(process.env.KB_DATA_DIR || app.getPath('userData'))
  diagnostic('desktop.start', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node
  })
  // 异常仅提取代码位置；捕获器不擅自把未完成业务显示为成功。
  process.on('uncaughtExceptionMonitor', (error) =>
    diagnostic('desktop.uncaught_exception', {}, error)
  )
  process.on('unhandledRejection', (error: unknown) =>
    diagnostic('desktop.unhandled_rejection', {}, error)
  )
  app.on('second-instance', () => {
    if (window?.isMinimized()) {
      window.restore()
    }
    window?.focus()
  })
  // 启动失败给出恢复入口，避免留下未处理 Promise 和不可操作的窗口。
  void app
    .whenReady()
    .then(startDesktop)
    .catch((error: unknown) => {
      diagnostic('desktop.start_failed', {}, error)
      dialog.showErrorBox('启动失败', '无法初始化桌面程序，请检查运行环境后重新启动。')
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting) {
      return
    }
    event.preventDefault()
    quitting = true
    diagnostic('desktop.stopping')
    void (bridge?.stop() ?? Promise.resolve())
      .catch((error: unknown) => {
        diagnostic('desktop.stop_failed', {}, error)
      })
      .then(() => {
        diagnostic('desktop.stopped')
        return flushDiagnostics()
      })
      .finally(() => app.quit())
  })
}
