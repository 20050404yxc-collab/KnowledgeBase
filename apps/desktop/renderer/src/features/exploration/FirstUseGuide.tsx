// 文件：FirstUseGuide.tsx
// 层：React 展示组件
// 作用：在没有模型接口时提供本地记录与 AI 学习的起步入口。
// 说明：不触发联网请求；保存接口后不再显示首次配置引导。
import { useAppContext } from '../../app/AppContext'

// 本地笔记无需配置即可使用，模型学习步骤与现有目录流程一致。
export function FirstUseGuide() {
  const { ready, providers, setEditor, setSection } = useAppContext()
  // 等待启动完成，避免已配置用户在加载期间闪现首次使用状态。
  if (!ready || providers.length) {
    return null
  }
  return (
    <aside className="first-use-guide" aria-label="开始使用知序">
      <div>
        <strong>从一条笔记开始，也可以用 AI 学习</strong>
        <p>本地笔记和搜索可直接使用。AI 学习：配置接口 → 生成目录 → 选择知识点。</p>
      </div>
      <div className="first-use-actions">
        <button onClick={() => setEditor({ title: '', content: '' })}>先写一条笔记</button>
        <button onClick={() => setSection('设置')}>设置 AI 接口</button>
      </div>
    </aside>
  )
}
