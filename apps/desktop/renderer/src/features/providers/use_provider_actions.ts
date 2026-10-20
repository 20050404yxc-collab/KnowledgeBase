// 文件：use_provider_actions.ts
// 层：React 交互 hook
// 作用：协调接口连接测试与删除。
// 说明：测试使用会话所选模型，删除不复活过期编辑草稿。
import type { Provider } from '../../../../../../contracts/desktop'
import { useAppContext } from '../../app/AppContext'
import { api } from '../../shared/api/client'
import { blankProvider } from './provider_form'

// 连接测试产生调用记录，参数在提交时固定；所有退出路径释放请求关联。
export function useProviderActions() {
  const state = useAppContext()
  const testProvider = (provider: Provider) =>
    state.runTask(async () => {
      const value = await state.taskRequest('providers.test', {
        id: provider.id,
        ...state.optionsFor(provider)
      })
      state.setMessage(value.message)
    })
  const deleteProvider = async (provider: Provider) => {
    if (!confirm('删除接口配置和 Windows 中保存的凭据？知识不受影响。')) {
      return
    }
    await state.guarded(async () => {
      state.setProviders(await api.request('providers.delete', { id: provider.id }))
      if (state.providerForm.id === provider.id) {
        state.setProviderForm(blankProvider)
      }
    })
  }
  return { testProvider, deleteProvider }
}
