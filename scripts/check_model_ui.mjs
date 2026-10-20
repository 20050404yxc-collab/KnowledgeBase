// 文件：check_model_ui.mjs
// 层：维护验证
// 作用：通过隔离桌面和本机模拟服务验证接口与模型交互。
// 说明：合成凭据在 finally 删除，不接触正式接口和用户数据。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { checkPageUi } from './check_page_ui.mjs'
import { checkProjectUi, checkLatePage } from './check_project_ui.mjs'
import { checkBatchUi } from './check_batch_ui.mjs'
import { checkLibraryUi } from './check_library_ui.mjs'

// 模型目录和 SSE 来自本机服务，可控制晚到目录及生成完成时机。
async function fixtureServer() {
  const state = { posts: [], slow: null, response: null }
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer synthetic-ui-model-key')
    if (request.method === 'GET') {
      if (request.url.startsWith('/slow/')) {
        state.slow = response
        return
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({ data: [{ id: 'fixture-a' }, { id: 'fixture-b' }, { id: 'fixture-a' }] })
      )
      return
    }
    let body = ''
    for await (const chunk of request) {
      body += chunk
    }
    state.posts.push(JSON.parse(body))
    state.response = response
    if (state.reply) {
      finish({ state }, state.reply(state.posts.at(-1)))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { ...state, state, server, url: `http://127.0.0.1:${server.address().port}/v1` }
}

// React select 通过原生 setter 和 change 事件更新受控状态。
async function select(ui, selector, value) {
  await ui.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw Error('Missing select')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('change', {bubbles: true}))
  })()`)
}

// 使用受限公开 API 读取隔离数据，辅助核对界面没有偷偷保存草稿。
async function providers(ui) {
  return (await ui.evaluate(`window.knowledgeBase.request('bootstrap')`)).providers
}

// 获取、去重和手动目录只修改草稿；地址变化取消旧结果，默认可留空。
async function createDraft(context) {
  const { ui, fill, click, waitFor, fixture } = context
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('API 配置')).click()`
  )
  await fill('.provider-form input[placeholder="例如：我的 GPT 接口"]', 'UI 模型测试')
  await fill('.provider-form input[type=url]', fixture.url.replace('/v1', '/slow/v1'))
  await fill('.provider-form input[type=password]', 'synthetic-ui-model-key')
  await click('获取模型列表')
  await waitFor(async () => !!fixture.state.slow, 'slow discovery received')
  await fill('.provider-form input[type=url]', fixture.url)
  fixture.state.slow.end(JSON.stringify({ data: [{ id: 'stale-model' }] }))
  await click('获取模型列表')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.model-catalog > div').length === 2`),
    'deduplicated discovery'
  )
  assert.equal(await ui.evaluate(`document.querySelector('[aria-label="默认模型"]').value`), '')
  assert.equal((await providers(ui)).length, 0)
  assert.equal(await ui.evaluate(`document.body.innerText.includes('stale-model')`), false)
  await fill('[aria-label="手动模型 ID"]', 'manual-model')
  await click('手动添加')
  await ui.evaluate(`document.querySelector('[aria-label="移除模型 manual-model"]').click()`)
  await click('保存接口')
  await waitFor(async () => (await providers(ui)).length === 1, 'save no-default configuration')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.provider-card') !== null`),
    'provider card'
  )
  const [saved] = await providers(ui)
  assert.equal(saved.model, '')
  assert.deepEqual(saved.models, ['fixture-a', 'fixture-b'])
  context.configId = saved.id
}

// 编辑取消不写库；同 ID 保存留空 Key 后仍可获取目录，草稿删除默认会清空默认值。
async function editDraft(context) {
  const { ui, click, fill, waitFor, screenshot } = context
  await click('编辑')
  assert.equal(
    await ui.evaluate(`document.querySelector('.provider-form input[type=password]').value`),
    ''
  )
  await fill('.provider-form input[placeholder="例如：我的 GPT 接口"]', '取消的名称')
  await click('取消')
  assert.equal((await providers(ui))[0].name, 'UI 模型测试')
  await click('编辑')
  await click('获取模型列表')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('已获取 2 个模型')`),
    'saved secret discovery'
  )
  await select(ui, '[aria-label="默认模型"]', 'fixture-a')
  await ui.evaluate(`document.querySelector('[aria-label="移除模型 fixture-a"]').click()`)
  assert.equal(await ui.evaluate(`document.querySelector('[aria-label="默认模型"]').value`), '')
  await click('获取模型列表')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.model-catalog > div').length === 2`),
    'restore draft model'
  )
  await select(ui, '[aria-label="默认模型"]', 'fixture-a')
  await fill('.provider-form input[placeholder="例如：我的 GPT 接口"]', 'UI 已编辑')
  await ui.evaluate(`document.querySelector('.model-fields').scrollIntoView({block: 'center'})`)
  await screenshot('desktop-model-edit.png')
  await click('保存修改')
  await waitFor(async () => (await providers(ui))[0].name === 'UI 已编辑', 'same-id edit')
  const [saved] = await providers(ui)
  assert.equal(saved.id, context.configId)
  assert.equal(saved.model, 'fixture-a')
  assert.equal(saved.active, true)
  await screenshot('desktop-model-settings.png')
}

