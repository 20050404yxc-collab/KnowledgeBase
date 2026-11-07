// 文件：use_modal_focus.ts
// 层：React 应用交互
// 作用：限制模态键盘焦点，关闭后返回触发位置。
// 说明：Escape 点击已有关闭动作，保留编辑器的保存及放弃确认规则。
import { useEffect } from 'react'

// 只返回可见可用控件；折叠区、禁用字段和隐藏内容不参与 Tab 顺序。
function controls(modal: HTMLElement): HTMLElement[] {
  return Array.from(
    modal.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, a[href], summary, [tabindex="0"]'
    )
  ).filter((item) => item.getClientRects().length > 0 && !item.matches(':disabled, [hidden]'))
}

// 根节点安装一次监听和观察器，卸载完整清理，不能留下全局键盘处理器。
export function useModalFocus() {
  useEffect(() => {
    let previous: HTMLElement | null =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    let current: HTMLElement | null = null
    const focused = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !event.target.closest('.modal')) {
        previous = event.target
      }
    }
    const observe = () => {
      const modal = Array.from(document.querySelectorAll<HTMLElement>('.modal')).at(-1) ?? null
      if (modal === current) {
        return
      }
      const wasOpen = !!current
      current = modal
      if (modal) {
        if (!modal.contains(document.activeElement)) {
          controls(modal)[0]?.focus()
        }
      } else if (wasOpen && previous?.isConnected) {
        previous.focus({ preventScroll: true })
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (!current) {
        return
      }
      if (event.key === 'Escape') {
        const close = current.querySelector<HTMLButtonElement>(
          '.modal-heading button[aria-label^="关闭"]'
        )
        if (close && !close.disabled) {
          event.preventDefault()
          close.click()
        }
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const items = controls(current)
      const first = items[0],
        last = items.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }
      if (!current.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('focusin', focused)
    document.addEventListener('keydown', keydown, true)
    const observer = new MutationObserver(observe)
    observer.observe(document.body, { childList: true, subtree: true })
    observe()
    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', focused)
      document.removeEventListener('keydown', keydown, true)
    }
  }, [])
}
