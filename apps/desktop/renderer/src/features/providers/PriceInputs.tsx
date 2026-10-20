// 文件：PriceInputs.tsx
// 层：React 页面／组件
// 作用：按模型收集可选的输入输出单价和币种。
// 说明：不定价仍可记录 token，只有用量和两侧价格齐全才估算费用。
import { useState } from 'react'
import { useAppContext } from '../../app/AppContext'
import type { ModelPriceInput } from '../../../../../../contracts/desktop'

// 计价对象独立于默认生成模型，切换对象保留各自的草稿价格。
export function PriceInputs() {
  const { providerForm, setProviderForm } = useAppContext()
  const [selected, setSelected] = useState('')
  const model = providerForm.models.includes(selected)
    ? selected
    : providerForm.model || providerForm.models[0] || ''
  const price = providerForm.model_prices.find((item) => item.model === model)
  // 关闭后删除选中模型单价，不能替换为零价格。
  const toggle = (enabled: boolean) => {
    const prices = providerForm.model_prices.filter((item) => item.model !== model)
    setProviderForm({
      ...providerForm,
      model_prices: enabled
        ? [...prices, { model, input_price: '', output_price: '', currency: 'USD' }]
        : prices
    })
  }
  const change = (value: ModelPriceInput) =>
    setProviderForm({
      ...providerForm,
      model_prices: providerForm.model_prices.map((item) => (item.model === model ? value : item))
    })
  return (
    <section className="model-price-settings">
      <h3>模型价格（选填）</h3>
      <label>
        计价模型
        <select
          aria-label="计价模型"
          value={model}
          disabled={!model}
          onChange={(e) => setSelected(e.target.value)}
        >
          {!model && <option value="">先添加模型</option>}
          {providerForm.models.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="model-price-toggle">
        <input
          type="checkbox"
          aria-label="添加模型价格"
          disabled={!model}
          checked={!!price}
          onChange={(e) => toggle(e.target.checked)}
        />
        添加模型价格
      </label>
      {price && <PriceFields price={price} change={change} />}
      <small>每百万 token 单价；两侧价格和实际用量齐全才估算费用。留空表示未知，0 表示免费。</small>
    </section>
  )
}

// 数值在后台校验；草稿保留空字符串，区分未定价和显式免费。
function PriceFields({
  price,
  change
}: {
  price: ModelPriceInput
  change: (value: ModelPriceInput) => void
}) {
  return (
    <div className="price-inputs">
      <label>
        输入 / 百万 token
        <input
          aria-label="模型输入单价"
          type="number"
          min="0"
          step="any"
          placeholder="未知留空"
          value={price.input_price ?? ''}
          onChange={(e) => change({ ...price, input_price: e.target.value })}
        />
      </label>
      <label>
        输出 / 百万 token
        <input
          aria-label="模型输出单价"
          type="number"
          min="0"
          step="any"
          placeholder="未知留空"
          value={price.output_price ?? ''}
          onChange={(e) => change({ ...price, output_price: e.target.value })}
        />
      </label>
      <label>
        币种
        <select
          aria-label="模型计价币种"
          value={price.currency}
          onChange={(e) => change({ ...price, currency: e.target.value })}
        >
          {['USD', 'CNY', 'EUR'].map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
