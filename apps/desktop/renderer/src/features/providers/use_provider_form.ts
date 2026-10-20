// 文件：use_provider_form.ts
// 层：React 交互 hook
// 作用：管理接口草稿、编辑和模型发现。
// 说明：所有草稿变化使旧请求失效，密钥保存或取消后清空。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject, SetStateAction } from 'react'
import { api, errorText } from '../../shared/api/client'
import { blankProvider, type ProviderFormValue } from './provider_form'

// 草稿状态只由当前表单拥有，请求失效同步发生以避免渲染间隙串入旧响应。
export function useProviderForm() {
  const [providerForm, updateForm] = useState(blankProvider)
  const [discovering, setDiscovering] = useState(false)
  const [discoveryNotice, setDiscoveryNotice] = useState('')
  const pending = useRef<string | null>(null)
  const revision = useRef(0)
  const cancelDiscovery = useCallback(() => {
    revision.current++
    const id = pending.current
    pending.current = null
    if (id) {
      void api.cancel(id).catch(() => setDiscoveryNotice('停止等待；后台取消未确认'))
    }
    setDiscovering(false)
  }, [])
  const setProviderForm = useCallback(
    (value: SetStateAction<ProviderFormValue>) => {
      cancelDiscovery()
      setDiscoveryNotice('')
      updateForm(value)
    },
    [cancelDiscovery]
  )
  useDiscoveryCleanup(pending, revision)
  const fetchModels = async () => {
    cancelDiscovery()
    const version = revision.current
    const id = crypto.randomUUID()
    pending.current = id
    setDiscovering(true)
    setDiscoveryNotice('')
    try {
      const { id: configId, protocol, base_url, key } = providerForm
      const result = await api.request(
        'providers.models',
        { id: configId, protocol, base_url, key },
        id
      )
      if (version !== revision.current) {
        return
      }
      const models = [...new Set([...providerForm.models, ...result.models])]
      if (models.length > 1000) {
        throw new Error('合并后超过 1000 个模型，已有列表保留，请先移除部分模型')
      }
      updateForm((current) => ({ ...current, models }))
      setDiscoveryNotice(
        result.partial
          ? '已获取部分模型，达到分页上限，可手动补充'
          : `已获取 ${result.models.length} 个模型，保存后生效`
      )
    } catch (error) {
      if (version === revision.current) {
        setDiscoveryNotice(errorText(error))
      }
    } finally {
      if (version === revision.current) {
        pending.current = null
        setDiscovering(false)
      }
    }
  }
  return {
    providerForm,
    setProviderForm,
    discovering,
    discoveryNotice,
    fetchModels,
    cancelDiscovery
  }
}

// 卸载时只取消请求，由同步版本号拒绝晚到响应。
function useDiscoveryCleanup(pending: RefObject<string | null>, revision: RefObject<number>) {
  useEffect(
    () => () => {
      // 卸载只发取消，不再更新组件状态，晚到成功和失败都由版本号拒绝。
      revision.current++
      const id = pending.current
      pending.current = null
      if (id) {
        void api.cancel(id).catch((error) => {
          console.warn(errorText(error))
        })
      }
    },
    []
  )
}
