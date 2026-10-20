import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class WorkerBridge {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, Pending>()
  private starting?: Promise<void>
  private stopping = false
  constructor(private root: string, private dataDir: string, private event: (value: unknown) => void) {}

  private terminateOwned(child: ChildProcessWithoutNullStreams): void {
    if (!child.pid) return
    if (process.platform === 'win32') {
      // A Windows venv launcher owns a second Python process. Terminate this owned tree only.
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => child.kill())
    } else child.kill()
  }

  private start(): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('应用正在关闭'))
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      const python = join(this.root, '.venv', 'Scripts', 'python.exe')
      if (!existsSync(python)) { reject(new Error('缺少开发运行时，请按 README 准备 .venv')); return }
      const child = spawn(python, ['-u', join(this.root, 'services', 'knowledge-agent', 'worker.py'), '--data-dir', this.dataDir], {
        cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      })
      this.child = child
      const readyTimer = setTimeout(() => { this.terminateOwned(child); reject(new Error('后台启动超时')) }, 15000)
      const fail = () => {
        clearTimeout(readyTimer)
        reject(new Error('后台已退出，可重试；已保存的数据保留'))
        if (this.child !== child) return
        this.starting = undefined
        if (this.child === child) this.child = undefined
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('后台中断，请重试')) }
        this.pending.clear()
      }
      child.on('error', fail)
      child.on('exit', fail)
      // Never forward stderr, document contents or provider error bodies into renderer logs.
      child.stderr.resume()
      child.stdin.on('error', () => this.terminateOwned(child))
      createInterface({ input: child.stdout }).on('line', line => {
        if (line.length > 2_000_000) { this.terminateOwned(child); return }
        let message: { type: string; id?: string; result?: unknown; error?: string }
        try { message = JSON.parse(line) } catch { this.terminateOwned(child); return }
        if (message.type === 'ready') { clearTimeout(readyTimer); resolve(); return }
        if (message.type === 'progress' || message.type === 'stream') { this.event(message); return }
        const pending = this.pending.get(message.id ?? '')
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(message.id!)
        if (message.type === 'result') pending.resolve(message.result)
        else pending.reject(new Error(message.error || '任务未完成'))
      })
    })
    const startup = this.starting
    startup.catch(() => { if (this.starting === startup) this.starting = undefined })
    return startup
  }

  async request(operation: string, params: Record<string, unknown> = {}, id: string = randomUUID()): Promise<unknown> {
    await this.start()
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('无效任务标识')
    if (this.pending.has(id)) throw new Error('任务正在执行')
    const line = JSON.stringify({ id, operation, params }) + '\n'
    if (Buffer.byteLength(line) > 1_000_000) throw new Error('输入过大')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); this.cancel(id); reject(new Error('任务超时，请重试'))
      }, 180000)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin.write(line)
    })
  }

  cancel(id: string): void {
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ id: randomUUID(), operation: 'cancel', params: { target: id } }) + '\n')
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.terminateOwned(child); child.once('exit', resolve) }, 2500)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.stdin.end()
    })
  }
}
