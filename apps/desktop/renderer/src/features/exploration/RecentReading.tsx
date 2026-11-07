// 文件：RecentReading.tsx
// 层：React 探索页面
// 作用：提供最近阅读的显式继续入口。
// 说明：知识已删除时沿用可检索错误，不自动恢复或重新生成内容。
import { useAppContext } from '../../app/AppContext'

// 打开完成后等正文布局提交，再恢复上次窗口位置。
export function RecentReading() {
  const { recentReading, clearRecentReading, openItem } = useAppContext()
  if (!recentReading.length) {
    return null
  }
  const resume = async (id: string, position: number) => {
    await openItem(id)
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, position)))
  }
  return (
    <section className="recent-reading" aria-label="最近阅读">
      <div className="section-title">
        <h2>继续上次阅读</h2>
        <button
          onClick={() => {
            if (confirm('清除最近阅读记录？已保存知识不受影响。')) {
              clearRecentReading()
            }
          }}
        >
          清除阅读记录
        </button>
      </div>
      <div className="recent-reading-list">
        {recentReading.map((item) => (
          <button key={item.id} onClick={() => void resume(item.id, item.position)}>
            {item.title}
            <small>{new Date(item.updated).toLocaleDateString('zh-CN')}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
