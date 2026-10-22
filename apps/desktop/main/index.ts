// 文件：index.ts
// 层：Electron 启动装配
// 作用：连接窗口、受限 IPC 和 Python 桥接。
// 说明：保持单实例和既有用户数据位置。
import { app, dialog, type BrowserWindow } from 'electron'
import { dirname, resolve } from 'node:path'
import { registerIpc } from './ipc_gateway'
import { createWindow } from './window_manager'
import { registerStorageIpc } from './storage_settings'
import { WorkerBridge } from './worker_bridge'
import { configureDiagnostics, diagnostic, flushDiagnostics } from './diagnostics'
import { markDatabaseInitialized, resolveStorageLocation } from './storage_location'
import { workerRuntime } from './worker_runtime'

app.setName('KnowledgeBase')
let window: BrowserWindow | null = null
let bridge: WorkerBridge | undefined
let quitting = false
// 应用就绪后装配；窗口关闭触发后台有界退出。
async function startDesktop(): Promise<void> {
  // 安装定位失败先停止启动，不允许日志或后台静默落入另一个数据目录。
  const location = await resolveStorageLocation({
    packaged: app.isPackaged,
    profile: app.getPath('userData'),
    program: dirname(process.execPath),
    environment: process.env
  })
  configureDiagnostics(location.data)
  diagnostic('desktop.start', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node
  })
  diagnostic('desktop.ready')
  const root = resolve(__dirname, '../..')
  const runtime = workerRuntime(root, app.isPackaged ? process.resourcesPath : undefined)
  runtime.ready = () => markDatabaseInitialized(location)
  bridge = new WorkerBridge(
    root,
    location.data,
    (event) => window?.webContents.send('kb:event', event),
    runtime
  )
  registerIpc(() => window, bridge)
  registerStorageIpc(() => window, location.data)
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
      dialog.showErrorBox(
        '启动失败',
        '无法读取安装时确认的数据位置或初始化桌面程序。请检查原数据磁盘、目录权限，或重新运行安装包修复；不会改用空知识库。'
      )
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
