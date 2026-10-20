// 文件：provider_form.ts
// 层：React 接口配置功能
// 作用：声明接口表单默认值和协议校验。
// 说明：表单值不包含已保存的系统凭据。
import type { Provider, ProviderInput } from '../../../../../../contracts/desktop'
export type ProviderFormValue = ProviderInput & {
  models: string[]
  model_prices: NonNullable<ProviderInput['model_prices']>
}
export const blankProvider: ProviderFormValue = {
  name: '',
  protocol: 'responses' as Provider['protocol'],
  base_url: 'https://api.openai.com/v1',
  model: '',
  models: [],
  model_prices: [],
  key: '',
  input_price: '',
  output_price: '',
  currency: 'USD'
}
// 配置协议是枚举值，不能由任意字符串断言获得。
export function readProtocol(value: string): Provider['protocol'] {
  if (value === 'responses' || value === 'chat-completions' || value === 'anthropic') {
    return value
  }
  throw new Error('无效接口协议')
}

// 编辑只复制无密钥配置，密码框始终保持空白。
export function editProvider(provider: Provider): ProviderFormValue {
  return {
    ...provider,
    key: '',
    model_prices:
      provider.model_prices ??
      (provider.model && (provider.input_price !== null || provider.output_price !== null)
        ? [
            {
              model: provider.model,
              input_price: provider.input_price,
              output_price: provider.output_price,
              currency: provider.currency
            }
          ]
        : []),
    input_price: provider.input_price ?? '',
    output_price: provider.output_price ?? '',
    prices_confirmed: true
  }
}
