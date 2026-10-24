// 文件：use_app_model.ts
// 层：React 应用装配
// 作用：组合功能状态，不集中实现各页面业务。
// 说明：通过受限 API 操作，不访问底层存储或供应商。
import { useFeedback } from '../shared/api/use_feedback'
import { useNavigation } from './use_navigation'
import { useLibrary } from './use_library'
import { useReading } from '../features/knowledge/use_reading'
import { useKnowledge } from '../features/knowledge/use_knowledge'
import { useDirectory } from '../features/exploration/use_directory'
import { useExploration } from '../features/exploration/use_exploration'
import { useModelSelection } from '../features/providers'
import { useProviderForm } from '../features/providers/use_provider_form'
import { useSessionTask } from './use_session_task'
import { useSavedTree } from '../features/knowledge/use_saved_tree'
import { useRestructure } from '../features/knowledge/use_restructure'
import { useGlobalSearch } from '../features/search/use_global_search'
import { useSelectionQuestions } from '../features/selection'
import type { GenerationOptions } from '../../../../../contracts/desktop'

// 上层组合功能 hook，只连接已声明的能力与状态。
export function useAppModel(resetSession: () => void) {
  const navigation = useNavigation()
  const globalSearch = useGlobalSearch(navigation)
  const feedback = useFeedback(navigation.section)
  const task = useSessionTask(navigation.section, feedback)
  const library = useLibrary({ ...feedback, ...navigation })
  const tree = useSavedTree(navigation.section, navigation.filter, library.dataRevision)
  const reading = useReading(navigation.section, globalSearch.globalSearchRevision)
  const knowledge = useKnowledge({ ...feedback, ...library, ...reading })
  const selection = useModelSelection(library.providers)
  const generationOptions = selection.optionsFor(library.activeProvider)
  const restructure = useRestructure({
    ...task,
    ...feedback,
    generationOptions,
    reload: library.reload
  })
  const exploration = useExploration({
    ...feedback,
    ...navigation,
    ...library,
    ...reading,
    ...task,
    generationOptions
  })
  const directory = useDirectory({
    ...feedback,
    ...navigation,
    ...reading,
    ...knowledge,
    ...exploration,
    reload: library.reload,
    generationOptions
  })
  const providerForm = useProviderForm()
  const chatDependencies = {
    ...task,
    section: navigation.section,
    generationOptions,
    reload: library.reload
  }
  const selectionChat = useSelectionQuestions(chatDependencies)
  const answerQuestion = (text = exploration.query) =>
    startAnswer(exploration, feedback, selectionChat, generationOptions, text)
  return {
    selectionChat,
    answerQuestion,
    resetSession,
    ...globalSearch,
    ...feedback,
    ...navigation,
    ...library,
    ...reading,
    ...knowledge,
    ...exploration,
    ...directory,
    ...providerForm,
    ...selection,
    ...task,
    openItem: directory.openLocalItem,
    ...tree,
    ...restructure,
    generationOptions
  }
}
export type AppModel = ReturnType<typeof useAppModel>

// 根节点冻结本次范围；附件解析未完成时不创建问答或调用模型。
async function startAnswer(
  exploration: ReturnType<typeof useExploration>,
  feedback: ReturnType<typeof useFeedback>,
  selectionChat: ReturnType<typeof useSelectionQuestions>,
  generationOptions: GenerationOptions,
  text: string
) {
  if (!text.trim()) {
    return
  }
  if (exploration.attachments.some((item) => item.state === 'loading')) {
    feedback.setError('附件仍在解析，请等待完成或移除后提问')
    return
  }
  const ids = exploration.attachments.flatMap((item) =>
    item.state === 'ready' && item.id ? [item.id] : []
  )
  await selectionChat.startQuestion({
    query: text,
    scope: !ids.length && exploration.scope !== 'files' ? 'knowledge' : exploration.scope,
    attachment_ids: ids,
    purpose: 'question',
    ...generationOptions
  })
}
