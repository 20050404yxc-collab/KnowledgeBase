// 文件：ProviderPresets.tsx
// 层：React 展示组件
// 作用：为空白接口表单提供明确的连接起点与配置步骤。
// 说明：不预设模型、价格或凭据；编辑或已有输入时不提供覆盖入口。
import { useAppContext } from '../../app/AppContext'
import type { ProviderFormValue } from './provider_form'

const PRESETS: { name: string; protocol: ProviderFormValue['protocol']; base_url: string }[] = [
  { name: 'OpenAI 官方', protocol: 'responses', base_url: 'https://api.openai.com/v1' },
  { name: 'Anthropic 官方', protocol: 'anthropic', base_url: 'https://api.anthropic.com/v1' },
  { name: '自定义兼容接口', protocol: 'chat-completions', base_url: '' }
]

// 仅空白新增表单能填入模板；任何模型、价格或密钥输入都视为用户草稿。
export function ProviderPresets() {
  const { providerForm: form, setProviderForm } = useAppContext()
  const pristine =
    !form.id &&
    !form.name &&
    form.protocol === 'responses' &&
    form.base_url === 'https://api.openai.com/v1' &&
    !form.key &&
    !form.model &&
    !form.models.length &&
    !form.model_prices.length &&
    form.currency === 'USD' &&
    form.input_price === '' &&
    form.output_price === ''
  // 编辑现有配置时不提示重新从模板开始，原配置及系统密钥保持既有保存语义。
  if (form.id) {
    return null
  }
  return (
    <div className="provider-start">
      <p>配置顺序：填写连接与 Key → 获取或手动添加模型 → 选择默认模型 → 保存接口。</p>
      {pristine && (
        <div className="provider-presets" role="group" aria-label="接口连接模板">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => setProviderForm({ ...form, ...preset })}
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}
      <p className="subtle">模板只填写连接信息；兼容接口请核对服务商文档中的协议和地址。</p>
    </div>
  )
}
