// 文件：Sidebar.tsx
// 层：React 页面／组件
// 作用：显示知识分区导航并切换当前页面。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import React from 'react'
import { useAppContext } from './AppContext'
import { primarySections, icons, isLibrarySection } from './navigation'

// 显示知识分区导航并切换当前页面。
export function Sidebar() {
  const { section, setSection, loadUsage } = useAppContext()
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">知</div>
        <div>
          <strong>知序</strong>
        </div>
      </div>
      <div className="workspace-label">
        我的知识空间 <span>LOCAL</span>
      </div>
      <nav aria-label="主导航">
        {primarySections.map((name, index) => (
          <React.Fragment key={name}>
            {name === '设置' && <div className="nav-divider" />}
            <button
              className={`nav-item ${section === name || (name === '知识库' && isLibrarySection(section)) ? 'active' : ''}`}
              aria-current={
                section === name || (name === '知识库' && isLibrarySection(section))
                  ? 'page'
                  : undefined
              }
              onClick={() => {
                setSection(name)
                if (name === '用量统计') {
                  void loadUsage()
                }
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {icons[index]}
              </span>
              {name}
            </button>
          </React.Fragment>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-indicator">
          <span /> 本地存储 · 由你掌控
        </div>
        <small>
          0.14.0 <span>正式版</span>
        </small>
      </div>
    </aside>
  )
}
