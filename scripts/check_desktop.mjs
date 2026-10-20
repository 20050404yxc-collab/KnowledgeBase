// 文件：check_desktop.mjs
// 层：维护验证
// 作用：验证对应开发环境或桌面流程。
// 说明：使用隔离资源，不访问正式用户数据。
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { checkModelUi } from './check_model_ui.mjs'

const root = resolve(import.meta.dirname, '..')
const artifactDir = join(root, 'artifacts', 'test0.03')
await mkdir(artifactDir, { recursive: true })
const dataDir = await mkdtemp(join(tmpdir(), 'knowledgebase-ui-'))
// 测试独占 Electron profile，避免单实例锁影响用户已运行的应用。
const isolatedApp = join(dataDir, 'electron-launcher')
await mkdir(isolatedApp)
await writeFile(
  join(isolatedApp, 'package.json'),
  JSON.stringify({ name: 'knowledgebase-ui', main: 'main.cjs' })
)
await writeFile(
  join(isolatedApp, 'main.cjs'),
  [
    "const {app} = require('electron')",
    `app.setPath('userData', ${JSON.stringify(join(dataDir, 'electron-profile'))})`,
    `require(${JSON.stringify(join(root, 'out', 'main', 'index.js'))})`
  ].join('\n')
)
const fixture = join(dataDir, '引用测试.md')
await writeFile(
  fixture,
  '# 数据库事务\n\n事务的一致性用于确保数据规则成立。\n\n<script>window.__documentExecuted=true</script>\n',
  'utf8'
)
const report = { version: 'test0.03', checks: [], screenshots: [] }
let child, socket
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 有限轮询隔离测试条件，超时明确失败而不操作正式应用。
async function waitFor(fn, description, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await fn().catch(() => false)
    if (result) {
      return result
    }
    await delay(120)
  }
  throw new Error(`Timed out: ${description}`)
}

// 启动独立配置目录的测试应用，再建立 DevTools 和后台握手。
async function launch() {
  const port = await new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port
      server.close(() => resolve(value))
    })
  })
  const env = { ...process.env, KB_DATA_DIR: dataDir }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(
    join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [
      isolatedApp,
      `--remote-debugging-port=${port}`,
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows'
    ],
    {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    }
  )
  child.stderr.resume()
  const target = await waitFor(
    async () =>
      (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
        (page) => page.type === 'page'
      ),
    'debug target'
  )
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const { command, evaluate } = createCommands(socket)

  await waitFor(
    () => evaluate(`document.body.innerText.includes('本地后台已连接')`),
    'backend handshake'
  )
  return { command, evaluate }
}

// 每条 DevTools 命令独立关联，响应按标识结算。
function createCommands(socket) {
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry) {
      pending.delete(message.id)
      message.error
        ? entry.reject(new Error(JSON.stringify(message.error)))
        : entry.resolve(message.result)
    }
  })
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)
      )
    }
    return result.result.value
  }
  return { command, evaluate }
}

// 等待测试窗口和后台完整退出，失败不报告正常关闭。
async function closeApp(ui) {
  const current = child
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      current.kill()
      reject(new Error('Application did not exit gracefully'))
    }, 8000)
    current.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  await ui.evaluate('window.close()').catch(() => {})
  await exited
  socket?.close()
  child = undefined
}

