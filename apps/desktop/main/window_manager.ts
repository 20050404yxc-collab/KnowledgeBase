// 文件：window_manager.ts
// 层：Electron 桌面宿主
// 作用：创建窗口并限制导航和外部窗口。
// 说明：保持沙箱、上下文隔离及禁用 renderer Node。
import { BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'

// 只加载构建产物或开发服务器，不开放额外浏览器能力。
export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#f7f8fa',
    title: '知序 · test0.03',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  // 加载失败可观察且有关闭路径，不让加载 Promise 的拒绝无人处理。
  const loading = process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(process.env.ELECTRON_RENDERER_URL)
    : window.loadFile(join(__dirname, '../renderer/index.html'))
  void loading.catch(() => {
    if (!window.isDestroyed()) {
      dialog.showErrorBox('页面加载失败', '请重新构建项目并启动，或检查开发服务器是否可用。')
      window.close()
    }
  })
  return window
}
