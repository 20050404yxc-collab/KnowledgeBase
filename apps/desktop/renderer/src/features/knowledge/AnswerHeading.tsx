// 文件：AnswerHeading.tsx
// 层：React 页面／组件
// 作用：显示回答标题、收录状态和手动保存入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示回答标题、收录状态和手动保存入口。
export function AnswerHeading() {
  const { selected, answer, selectedPoint, section } = useAppContext()
  let label = '未收录内容'
  // 以正式知识快照确认保存位置；待核对补充仍未提交，不继承成功标签。
  if (selected) {
    label = `已保存 · ${selected.bucket} · ${selected.generated ? 'AI 学习内容' : '个人笔记'}`
  }
  if (answer?.review) {
    label = '待核对补充 · 尚未保存'
  }
  return (
    <div className="answer-heading">
      <div>
        <span className="pill">{label}</span>
        <h2>
          {selected?.title ?? (section === '探索' ? selectedPoint?.title : null) ?? '检索与回答'}
        </h2>
      </div>
    </div>
  )
}
