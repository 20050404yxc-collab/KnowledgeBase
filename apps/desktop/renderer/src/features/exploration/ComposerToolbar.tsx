// 文件：ComposerToolbar.tsx
// 层：React 页面／组件
// 作用：选择文档与回答范围，并提交或取消请求。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

import { readScope } from './attachment_state'

// 选择文档与回答范围，并提交或取消请求。
export function ComposerToolbar() {
  const { guarded, ready, query, scope, setScope, busy, setPathEntry, addFiles, searchGlobal } =
    useAppContext()
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
        <label className="learning-scope">
          <span>AI 学习范围</span>
          <select
            aria-label="AI 学习范围"
            value={scope}
            onChange={(event) => setScope(readScope(event.target.value))}
          >
            <option value="mixed">本次文件＋知识库</option>
            <option value="files">仅本次文件</option>
            <option value="knowledge">仅知识库</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        className="secondary"
        title="搜索全部已保存知识和资料，不调用模型；不受 AI 学习范围影响"
        disabled={!ready || !query.trim()}
        onClick={() => void searchGlobal(query)}
      >
        搜索此问题
      </button>
      <SubmitActions />
    </div>
  )
}

// 目录与直接回答有独立入口，共用取消和忙碌状态。
function SubmitActions() {
  const { busy, ready, query, buildDirectory, cancelTask } = useAppContext()
  return busy ? (
    <button type="button" className="secondary" onClick={() => void cancelTask()}>
      取消任务
    </button>
  ) : (
    <>
      <button
        type="button"
        disabled={!ready || !query.trim()}
        onClick={() => void buildDirectory()}
      >
        生成学习目录
      </button>
      <button className="primary" disabled={!ready || !query.trim()}>
        AI 回答 <span>↗</span>
      </button>
    </>
  )
}
