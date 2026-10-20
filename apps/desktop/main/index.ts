import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { WorkerBridge } from './worker'

app.setName('KnowledgeBase')
const root = resolve(__dirname, '../..')
let window: BrowserWindow | null = null
let bridge: WorkerBridge
let quitting = false
const operations = new Set(['bootstrap', 'knowledge.list', 'knowledge.get', 'knowledge.save', 'knowledge.delete',
  'knowledge.bucket', 'attachments.add', 'attachments.remove', 'sources.list', 'sources.retain', 'sources.delete',
  'providers.save', 'providers.delete', 'providers.select', 'providers.test', 'usage.list', 'question', 'recommendations'])

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  app.whenReady().then(() => {
    bridge = new WorkerBridge(root, process.env.KB_DATA_DIR || app.getPath('userData'), event => window?.webContents.send('kb:event', event))
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('请求来源无效')
    }
    ipcMain.handle('kb:request', (event, operation: string, params: Record<string, unknown>, id?: string) => {
      trusted(event)
      if (!operations.has(operation) || !params || typeof params !== 'object' || Array.isArray(params)) throw new Error('无效操作')
      return bridge.request(operation, params, id)
    })
    ipcMain.handle('kb:cancel', (event, id: string) => { trusted(event); if (typeof id === 'string') bridge.cancel(id) })
    ipcMain.handle('kb:files', async event => {
      trusted(event)
      const result = await dialog.showOpenDialog(window!, {
        title: '加入本次提问', properties: ['openFile', 'multiSelections'],
        filters: [{ name: '支持的文档', extensions: ['md', 'txt', 'docx', 'pdf'] }]
      })
      return result.canceled ? [] : result.filePaths
    })
    window = new BrowserWindow({
      width: 1320, height: 900, minWidth: 980, minHeight: 700, backgroundColor: '#f7f8fa',
      title: '知序 · test0.01', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
    else window.loadFile(join(__dirname, '../renderer/index.html'))
    window.on('closed', () => { window = null })
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (quitting || !bridge) return
    event.preventDefault(); quitting = true
    bridge.stop().finally(() => app.quit())
  })
}
