// 文件：request_registry.ts
// 层：Electron 桌面宿主
// 作用：关联请求、超时与 Promise 终态。
// 说明：每个请求只结算一次，同时释放定时器。
interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export const REQUEST_TIMEOUT_MS = 180_000
export class RequestRegistry {
  private entries = new Map<string, Pending>()
  // 超时先撤销关联，再取消后台；晚到消息不改变终态。
  register(id: string, cancel: () => void): Promise<unknown> {
    if (this.entries.has(id)) {
      return Promise.reject(new Error('任务正在执行'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(id)
        cancel()
        reject(new Error('任务超时，请重试'))
      }, REQUEST_TIMEOUT_MS)
      this.entries.set(id, { resolve, reject, timer })
    })
  }
  // 事件只发给仍有关联的请求。
  has(id: string): boolean {
    return this.entries.has(id)
  }
  // 成功、失败和重复消息共用同一回收路径。
  settle(id: string, value: unknown, error?: Error): void {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    clearTimeout(entry.timer)
    this.entries.delete(id)
    if (error) {
      entry.reject(error)
    } else {
      entry.resolve(value)
    }
  }
  // 后台退出不能遗留永远等待的 Promise。
  failAll(error: Error): void {
    for (const id of this.entries.keys()) {
      this.settle(id, undefined, error)
    }
  }
}
