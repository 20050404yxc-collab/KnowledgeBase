// 文件：ComposerToolbar.tsx
// 层：React 页面／组件
// 作用：选择文档与回答范围，并提交或取消请求。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

import { readScope } from './attachment_state'

// 选择文档与回答范围，并提交或取消请求。
export function ComposerToolbar() {
  const {
    guarded,
    ready,
    query,
    scope,
    setScope,
    busy,
    setPathEntry,
    addFiles,
    localSearch,
    cancelTask
  } = useAppContext()
  return (
    <div className="composer-toolbar">
      <div className="toolbar-left">
        <button
          type="button"
          className="attach-button"
          disabled={!ready || !!busy}
          onClick={() =>
            void guarded(async () => {
              await addFiles(await api.chooseFiles())
            })
          }
        >
          ＋ 添加文档
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!ready || !!busy}
          onClick={() => setPathEntry('')}
        >
          本地路径
        </button>
        <span className="toolbar-separator" />
        <select
          aria-label="回答范围"
          value={scope}
          onChange={(event) => setScope(readScope(event.target.value))}
        >
          <option value="mixed">本次文件＋知识库</option>
          <option value="files">仅本次文件</option>
          <option value="knowledge">仅知识库</option>
        </select>
      </div>
      <button
        type="button"
        className="secondary"
        disabled={!ready || !query.trim() || !!busy}
        onClick={() => void localSearch()}
      >
        本地检索
      </button>
      {busy ? (
        <button type="button" className="secondary" onClick={() => void cancelTask()}>
          取消任务
        </button>
      ) : (
        <button className="primary" disabled={!ready || !query.trim()}>
          拆解并学习 <span>↗</span>
        </button>
      )}
    </div>
  )
}
