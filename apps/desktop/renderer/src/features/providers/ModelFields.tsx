// 文件：ModelFields.tsx
// 层：React 页面／组件
// 作用：管理草稿模型目录及可空默认模型。
// 说明：获取只更新草稿，默认模型变化时旧单价失效。
import { useState } from 'react'
import { useAppContext } from '../../app/AppContext'

// 获取和手动添加共用目录，删除默认模型会同时清空默认和旧价格。
export function ModelFields() {
  const {
    providerForm,
    setProviderForm,
    discovering,
    discoveryNotice,
    fetchModels,
    cancelDiscovery
  } = useAppContext()
  const [manual, setManual] = useState('')
  const changeDefault = (model: string) =>
    setProviderForm({
      ...providerForm,
      model,
      input_price: '',
      output_price: '',
      prices_confirmed: true
    })
  const add = () => {
    const model = manual.trim()
    if (!model || model.length > 160 || providerForm.models.length >= 1000) {
      return
    }
    setProviderForm({ ...providerForm, models: [...new Set([...providerForm.models, model])] })
    setManual('')
  }
  return (
    <section className="model-fields">
      <div className="model-actions">
        <b>模型列表</b>
        <button type="button" disabled={discovering} onClick={() => void fetchModels()}>
          {discovering ? '获取中…' : '获取模型列表'}
        </button>
        {discovering && (
          <button type="button" onClick={cancelDiscovery}>
            停止获取
          </button>
        )}
      </div>
      <div className="manual-model">
        <input
          aria-label="手动模型 ID"
          maxLength={160}
          placeholder="输入模型 ID"
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" onClick={add}>
          手动添加
        </button>
      </div>
      <CatalogItems />
      {discoveryNotice && <p role="status">{discoveryNotice}</p>}
      <label>
        默认模型
        <select
          aria-label="默认模型"
          value={providerForm.model}
          onChange={(event) => changeDefault(event.target.value)}
        >
          <option value="">不设置默认模型</option>
          {providerForm.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <small>获取失败可手动添加；默认模型可留空，提问时再选择。</small>
    </section>
  )
}

// 删除默认模型会同时清空默认值及单价，保存前仍只影响草稿。
function CatalogItems() {
  const { providerForm, setProviderForm } = useAppContext()
  return (
    <div className="model-catalog">
      {providerForm.models.map((model) => (
        <div key={model}>
          <span>{model}</span>
          <button
            type="button"
            aria-label={`移除模型 ${model}`}
            onClick={() => {
              const draft = {
                ...providerForm,
                models: providerForm.models.filter((item) => item !== model)
              }
              if (draft.model === model) {
                draft.model = ''
                draft.input_price = ''
                draft.output_price = ''
                draft.prices_confirmed = true
              }
              setProviderForm(draft)
            }}
          >
            移除
          </button>
        </div>
      ))}
    </div>
  )
}
