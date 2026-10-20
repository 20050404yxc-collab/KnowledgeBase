import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI, WorkerEvent } from '../../../contracts/desktop'

const api: DesktopAPI = {
  version: 'test0.01',
  request: (operation, params = {}, id) => ipcRenderer.invoke('kb:request', operation, params, id),
  cancel: id => ipcRenderer.invoke('kb:cancel', id),
  chooseFiles: () => ipcRenderer.invoke('kb:files'),
  pathsForFiles: files => files.map(file => webUtils.getPathForFile(file)).filter(Boolean),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: WorkerEvent) => callback(value)
    ipcRenderer.on('kb:event', listener)
    return () => ipcRenderer.removeListener('kb:event', listener)
  }
}
contextBridge.exposeInMainWorld('knowledgeBase', api)
