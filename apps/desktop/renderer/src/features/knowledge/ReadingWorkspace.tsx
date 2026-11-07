// 文件：ReadingWorkspace.tsx
// 层：React 知识阅读布局
// 作用：宽屏并列目录与正文，窄屏提供保留目录位置的返回入口。
// 说明：隐藏不卸载目录，不重置分类路径和视图偏好。
import { useEffect, useState, type ReactNode } from 'react'
import { useAppContext } from '../../app/AppContext'
import { SavedKnowledgeTree } from './SavedKnowledgeTree'

// 新选择默认阅读；返回目录仍保留所选知识，用户可继续当前阅读。
export function ReadingWorkspace({ children }: { children: ReactNode }) {
  const { selected, treeView } = useAppContext()
  const [detail, setDetail] = useState(true)
  useEffect(() => {
    setDetail(true)
  }, [selected?.id])
  return (
    <div
      className={`library-workspace reading-workspace ${treeView === 'planets' ? 'planet-workspace' : ''}`}
      data-detail={!!selected && detail}
    >
      <div className="reading-directory">
        {selected && (
          <button className="narrow-reading-control" onClick={() => setDetail(true)}>
            继续当前阅读
          </button>
        )}
        <SavedKnowledgeTree />
      </div>
      <div className="reading-detail">
        {selected && (
          <button className="narrow-reading-control" onClick={() => setDetail(false)}>
            返回知识目录
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
