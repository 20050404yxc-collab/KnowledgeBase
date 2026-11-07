// 文件：TaskStatus.tsx
// 层：React 应用布局
// 作用：在任意页面显示当前会话任务并提供返回和取消。
// 说明：导航只切换显示，明确取消才终止后续阶段。
import { useAppContext } from './AppContext'

// 全局任务条不携带其他页面的正文和错误。
export function TaskStatus() {
  const { busy, taskOwner, section, progress, setSection, cancelTask } = useAppContext()
  // 前台由页内状态展示；离开任务页后才出现跨页返回入口。
  if (!busy || taskOwner === section) {
    return null
  }
  return (
    <div className="session-task" role="status">
      <span className="spinner" />
      <strong>{taskOwner}</strong>
      <span>{progress}</span>
      <button onClick={() => setSection(taskOwner)}>返回任务</button>
      <button onClick={() => void cancelTask()}>取消任务</button>
    </div>
  )
}