// 未选模型在本地失败，正式提问将模型与强度传到 HTTP，并在进行中禁用选择器。
async function generate(context) {
  const { ui, fill, click, waitFor, fixture, screenshot } = context
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  await fill('#question', '数据库事务：模型强度界面测试新概念')
  await click('拆解并学习 ↗')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('请选择模型；此接口未设置默认模型')`),
    'missing model error'
  )
  assert.equal(fixture.state.posts.length, 0)
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('API 配置')).click()`
  )
  await editDraft(context)
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  await select(ui, '.composer-caption [aria-label="生成模型"]', 'fixture-b')
  await select(ui, '.composer-caption [aria-label="推理强度"]', 'high')
  await select(ui, '.composer-caption [aria-label="生成模型"]', 'fixture-a')
  assert.equal(
    await ui.evaluate(`document.querySelector('.composer-caption [aria-label="推理强度"]').value`),
    'auto'
  )
  await select(ui, '.composer-caption [aria-label="生成模型"]', 'fixture-b')
  await select(ui, '.composer-caption [aria-label="推理强度"]', 'high')
  await screenshot('desktop-model-selection.png')
  await click('拆解并学习 ↗')
  await waitFor(async () => fixture.state.posts.length === 1, 'generation HTTP received')
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.composer-caption [aria-label="生成模型"]').disabled`
    ),
    true
  )
  assert.equal(fixture.state.posts[0].model, 'fixture-b')
  assert.deepEqual(fixture.state.posts[0].reasoning, { effort: 'high' })
  finish(fixture, {
    points: [
      { title: '模型选择验证', theme: '模型测试', facet: '临时模型和推理强度的作用' },
      { title: '错误处理', theme: '模型测试', facet: '异常恢复策略' }
    ]
  })
  await finishReview(context, 2)
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.directory-point').length === 2`),
    'point directory'
  )
  assert.equal(await ui.evaluate(`document.querySelector('.answer-panel') === null`), true)
  await screenshot('desktop-directory.png')
  await ui.evaluate(`document.querySelector('.directory-point').click()`)
  await click('学习这个知识点')
  await waitFor(async () => fixture.state.posts.length === 3, 'lazy detail HTTP received')
  await verifyMarkdown(context)
}

// 正文验证独立覆盖格式、引用、代码字面量和危险内容拦截。
async function verifyMarkdown(context) {
  const { fixture, waitFor, ui } = context
  const evidence = JSON.parse(fixture.state.posts[2].input).evidence
  const citation = evidence[0]
  context.citation = citation
  const marker = citation ? `[${citation.id}]` : '[unknown]'
  const content = [
    '## 连接与退避',
    '',
    '**重点**：隔离服务生成的完整知识正文。',
    '',
    '- **整体开发与设备接入： **独立负责',
    '- 按点学习',
    '- 保留原笔记',
    '',
    '| 模型 | 状态 |',
    '| --- | --- |',
    '| fixture-b | 已验证 |',
    '',
    '```js',
    '// **代码标签： **保留星号',
    `const literal = "${marker}"; // ${'longcode'.repeat(30)}`,
    '```',
    '',
    '依据 ' + marker,
    '',
    '<script>window.__markdownExecuted=true</script>',
    '',
    '[危险链接](javascript:alert(1))',
    '',
    '![外部图片](https://example.test/pixel.png)'
  ].join('\n')
  finish(fixture, {
    title: '不采用的整句问题',
    content,
    citation_ids: citation ? [citation.id] : [],
    recommendations: []
  })
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.answer-panel')?.innerText.includes('隔离服务生成')`),
    'completed generated answer'
  )
  await verifyRenderedMarkdown(context, marker, citation)
}

