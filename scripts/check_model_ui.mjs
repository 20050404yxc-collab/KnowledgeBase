// 文件：check_model_ui.mjs
// 层：维护验证
// 作用：通过隔离桌面和本机模拟服务验证接口与模型交互。
// 说明：合成凭据在 finally 删除，不接触正式接口和用户数据。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

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
  await ui.evaluate(`document.querySelectorAll('.nav-item')[5].click()`)
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
  await fill('#question', '模型强度界面测试新概念')
  await click('检索并提问 ↗')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('请选择模型；此接口未设置默认模型')`),
    'missing model error'
  )
  assert.equal(fixture.state.posts.length, 0)
  await ui.evaluate(`document.querySelectorAll('.nav-item')[5].click()`)
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
  await click('检索并提问 ↗')
  await waitFor(async () => fixture.state.posts.length === 1, 'generation HTTP received')
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.composer-caption [aria-label="生成模型"]').disabled`
    ),
    true
  )
  assert.equal(fixture.state.posts[0].model, 'fixture-b')
  assert.deepEqual(fixture.state.posts[0].reasoning, { effort: 'high' })
  const answer = JSON.stringify({
    title: '模型选择验证',
    content: '隔离服务生成的完整知识正文。',
    citation_ids: [],
    recommendations: []
  })
  fixture.state.response.setHeader('Content-Type', 'text/event-stream')
  fixture.state.response.end(
    [
      { type: 'response.output_text.delta', delta: answer },
      { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 20 } } }
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')
  )
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.answer-panel')?.innerText.includes('隔离服务生成')`),
    'completed generated answer'
  )
  assert.equal((await providers(ui))[0].model, 'fixture-a')
  const attempts = await ui.evaluate(`window.knowledgeBase.request('usage.list')`)
  assert.equal(attempts[0].model, 'fixture-b')
  assert.equal(attempts[0].cost, null)
}

// 新功能验收附加到既有桌面回归，失败也删除本轮合成系统凭据。
export async function checkModelUi(context) {
  const fixture = await fixtureServer()
  const value = { ...context, fixture, configId: null }
  try {
    await createDraft(value)
    await generate(value)
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
