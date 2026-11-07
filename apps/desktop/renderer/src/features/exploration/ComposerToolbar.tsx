// 文件：ComposerToolbar.tsx
// 层：React 页面／组件
// 作用：选择文档与回答范围，并提交或取消请求。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

import { readScope } from './attachment_state'

// 选择文档与回答范围，并提交或取消请求。
export function ComposerToolbar() {
  const { guarded, ready, scope, setScope, busy, setPathEntry, addFiles } = useAppContext()
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
          <span>知识来源</span>
          <select
            aria-label="知识来源"
            value={scope}
            onChange={(event) => setScope(readScope(event.target.value))}
          >
            <option value="mixed">混合（文档＋知识库）</option>
            <option value="files">仅本次文件</option>
            <option value="knowledge">仅知识库</option>
          </select>
        </label>
      </div>
      <div className="toolbar-actions">
        <SubmitActions />
      </div>
    </div>
  )
}

// 目录与直接回答有独立入口，共用取消和忙碌状态。
function SubmitActions() {
  const { busy, ready, query, buildDirectory, cancelTask, searchGlobal } = useAppContext()
  return (
    <>
      <button
        type="button"
        className="composer-search text-button"
        title="搜索全部已保存知识和资料，不调用模型；不受知识来源影响"
        disabled={!ready || !query.trim()}
        onClick={() => void searchGlobal(query)}
      >
        不消耗 API，直接全文检索
      </button>
      {busy ? (
        <button type="button" className="secondary" onClick={() => void cancelTask()}>
          取消任务
        </button>
      ) : (
        <>
          <button
            type="button"
            className="secondary"
            title="先规划要学什么，再按知识点生成内容；可能产生模型费用"
            disabled={!ready || !query.trim()}
            onClick={() => void buildDirectory()}
          >
            生成学习目录
          </button>
          <button
            className="primary"
            aria-describedby="answer-guide"
            disabled={!ready || !query.trim()}
          >
            AI 回答 <span>↗</span>
          </button>
        </>
      )}
    </>
  )
}
