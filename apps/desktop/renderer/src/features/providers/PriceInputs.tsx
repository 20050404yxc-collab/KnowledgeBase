// 文件：PriceInputs.tsx
// 层：React 页面／组件
// 作用：收集按百万 token 计价的输入输出价格与币种。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 收集按百万 token 计价的输入输出价格与币种。
export function PriceInputs() {
  const { providerForm, setProviderForm } = useAppContext()
  return (
    <div className="price-inputs">
      <label>
        输入 / 百万 token
        <input
          type="number"
          min="0"
          step="any"
          placeholder="未知留空"
          value={providerForm.input_price ?? ''}
          onChange={(e) =>
            setProviderForm({
              ...providerForm,
              input_price: e.target.value,
              prices_confirmed: true
            })
          }
        />
      </label>
      <label>
        输出 / 百万 token
        <input
          type="number"
          min="0"
          step="any"
          placeholder="未知留空"
          value={providerForm.output_price ?? ''}
          onChange={(e) =>
            setProviderForm({
              ...providerForm,
              output_price: e.target.value,
              prices_confirmed: true
            })
          }
        />
      </label>
      <label>
        币种
        <select
          value={providerForm.currency}
          onChange={(e) => setProviderForm({ ...providerForm, currency: e.target.value })}
        >
          {['USD', 'CNY', 'EUR'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
