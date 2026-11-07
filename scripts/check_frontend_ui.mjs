// 文件：check_frontend_ui.mjs
// 层：维护验证
// 作用：验证收拢导航、键盘设置、整理模态与宽窄布局。
// 说明：仅隔离窗口和本地空配置，不请求模型或使用正式数据。
import assert from 'node:assert/strict'
import { navigateUi } from './ui_navigation.mjs'

// 验证入口重排后的可达性与模态焦点，防止只调整视觉却破坏键盘操作。
export async function checkFrontendUi({ ui, click, waitFor, screenshot, report }) {
  assert.equal(await ui.evaluate(`document.querySelectorAll('.nav-item').length`), 7)
  assert.equal(await ui.evaluate(`document.querySelector('.avatar').textContent.trim()`), '⚙')
  await ui.evaluate(`document.querySelector('.avatar').click()`)
  assert.equal(await ui.evaluate(`!!document.querySelector('.quick-start')`), true)
  await screenshot('desktop-frontend-quick-start.png')
  await ui.evaluate(`document.querySelector('.settings-tabs [aria-selected="true"]').focus()`)
  await ui.command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight'
  })
  await waitFor(
    () =>
      ui.evaluate(
        `document.activeElement.id==='settings-storage' && !!document.querySelector('.storage-settings')`
      ),
    'settings keyboard activation'
  )
  await ui.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' })
  assert.equal(await ui.evaluate(`document.activeElement.id==='settings-api'`), true)
  const colors = await ui.evaluate(`(() => {
    const active=document.querySelector('.settings-tabs [aria-selected="true"]');
    const inactive=document.querySelector('.settings-tabs [aria-selected="false"]');
    return [getComputedStyle(active).backgroundColor, getComputedStyle(inactive).backgroundColor,
      getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()];
  })()`)
  assert.notEqual(colors[0], colors[1])
  assert.ok(colors[2])
  await navigateUi(ui, '知识库')
  for (const name of ['常用', '在学', '归档']) {
    await navigateUi(ui, name)
    assert.equal(
      await ui.evaluate(
        `document.querySelector('.library-view[aria-current="page"]').textContent.trim()`
      ),
      name
    )
    assert.ok(
      await ui.evaluate(
        `document.querySelector('.nav-item.active').textContent.trim().endsWith('知识库')`
      )
    )
  }
  await navigateUi(ui, '知识库')
  // 脚本的 HTMLElement.click 不会自动聚焦，先模拟真实鼠标点击的焦点前置行为。
  await ui.evaluate(`document.querySelector('.heading-actions button').focus()`)
  await click('整理知识库')
  assert.equal(
    await ui.evaluate(`document.querySelector('.organization-setup').matches(':modal')`),
    true
  )
  await screenshot('desktop-frontend-organization.png')
  await pressEscape(ui)
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.organization-setup')`),
    'escape closes organization'
  )
  assert.equal(await ui.evaluate(`document.activeElement.textContent.trim()`), '整理知识库')
  assert.equal((await ui.evaluate(`window.knowledgeBase.request('usage.list')`)).length, 0)
  await navigateUi(ui, '探索')
  await screenshot('desktop-frontend-exploration.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true)
    await screenshot('desktop-frontend-exploration-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  report.checks.push(
    'seven destinations; four independent library views; semantic settings shortcut; quick start; keyboard tab activation; modal Escape/focus return; no model attempts; wide/narrow composer'
  )
}

// 原生 dialog 的默认行为依赖虚拟键码及完整按键序列，不能只发送 DOM 键名。
async function pressEscape(ui) {
  for (const type of ['keyDown', 'keyUp']) {
    await ui.command('Input.dispatchKeyEvent', {
      type,
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27
    })
  }
}
