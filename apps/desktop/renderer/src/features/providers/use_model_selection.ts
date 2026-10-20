// 文件：use_model_selection.ts
// 层：React 交互 hook
// 作用：按接口维护当前会话的模型和推理强度。
// 说明：覆盖值不写回默认值，配置变化时失效旧选择。
import { useEffect, useState } from 'react'
import type {
  GenerationOptions,
  Provider,
  ReasoningEffort
} from '../../../../../../contracts/desktop'

interface Selection {
  model: string
  effort: ReasoningEffort
  signature: string
}
// 配置变化后旧覆盖失效，重启自然回到默认值。
function signature(provider: Provider): string {
  return JSON.stringify([provider.protocol, provider.base_url, provider.model, provider.models])
}
// 返回各接口独立的有效选择，并提示目录变更造成的重置。
export function useModelSelection(providers: Provider[]) {
  const [selections, setSelections] = useState<Record<string, Selection>>({})
  const [selectionNotice, setSelectionNotice] = useState('')
  useEffect(() => {
    const invalid = Object.entries(selections).filter(([id, value]) => {
      const provider = providers.find((item) => item.id === id)
      return !provider || value.signature !== signature(provider)
    })
    if (invalid.length) {
      setSelections((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !invalid.some(([key]) => key === id))
        )
      )
      setSelectionNotice('接口或模型列表已变更，临时选择已重置，请核对模型')
    }
  }, [providers, selections])
  const optionsFor = (provider?: Provider): GenerationOptions => {
    if (!provider) {
      return {}
    }
    const value = selections[provider.id]
    const valid = value?.signature === signature(provider)
    return {
      provider_id: provider.id,
      model: valid ? value.model : '',
      reasoning_effort: valid ? value.effort : 'auto'
    }
  }
  const chooseModel = (provider: Provider, model: string) => {
    setSelectionNotice('')
    setSelections((current) => ({
      ...current,
      [provider.id]: { model, effort: 'auto', signature: signature(provider) }
    }))
  }
  const chooseEffort = (provider: Provider, effort: string) => {
    if (effort !== 'auto' && effort !== 'low' && effort !== 'medium' && effort !== 'high') {
      throw new Error('无效推理强度')
    }
    setSelections((current) => ({
      ...current,
      [provider.id]: {
        model: optionsFor(provider).model ?? '',
        effort,
        signature: signature(provider)
      }
    }))
  }
  return { optionsFor, chooseModel, chooseEffort, selectionNotice }
}