// 验证浏览器实际 DOM 与模型原始 Markdown 的可读映射。
async function verifyRenderedMarkdown(context, marker, citation) {
  const { ui, fixture, waitFor, screenshot } = context
  assert.equal(
    await ui.evaluate(
      `!!document.querySelector('.markdown-content h2') && !!document.querySelector('.markdown-content strong') && !!document.querySelector('.markdown-content table') && !!document.querySelector('.markdown-content ul')`
    ),
    true
  )
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.markdown-content code').innerText.includes(${JSON.stringify(marker)})`
    ),
    true
  )
  assert.equal(
    await ui.evaluate(
      `window.__markdownExecuted === undefined && !document.querySelector('.markdown-content img') && !document.querySelector('.markdown-content a[href^="javascript:"]')`
    ),
    true
  )
  if (citation) {
    assert.equal(await ui.evaluate(`document.querySelectorAll('.inline-citation').length`), 1)
    await ui.evaluate(`document.querySelector('.inline-citation').click()`)
    await waitFor(
      () => ui.evaluate(`!!document.querySelector('.citation-locator')`),
      'inline citation'
    )
    await ui.evaluate(`document.querySelector('[aria-label="关闭引用"]').click()`)
  }
  assert.equal(
    await ui.evaluate(
      `Array.from(document.querySelectorAll('.markdown-content strong')).some((e) => e.innerText === '整体开发与设备接入：')`
    ),
    true
  )
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.markdown-content code').innerText.includes('**代码标签： **')`
    ),
    true
  )
  await screenshot('desktop-markdown.png')
  await verifyResponsive(context)
  context.generated = (
    await ui.evaluate(`window.knowledgeBase.request('knowledge.search', {query: '模型选择验证'})`)
  ).items.find((hit) => hit.kind === 'knowledge')
  assert.ok(context.generated)
  const stored = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.get', {id: ${JSON.stringify(context.generated.knowledge_id)}})`
  )
  assert.ok(stored.content.includes('**整体开发与设备接入： **独立负责'))
  assert.equal(fixture.state.posts.length, 3)
  assert.equal((await providers(ui))[0].model, 'fixture-a')
  const attempts = await ui.evaluate(`window.knowledgeBase.request('usage.list')`)
  assert.equal(attempts[0].model, 'fixture-b')
  assert.equal(attempts[0].cost, null)
}

// 较窄窗口目录堆叠，长代码在正文内部滚动，不撑开整个窗口。
async function verifyResponsive({ ui, screenshot }) {
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(
      await ui.evaluate(
        `getComputedStyle(document.querySelector('.knowledge-workspace')).gridTemplateColumns.split(' ').length`
      ),
      1
    )
    assert.equal(
      await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`),
      true
    )
    assert.equal(
      await ui.evaluate(
        `document.querySelector('.answer-panel pre').scrollWidth > document.querySelector('.answer-panel pre').clientWidth`
      ),
      true
    )
    await ui.evaluate(`document.querySelector('.answer-panel').scrollIntoView({block: 'start'})`)
    await screenshot('desktop-markdown-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 完整终态经真实 SSE 返回，目录与正文复用相同传输但各自独立记账。
function finish(fixture, value) {
  fixture.state.response.setHeader('Content-Type', 'text/event-stream')
  fixture.state.response.end(
    [
      { type: 'response.output_text.delta', delta: JSON.stringify(value) },
      { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 20 } } }
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')
  )
}

// 后续问题关联原主题，补充先预览，经核对保存后单独编辑删除并同步搜索。
async function supplement(context) {
  const { ui, fill, click, waitFor, fixture, screenshot, generated } = context
  await fill('#question', '模型选择验证有哪些新内容')
  await click('拆解并学习 ↗')
  await waitFor(async () => fixture.state.posts.length === 4, 'supplement planning')
  finish(fixture, {
    points: [
      {
        title: '模型选择验证',
        theme: '模型测试',
        facet: '新增重试与退避说明',
        target_id: generated.knowledge_id
      }
    ]
  })
  await finishReview(context, 5)
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.directory-point').length === 1`),
    'supplement directory'
  )
  await ui.evaluate(`document.querySelector('.directory-point').click()`)
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.answer-panel')?.innerText.includes('隔离服务生成')`),
    'open original locally'
  )
  assert.equal(fixture.state.posts.length, 5)
  await click('生成补充')
  await waitFor(async () => fixture.state.posts.length === 6, 'supplement generation')
  finish(fixture, {
    title: '补充说明',
    content: '### 增量补充\n\n**jitterstrategy**：增加退避抖动以分散请求。',
    citation_ids: [],
    recommendations: []
  })
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('确认归属并保存补充')`),
    'review before capture'
  )
  assert.equal(
    (
      await ui.evaluate(
        `window.knowledgeBase.request('knowledge.get', {id: ${JSON.stringify(generated.knowledge_id)}})`
      )
    ).supplements.length,
    0
  )
  await click('确认归属并保存补充')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.supplement-item').length === 1`),
    'supplement saved'
  )
  assert.equal(fixture.state.posts.length, 6)
  assert.equal(
    await ui.evaluate(`document.querySelector('.answer-panel').innerText.includes('隔离服务生成')`),
    true
  )
  await screenshot('desktop-supplement.png')
  await maintainSupplement(context)
}

