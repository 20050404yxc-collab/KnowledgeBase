// 文件：SelectableText.tsx
// 层：React 页面／组件
// 作用：在同一来源的可见正文中捕获鼠标或键盘选区。
// 说明：仅显式点击开启会话；滚动、切换来源或卸载会移除浮动入口。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SelectionSource } from '../../../../../../contracts/selection'
import { useAppContext } from '../../app/AppContext'

type Props = { source?: SelectionSource; children: ReactNode }
// 冻结选中文字后再显示入口，按钮按下不会抹掉原选区。
export function SelectableText({ source, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null)
  const { selectionChat } = useAppContext()
  const identity = JSON.stringify(source)
  useEffect(() => {
    setSelection(null)
    const clear = () => setSelection(null)
    // 选区移到别处时撤销旧入口；点击按钮前的 pointerdown 保留当前范围。
    const changed = () => {
      const current = window.getSelection()
      if (
        !current ||
        current.isCollapsed ||
        !ref.current?.contains(current.anchorNode) ||
        !ref.current.contains(current.focusNode)
      ) {
        setSelection(null)
      }
    }
    window.addEventListener('scroll', clear, true)
    document.addEventListener('selectionchange', changed)
    return () => {
      window.removeEventListener('scroll', clear, true)
      document.removeEventListener('selectionchange', changed)
    }
  }, [identity])
  // 两个端点必须都属于该正文，跨卡片和输入框选择不会带入错误来源。
  function inspect() {
    const value = window.getSelection()
    if (
      !source ||
      !value?.rangeCount ||
      value.isCollapsed ||
      !ref.current?.contains(value.anchorNode) ||
      !ref.current.contains(value.focusNode)
    ) {
      setSelection(null)
      return
    }
    const text = value.toString().trim()
    const rect = value.getRangeAt(0).getBoundingClientRect()
    setSelection(
      text
        ? {
            text,
            x: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
            y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 65))
          }
        : null
    )
  }
  return (
    <div
      ref={ref}
      className={source ? 'selectable-text' : undefined}
      onPointerUp={inspect}
      onKeyUp={inspect}
    >
      {children}
      {selection && source && (
        <button
          className="selection-trigger"
          style={{ left: selection.x, top: selection.y }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            void selectionChat.open(source, selection.text)
            setSelection(null)
          }}
          disabled={selection.text.length > 6000}
        >
          {selection.text.length > 6000 ? '选区过长，请缩至 6000 字符' : '就选中文字提问'}
        </button>
      )}
    </div>
  )
}
