// 文件：ExplorationHeading.tsx
// 层：React 页面／组件
// 作用：显示探索页面标题及新建笔记入口。
// 说明：通过受限 API 操作，不访问底层存储或供应商。

import { useAppContext } from '../../app/AppContext'

// 显示探索页面标题及新建笔记入口。
export function ExplorationHeading() {
  const { section, ready, setEditor } = useAppContext()
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">THINK · CONNECT · GROW</div>
        <h1>{section === '探索' ? '让每一次好奇，都有所积累。' : `${section}的知识`}</h1>
        <p>
          {section === '探索'
            ? '从一个问题开始，连接已有知识，发现新的可能。'
            : '按使用频率整理，随时回来继续学习。'}
        </p>
      </div>
      <button
        className="secondary"
        disabled={!ready}
        onClick={() => setEditor({ title: '', content: '' })}
      >
        ＋ 新建知识
      </button>
    </div>
  )
}
