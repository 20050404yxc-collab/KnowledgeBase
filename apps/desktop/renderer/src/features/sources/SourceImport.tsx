// 文件：SourceImport.tsx
// 层：React 资料交互
// 作用：在资料库明确选择临时附件或保留资料，逐项导入和重试。
// 说明：不改写用户原件，单项失败不撤销已经成功保留的资料。
import { useAppContext } from '../../app/AppContext'
import { api, errorText } from '../../shared/api/client'

// 批次最多二十份，使用 ref 在连续点击之间锁住入口。
function useSourceImport() {
  const {
    ready,
    busy,
    setSources,
    addFiles,
    setSection,
    setAttachments,
    sourceImport,
    setSourceImport,
    sourceImportLock: lock
  } = useAppContext()
  const { retained, items, running, error } = sourceImport
  const setRetained = (retained: boolean) =>
    setSourceImport((current) => ({ ...current, retained }))
  const setRunning = (running: boolean) => setSourceImport((current) => ({ ...current, running }))
  const setError = (error: string) => setSourceImport((current) => ({ ...current, error }))
  const importPaths = async (paths: string[]) => {
    if (lock.current) {
      return
    }
    lock.current = true
    setRunning(true)
    setError('')
    try {
      if (!retained) {
        setSection('探索')
        await addFiles(paths)
        return
      }
      for (const path of paths.slice(0, 20)) {
        const name = path.split(/[\\/]/).pop() || '资料'
        const update = (state: string, failure = '') =>
          setSourceImport((current) => ({
            ...current,
            items: [
              ...current.items.filter((item) => item.path !== path).slice(-99),
              { path, name, state, error: failure }
            ]
          }))
        update('正在解析')
        try {
          const attachment = await api.request('attachments.add', { path, retain: true })
          setSources(await api.request('sources.list'))
          setAttachments((current) =>
            current.map((item) => (item.id === attachment.id ? { ...item, retained: true } : item))
          )
          update(
            `已保留 · ${attachment.blocks} 个可读片段${attachment.warnings.length ? ' · ' + attachment.warnings.join('；') : ''}`
          )
        } catch (failure) {
          update('导入失败', errorText(failure))
        }
      }
    } finally {
      lock.current = false
      setRunning(false)
    }
  }
  const choose = async () => {
    try {
      await importPaths(await api.chooseFiles())
    } catch (failure) {
      setError(errorText(failure))
    }
  }
  return { ready, busy, retained, setRetained, items, running, error, choose, importPaths }
}

// 展示各项结果和重试，动作状态由同一导入流程持有。
export function SourceImport() {
  const { ready, busy, retained, setRetained, items, running, error, choose, importPaths } =
    useSourceImport()
  return (
    <section className="panel source-import" aria-label="导入资料">
      <h2>添加资料</h2>
      <label>
        <input
          type="checkbox"
          checked={retained}
          disabled={running}
          onChange={(event) => setRetained(event.target.checked)}
        />
        长期保留到资料库
      </label>
      <p className="subtle">
        {retained
          ? '保留应用副本，原文件不变。解析范围和遗漏会在资料旁显示。'
          : '仅加入探索的本次附件；关闭应用后需重新添加，不会自动保留。'}{' '}
        每次最多 20 份。
      </p>
      <button
        className="primary"
        disabled={!ready || !!busy || running}
        onClick={() => void choose()}
      >
        {running ? '导入中…' : '选择文件导入'}
      </button>
      {error && <p role="alert">{error}</p>}
      <ul aria-live="polite">
        {items.map((item) => (
          <li key={item.path}>
            <strong>{item.name}</strong> · {item.state}
            {item.error && (
              <>
                <p role="alert">{item.error}</p>
                <button disabled={running || !!busy} onClick={() => void importPaths([item.path])}>
                  重试此资料
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
