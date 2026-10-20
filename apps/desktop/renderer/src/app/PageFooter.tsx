// 文件：PageFooter.tsx
// 层：React 页面／组件
// 作用：显示应用版本、离线状态及数据目录。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from './AppContext'

// 显示应用版本、离线状态及数据目录。
export function PageFooter() {
  const { dataDir } = useAppContext()
  return (
    <footer className="page-footer">
      知序 <span>·</span> 让知识有序，让思考自由。
      <details>
        <summary>存储位置与测试版边界</summary>
        <p>{dataDir}</p>
        <p>
          MD / TXT / DOCX / 文字版 PDF；单文件 50MB，PDF 200 页，单次上下文约 28000 字。未接入
          OCR、语义索引或安装包，真实接口需自行配置验证。
        </p>
      </details>
    </footer>
  )
}
