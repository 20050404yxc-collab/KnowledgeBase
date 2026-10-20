// 文件：WorkingStatus.tsx
// 层：React 页面／组件
// 作用：显示当前请求进度和已接收文本字符数。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示当前请求进度和已接收文本字符数。
export function WorkingStatus() {
  const { progress, streamChars } = useAppContext()
  return (
    <div className="working" role="status">
      <span className="spinner" />
      {progress}
      {streamChars > 0 && <small>已接收 {streamChars.toLocaleString()} 字，正在等待完整结果</small>}
    </div>
  )
}
