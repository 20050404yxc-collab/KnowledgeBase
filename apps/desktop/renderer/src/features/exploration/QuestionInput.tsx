// 文件：QuestionInput.tsx
// 层：React 页面／组件
// 作用：管理问题输入、快捷提交和本地路径粘贴。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 管理问题输入、快捷提交和本地路径粘贴。
export function QuestionInput() {
  const { query, setQuery, answerQuestion, addFiles } = useAppContext()
  return (
    <textarea
      id="question"
      placeholder="想了解什么？输入问题，或把文档拖到这里…"
      value={query}
      maxLength={12000}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          void answerQuestion()
        }
      }}
      onPaste={(event) => {
        const value = event.clipboardData.getData('text').trim()
        if (/^(?:"?[a-zA-Z]:[\\/]|"?\\\\)/.test(value) && !value.includes('\n')) {
          event.preventDefault()
          void addFiles([value.replace(/^"|"$/g, '')])
        }
      }}
    />
  )
}
