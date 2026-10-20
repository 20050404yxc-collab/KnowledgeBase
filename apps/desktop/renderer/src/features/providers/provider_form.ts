// 文件：provider_form.ts
// 层：React 接口配置功能
// 作用：声明接口表单默认值和协议校验。
// 说明：表单值不包含已保存的系统凭据。
import type { Provider } from '../../../../../../contracts/desktop'
export const blankProvider = {
  name: '',
  protocol: 'responses' as Provider['protocol'],
  base_url: 'https://api.openai.com/v1',
  model: '',
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
