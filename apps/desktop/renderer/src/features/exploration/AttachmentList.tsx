// 文件：AttachmentList.tsx
// 层：React 页面／组件
// 作用：显示附件解析状态、保留入口及移除操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示附件解析状态、保留入口及移除操作。
export function AttachmentList() {
  const { attachments, busy, removeAttachment, retain } = useAppContext()
  return (
    <div className="attachments">
      {attachments.map((item) => (
        <div key={item.localId} className={`attachment ${item.state}`}>
          <div>
            <b>▱ {item.name}</b>
            <small>
              {item.state === 'loading'
                ? '解析中…'
                : item.state === 'error'
                  ? item.error
                  : `${item.blocks} 个片段 · ${item.retained ? '已保存到资料库' : '临时附件 · 退出后清理'}`}
            </small>
          </div>
          {item.state === 'ready' && !item.retained && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void retain(item)}
              title="保存文件副本到资料库，便于下次使用；不会自动生成知识"
            >
              保存到资料库
            </button>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void removeAttachment(item)}
            aria-label={`移除 ${item.name}`}
          >
            ×
          </button>
          {item.warnings?.length ? (
            <details>
              <summary>解析说明</summary>
              {item.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </details>
          ) : null}
        </div>
      ))}
    </div>
  )
}
