// 文件：worker_bridge.ts
// 层：Electron 桌面宿主
// 作用：管理 Python 进程与请求关联。
// 说明：仅清理本对象拥有的进程树。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

import type { Operation, WorkerEvent } from '../../../contracts/desktop'
import { isWorkerMessage } from '../shared/protocol_validation'
import { RequestRegistry } from './request_registry'
import { diagnostic, sessionId } from './diagnostics'

const START_TIMEOUT_MS = 15_000
const SHUTDOWN_GRACE_MS = 2_500
const MAX_REQUEST_BYTES = 1_000_000
const MAX_MESSAGE_CHARS = 2_000_000

export class WorkerBridge {
  private child?: ChildProcessWithoutNullStreams
  private pending = new RequestRegistry(diagnostic)
  private starting?: Promise<void>
  private stopping = false
  // 装配项目路径、数据目录与受限事件接收者，不立即启动后台。
  constructor(
    private root: string,
    private dataDir: string,
    private event: (value: WorkerEvent) => void
  ) {}

  // 只终止本桥接创建的后台进程树，不按名称全局杀进程。
  private terminateOwned(child: ChildProcessWithoutNullStreams): void {
    if (!child.pid) {
      return
    }
    diagnostic('worker.terminate', { worker_pid: child.pid })
    if (process.platform === 'win32') {
      // Windows 虚拟环境包含启动器和运行时，仅终止本对象拥有的树。
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.on('error', () => child.kill())
    } else {
      child.kill()
    }
  }

