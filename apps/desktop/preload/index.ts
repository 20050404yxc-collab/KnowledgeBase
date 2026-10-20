// 文件：index.ts
// 层：Electron preload
// 作用：暴露有限操作并校验返回值和事件。
// 说明：不向界面开放任意 IPC、Node 或凭据能力。
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI } from '../../../contracts/desktop'
import { decodeResult, isWorkerEvent } from '../shared/protocol_validation'

const api: DesktopAPI = {
  version: 'test0.03',
  // 来自另一个进程的结果先作为 unknown 处理，再按操作对应的 DTO 验证。
  request: async (operation, params, id) => {
    const value: unknown = await ipcRenderer.invoke('kb:request', operation, params ?? {}, id)
    return decodeResult(operation, value)
  },
  // 取消发送失败向界面传播，成功发送仍需等待业务请求的实际终态。
  cancel: async (id) => {
    await ipcRenderer.invoke('kb:cancel', id)
  },
  // 文件对话框也是跨进程结果，先验证字符串数组再交给附件流程。
  chooseFiles: async () => {
    const value: unknown = await ipcRenderer.invoke('kb:files')
    if (!Array.isArray(value) || !value.every((path: unknown) => typeof path === 'string')) {
      throw new Error('文件选择结果格式无效，请重试')
    }
    return value
  },
  pathsForFiles: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  onEvent: (callback) => {
    // 验证每条事件后再调用界面，退订必须移除同一个监听函数。
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isWorkerEvent(value)) {
        callback(value)
      }
    }
    ipcRenderer.on('kb:event', listener)
    return () => ipcRenderer.removeListener('kb:event', listener)
  }
}
contextBridge.exposeInMainWorld('knowledgeBase', api)
