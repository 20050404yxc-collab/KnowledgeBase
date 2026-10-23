// 文件：PageFooter.tsx
// 层：React 页面／组件
// 作用：显示应用版本、离线状态及数据目录。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

// 显示应用版本、离线状态及数据目录。
export function PageFooter() {
  return (
    <footer className="page-footer">
      知序 <span>·</span> 让知识有序，让思考自由。
      <details>
        <summary>功能边界</summary>
        <p>
          MD / TXT / DOCX / 文字版 PDF；单文件 50MB，PDF 200 页，单次上下文约 28000 字。未接入 OCR
          或语义索引，真实接口需自行配置验证。
        </p>
      </details>
    </footer>
  )
}
