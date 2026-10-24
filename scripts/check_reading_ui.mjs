// 文件：check_reading_ui.mjs
// 层：维护验证
// 作用：验证列表阅读位置、底部提问可达及按页隔离的提问结果。
// 说明：仅使用隔离知识和本机模拟服务，不读取正式数据或调用付费接口。
import assert from 'node:assert/strict'

// 正常导航保留原页面状态，不使用组件内部 setter 绕过实际交互。
async function go(ui, section) {
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith(${JSON.stringify(section)})).click()`
  )
}

// 中段输入真正可点击，文末不被吸附栏遮挡；同时覆盖宽窄布局与设置展开。
async function checkDockGeometry({ ui, waitFor, screenshot }, suffix) {
  await ui.evaluate(`(() => {
    const article=document.querySelector('.answer-panel');
    window.scrollTo(0, scrollY+article.getBoundingClientRect().top+article.offsetHeight/2)
  })()`)
  await waitFor(
    () =>
      ui.evaluate(`(() => {
      const input=document.querySelector('[aria-label="知识提问内容"]');
      const rect=input.getBoundingClientRect();
      return rect.top>=0 && rect.bottom<=innerHeight &&
        document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)===input
    })()`),
    'question dock visible and hit-testable in article middle'
  )
  assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true)
  await screenshot(`desktop-reading-${suffix}.png`)
  await ui.evaluate(`document.querySelector('.reading-question-settings').open=true`)
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.reading-question-settings').getBoundingClientRect().height<=innerHeight*0.3+1`
    ),
    true
  )
  await ui.evaluate(
    `document.querySelector('.reading-question-settings').open=false; window.scrollTo(0,document.documentElement.scrollHeight)`
  )
  await waitFor(
    () =>
      ui.evaluate(`(() => {
      const last=document.querySelector('.answer-panel .markdown-content p:last-child').getBoundingClientRect();
      const dock=document.querySelector('.reading-question').getBoundingClientRect();
      return last.bottom<=dock.top && dock.bottom<=innerHeight && dock.top>=0
    })()`),
    'final paragraph remains above usable question dock'
  )
  await screenshot(`desktop-reading-end-${suffix}.png`)
}

// 探索列表条目仅在列表后展开；进入知识库后仍可阅读并提交本地问题。
export async function checkReadingUi(context) {
  const { ui, fill, waitFor, report } = context
  const original = await ui.evaluate(`document.querySelector('.answer-heading h2').innerText`)
  const title = '阅读停靠验收'
  const content = '可重复阅读的长文段落。\n\n'.repeat(160) + '文末段落必须完整可见。'
  const note = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.save',{title:${JSON.stringify(title)},content:${JSON.stringify(content)},category_path:['阅读验收']})`
  )
  await fill('.inline-search', title)
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.knowledge-card').length===1`),
    'reading fixture listed'
  )
  await ui.evaluate(`document.querySelector('.knowledge-card').click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='阅读停靠验收'`),
    'reading fixture opened'
  )
  assert.equal(await ui.evaluate(`document.querySelectorAll('.answer-panel').length`), 1)
  assert.equal(
    await ui.evaluate(
      `!!(document.querySelector('.knowledge-section').compareDocumentPosition(document.querySelector('.answer-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)`
    ),
    true
  )
  await checkDockGeometry(context, 'exploration-wide')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    await checkDockGeometry(context, 'exploration-narrow')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  await fill('[aria-label="知识提问内容"]', '探索阅读草稿')
  await checkLibraryOfflineReading(context, title)
  await go(ui, '探索')
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="知识提问内容"]').value`),
    '探索阅读草稿'
  )
  await fill('[aria-label="知识提问内容"]', '')
  await ui.evaluate(
    `window.knowledgeBase.request('knowledge.delete',{id:${JSON.stringify(note.id)}})`
  )
  await fill('.inline-search', '')
  await waitFor(
    () =>
      ui.evaluate(
        `!![...document.querySelectorAll('.knowledge-card')].find(n=>n.innerText.includes(${JSON.stringify(original)}))`
      ),
    'original list restored'
  )
  await ui.evaluate(
    `[...document.querySelectorAll('.knowledge-card')].find(n=>n.innerText.includes(${JSON.stringify(original)})).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.answer-heading h2')?.innerText===${JSON.stringify(original)}`
      ),
    'original reading restored'
  )
  report.checks.push(
    'exploration list reading below list; long article middle/end hit-testable question dock, wide/narrow layouts, library offline planning and page-isolated drafts'
  )
}

