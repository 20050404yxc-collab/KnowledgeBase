// 文件：ProvidersHeading.tsx
// 层：React 页面／组件
// 作用：显示接口配置页标题与协议提示。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

// 显示接口配置页标题与协议提示。
export function ProvidersHeading() {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">MODEL CONNECTIONS</div>
        <h1>选择适合你的思考伙伴。</h1>
        <p>按实际接口协议配置模型。外部调用会发送问题及选定的相关片段。</p>
      </div>
    </div>
  )
}
