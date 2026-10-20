// 文件：ProviderList.tsx
// 层：React 页面／组件
// 作用：显示已保存接口及启用、连接测试和删除操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 显示已保存接口及启用、连接测试和删除操作。
export function ProviderList() {
  const { setMessage, guarded, providers, setProviders, busy, setBusy, activeRequest } =
    useAppContext()
  return (
    <section className="panel">
      <h2>已保存的接口</h2>
      {providers.length ? (
        providers.map((provider) => (
          <article className="provider-card" key={provider.id}>
            <h3>
              {provider.name} {provider.active ? <span className="pill">使用中</span> : null}
            </h3>
            <p>
              {provider.protocol} · {provider.model}
            </p>
            <small>{provider.base_url}</small>
            <div className="provider-actions">
              <button
                disabled={provider.active}
                onClick={() =>
                  void guarded(async () =>
                    setProviders(await api.request('providers.select', { id: provider.id }))
                  )
                }
              >
                设为当前
              </button>
              <button
                disabled={!!busy}
                onClick={() => {
                  const id = crypto.randomUUID()
                  activeRequest.current = id
                  setBusy(id)
                  void guarded(async () => {
                    const value = await api.request('providers.test', { id: provider.id }, id)
                    setMessage(value.message)
                  }).finally(() => {
                    activeRequest.current = null
                    setBusy(null)
                  })
                }}
              >
                测试连接（会调用 API）
              </button>
              <button
                className="danger-text"
                onClick={() => {
                  if (confirm('删除接口配置和 Windows 中保存的凭据？知识不受影响。')) {
                    void guarded(async () =>
                      setProviders(await api.request('providers.delete', { id: provider.id }))
                    )
                  }
                }}
              >
                删除
              </button>
            </div>
          </article>
        ))
      ) : (
        <p className="subtle">尚未配置。本地知识编辑与关键词检索仍可使用。</p>
      )}
      <div className="info-box">
        API Key 保存在 Windows
        凭据管理器。生成接口连通不等于支持向量检索；本测试版仅使用关键词检索。
      </div>
    </section>
  )
}
