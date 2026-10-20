// 文件：ComposerCaption.tsx
// 层：React 页面／组件
// 作用：显示当前生成接口及提问范围说明。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示当前生成接口及提问范围说明。
export function ComposerCaption() {
  const { activeProvider } = useAppContext()
  return (
    <div className="composer-caption">
      <span>
        ⌁{' '}
        {activeProvider
          ? activeProvider.name + ' · ' + activeProvider.model
          : '本地模式 · 配置 API 后可生成学习内容'}
      </span>
      <span>
        关键词检索 <span className="caption-dot">·</span> Ctrl + Enter 发送
      </span>
    </div>
  )
}
