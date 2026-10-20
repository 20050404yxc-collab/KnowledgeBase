// 文件：PathDialog.tsx
// 层：React 页面／组件
// 作用：收集本地文件路径并交给附件流程。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 收集本地文件路径并交给附件流程。
export function PathDialog() {
  const { pathEntry, setPathEntry, addFiles } = useAppContext()
  if (pathEntry === null) {
    return null
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          const value = pathEntry
          setPathEntry(null)
          void addFiles([value])
        }}
      >
        <div className="modal-heading">
          <h2>加入本地文档</h2>
          <button type="button" onClick={() => setPathEntry(null)} aria-label="关闭路径输入">
            ×
          </button>
        </div>
        <label>
          文件绝对路径
          <input
            autoFocus
            required
            value={pathEntry}
            onChange={(event) => setPathEntry(event.target.value)}
            placeholder="D:\资料\笔记.md"
          />
        </label>
        <p className="subtle">
          也可将本地路径直接粘贴到问题输入框，或拖入文件。网络 URL 不受支持。
        </p>
        <button className="primary">解析并加入</button>
      </form>
    </div>
  )
}
