// 文件：ProviderList.tsx
// 层：React 页面／组件
// 作用：显示已保存接口及启用、连接测试和删除操作。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import type { Provider } from '../../../../../../contracts/desktop'
import { editProvider } from './provider_form'
import { ModelPicker } from './ModelPicker'
import { useProviderActions } from './use_provider_actions'
import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

// 已保存接口只展示无密钥数据，编辑复用原 ID；测试可单独选择模型。
export function ProviderList() {
  const { providers } = useAppContext()
  return (
    <section className="panel">
      <h2>已保存的接口</h2>
      {providers.length ? (
        providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)
      ) : (
        <p className="subtle">尚未配置。本地知识编辑与关键词检索仍可使用。</p>
      )}
      <div className="info-box">
        API Key 保存在 Windows 凭据管理器。获取列表不代表生成或向量能力已通过测试。
      </div>
    </section>
  )
}

// 卡片中的临时模型与主界面共享会话选择，不修改默认配置。
function ProviderCard({ provider }: { provider: Provider }) {
  const {
    guarded,
    setProviders,
    busy,
    saving,
    setProviderForm,
    optionsFor,
    chooseModel,
    chooseEffort
  } = useAppContext()
  const { testProvider, deleteProvider } = useProviderActions()
  return (
    <article className="provider-card">
      <h3>
        {provider.name} {provider.active && <span className="pill">使用中</span>}
      </h3>
      <p>
        {provider.protocol} · {provider.model || '未设置默认模型'}
      </p>
      <small>{provider.base_url}</small>
      <ModelPicker
        provider={provider}
        value={optionsFor(provider)}
        disabled={!!busy}
        onModel={(model) => chooseModel(provider, model)}
        onEffort={(effort) => chooseEffort(provider, effort)}
      />
      <div className="provider-actions">
        <button
          disabled={provider.active || !!busy}
          onClick={() =>
            void guarded(async () =>
              setProviders(await api.request('providers.select', { id: provider.id }))
            )
          }
        >
          设为当前
        </button>
        <button disabled={saving} onClick={() => setProviderForm(editProvider(provider))}>
          编辑
        </button>
        <button disabled={!!busy} onClick={() => void testProvider(provider)}>
          测试连接（会调用 API）
        </button>
        <button
          disabled={saving || !!busy}
          className="danger-text"
          onClick={() => void deleteProvider(provider)}
        >
          删除
        </button>
      </div>
    </article>
  )
}
