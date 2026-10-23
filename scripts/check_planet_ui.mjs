// 文件：check_planet_ui.mjs
// 层：维护验证
// 作用：采样真实星球移动并遍历有界展示页，验证完整目录可达。
// 说明：使用隔离桌面数据，运动证据与宽窄截图写入现有报告。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { readDiagnosticLog } from './diagnostic_fixtures.mjs'

// 只暂停从本次隔离日志取得的后台 PID，辅助进程退出前必恢复。
async function verifyPlanetSlow({ ui, click, waitFor, logDir }) {
  const rows = (await readDiagnosticLog(logDir, 'worker')).trim().split('\n')
  const pid = JSON.parse(rows.at(-1)).pid
  const source = `import ctypes,sys
k=ctypes.WinDLL('kernel32',use_last_error=True); n=ctypes.WinDLL('ntdll')
k.OpenProcess.restype=ctypes.c_void_p
h=k.OpenProcess(0x0800,False,int(sys.argv[1])); assert h
n.NtSuspendProcess.argtypes=[ctypes.c_void_p]; n.NtResumeProcess.argtypes=[ctypes.c_void_p]
k.CloseHandle.argtypes=[ctypes.c_void_p]
assert n.NtSuspendProcess(h)==0
try:
 print('paused',flush=True); sys.stdin.readline()
finally:
 n.NtResumeProcess(h); k.CloseHandle(h)`
  const helper = spawn(resolve('.venv/Scripts/python.exe'), ['-u', '-c', source, String(pid)], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const exited = new Promise((resolve) => helper.once('exit', resolve))
  try {
    await new Promise((resolve, reject) => {
      helper.stdout.once('data', resolve)
      helper.once('error', reject)
      helper.once('exit', () => reject(Error('isolated worker pause failed')))
    })
    await ui.evaluate(
      `window.__slowPlanet=document.querySelector('.planet-node:not(.planet-hidden)'); window.__slowPlanet.click()`
    )
    await waitFor(
      () => ui.evaluate(`!!document.querySelector('.planet-status [role="status"]')`),
      'slow branch'
    )
    const held = await ui.evaluate(`new Promise(resolve=>setTimeout(()=>resolve(
      window.__slowPlanet===document.querySelector('.planet-center') && !document.querySelector('.planet-leaf')),750))`)
    assert.equal(held, true)
  } finally {
    helper.stdin.end('\n')
    await exited
  }
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.planet-status [role]')`),
    'slow branch resumes'
  )
  await click('返回上层')
}

// 临时改名隔离数据库中的知识表，借真实查询失败验证同一中心球及重试。
async function verifyPlanetFailure(context) {
  const { ui, waitFor, click, logDir } = context
  const worker = spawn(
    resolve('.venv/Scripts/python.exe'),
    [
      '-u',
      '-c',
      'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("ALTER TABLE knowledge RENAME TO planet_fault_knowledge"); db.commit(); print("ready",flush=True); sys.stdin.readline(); db.execute("ALTER TABLE planet_fault_knowledge RENAME TO knowledge"); db.commit(); db.close()',
      join(dirname(logDir), 'knowledge.sqlite3')
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const exited = new Promise((resolve) => worker.once('exit', resolve))
  try {
    await new Promise((resolve, reject) => {
      worker.stdout.once('data', resolve)
      worker.once('error', reject)
      worker.once('exit', () => reject(new Error('test database lock failed')))
    })
    await ui.evaluate(
      `window.__planetHeld = document.querySelector('.planet-node:not(.planet-hidden)'); window.__planetHeld.click()`
    )
    await waitFor(
      () => ui.evaluate(`!!document.querySelector('.planet-status [role="alert"]')`),
      'branch lock failure'
    )
    assert.equal(
      await ui.evaluate(`window.__planetHeld === document.querySelector('.planet-center')`),
      true
    )
  } finally {
    worker.stdin.end('\n')
    await exited
  }
  await click('重试')
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.planet-status [role]')`),
    'branch retry'
  )
  assert.equal(
    await ui.evaluate(`window.__planetHeld === document.querySelector('.planet-center')`),
    true
  )
  await click('返回上层')
}

// 动画中查询、返回及尺寸变化只保留最后目标；减少动画单独检查。
async function verifyPlanetInterruptions({ ui, fill, click, waitFor }) {
  await ui.evaluate(`(() => {
    const node=document.querySelector('.planet-node:not(.planet-hidden):not(.planet-center)');
    node.click(); node.click();
    Array.from(document.querySelectorAll('button')).find(n=>n.textContent.trim()==='返回上层').click();
  })()`)
  await fill('[aria-label="筛选已有知识"]', '快速查询不存在')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '0'`),
    'interrupted search'
  )
  await fill('[aria-label="筛选已有知识"]', '完整树条目')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '205'`),
    'interrupted root'
  )
  await ui.command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  try {
    await ui.evaluate(`document.querySelector('.planet-node:not(.planet-hidden)').click()`)
    await waitFor(
      () => ui.evaluate(`document.querySelector('.planet-canvas').dataset.depth==='1'`),
      'reduced navigation'
    )
    assert.equal(
      await ui.evaluate(
        `getComputedStyle(document.querySelector('.planet-center')).transitionProperty`
      ),
      'opacity'
    )
    await click('返回上层')
  } finally {
    await ui.command('Emulation.setEmulatedMedia', { features: [] })
  }
}

