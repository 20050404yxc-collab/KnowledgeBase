// 文件：index.ts
// 层：Electron preload
// 作用：暴露有限操作并校验返回值和事件。
// 说明：不向界面开放任意 IPC、Node 或凭据能力。
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI, RendererDiagnostic } from '../../../contracts/desktop'
import { decodeResult, isWorkerEvent, isStoragePaths } from '../shared/protocol_validation'
import { diagnosticError, requestError } from '../shared/diagnostic_error'

// 宿主再次校验元数据；日志通道失败不能覆盖原请求或制造递归拒绝。
function reportDiagnostic(report: RendererDiagnostic): void {
  try {
    ipcRenderer.send('kb:diagnostic', report)
  } catch {
    console.error('KnowledgeBase renderer diagnostic unavailable')
  }
}

const api: DesktopAPI = {
  version: 'test0.03',
  // 来自另一个进程的结果先作为 unknown 处理，再按操作对应的 DTO 验证。
  request: async (operation, params, id) => {
    const request_id = id ?? crypto.randomUUID()
    const started = performance.now()
    reportDiagnostic({ event: 'request_start', operation, request_id })
    try {
      const value: unknown = await ipcRenderer.invoke(
        'kb:request',
        operation,
        params ?? {},
        request_id
      )
      const result = decodeResult(operation, value)
      reportDiagnostic({
        event: 'request_completed',
        operation,
        request_id,
        elapsed_ms: Math.round(performance.now() - started)
      })
      return result
    } catch (error) {
      reportDiagnostic({
        event: 'request_failed',
        operation,
        request_id,
        elapsed_ms: Math.round(performance.now() - started),
        ...diagnosticError(error)
      })
      throw requestError(error, request_id)
    }
  },
  // 取消发送失败向界面传播，成功发送仍需等待业务请求的实际终态。
  cancel: async (id) => {
    reportDiagnostic({ event: 'cancel', request_id: id })
    await ipcRenderer.invoke('kb:cancel', id)
  },
  // 文件对话框也是跨进程结果，先验证字符串数组再交给附件流程。
  chooseFiles: async () => {
    const request_id = crypto.randomUUID()
    try {
      const value: unknown = await ipcRenderer.invoke('kb:files')
      if (!Array.isArray(value) || !value.every((path: unknown) => typeof path === 'string')) {
        throw new Error('文件选择结果格式无效，请重试')
      }
      return value
    } catch (error) {
      reportDiagnostic({ event: 'files_failed', request_id, ...diagnosticError(error) })
      throw requestError(error, request_id)
    }
  },
  // 固定能力单独校验，目录标识不能变成任意文件系统路径。
  storagePaths: async () => {
    const request_id = crypto.randomUUID()
    try {
      const value: unknown = await ipcRenderer.invoke('kb:storage-paths', request_id)
      if (!isStoragePaths(value)) {
        throw new Error('存储路径格式无效')
      }
      return value
    } catch (error) {
      throw requestError(error, request_id)
    }
  },
  openDirectory: async (directory) => {
    const request_id = crypto.randomUUID()
    try {
      await ipcRenderer.invoke('kb:open-directory', directory, request_id)
    } catch (error) {
      throw requestError(error, request_id)
    }
  },
  pathsForFiles: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  reportDiagnostic,
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