try {
  let ui = await launch()
  // 在真实沙箱内触发失败与全局错误，验证日志通道不接受私密正文。
  await ui.evaluate(`(async () => {
    try { await window.knowledgeBase.request('knowledge.get', {id:'missing-diagnostic-fixture'}, 'diagnostic-ui-failure') } catch {}
    window.dispatchEvent(new ErrorEvent('error', {error:new Error('private-ui-error-token')}));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {promise:Promise.resolve(),reason:new Error('private-ui-rejection-token')}));
  })()`)
  const click = async (text) =>
    ui.evaluate(
      `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw Error('Missing button'); button.click() })()`
    )
  const fill = async (selector, value) =>
    ui.evaluate(
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw Error('Missing input'); const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', {bubbles:true})); })()`
    )
  const screenshot = async (name) => {
    const result = await ui.command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    await writeFile(join(artifactDir, name), Buffer.from(result.data, 'base64'))
    report.screenshots.push(name)
  }
  await screenshot('desktop-empty.png')
  assert.equal(await ui.evaluate(`typeof require`), 'undefined')
  report.checks.push('sandboxed renderer: Node require unavailable')
  await click('＋ 新建知识')
  await fill('.editor input', '数据库事务与一致性')
  await fill(
    '.editor textarea',
    '事务把一组操作视为整体。\n\n成功时全部提交；失败时全部回滚。\n\n这是桌面端到端测试创建的笔记。'
  )
  await click('保存知识')
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.editor') && document.body.innerText.includes('知识已保存')`
      ),
    'create note'
  )
  report.checks.push('create note using actual React form')
  await click('编辑')
  await fill(
    '.editor textarea',
    '事务将多步操作视为整体。\n\n提交与回滚保证操作的原子性；一致性还依赖约束和业务规则。\n\n<script>window.__noteExecuted=true</script>'
  )
  await click('保存知识')
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.editor') && document.body.innerText.includes('业务规则')`
      ),
    'edit note'
  )
  assert.equal(await ui.evaluate('window.__noteExecuted === undefined'), true)
  report.checks.push('edit note; hostile HTML blocked and never executed')
  await fill('.inline-search', '天文学')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('没有找到匹配的知识')`),
    'empty search'
  )
  await fill('.inline-search', '事务')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.knowledge-card').length === 1`),
    'Chinese retrieval'
  )
  report.checks.push('Chinese keyword search and no-hit state')
  await fill('.inline-search', '')
  await click('本地路径')
  await fill('.modal input', fixture)
  await click('解析并加入')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.attachment.ready') !== null`),
    'attachment parsing'
  )
  await fill('#question', '数据库事务')
  await ui.evaluate(`(() => {
    const input = document.querySelector('[aria-label="回答范围"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, 'files')
    input.dispatchEvent(new Event('change', {bubbles: true}))
  })()`)
  await click('拆解并学习 ↗')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.directory-panel')?.innerText.includes('本次文件') && document.body.innerText.includes('尚未配置生成接口')`
      ),
    'offline question'
  )
  assert.equal(await ui.evaluate('window.__documentExecuted === undefined'), true)
  assert.ok(await ui.evaluate(`document.querySelectorAll('.directory-hit').length > 0`))
  assert.equal(
    await ui.evaluate(`document.querySelector('.directory-panel').innerText.includes('已有知识')`),
    false
  )
  await ui.evaluate(`document.querySelector('.directory-hit button').click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.citation-locator') !== null`),
    'citation excerpt'
  )
  await screenshot('desktop-citation.png')
  await ui.evaluate(`document.querySelector('[aria-label="关闭引用"]').click()`)
  await click('保留')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('资料已保留')`),
    'retain source'
  )
  report.checks.push(
    'local path attachment, offline scoped evidence, safe citation modal and source retention'
  )
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('资料库')).click()`
  )
  await waitFor(
    () => ui.evaluate(`document.querySelector('.source-row') !== null`),
    'source library'
  )
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('设置')).click()`
  )
  await screenshot('desktop-settings.png')
  assert.equal(await ui.evaluate(`document.querySelector('input[type=password]') !== null`), true)
  report.checks.push('source and provider settings screens render')
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.knowledge-card') !== null`),
    'back to exploration'
  )
  await screenshot('desktop-knowledge.png')
  await closeApp(ui)
  // 正常关闭已 flush，三端同一请求必须可关联，合成私密内容不得进入文件。
  const desktopLog = await readFile(join(dataDir, 'logs', 'desktop.log'), 'utf8')
  const workerLog = await readFile(join(dataDir, 'logs', 'worker.log'), 'utf8')
  const desktopRows = desktopLog.trim().split('\n').map(JSON.parse)
  const workerRows = workerLog.trim().split('\n').map(JSON.parse)
  const desktopFailure = desktopRows.find(
    (row) => row.event === 'request.failed' && row.request_id === 'diagnostic-ui-failure'
  )
  const workerFailure = workerRows.find(
    (row) => row.event === 'step.failed' && row.request_id === 'diagnostic-ui-failure'
  )
  assert.ok(desktopFailure && workerFailure)
  assert.equal(desktopFailure.session_id, workerFailure.session_id)
  assert.ok(desktopRows.some((row) => row.event === 'renderer.diagnostic' && row.kind === 'error'))
  assert.ok(
    desktopRows.some((row) => row.event === 'renderer.diagnostic' && row.kind === 'rejection')
  )
  assert.ok(!desktopLog.includes('private-ui-') && !workerLog.includes('private-ui-'))
  assert.ok(!desktopLog.includes('数据库事务与一致性') && !workerLog.includes('数据库事务与一致性'))
  report.checks.push(
    'persistent diagnostics correlate renderer, desktop and worker without private content'
  )
  report.checks.push('graceful Electron shutdown')
  ui = await launch()
  await waitFor(
    () => ui.evaluate(`document.querySelector('.knowledge-card') !== null`),
    'initial page list loaded after restart'
  )
  assert.ok(
    await ui.evaluate(
      `document.querySelector('.knowledge-card')?.innerText.includes('数据库事务与一致性')`
    )
  )
  await ui.evaluate(`document.querySelector('.knowledge-card').click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.reading-text')?.innerText.includes('业务规则')`),
    'reopen durable edited note'
  )
  report.checks.push('restart retains edited note and source database')
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('用量统计')).click()`
  )
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('还没有调用记录')`),
    'usage screen'
  )
  report.checks.push('offline operations incur no API attempts')
  await checkModelUi({
    ui,
    fill,
    click,
    waitFor,
    screenshot,
    report,
    attachmentPath: fixture,
    logDir: join(dataDir, 'logs')
  })
  const processes = await new Promise((resolve, reject) => {
    const probe = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*${dataDir.replaceAll("'", "''")}*' } | Select-Object ProcessId,ParentProcessId) | ConvertTo-Json -Compress`
      ],
      { windowsHide: true }
    )
    let output = ''
    probe.stdout.on('data', (value) => (output += value))
    probe.once('error', reject)
    probe.once('exit', () => resolve(JSON.parse(output)))
  })
  const pids = processes.map((p) => p.ProcessId)
  assert.equal(
    processes.filter((p) => !pids.includes(p.ParentProcessId)).length,
    1,
    'one owned Python process tree (venv launcher and runtime)'
  )
  await closeApp(ui)
  const alive = pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  assert.equal(alive.length, 0, 'no owned worker after shutdown')
  report.checks.push('owned Python worker exits with Electron')
  // 故障注入只暂停本测试目录关联的后台，验证有界关闭路径。
  ui = await launch()
  const stoppedPids = await new Promise((resolve, reject) => {
    const source = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KnowledgeBaseFaultFixture {
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr process);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$owned = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*${dataDir.replaceAll("'", "''")}*' })
foreach ($entry in $owned) {
  $handle = [KnowledgeBaseFaultFixture]::OpenProcess(0x0800, $false, $entry.ProcessId)
  if ($handle -eq [IntPtr]::Zero) { throw 'Cannot suspend isolated fixture worker' }
  $status = [KnowledgeBaseFaultFixture]::NtSuspendProcess($handle)
  [void][KnowledgeBaseFaultFixture]::CloseHandle($handle)
  if ($status -ne 0) { throw 'Suspend failed' }
}
$owned | Select-Object -ExpandProperty ProcessId
`
    const probe = spawn('powershell.exe', ['-NoProfile', '-Command', source], { windowsHide: true })
    let output = ''
    probe.stdout.on('data', (value) => (output += value))
    probe.stderr.resume()
    probe.once('error', reject)
    probe.once('exit', (code) =>
      code === 0
        ? resolve(output.trim().split(/\s+/).filter(Boolean).map(Number))
        : reject(new Error('Fault fixture setup failed'))
    )
  })
  assert.ok(stoppedPids.length >= 1)
  const forcedStart = Date.now()
  await closeApp(ui)
  assert.ok(Date.now() - forcedStart >= 2300, 'bounded shutdown timeout was exercised')
  assert.equal(
    stoppedPids.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }).length,
    0
  )
  report.checks.push(
    'forced timeout shutdown terminates suspended owned Python tree without orphans'
  )
  report.status = 'passed'
  await writeFile(join(artifactDir, 'desktop-check.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  report.status = 'failed'
  report.error = String(error)
  await writeFile(join(artifactDir, 'desktop-check.json'), JSON.stringify(report, null, 2) + '\n')
  throw error
} finally {
  socket?.close()
  if (child) {
    child.kill()
    await delay(1000)
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {
    console.warn('测试临时目录清理失败，请在测试进程退出后清理本次隔离目录。')
  })
}
