// 文件：diagnostics.ts
// 层：Electron 桌面宿主／诊断
// 作用：异步写入有界滚动日志并关联会话。
// 说明：主进程独占 desktop.log；日志失败不覆盖业务异常。
import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { diagnosticError } from '../shared/diagnostic_error'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const LOG_BACKUPS = 5
const MAX_QUEUE = 1024
export const sessionId = randomUUID()
// 单实例宿主拥有日志队列；退出前 flushDiagnostics 等待已接收记录落盘。
let logger: DiagnosticLog | undefined

export class DiagnosticLog {
  private queue: string[] = []
  private draining?: Promise<void>
  private dropped = 0
  private bytes?: number
  private warned = false
  private path: string

  // 可传入小容量供隔离轮转测试；实际应用沿用统一默认容量。
  constructor(
    private directory: string,
    private maxBytes = MAX_LOG_BYTES
  ) {
    this.path = join(directory, 'desktop.log')
  }

  // 只接受调用点显式提供的标量字段，不序列化业务参数或任意 Error。
  write(
    event: string,
    fields: Record<string, string | number | boolean | undefined> = {},
    error?: unknown
  ): void {
    // 拥塞时计数；不让故障风暴造成无限内存增长。
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++
      return
    }
    const entry = {
      time: new Date().toISOString(),
      level: error === undefined ? 'info' : 'error',
      process: 'desktop',
      pid: process.pid,
      session_id: sessionId,
      event,
      ...fields,
      ...(error === undefined ? {} : diagnosticError(error)),
      dropped: this.dropped
    }
    this.dropped = 0
    this.queue.push(JSON.stringify(entry) + '\n')
    this.draining ??= this.drain()
  }

  // 初始化和追加均异步执行，主事件循环不等待同步磁盘访问。
  private async drain(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true })
      this.bytes ??= await stat(this.path)
        .then((value) => value.size)
        .catch((error: unknown) => {
          // 文件尚不存在是正常首次启动；其他磁盘错误交给统一失败分支。
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return 0
          }
          throw error
        })
      // 同一队列串行轮转和追加，避免并发 rename 或日志互相覆盖。
      while (this.queue.length || this.dropped) {
        // 最后一波拥塞即使没有后续记录，也留下丢弃计数。
        if (!this.queue.length) {
          this.queue.push(
            JSON.stringify({
              time: new Date().toISOString(),
              level: 'warn',
              process: 'desktop',
              pid: process.pid,
              session_id: sessionId,
              event: 'diagnostics.dropped',
              dropped: this.dropped
            }) + '\n'
          )
          this.dropped = 0
        }
        const line = this.queue[0]
        const size = Buffer.byteLength(line)
        if (this.bytes + size > this.maxBytes && this.bytes > 0) {
          await this.rotate()
        }
        await appendFile(this.path, line, 'utf8')
        this.bytes += size
        this.queue.shift()
      }
      this.warned = false
    } catch {
      this.dropped += this.queue.length
      this.queue = []
      this.bytes = undefined
      // 失败提示固定文字，不把诊断异常或原始记录再泄漏到控制台。
      if (!this.warned) {
        console.error('KnowledgeBase diagnostic write failed; check disk space and permissions.')
        this.warned = true
      }
    } finally {
      this.draining = undefined
    }
  }

  // 只有当前进程的 desktop.log 参与轮转，不访问 worker.log 或其他数据。
  private async rotate(): Promise<void> {
    await unlink(`${this.path}.${LOG_BACKUPS}`).catch(ignoreMissing)
    for (let index = LOG_BACKUPS - 1; index >= 1; index--) {
      await rename(`${this.path}.${index}`, `${this.path}.${index + 1}`).catch(ignoreMissing)
    }
    await rename(this.path, `${this.path}.1`)
    this.bytes = 0
  }

  // 退出装配点负责停止新日志后调用；不接管业务资源。
  async flush(): Promise<void> {
    await this.draining
  }
}

// 缺少旧轮转文件属于正常状态，权限或磁盘错误不能伪装成成功。
function ignoreMissing(error: unknown): void {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
    throw error
  }
}

// 数据目录由桌面启动装配点给定，与既有 KB_DATA_DIR 隔离规则一致。
export function configureDiagnostics(dataDir: string): void {
  logger = new DiagnosticLog(join(dataDir, 'logs'))
}

// 未装配的单元测试和模块导入不创建文件或访问正式数据。
export function diagnostic(
  event: string,
  fields: Record<string, string | number | boolean | undefined> = {},
  error?: unknown
): void {
  logger?.write(event, fields, error)
}

// 正常关闭时把已排队的记录落盘；突然断电不保证最后一批日志完整。
export async function flushDiagnostics(): Promise<void> {
  await logger?.flush()
}
