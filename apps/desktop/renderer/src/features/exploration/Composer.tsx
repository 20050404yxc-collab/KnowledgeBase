// 文件：Composer.tsx
// 层：React 页面／组件
// 作用：组合问题输入、附件列表与提交工具栏。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

import { QuestionInput } from './QuestionInput'
import { AttachmentList } from './AttachmentList'
import { ComposerToolbar } from './ComposerToolbar'

// 组合问题输入、附件列表与提交工具栏。
export function Composer() {
  const { attachments, ask } = useAppContext()
  return (
    <section className="composer">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <label className="sr-only" htmlFor="question">
          输入问题
        </label>
        <QuestionInput />
        {attachments.length > 0 && <AttachmentList />}
        <ComposerToolbar />
      </form>
    </section>
  )
}
