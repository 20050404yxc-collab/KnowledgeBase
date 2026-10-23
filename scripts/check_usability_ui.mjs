// 文件：check_usability_ui.mjs
// 层：维护验证
// 作用：验证首次配置、紧凑完整目录和明确的保存删除反馈。
// 说明：复用隔离桌面及合成知识，不接触正式数据或外部服务。
import assert from 'node:assert/strict'

// 页面入口使用实际导航，保持根会话状态与用户操作一致。
async function go(ui, section) {
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith(${JSON.stringify(section)})).click()`
  )
}

// 模板只作用于空白新增；任何用户输入及现有配置均不可被模板替换。
export async function checkFirstUseUi(context) {
  const { ui, click, fill, waitFor, screenshot, report } = context
  assert.equal(await ui.evaluate(`!!document.querySelector('.first-use-guide')`), true)
  await click('先写一条笔记')
  assert.equal(await ui.evaluate(`!!document.querySelector('.editor')`), true)
  await click('取消')
  await click('设置 AI 接口')
  await waitFor(() => ui.evaluate(`!!document.querySelector('.provider-presets')`), 'blank presets')
  for (const [label, protocol, url] of [
    ['OpenAI 官方', 'responses', 'https://api.openai.com/v1'],
    ['Anthropic 官方', 'anthropic', 'https://api.anthropic.com/v1'],
    ['自定义兼容接口', 'chat-completions', '']
  ]) {
    await click(label)
    const form = await ui.evaluate(`({
      name:document.querySelector('.provider-form input[maxlength="80"]').value,
      protocol:document.querySelector('.provider-form select').value,
      url:document.querySelector('.provider-form input[type=url]').value,
      key:document.querySelector('.provider-form input[type=password]').value,
      templates:!!document.querySelector('.provider-presets')})`)
    assert.deepEqual(form, { name: label, protocol, url, key: '', templates: false })
    await click('取消')
  }
  await screenshot('desktop-provider-start.png')
  await fill('.provider-form input[type=password]', 'synthetic-unsaved-template-key')
  assert.equal(await ui.evaluate(`!!document.querySelector('.provider-presets')`), false)
  await click('取消')
  await click('备份与恢复')
  await waitFor(() => ui.evaluate(`!!document.querySelector('.backup-guide')`), 'backup guide')
  assert.equal(
    await ui.evaluate(`document.querySelector('.backup-guide').innerText.includes('关闭知序')`),
    true
  )
  const attempts = await ui.evaluate(`window.knowledgeBase.request('usage.list')`)
  assert.equal(attempts.length, 0)
  await go(ui, '探索')
  await waitFor(() => ui.evaluate(`!!document.querySelector('#question')`), 'back to exploration')
  report.checks.push(
    'first-use actions, three blank-only connection presets, draft protection and offline backup instructions; zero model attempts'
  )
}

// 取消带标题的删除不改变知识；匹配为空时清除筛选恢复已有列表。
export async function checkFeedbackUi({ ui, click, fill, waitFor, report }) {
  const title = await ui.evaluate(`document.querySelector('.answer-heading h2').innerText`)
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.answer-heading .pill').innerText.includes('已保存')`
    ),
    true
  )
  await ui.evaluate(`window.__previousConfirm = window.confirm;
    window.confirm = text => { window.__deletePrompt = text; return false }`)
  try {
    await ui.evaluate(`document.querySelector('.note-footer .danger-text').click()`)
    const prompt = await ui.evaluate(`window.__deletePrompt`)
    assert.ok(prompt.includes(title) && prompt.includes('回收站') && prompt.includes('恢复'))
  } finally {
    await ui.evaluate(
      `window.confirm=window.__previousConfirm; delete window.__previousConfirm; delete window.__deletePrompt`
    )
  }
  const items = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.list', {query:${JSON.stringify(title)}})`
  )
  assert.ok(items.some((item) => item.title === title))
  await fill('.inline-search', 'USABILITY_NO_MATCH_2026')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.empty-state button')`),
    'no-match recovery'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.empty-state button').textContent.trim()`),
    '清除筛选'
  )
  await click('清除筛选')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.knowledge-card')`),
    'clear restores knowledge'
  )
  report.checks.push(
    'saved-location label, named canceled deletion retains knowledge, no-match filter recovery'
  )
}

// 目录游标超越普通列表上限；切页隔离视图，切换模式不丢路径或读取正文。
export async function checkCompactPages(context, expected) {
  const { ui, click, waitFor, screenshot, report } = context
  const before = await ui.evaluate(`document.querySelector('.planet-breadcrumbs').innerText`)
  const answerBefore = await ui.evaluate(
    `document.querySelector('.answer-heading h2')?.innerText ?? ''`
  )
  await click('紧凑列表')
  for (const count of [50, 100, 150, 200, expected]) {
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.compact-tree-row').length===${count}`),
      'compact loaded ' + count
    )
    // 只有后台明确返回更多游标时才继续，验证末页完整可达。
    if (count < expected) {
      await click('加载更多')
    }
  }
  const titles = await ui.evaluate(
    `[...document.querySelectorAll('.compact-tree-main > span')].map(n=>n.textContent)`
  )
  assert.equal(new Set(titles).size, expected)
  assert.equal(
    await ui.evaluate(`(() => {
    const list=document.querySelector('.compact-tree');
    return list.clientHeight<=520 && list.scrollHeight>list.clientHeight && list.tabIndex===0
  })()`),
    true
  )
  assert.equal(await ui.evaluate(`document.querySelector('.planet-breadcrumbs').innerText`), before)
  assert.equal(
    await ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText ?? ''`),
    answerBefore
  )
  await go(ui, '归档')
  assert.equal(await ui.evaluate(`!!document.querySelector('.compact-tree')`), false)
  await go(ui, '常用')
  assert.equal(await ui.evaluate(`document.querySelectorAll('.compact-tree-row').length`), expected)
  await ui.evaluate(`document.querySelector('.saved-tree').scrollIntoView({block:'start'})`)
  await screenshot('desktop-compact-tree.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true)
    await screenshot('desktop-compact-tree-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  await click('星球视图')
  assert.equal(await ui.evaluate(`document.querySelector('.planet-canvas').dataset.depth`), '2')
  report.checks.push(
    'compact complete 205-item cursor traversal, page-owned view/path, view changes do not open knowledge; wide/narrow layout'
  )
}

// 混合分支的展开与阅读互不替代；正文刷新后路径和视图仍属于当前页。
export async function checkCompactDeep({ ui, click, waitFor, report }) {
  await click('紧凑列表')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="阅读节点：vector"]')`),
    'compact readable branch'
  )
  const before = await ui.evaluate(`document.querySelector('.planet-breadcrumbs').innerText`)
  await ui.evaluate(`document.querySelector('[aria-label="阅读节点：vector"]').click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='vector'`),
    'compact internal body'
  )
  assert.equal(await ui.evaluate(`document.querySelector('.planet-breadcrumbs').innerText`), before)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="展开分类：vector"]')`),
    'branch restored'
  )
  await ui.evaluate(`document.querySelector('[aria-label="展开分类：vector"]').click()`)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="阅读知识：扩容机制"]')`),
    'compact deep leaf'
  )
  await ui.evaluate(`document.querySelector('[aria-label="阅读知识：扩容机制"]').click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='扩容机制'`),
    'compact leaf body'
  )
  await click('返回上层')
  await click('星球视图')
  assert.equal(await ui.evaluate(`document.querySelector('.planet-canvas').dataset.depth`), '4')
  report.checks.push(
    'compact deep internal body and independent expansion, leaf read, back and view restore'
  )
}
