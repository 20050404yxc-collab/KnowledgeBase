// 文件：LibraryViews.tsx
// 层：React 应用布局
// 作用：在知识库内切换全库与频率分区。
// 说明：导航复用原页面键，不合并阅读、草稿或后台任务。
import { useAppContext } from './AppContext'
import { isLibrarySection, librarySections } from './navigation'

// 分段导航使用当前页语义，所有入口均可通过键盘 Tab 和 Enter 访问。
export function LibraryViews() {
  const { section, setSection } = useAppContext()
  if (!isLibrarySection(section)) {
    return null
  }
  return (
    <nav className="library-tabs" aria-label="知识库视图">
      {librarySections.map((name) => (
        <button
          key={name}
          className="library-view"
          aria-current={section === name ? 'page' : undefined}
          onClick={() => setSection(name)}
        >
          {name === '知识库' ? '全部知识' : name}
        </button>
      ))}
    </nav>
  )
}
