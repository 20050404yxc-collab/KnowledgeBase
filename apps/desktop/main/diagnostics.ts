// 文件：diagnostics.ts
// 层：Electron 桌面宿主／诊断
// 作用：异步写入按日期编号的会话日志，并清理超过十四天的记录。
// 说明：主进程只管理桌面日志；日志失败不覆盖业务异常。
import { appendFile, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { diagnosticError } from '../shared/diagnostic_error'

const MAX_LOG_BYTES = 5 * 1024 * 1024
const LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const DESKTOP_LOG = /^(?:\d{4}-\d{2}-\d{2}-[1-9]\d*-desktop\.log|desktop\.log(?:\.[1-9]\d*)?)$/
const MAX_QUEUE = 1024
export const sessionId = randomUUID()
// 单实例宿主拥有日志队列；退出前 flushDiagnostics 等待已接收记录落盘。
let logger: DiagnosticLog | undefined

export class DiagnosticLog {
  private queue: string[] = []
  private draining?: Promise<void>
  private dropped = 0
  private bytes = 0
  private warned = false
  private path?: string
  private lastCleanup?: number

  // 时钟和小容量用于隔离边界测试；每个实例首次写入独占一个新文件。
  constructor(
    private directory: string,
    private maxBytes = MAX_LOG_BYTES,
    private now: () => Date = () => new Date()
  ) {}

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
      await this.cleanupExpired()
      // 独占创建后才追加，重启和容量分段都不会覆盖或接续历史文件。
      if (!this.path) {
        await this.rotate()
      }
      if (!this.path) {
        throw new Error('Diagnostic file unavailable')
      }
      // 同一队列串行创建和追加，避免并发分段或日志互相覆盖。
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
      // 写入可能只完成部分字节；恢复时换新文件，避免继续拼接损坏记录。
      this.path = undefined
      // 失败提示固定文字，不把诊断异常或原始记录再泄漏到控制台。
      if (!this.warned) {
        console.error('KnowledgeBase diagnostic write failed; check disk space and permissions.')
        this.warned = true
      }
    } finally {
      this.draining = undefined
    }
  }

  // 当天序号延续已有最大值；排他创建处理其他实例同时占用候选名称的情况。
  private async rotate(): Promise<void> {
    const today = this.now()
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('-')
    const names = await readdir(this.directory)
    let index = names.reduce((highest, name) => {
      const match = /^(\d{4}-\d{2}-\d{2})-([1-9]\d*)-desktop\.log$/.exec(name)
      return match?.[1] === date ? Math.max(highest, Number(match[2])) : highest
    }, 0)
    // 只在名称已被占用时尝试下个序号；权限等故障交给固定失败提示。
    while (true) {
      const candidate = join(this.directory, `${date}-${++index}-desktop.log`)
      try {
        const file = await open(candidate, 'wx')
        await file.close()
        this.path = candidate
        this.bytes = 0
        return
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error
        }
      }
    }
  }

  // 启动及持续运行后的首次日常写入触发清理；不跟随符号链接或删除当前文件。
  private async cleanupExpired(): Promise<void> {
    const now = this.now().getTime()
    if (this.lastCleanup !== undefined && now - this.lastCleanup < CLEANUP_INTERVAL_MS) {
      return
    }
    this.lastCleanup = now
    try {
      for (const entry of await readdir(this.directory, { withFileTypes: true })) {
        const path = join(this.directory, entry.name)
        // 白名单只接受本进程新旧命名，目录、链接及后台日志均保留。
        if (!entry.isFile() || !DESKTOP_LOG.test(entry.name) || path === this.path) {
          continue
        }
        try {
          const info = await lstat(path)
          if (info.isFile() && info.mtimeMs < now - LOG_RETENTION_MS) {
            await unlink(path)
          }
        } catch (error) {
          // 清理期间文件已消失可忽略；其他失败留下固定提示并继续后续文件。
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            console.error('KnowledgeBase diagnostic cleanup failed; check permissions.')
          }
        }
      }
    } catch {
      console.error('KnowledgeBase diagnostic cleanup failed; check disk space and permissions.')
    }
  }

  // 退出装配点负责停止新日志后调用；不接管业务资源。
  async flush(): Promise<void> {
    await this.draining
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
