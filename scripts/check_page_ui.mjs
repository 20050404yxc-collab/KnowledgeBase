// 文件：check_page_ui.mjs
// 层：维护验证
// 作用：验证独立分区首帧、筛选、阅读、草稿与滚动恢复。
// 说明：使用隔离桌面的公开 API 建立合成知识，不请求模型。
import assert from 'node:assert/strict'

// 导航后的首个绘制帧不允许出现探索内容或另一个分区的详情。
async function navigate(ui, index) {
  const state = await ui.evaluate(`new Promise((resolve, reject) => {
    const target = [...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith(${JSON.stringify(['探索', '常用', '在学', '归档'][index])}))
    const snapshot = () => ({composer: !!document.querySelector('#question'), directory: !!document.querySelector('.directory-panel'),
      answer: !!document.querySelector('.answer-panel'), active: document.querySelector('.nav-item.active').innerText})
    if (target.classList.contains('active')) { resolve(snapshot()); return }
    const timer = setTimeout(() => { observer.disconnect(); reject(Error('Navigation did not commit')) }, 15000)
    const observer = new MutationObserver(() => {
      if (target.classList.contains('active')) { observer.disconnect(); clearTimeout(timer); resolve(snapshot()) }
    })
    observer.observe(document.querySelector('main').parentElement, {subtree: true, childList: true, attributes: true})
    target.click()
  })`)
  assert.equal(state.composer, index === 0)
  if (index > 0) {
    assert.equal(state.directory, false)
  }
  return state
}

// 每页独立筛选和主动阅读；重返探索恢复原问题和已完成的文章。
export async function checkPageUi(context) {
  const { ui, fill, waitFor, screenshot, fixture } = context
  const posts = fixture.state.posts.length
  const originalQuery = await ui.evaluate(`document.querySelector('#question').value`)
  const notes = []
  for (const bucket of ['常用', '在学', '归档']) {
    const note = await ui.evaluate(`window.knowledgeBase.request('knowledge.save', {
      title: ${JSON.stringify(bucket + '页面专属')}, content: ${JSON.stringify(bucket + '\n\n' + '独立阅读段落。\n\n'.repeat(100))}
    })`)
    await ui.evaluate(
      `window.knowledgeBase.request('knowledge.bucket', {id: ${JSON.stringify(note.id)}, bucket: ${JSON.stringify(bucket)}})`
    )
    notes.push(note)
  }
  for (let index = 1; index <= 3; index++) {
    const first = await navigate(ui, index)
    assert.equal(first.answer, false)
    await fill('[aria-label="筛选已有知识"]', ['常用', '在学', '归档'][index - 1] + '页面专属')
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.saved-category').length === 1`),
      'owned bucket list'
    )
    await ui.evaluate(`document.querySelector('.saved-category').click()`)
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.saved-category').length === 2`),
      'subcategory'
    )
    await ui.evaluate(`document.querySelectorAll('.saved-category')[1].click()`)
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.saved-leaf').length === 1`),
      'saved leaf'
    )
    assert.equal(
      await ui.evaluate(
        `document.querySelector('.saved-leaf').innerText.includes(${JSON.stringify(notes[index - 1].title)})`
      ),
      true
    )
    await ui.evaluate(`document.querySelector('.saved-leaf').click()`)
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.answer-panel h2')?.innerText === ${JSON.stringify(notes[index - 1].title)}`
        ),
      'owned bucket detail'
    )
    if (index === 3) {
      await screenshot('desktop-independent-pages.png')
    }
  }
  await verifyPageReturn(context, originalQuery)
  assert.equal(fixture.state.posts.length, posts)
  await screenshot('desktop-exploration-restored.png')
  context.report.checks.push(
    'four independent pages: clean first frame, per-page filter/detail, editor draft and scroll restore; completed exploration preserved'
  )
}

// 返回时正确的页面快照直接显示；编辑器草稿也跟随发起页面。
async function verifyPageReturn({ ui, fill, waitFor }, query) {
  await navigate(ui, 1)
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="筛选已有知识"]').value`),
    '常用页面专属'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.answer-panel h2').innerText`),
    '常用页面专属'
  )
  await ui.evaluate(`window.scrollTo(0, 320)`)
  await waitFor(() => ui.evaluate(`window.scrollY >= 300`), 'page scroll')
  await navigate(ui, 2)
  assert.equal(
    await ui.evaluate(`document.querySelector('.answer-panel h2').innerText`),
    '在学页面专属'
  )
  await navigate(ui, 1)
  assert.equal(await ui.evaluate(`window.scrollY >= 300`), true)
  await ui.evaluate(`document.querySelector('.note-footer button').click()`)
  await fill('.editor textarea', '尚未保存的常用页草稿')
  await navigate(ui, 2)
  assert.equal(await ui.evaluate(`document.querySelector('.editor') === null`), true)
  await navigate(ui, 1)
  assert.equal(
    await ui.evaluate(`document.querySelector('.editor textarea').value`),
    '尚未保存的常用页草稿'
  )
  await ui.evaluate(`document.querySelector('[aria-label="关闭编辑"]').click()`)
  await navigate(ui, 0)
  assert.equal(await ui.evaluate(`document.querySelector('#question').value`), query)
  assert.equal(
    await ui.evaluate(`document.querySelector('.answer-panel').innerText.includes('隔离服务生成')`),
    true
  )
}