// 知识库的提问不借用探索草稿；无接口时本地结果和输入仍可操作。
async function checkLibraryOfflineReading(context, title) {
  const { ui, fill, click, waitFor } = context
  await go(ui, '知识库')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.reading-question')`),
    'library question'
  )
  assert.equal(await ui.evaluate(`document.querySelector('[aria-label="知识提问内容"]').value`), '')
  await fill('[aria-label="筛选已有知识"]', title)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="展开分类：阅读验收"]')`),
    'library fixture category'
  )
  await ui.evaluate(`document.querySelector('[aria-label="展开分类：阅读验收"]').click()`)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="阅读知识：阅读停靠验收"]')`),
    'library fixture leaf'
  )
  await ui.evaluate(`document.querySelector('[aria-label="阅读知识：阅读停靠验收"]').click()`)
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='阅读停靠验收'`),
    'library reading'
  )
  await checkDockGeometry(context, 'library-wide')
  await fill('[aria-label="知识提问内容"]', title)
  await click('查看本地相关内容')
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.session-task') && document.querySelector('.selection-candidates')?.innerText.includes('阅读停靠验收')`
      ),
    'library-local question results without provider'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="知识提问内容"]').value`),
    title
  )
  await click('收起问答')
  await fill('[aria-label="知识提问内容"]', '')
  await fill('[aria-label="筛选已有知识"]', '')
  await click('全部分类')
}

// 规划失败后保留草稿可重试；后台完成只更新发起页，主探索输入不被覆盖。
export async function checkReadingQuestions(context) {
  const { ui, fill, click, waitFor, fixture, finish, report } = context
  const exploration = await ui.evaluate(`document.querySelector('#question').value`)
  await go(ui, '知识库')
  const before = fixture.state.posts.length
  await fill('[aria-label="知识提问内容"]', '阅读提问失败后重试')
  await click('生成学习目录')
  await waitFor(
    async () => fixture.state.posts.length === before + 1,
    'library question model request'
  )
  assert.equal(
    await ui.evaluate(`getComputedStyle(document.querySelector('.reading-question')).position`),
    'static'
  )
  fixture.state.response.writeHead(503, { 'Content-Type': 'application/json' })
  fixture.state.response.end(JSON.stringify({ error: { message: 'synthetic unavailable' } }))
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.session-task') && !document.querySelector('.knowledge-question .primary').disabled`
      ),
    'failed planning retains retry'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="知识提问内容"]').value`),
    '阅读提问失败后重试'
  )
  assert.equal(await ui.evaluate(`document.querySelectorAll('.directory-point').length`), 0)
  await click('生成学习目录')
  await waitFor(async () => fixture.state.posts.length === before + 2, 'explicit retry request')
  assert.equal(JSON.parse(fixture.state.posts.at(-1).input).question, '阅读提问失败后重试')
  await go(ui, '探索')
  finish(fixture, { points: [{ title: '阅读提问专属目录', theme: '阅读回归', facet: '提问流程' }] })
  await waitFor(
    async () => fixture.state.posts.length === before + 3,
    'hidden library qualification'
  )
  const points = JSON.parse(fixture.state.posts.at(-1).input).points
  finish(fixture, {
    decisions: points.map((p) => ({
      id: p.id,
      decision: 'keep',
      reason: '通用方法',
      category: '阅读回归',
      subcategory: '提问流程',
      project_required: false
    }))
  })
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.session-task')`),
    'hidden library completion'
  )
  assert.equal(await ui.evaluate(`document.querySelector('#question').value`), exploration)
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.directory-panel')?.innerText.includes('阅读提问专属目录') ?? false`
    ),
    false
  )
  await go(ui, '知识库')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.directory-panel')?.innerText.includes('阅读提问专属目录')`
      ),
    'library owns completed question'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="知识提问内容"]').value`),
    '阅读提问失败后重试'
  )
  await go(ui, '探索')
  report.checks.push(
    'library reading question: HTTP failure preserves draft and retry, explicit retry uses planner/reviewer, background result stays on library, exploration main input preserved'
  )
}
