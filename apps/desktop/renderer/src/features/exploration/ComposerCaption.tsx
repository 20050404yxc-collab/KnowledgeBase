// 文件：ComposerCaption.tsx
// 层：React 页面／组件
// 作用：显示当前生成接口及提问范围说明。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { ModelPicker } from '../providers'
import { useAppContext } from '../../app/AppContext'

// 显示当前生成接口及提问范围说明。
export function ComposerCaption() {
  const { activeProvider, generationOptions, chooseModel, chooseEffort, busy, selectionNotice } =
    useAppContext()
  return (
    <div className="composer-caption">
      <span>⌁ {activeProvider ? activeProvider.name : '本地模式 · 配置 API 后可生成学习内容'}</span>
      {activeProvider && (
        <ModelPicker
          provider={activeProvider}
          value={generationOptions}
          disabled={!!busy}
          onModel={(model) => chooseModel(activeProvider, model)}
          onEffort={(effort) => chooseEffort(activeProvider, effort)}
        />
      )}
      {selectionNotice && <small role="status">{selectionNotice}</small>}
      <span>
        关键词检索 <span className="caption-dot">·</span> Ctrl + Enter 发送
      </span>
    </div>
  )
}
