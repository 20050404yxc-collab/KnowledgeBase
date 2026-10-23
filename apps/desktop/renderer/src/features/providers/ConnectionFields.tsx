// 文件：ConnectionFields.tsx
// 层：React 页面／组件
// 作用：收集接口名称、协议和基础地址。
// 说明：不读取凭据或直接请求供应商。
import { useAppContext } from '../../app/AppContext'
import { readProtocol } from './provider_form'
import { ProviderPresets } from './ProviderPresets'

// 名称、协议和基础地址共同确定连接，不处理凭据存储。
export function ConnectionFields() {
  const { providerForm, setProviderForm } = useAppContext()
  return (
    <>
      <ProviderPresets />
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
