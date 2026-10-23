// 文件：check_recovery_ui.mjs
// 层：维护验证
// 作用：验证真实桌面回收站、快照确认与恢复后会话重载。
// 说明：仅合成知识与临时数据库，不接触正式配置和资料。
import assert from 'node:assert/strict'

// 从设置界面恢复已删除条目；快照取消保留当前内容，确认后恢复并重载。
export async function checkRecoveryUi({ ui, click, waitFor, screenshot, report }) {
  const id = await seedDeletedNote(ui)
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim().endsWith('回收站')).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.recovery-settings')?.innerText.includes('回收站界面验收')`
      ),
    'persistent recycle entry'
  )
  await click('恢复知识「回收站界面验收」')
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.recovery-settings').innerText.includes('恢复知识「回收站界面验收」')`
      ),
    'restored recycle entry removed'
  )
  assert.equal(
    await ui.evaluate(
      `(async()=> (await window.knowledgeBase.request('knowledge.get',{id:${JSON.stringify(id)}})).content)()`
    ),
    '可找回的原文与关联'
  )
  await openSnapshots({ ui, click, screenshot })
  await click('立即创建知识快照')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.recovery-settings')?.innerText.includes('手动快照')`),
    'manual snapshot visible'
  )
  const snapshot = await ui.evaluate(
    `(async()=> (await window.knowledgeBase.request('recovery.list',{})).find(p=>p.kind==='manual').id)()`
  )
  await ui.evaluate(
    `window.knowledgeBase.request('knowledge.save',{id:${JSON.stringify(id)},title:'回收站界面验收',content:'快照后的新手工编辑'})`
  )
  await ui.evaluate(
    `window.__previousConfirm=window.confirm;window.confirm=text=>{window.__restorePrompt=text;return false};[...document.querySelectorAll('.recovery-row')].find(r=>r.innerText.includes(${JSON.stringify(snapshot)})).querySelector('button').click()`
  )
  assert.ok(
    await ui.evaluate(
      `window.__restorePrompt.includes('未保存') && window.__restorePrompt.includes('API 配置')`
    )
  )
  assert.equal(
    await ui.evaluate(
      `(async()=> (await window.knowledgeBase.request('knowledge.get',{id:${JSON.stringify(id)}})).content)()`
    ),
    '快照后的新手工编辑'
  )
  await captureRecovery({ ui, screenshot })
  await ui.evaluate(
    `window.confirm=()=>true;[...document.querySelectorAll('.recovery-row')].find(r=>r.innerText.includes(${JSON.stringify(snapshot)})).querySelector('button').click();window.confirm=window.__previousConfirm;delete window.__previousConfirm;delete window.__restorePrompt`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.recovery-settings') && !!document.querySelector('#question') && document.querySelector('#question').value === ''`
      ),
    'successful restore reloads session'
  )
  assert.equal(
    await ui.evaluate(
      `(async()=> (await window.knowledgeBase.request('knowledge.get',{id:${JSON.stringify(id)}})).content)()`
    ),
    '可找回的原文与关联'
  )
  const points = await ui.evaluate(`window.knowledgeBase.request('recovery.list',{})`)
  assert.ok(points.some((p) => p.kind === 'before'))
  await ui.evaluate(`window.knowledgeBase.request('knowledge.delete',{id:${JSON.stringify(id)}})`)
  report.checks.push(
    'persistent recycle restore; explicit manual snapshot, canceled restore keeps edits; scoped restore reloads session and creates reversible backup; wide/narrow recovery layout'
  )
}

// 宽窄布局截图独立采集，恢复操作继续使用同一真实桌面会话。
async function captureRecovery({ ui, screenshot }) {
  await ui.evaluate(`document.querySelector('.recovery-settings').scrollIntoView({block:'start'})`)
  await screenshot('desktop-recovery-wide.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 760,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false
  })
  await screenshot('desktop-recovery-narrow.png')
  assert.equal(await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  await ui.command('Emulation.clearDeviceMetricsOverride')
}

// 删除对象由测试新建，单独恢复不会接触其他条目。
async function seedDeletedNote(ui) {
  const id = await ui.evaluate(
    `(async()=>{const item=await window.knowledgeBase.request('knowledge.save',{title:'回收站界面验收',content:'可找回的原文与关联'});await window.knowledgeBase.request('knowledge.delete',{id:item.id});return item.id})()`
  )
  return id
}

// 侧栏回收站与设置备份分开，核对各自入口。
async function openSnapshots({ ui, click, screenshot }) {
  await screenshot('desktop-trash-direct.png')
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim().endsWith('设置')).click()`
  )
  await click('备份与恢复')
}
