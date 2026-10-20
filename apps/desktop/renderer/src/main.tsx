// 文件：main.tsx
// 层：React 启动入口
// 作用：挂载应用根组件。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './shared/styles/styles.css'

// DOM 入口不存在时明确失败，不用非空断言掩盖挂载错误。
const root = document.getElementById('root')
if (!root) {
  throw new Error('缺少应用挂载节点')
}
createRoot(root).render(<App />)
