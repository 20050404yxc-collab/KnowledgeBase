// 文件：Topbar.tsx
// 层：React 页面／组件
// 作用：显示当前分区名称及知识筛选输入。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from './AppContext'

// 显示当前分区名称及知识筛选输入。
export function Topbar() {
  const { section, ready } = useAppContext()
  return (
    <header className="topbar">
      <span>
        我的知识库 <span className="crumb">/</span> <strong>{section}</strong>
      </span>
      <div className="connection">
        <i className={ready ? 'online' : ''} />
        {ready ? '本地后台已连接' : '后台连接中'}
        <span className="avatar">Y</span>
      </div>
    </header>
  )
}
