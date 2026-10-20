// 文件：ipc_gateway.ts
// 层：Electron 桌面宿主
// 作用：限制 IPC 来源、操作、参数和文件选择。
// 说明：只接受当前主窗口的主 frame。
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { isOperation, isRecord } from '../shared/protocol_validation'
import type { WorkerBridge } from './worker_bridge'
import { diagnostic } from './diagnostics'
import { rendererDiagnostic } from './renderer_diagnostics'

// 子 frame 和失效窗口不能借用可信能力。
function trusted(event: IpcMainInvokeEvent, window: BrowserWindow | null): BrowserWindow {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    diagnostic('ipc.untrusted_source')
    throw new Error('请求来源无效')
  }
  return window
}

// 具体业务参数继续由后台入口验证，宿主只限制协议结构。
export function registerIpc(getWindow: () => BrowserWindow | null, bridge: WorkerBridge): void {
  // 每分钟上限只作用于界面诊断通道，业务请求仍沿原通道执行。
  let budget = 600
  let reset = Date.now()
  ipcMain.on('kb:diagnostic', (event, value: unknown) => {
    // send 没有调用方 Promise；无效来源只忽略，不抛出未处理主进程异常。
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      return
    }
    if (Date.now() - reset >= 60_000) {
      budget = 600
      reset = Date.now()
    }
    if (budget-- <= 0) {
      return
    }
    const fields = rendererDiagnostic(value)
    if (fields) {
      diagnostic('renderer.diagnostic', fields)
    }
  })
  ipcMain.handle('kb:request', (event, operation: unknown, params: unknown, id: unknown) => {
    trusted(event, getWindow())
    if (
      !isOperation(operation) ||
      !isRecord(params) ||
      (id !== undefined && typeof id !== 'string')
    ) {
      diagnostic('ipc.invalid_request')
      throw new Error('无效操作')
    }
    return bridge.request(operation, params, id)
  })
  ipcMain.handle('kb:cancel', (event, id: unknown) => {
    trusted(event, getWindow())
    if (typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id)) {
      bridge.cancel(id)
    }
  })
  ipcMain.handle('kb:files', async (event) => {
    const window = trusted(event, getWindow())
    const result = await dialog.showOpenDialog(window, {
      title: '加入本次提问',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '支持的文档', extensions: ['md', 'txt', 'docx', 'pdf'] }]
    })
    diagnostic('files.selected', { cancelled: result.canceled, count: result.filePaths.length })
    return result.canceled ? [] : result.filePaths
  })
}
