// 文件：main.tsx
// 层：React 启动入口
// 作用：挂载应用根组件。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './shared/styles/styles.css'
import { diagnosticError } from '../../shared/diagnostic_error'

// 全局错误和 Promise 拒绝只上报类别与代码位置，不上传 message 和业务对象。
window.addEventListener('error', (event) => {
  window.knowledgeBase.reportDiagnostic({ event: 'error', ...diagnosticError(event.error) })
})
window.addEventListener('unhandledrejection', (event) => {
  window.knowledgeBase.reportDiagnostic({ event: 'rejection', ...diagnosticError(event.reason) })
})
window.knowledgeBase.reportDiagnostic({ event: 'ready' })

// DOM 入口不存在时明确失败，不用非空断言掩盖挂载错误。
const root = document.getElementById('root')
if (!root) {
  throw new Error('缺少应用挂载节点')
}
createRoot(root, {
  // React 渲染错误包括框架捕获路径，既写日志又保留开发控制台的固定提示。
  onUncaughtError: (error) => {
    window.knowledgeBase.reportDiagnostic({ event: 'react_error', ...diagnosticError(error) })
    console.error('界面渲染失败，请查看本地诊断日志。')
  },
  onCaughtError: (error) => {
    window.knowledgeBase.reportDiagnostic({ event: 'react_error', ...diagnosticError(error) })
  }
}).render(<App />)
