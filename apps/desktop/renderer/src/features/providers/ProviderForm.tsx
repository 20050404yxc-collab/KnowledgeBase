// 文件：ProviderForm.tsx
// 层：React 页面／组件
// 作用：收集接口协议、模型和凭据并提交配置。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { api } from '../../shared/api/client'
import { useAppContext } from '../../app/AppContext'

import { blankProvider } from './provider_form'
import { ConnectionFields } from './ConnectionFields'
import { ModelFields } from './ModelFields'
import { useEffect } from 'react'

import { PriceInputs } from './PriceInputs'

// 收集接口协议、模型和凭据并提交配置。
export function ProviderForm() {
  const {
    setMessage,
    guarded,
    setProviders,
    saving,
    setSaving,
    providerForm,
    setProviderForm,
    cancelDiscovery
  } = useAppContext()
  useEffect(() => () => cancelDiscovery(), [cancelDiscovery])
  return (
    <form
      className="panel provider-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (saving) {
          return
        }
        cancelDiscovery()
        setSaving(true)
        void guarded(async () => {
          setProviders(await api.request('providers.save', providerForm))
          setProviderForm(blankProvider)
          setMessage('配置已保存，凭据未写入普通配置文件')
        }).finally(() => setSaving(false))
      }}
    >
      <h2>{providerForm.id ? '编辑接口' : '添加接口'}</h2>
      <fieldset disabled={saving}>
        <ConnectionFields />
        <ModelFields key={providerForm.id ?? 'new'} />
        <label>
          API Key
          <input
            required={!providerForm.id}
            placeholder={providerForm.id ? '留空保留已保存的 Key' : '填写 API Key'}
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
          {providerForm.id ? '保存修改' : '保存接口'}
        </button>
        <button type="button" disabled={saving} onClick={() => setProviderForm(blankProvider)}>
          取消
        </button>
      </fieldset>
    </form>
  )
}
