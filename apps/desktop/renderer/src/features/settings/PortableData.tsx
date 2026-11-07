// 文件：PortableData.tsx
// 层：React 设置交互
// 作用：创建完整备份、校验备份和执行隔离恢复。
// 说明：不覆盖当前库；路径来自显式文件夹选择。
import { api, errorText } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 原位反馈失败与恢复目录；备份内容和凭据边界在操作前可见。
export function PortableData() {
  const { busy, portableData, setPortableData, portableDataLock: lock } = useAppContext()
  const { running, result, error } = portableData
  const setRunning = (running: boolean) => setPortableData((state) => ({ ...state, running }))
  const setResult = (result: string) => setPortableData((state) => ({ ...state, result }))
  const setError = (error: string) => setPortableData((state) => ({ ...state, error }))
  const execute = async (action: 'backup' | 'verify' | 'restore') => {
    if (lock.current) {
      return
    }
    lock.current = true
    setRunning(true)
    setError('')
    setResult('')
    try {
      const path = await api.chooseFolder()
      if (!path) {
        return
      }
      let receipt
      if (action === 'backup') {
        receipt = await api.request('data.backup', { directory: path })
      } else if (action === 'verify') {
        receipt = await api.request('data.verify', { path })
      } else {
        const directory = await api.chooseFolder()
        if (!directory) {
          return
        }
        receipt = await api.request('data.restore', { path, directory })
      }
      setResult(
        `${action === 'restore' ? '隔离恢复完成，当前库未替换' : action === 'backup' ? '备份已完成并核对' : '备份校验通过'}：${receipt.path} · ${receipt.files} 个文件 · ${(receipt.bytes / 1024).toFixed(1)} KB`
      )
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      lock.current = false
      setRunning(false)
    }
  }
  return (
    <section className="portable-data" aria-label="完整备份与隔离恢复">
      <p>
        包含知识、补充、引用、保留资料、配置、草稿与项目路径登记；不包含系统 API
        Key、临时附件、日志或可重建模型资源。请先等待所有任务及草稿写入结束。
      </p>
      <div className="heading-actions">
        <button disabled={!!busy || running} onClick={() => void execute('backup')}>
          创建完整备份
        </button>
        <button disabled={!!busy || running} onClick={() => void execute('verify')}>
          校验备份目录
        </button>
        <button disabled={!!busy || running} onClick={() => void execute('restore')}>
          恢复到新隔离目录
        </button>
      </div>
      {running && <p role="status">正在处理文件，请等待结果…</p>}
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}。当前工作库没有被恢复操作覆盖。</p>}
      <p className="subtle">
        恢复时先选择备份目录，再选择隔离目录的父目录。核对恢复内容后，关闭应用并按备份指引切换数据；当前操作不会自动切换数据目录。
      </p>
    </section>
  )
}