// 保持按钮引用并采样实际屏幕位置，避免把换节点淡入误判为移动。
export async function enterPlanet({ ui, waitFor, report }, back = false) {
  const motion = await ui.evaluate(`(async () => {
    const node = document.querySelector(${JSON.stringify(back ? '.planet-center' : '.planet-node:not(.planet-hidden):not(.planet-center)')});
    const samples=[]; const key=node.dataset.path;
    const sample=()=>{const r=node.getBoundingClientRect(); samples.push({x:r.x+r.width/2,y:r.y+r.height/2})};
    sample(); ${back ? "Array.from(document.querySelectorAll('button')).find(n=>n.textContent.trim()==='返回上层').click()" : 'node.click()'};
    const start=performance.now(); let checkpoint=0;
    while(performance.now()-start<850) {
      await new Promise(resolve=>setTimeout(resolve,40));
      if(performance.now()-start>=checkpoint) { sample(); checkpoint+=100 }
    }
    return {key,samples,same:node===Array.from(document.querySelectorAll('.planet-node')).find(n=>n.dataset.path===key)};
  })()`)
  assert.equal(motion.same, true)
  const first = motion.samples[0]
  const last = motion.samples.at(-1)
  const distance = (point) => Math.hypot(point.x - last.x, point.y - last.y)
  assert.ok(distance(first) > 40, 'planet starts away from center')
  assert.ok(
    motion.samples.some((point) => distance(point) > 5 && distance(point) < distance(first) - 5)
  )
  report?.checks.push({ name: 'continuous-planet-motion', back, ...motion })
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.planet-status [role="status"]')`),
    'planet branch'
  )
}

// 展示页只保留四至六项，后端游标与展示分页分别验证。
export async function verifyPlanetPages(context, expected) {
  const { ui, click, waitFor } = context
  await click('星球视图')
  await enterPlanet(context)
  await enterPlanet(context)
  for (const count of [50, 100, 150, 200, 205]) {
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.planet-pagination').innerText.includes('已加载 ${count} 项')`
        ),
      'loaded branch ' + count
    )
    if (count < 205) {
      await click('加载更多')
    }
  }
  const found = new Set()
  for (;;) {
    const page =
      await ui.evaluate(`({titles:Array.from(document.querySelectorAll('.saved-leaf span')).map(n=>n.textContent),
      next:Array.from(document.querySelectorAll('button')).find(n=>n.textContent.trim()==='下一页节点').disabled})`)
    assert.ok(page.titles.length > 0 && page.titles.length <= 6)
    page.titles.forEach((title) => found.add(title))
    if (page.next) {
      break
    }
    await click('下一页节点')
  }
  assert.equal(found.size, expected)
  const snapshot = await ui.evaluate(`document.querySelector('.planet-pagination').innerText`)
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.trim().endsWith('归档')).click()`
  )
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.trim().endsWith('常用')).click()`
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.planet-pagination').innerText`),
    snapshot
  )
  await enterPlanet(context, true)
  await waitFor(
    () => ui.evaluate(`document.activeElement?.classList.contains('planet-node')`),
    'return keyboard focus'
  )
  await enterPlanet(context, true)
  await context.fill('[aria-label="筛选已有知识"]', '不存在的星球查询')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '0'`),
    'empty search'
  )
  await context.fill('[aria-label="筛选已有知识"]', '完整树条目')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '205'`),
    'reset search'
  )
  assert.equal(await ui.evaluate(`document.querySelector('.planet-canvas').dataset.depth`), '0')
  await verifyPlanetSlow(context)
  await context.fill('[aria-label="筛选已有知识"]', '清除慢请求缓存')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '0'`),
    'clear cache'
  )
  await context.fill('[aria-label="筛选已有知识"]', '完整树条目')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '205'`),
    'restore cache'
  )
  await verifyPlanetFailure(context)
  await verifyPlanetInterruptions(context)
  await enterPlanet(context)
  await enterPlanet(context)
}
