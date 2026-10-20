// 文件：ipc_gateway.ts
// 层：Electron 桌面宿主
// 作用：限制 IPC 来源、操作、参数和文件选择。
// 说明：只接受当前主窗口的主 frame。
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { isOperation, isRecord } from '../shared/protocol_validation'
import type { WorkerBridge } from './worker_bridge'

// 子 frame 和失效窗口不能借用可信能力。
function trusted(event: IpcMainInvokeEvent, window: BrowserWindow | null): BrowserWindow {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error('请求来源无效')
  }
  return window
}

// 具体业务参数继续由后台入口验证，宿主只限制协议结构。
export function registerIpc(getWindow: () => BrowserWindow | null, bridge: WorkerBridge): void {
  ipcMain.handle('kb:request', (event, operation: unknown, params: unknown, id: unknown) => {
    trusted(event, getWindow())
    if (
      !isOperation(operation) ||
      !isRecord(params) ||
      (id !== undefined && typeof id !== 'string')
    ) {
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
    return result.canceled ? [] : result.filePaths
  })
}
