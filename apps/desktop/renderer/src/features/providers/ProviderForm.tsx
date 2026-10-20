// 文件：ProviderForm.tsx
// 层：React 页面／组件
// 作用：收集接口协议、模型和凭据并提交配置。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

import { blankProvider, readProtocol } from './provider_form'

import { PriceInputs } from './PriceInputs'

// 收集接口协议、模型和凭据并提交配置。
export function ProviderForm() {
  const { setMessage, guarded, setProviders, saving, setSaving, providerForm, setProviderForm } =
    useAppContext()
  return (
    <form
      className="panel provider-form"
      onSubmit={(event) => {
        event.preventDefault()
        setSaving(true)
        void guarded(async () => {
          setProviders(await api.request('providers.save', providerForm))
          setProviderForm(blankProvider)
          setMessage('配置已保存，凭据未写入普通配置文件')
        }).finally(() => setSaving(false))
      }}
    >
      <h2>添加接口</h2>
      <ConnectionFields />
      <label>
        模型 ID
        <input
          required
          maxLength={160}
          placeholder="填写接口支持的实际模型 ID"
          value={providerForm.model}
          onChange={(e) => setProviderForm({ ...providerForm, model: e.target.value })}
        />
      </label>
      <label>
        API Key
        <input
          required
          type="password"
          autoComplete="off"
          value={providerForm.key}
          onChange={(e) => setProviderForm({ ...providerForm, key: e.target.value })}
        />
      </label>
      <PriceInputs />
      <p className="subtle">
        价格由你填写，用于估算；不代表供应商账单。DeepSeek / Grok 等请按其实际兼容协议填写。
      </p>
      <button className="primary" disabled={saving}>
        保存接口
      </button>
    </form>
  )
}

// 名称、协议和基础地址共同确定连接，不处理凭据存储。
function ConnectionFields() {
  const { providerForm, setProviderForm } = useAppContext()
  return (
    <>
      <label>
        配置名称
        <input
          required
          maxLength={80}
          placeholder="例如：我的 GPT 接口"
          value={providerForm.name}
          onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
        />
      </label>
      <label>
        实际接口协议
        <select
          value={providerForm.protocol}
          onChange={(e) =>
            setProviderForm({ ...providerForm, protocol: readProtocol(e.target.value) })
          }
        >
          <option value="responses">OpenAI Responses</option>
          <option value="chat-completions">Chat Completions 兼容接口</option>
          <option value="anthropic">Anthropic Messages</option>
        </select>
      </label>
      <label>
        基础地址（包含 /v1 等前缀）
        <input
          required
          type="url"
          value={providerForm.base_url}
          onChange={(e) => setProviderForm({ ...providerForm, base_url: e.target.value })}
        />
      </label>
    </>
  )
}