// 补充独立维护后检索立刻反映新正文，删除不影响原笔记。
async function maintainSupplement(context) {
  const { ui, fill, click, waitFor, fixture } = context
  await click('编辑补充')
  await fill('[aria-label="补充正文"]', 'editedsupplement 修改后的补充内容')
  await click('保存补充')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.supplement-item')?.innerText.includes('editedsupplement')`
      ),
    'supplement edit'
  )
  assert.equal(
    (
      await ui.evaluate(
        `window.knowledgeBase.request('knowledge.search', {query: 'jitterstrategy'})`
      )
    ).total,
    0
  )
  assert.equal(
    (
      await ui.evaluate(
        `window.knowledgeBase.request('knowledge.search', {query: 'editedsupplement'})`
      )
    ).total,
    1
  )
  await ui.evaluate(`window.confirm = () => true`)
  await click('删除补充')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.supplement-item').length === 0`),
    'supplement delete'
  )
  assert.equal(
    (
      await ui.evaluate(
        `window.knowledgeBase.request('knowledge.search', {query: 'editedsupplement'})`
      )
    ).total,
    0
  )
  await fill('#question', '模型选择验证')
  await click('本地检索')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.local-results')?.innerText.includes('模型选择验证')`),
    'independent local search'
  )
  assert.equal(fixture.state.posts.length, 6)
  assert.equal(await ui.evaluate(`document.querySelectorAll('.directory-point').length`), 0)
  context.report.checks.push(
    'directory lazy learning; safe Markdown table/code/reference; review, edit, delete and index supplement; independent zero-model search'
  )
}

// 新功能验收附加到既有桌面回归，失败也删除本轮合成系统凭据。
export async function checkModelUi(context) {
  const fixture = await fixtureServer()
  const value = { ...context, fixture, configId: null }
  try {
    await createDraft(value)
    await generate(value)
    await checkPageUi(value)
    await supplement(value)
    await checkProjectUi({ ...value, finish })
    await checkLatePage({ ...value, finish })
    await checkBatchUi({ ...value, finish })
    await checkLibraryUi({ ...value, finish })
    context.report.checks.push(
      'model discovery: stale cancellation, deduplication, manual add/remove, optional default, draft cancellation'
    )
    context.report.checks.push(
      'same-id edit keeps saved key; composer model and effort reach HTTP; selectors disabled while generating; override cost unknown'
    )
  } finally {
    try {
      const saved = await providers(context.ui)
      for (const config of saved) {
        await context.ui.evaluate(
          `window.knowledgeBase.request('providers.delete', {id: ${JSON.stringify(config.id)}})`
        )
      }
    } finally {
      fixture.server.closeAllConnections()
      await new Promise((resolve) => fixture.server.close(resolve))
    }
  }
}

// 独立审核请求使用该次候选ID；不把旧的规划响应复用为审核许可。
async function finishReview(context, count) {
  const { fixture, waitFor } = context
  await waitFor(async () => fixture.state.posts.length === count, 'independent qualification HTTP')
  const prompt = JSON.parse(fixture.state.posts[count - 1].input)
  finish(fixture, {
    decisions: prompt.points.map((p) => ({
      id: p.id,
      decision: 'keep',
      reason: '可复用的技术方法',
      category: '框架与工具',
      subcategory: '模型测试',
      project_required: false
    }))
  })
}
