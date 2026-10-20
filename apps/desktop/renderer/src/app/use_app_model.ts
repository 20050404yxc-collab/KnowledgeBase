// 文件：use_app_model.ts
// 层：React 应用装配
// 作用：组合功能状态，不集中实现各页面业务。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useFeedback } from '../shared/api/use_feedback'
import { useNavigation } from './use_navigation'
import { useLibrary } from './use_library'
import { useReading } from '../features/knowledge/use_reading'
import { useKnowledge } from '../features/knowledge/use_knowledge'
import { useExploration } from '../features/exploration/use_exploration'
import { useProviderForm } from '../features/providers/use_provider_form'

// 上层组合功能 hook，只连接已声明的能力与状态。
export function useAppModel() {
  const feedback = useFeedback()
  const navigation = useNavigation()
  const library = useLibrary({ ...feedback, ...navigation })
  const reading = useReading()
  const knowledge = useKnowledge({ ...feedback, ...library, ...reading })
  const exploration = useExploration({ ...feedback, ...navigation, ...library, ...reading })
  const providerForm = useProviderForm()
  return {
    ...feedback,
    ...navigation,
    ...library,
    ...reading,
    ...knowledge,
    ...exploration,
    ...providerForm
  }
}
export type AppModel = ReturnType<typeof useAppModel>