  // 共用启动 Promise；失败释放状态后允许下一次请求重试。
  private start(): Promise<void> {
    // 关闭期间不再创建后台；并发启动共用同一就绪结果。
    if (this.stopping) {
      return Promise.reject(new Error('应用正在关闭'))
    }
    if (this.starting) {
      return this.starting
    }
    diagnostic('worker.starting', { timeout_ms: START_TIMEOUT_MS })
    this.starting = new Promise<void>((resolve, reject) => {
      const python = join(this.root, '.venv', 'Scripts', 'python.exe')
      // 缺少运行时即受控失败，保留安装说明供用户恢复。
      if (!existsSync(python)) {
        diagnostic('worker.runtime_missing')
        reject(new Error('缺少开发运行时，请按 README 准备 .venv'))
        return
      }
      const child = spawn(
        python,
        [
          '-u',
          join(this.root, 'services', 'knowledge-agent', 'worker.py'),
          '--data-dir',
          this.dataDir
        ],
        {
          cwd: this.root,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            KB_LOG_SESSION: sessionId
          }
        }
      )
      this.child = child
      this.bind(child, resolve, reject)
    })
    const startup = this.starting
    // 已处理失败才释放共享启动状态，下次请求可以重新启动。
    startup.catch(() => {
      if (this.starting === startup) {
        this.starting = undefined
      }
    })
    return startup
  }

  // 每个子进程拥有独立的就绪计时器与终态处理。
  private bind(
    child: ChildProcessWithoutNullStreams,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const readyTimer = setTimeout(() => {
      diagnostic('worker.start_timeout', { worker_pid: child.pid })
      this.terminateOwned(child)
      reject(new Error('后台启动超时'))
    }, START_TIMEOUT_MS)
    const fail = () => {
      clearTimeout(readyTimer)
      reject(new Error('后台已退出，可重试；已保存的数据保留'))
      // 已被替换的旧进程退出不能清空新进程的请求状态。
      if (this.child !== child) {
        return
      }
      this.starting = undefined
      if (this.child === child) {
        this.child = undefined
      }
      this.pending.failAll(new Error('后台中断，请重试'))
    }
    child.on('error', (error) => {
      diagnostic('worker.spawn_failed', { worker_pid: child.pid }, error)
      fail()
    })
    child.on('exit', (code, signal) => {
      diagnostic('worker.exit', {
        worker_pid: child.pid,
        exit_code: code ?? undefined,
        signal: signal ?? undefined,
        stopping: this.stopping
      })
      fail()
    })
    // Python 详细诊断独立落盘；未知 stderr 只记字节数，不保存任意原始输出。
    let stderrBytes = 0
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
    })
    child.stderr.on('end', () => {
      if (stderrBytes) {
        diagnostic('worker.stderr', { bytes: stderrBytes })
      }
    })
    child.stdin.on('error', (error) => {
      diagnostic('worker.stdin_failed', {}, error)
      this.terminateOwned(child)
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.receive(line, child)) {
        diagnostic('worker.ready', { worker_pid: child.pid })
        clearTimeout(readyTimer)
        resolve()
      }
    })
  }

  // 未通过结构校验的消息终止后台，不作为成功结果继续传递。
  private receive(line: string, child: ChildProcessWithoutNullStreams): boolean {
    try {
      // 外部消息先限制大小并收窄结构，再访问类型和请求标识。
      if (line.length > MAX_MESSAGE_CHARS) {
        throw new Error('协议消息过大')
      }
      const message: unknown = JSON.parse(line)
      if (!isWorkerMessage(message)) {
        throw new Error('无效后台协议')
      }
      if (message.type === 'ready') {
        return true
      }
      // 只转发仍有关联的事件，成功和失败由注册表统一结算一次。
      if (message.type === 'progress' || message.type === 'stream') {
        if (this.pending.has(message.id)) {
          this.event(message)
        }
      } else if (message.type === 'result') {
        this.pending.settle(message.id, message.result)
      } else if (message.type === 'error' && message.id) {
        this.pending.settle(message.id, undefined, new Error(message.error))
      }
    } catch (error) {
      diagnostic('protocol.invalid_message', { chars: line.length }, error)
      // 损坏协议不能继续作为可信后台使用，退出监听负责结算全部请求。
      this.terminateOwned(child)
    }
    return false
  }

  // 先校验输入和关联标识，再登记超时并写入后台协议。
  async request(
    operation: Operation,
    params: Record<string, unknown> = {},
    id: string = randomUUID()
  ): Promise<unknown> {
    const diagnosticId = /^[a-zA-Z0-9-]{1,80}$/.test(id) ? id : undefined
    diagnostic('request.received', { request_id: diagnosticId, operation })
    try {
      await this.start()
    } catch (error) {
      diagnostic('request.start_failed', { request_id: diagnosticId, operation }, error)
      throw error
    }
    // 连续输入校验失败均不登记请求，不留下超时定时器。
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) {
      throw new Error('无效任务标识')
    }
    if (this.pending.has(id)) {
      throw new Error('任务正在执行')
    }
    const line = JSON.stringify({ id, operation, params }) + '\n'
    if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) {
      throw new Error('输入过大')
    }
    const child = this.child
    if (this.stopping || !child?.stdin.writable) {
      throw new Error('后台不可用，请重试')
    }
    const pending = this.pending.register(id, () => this.cancel(id), operation)
    diagnostic('request.sent', { request_id: id, operation, bytes: Buffer.byteLength(line) })
    // 先登记后发送，确保快速返回的结果也能找到唯一关联。
    child.stdin.write(line)
    return pending
  }

  // 发送指定任务取消帧，实际终态仍由后台返回。
  cancel(id: string): void {
    diagnostic('request.cancel_sent', {
      request_id: id,
      writable: this.child?.stdin.writable ?? false
    })
    if (this.child?.stdin.writable) {
      this.child.stdin.write(
        JSON.stringify({ id: randomUUID(), operation: 'cancel', params: { target: id } }) + '\n'
      )
    }
  }

  // 先发送 EOF，宽限期后仅终止本对象拥有的进程树。
  async stop(): Promise<void> {
    diagnostic('worker.stopping')
    this.stopping = true
    const child = this.child
    if (!child || child.exitCode !== null) {
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.terminateOwned(child)
      }, SHUTDOWN_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.stdin.end()
    })
  }
}
