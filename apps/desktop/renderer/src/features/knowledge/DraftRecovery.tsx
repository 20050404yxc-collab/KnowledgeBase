// 文件：DraftRecovery.tsx
// 层：React 页面／组件
// 作用：在草稿无法进入编辑器时提供明确反馈和恢复入口。
// 说明：损坏文件保留供备份，结构错误仅经明确放弃后清除。
import { useAppContext } from '../../app/AppContext'

// 正常读取不额外占据界面；错误不会静默变成空笔记。
export function DraftRecovery() {
  const { ready, noteDraftReady, noteDraftInvalid, draftStatus, retryDraft, clearInvalidDraft } =
    useAppContext()
  if (!ready || noteDraftReady || draftStatus === '正在读取草稿') {
    return null
  }
  return (
    <div className="alert error" role="alert">
      {noteDraftInvalid ? '笔记草稿格式无效，原始内容仍保留；请先创建完整备份。' : draftStatus}
      <button onClick={retryDraft}>重新读取笔记草稿</button>
      {noteDraftInvalid && (
        <button
          onClick={() => {
            // 用户明确放弃后才允许用空草稿替换旧内容。
            if (confirm('清除格式无效的笔记草稿？建议先完成备份，清除后无法恢复。')) {
              clearInvalidDraft()
            }
          }}
        >
          放弃损坏草稿
        </button>
      )}
    </div>
  )
}
