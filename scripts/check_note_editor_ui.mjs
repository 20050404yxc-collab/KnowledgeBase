// 文件：check_note_editor_ui.mjs
// 层：维护验证
// 作用：验证笔记关闭保护、保存失败保留和提交期间的编辑锁定。
// 说明：复用隔离桌面及合成笔记，不读取正式数据或调用模型。
import assert from 'node:assert/strict'

// 空草稿可直接关闭；有输入必须明确放弃，取消确认仍保留正文。
export async function checkEmptyEditorUi(context) {
  const { ui, fill, click, waitFor, screenshot, report } = context
  await checkNarrowLayout(context, 'desktop-learning-entry-narrow.png')
  await click('＋ 新建知识')
  await ui.evaluate(`document.querySelector('[aria-label="关闭编辑"]').click()`)
  assert.equal(await ui.evaluate(`!!document.querySelector('.editor')`), false)
  await click('＋ 新建知识')
  await fill('.editor textarea', '尚未保存的新笔记草稿')
  await ui.evaluate(`document.querySelector('[aria-label="关闭编辑"]').click()`)
  await waitFor(() => ui.evaluate(`!!document.querySelector('.discard-warning')`), 'discard prompt')
  await screenshot('desktop-unsaved-note.png')
  await checkNarrowLayout(context, 'desktop-unsaved-note-narrow.png')
  await click('继续编辑')
  assert.equal(
    await ui.evaluate(`document.querySelector('.editor textarea').value`),
    '尚未保存的新笔记草稿'
  )
  assert.equal(
    await ui.evaluate(`document.activeElement === document.querySelector('.editor textarea')`),
    true
  )
  await click('取消')
  await click('放弃修改')
  assert.equal(await ui.evaluate(`!!document.querySelector('.editor')`), false)
  await click('＋ 新建知识')
  assert.equal(await ui.evaluate(`document.querySelector('.editor textarea').value`), '')
  await click('取消')
  report.checks.push(
    'empty/new editor: close without changes; explicit discard; continue preserves input and focus'
  )
}

// 最小支持窗口内工具栏和关闭确认都可达，截图供视觉核对。
async function checkNarrowLayout({ ui, screenshot }, name) {
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 980,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    await ui.evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    await screenshot(name)
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 对照打开时原稿判断修改；失败保留输入、释放保存锁，重试成功后清理原稿。
export async function checkNoteEditorUi(context) {
  const { ui, fill, click, waitFor, report } = context
  await click('编辑')
  const original = await ui.evaluate(`({title: document.querySelector('.editor input').value,
    content: document.querySelector('.editor textarea').value})`)
  await fill('.editor input', original.title + '草稿')
  await click('取消')
  assert.equal(await ui.evaluate(`!!document.querySelector('.discard-warning')`), true)
  await click('继续编辑')
  await fill('.editor input', original.title)
  await click('取消')
  assert.equal(await ui.evaluate(`!!document.querySelector('.editor')`), false)
  await click('编辑')
  // 绕过 HTML 长度约束注入非法标题，验证真实后台失败而不是浏览器校验。
  await fill('.editor input', 'x'.repeat(161))
  await ui.evaluate(`(() => {
    window.__noteSaveLocked = false
    const form = document.querySelector('.editor')
    const observer = new MutationObserver(() => {
      const save = form.querySelector('.primary')
      if (save?.textContent.includes('保存中')) {
        window.__noteSaveLocked = form.querySelector('fieldset').disabled && save.disabled &&
          form.querySelector('[aria-label="关闭编辑"]').disabled &&
          [...form.querySelectorAll('button')].find(b => b.textContent.trim() === '取消').disabled
      }
      if (!form.isConnected) observer.disconnect()
    })
    observer.observe(form, {subtree:true, childList:true, attributes:true, characterData:true})
    window.__noteSaveObserver = observer
    form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))
  })()`)
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.alert.error')?.innerText.includes('160') &&
    document.querySelector('.editor .primary')?.textContent.includes('保存知识')`),
    'failed save remains editable'
  )
  assert.equal(await ui.evaluate('window.__noteSaveLocked'), true)
  assert.equal(await ui.evaluate(`document.querySelector('.editor input').value.length`), 161)
  assert.equal(await ui.evaluate(`document.querySelector('.editor fieldset').disabled`), false)
  assert.equal(
    await ui.evaluate(`document.querySelector('.editor textarea').value`),
    original.content
  )
  await fill('.editor input', original.title)
  await click('保存知识')
  await waitFor(
    () =>
      ui.evaluate(`!document.querySelector('.editor') &&
    document.body.innerText.includes('知识已保存')`),
    'save retry'
  )
  await ui.evaluate(
    'window.__noteSaveObserver.disconnect(); delete window.__noteSaveObserver; delete window.__noteSaveLocked'
  )
  await click('编辑')
  await click('取消')
  assert.equal(await ui.evaluate(`!!document.querySelector('.editor')`), false)
  report.checks.push(
    'editor: title-only protection, reverted edits close directly, saving lock, real failed save retains input, successful retry resets original'
  )
}
