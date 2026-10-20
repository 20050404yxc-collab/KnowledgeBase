// 文件：index.ts
// 层：Electron 启动装配
// 作用：连接窗口、受限 IPC 和 Python 桥接。
// 说明：保持单实例和既有用户数据位置。
import { app, dialog, type BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { registerIpc } from './ipc_gateway'
import { createWindow } from './window_manager'
import { WorkerBridge } from './worker_bridge'

app.setName('KnowledgeBase')
let window: BrowserWindow | null = null
let bridge: WorkerBridge | undefined
let quitting = false

// 应用就绪后装配；窗口关闭触发后台有界退出。
function startDesktop(): void {
  bridge = new WorkerBridge(
    resolve(__dirname, '../..'),
    process.env.KB_DATA_DIR || app.getPath('userData'),
    (event) => window?.webContents.send('kb:event', event)
  )
  registerIpc(() => window, bridge)
  window = createWindow()
  window.on('closed', () => {
    window = null
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
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
    .catch(() => {
      dialog.showErrorBox('启动失败', '无法初始化桌面程序，请检查运行环境后重新启动。')
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting || !bridge) {
      return
    }
    event.preventDefault()
    quitting = true
    void bridge
      .stop()
      .catch(() => {
        console.error('后台关闭失败；请检查本应用后台是否已退出。')
      })
      .finally(() => app.quit())
  })
}
