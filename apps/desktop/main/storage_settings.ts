// 文件：storage_settings.ts
// 层：Electron 桌面宿主
// 作用：提供实际存储路径和受限的打开目录能力。
// 说明：只接受当前窗口主 frame 和固定目录标识，不接受任意路径。
import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'node:path'
import { diagnostic } from './diagnostics'

// 数据根目录与后台启动参数一致，路径由宿主解析而非页面拼接。
export function registerStorageIpc(getWindow: () => BrowserWindow | null, dataDir: string): void {
  const data = resolve(dataDir)
  const directories = { data, logs: join(data, 'logs'), sources: join(data, 'sources') }
  const paths = { ...directories, database: join(data, 'knowledge.sqlite3') }
  // 每次访问都验证活跃主 frame，子 frame 不能借用系统能力。
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      diagnostic('storage.untrusted_source')
      throw new Error('请求来源无效')
    }
  }
  ipcMain.handle('kb:storage-paths', (event, id: unknown) => {
    trusted(event)
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) {
      throw new Error('无效请求编号')
    }
    diagnostic('storage.paths_read', { request_id: id })
    return paths
  })
  ipcMain.handle('kb:open-directory', async (event, directory: unknown, id: unknown) => {
    trusted(event)
    if (
      (directory !== 'data' && directory !== 'logs' && directory !== 'sources') ||
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(id)
    ) {
      diagnostic('storage.invalid_directory')
      throw new Error('无效目录')
    }
    diagnostic('storage.open_started', { request_id: id, directory })
    try {
      const error = await shell.openPath(directories[directory])
      // shell 返回非空文本表示失败；不把系统路径或原始错误写入日志。
      if (error) {
        throw new Error('无法打开目录，请检查目录是否存在及系统权限')
      }
      diagnostic('storage.open_completed', { request_id: id, directory })
    } catch (error) {
      diagnostic('storage.open_failed', { request_id: id, directory })
      throw error
    }
  })
}
