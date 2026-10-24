// 文件：check_selection_ui.mjs
// 层：维护验证
// 作用：验证真实桌面选区、免费命中、显式模型回答、追问和确认入库。
// 说明：仅使用隔离数据库和本机 SSE 服务，结束时删除合成凭据和知识。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// 通过实际受限 API 布置隔离样例，所有生成仍从界面发送。
async function request(ui, operation, params = {}) {
  return ui.evaluate(
    `window.knowledgeBase.request(${JSON.stringify(operation)},${JSON.stringify(params)})`
  )
}

// 构造真实浏览器范围，模拟鼠标释放；按钮必须来自正文的选区处理。
async function selectQuote(ui, text) {
  await ui.evaluate(`(async()=> {
    document.querySelector('.answer-panel .selectable-text').scrollIntoView({block:'center',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  })()`)
  await ui.evaluate(`(() => {
    const root=document.querySelector('.answer-panel .selectable-text');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node; while(node=walker.nextNode()) {
      const start=node.textContent.indexOf(${JSON.stringify(text)});
      if(start<0) continue;
      const range=document.createRange(); range.setStart(node,start); range.setEnd(node,start+${text.length});
      const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); return;
    }
    throw Error('Selection quote missing');
  })()`)
}

// 本机完整响应不声明虚构用量；挂起模式用于检验显式取消后不保存半成品。
async function selectionServer() {
  const state = { posts: [], hold: false, pending: [] }
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const part of req) {
      body += part
    }
    state.posts.push(JSON.parse(body))
    if (state.hold) {
      state.pending.push(res)
      return
    }
    const answer = JSON.stringify({
      title: '公平调度解释',
      content: '公平调度让等待线程轮流执行，降低长期饥饿风险。',
      citation_ids: []
    })
    res.setHeader('Content-Type', 'text/event-stream')
    res.end(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: answer })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { state, server, url: `http://127.0.0.1:${server.address().port}/v1` }
}

// 新功能不影响其他验收数据；所有测试产物在 finally 通过正式删除入口清理。
export async function checkSelectionUi(context) {
  const { ui, fill, click, waitFor, report } = context
  const fixture = await selectionServer()
  const ids = []
  let provider
  const original = await ui.evaluate(`document.querySelector('.answer-heading h2').innerText`)
  try {
    const note = await request(ui, 'knowledge.save', {
      title: '选区问答验收背景',
      content: '互斥锁保护共享状态。',
      category_path: ['选区验收']
    })
    const local = await request(ui, 'knowledge.save', {
      title: '公平调度本地解释',
      content: '公平调度使用等待队列，已保存的知识可以复用。',
      category_path: ['选区验收']
    })
    ids.push(note.id, local.id)
    await openFixtureChat(context, note)
    await fill('[aria-label="选区问题"]', '公平调度为什么有效')
    await click('发送问题')
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.selection-panel').innerText.includes('本地相关内容')`
        ),
      'local candidates shown'
    )
    assert.equal(fixture.state.posts.length, 0)
    assert.equal((await request(ui, 'usage.list')).length, 0)
    provider = await saveFixtureProvider(context, fixture)
    await click('询问模型／重试')
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.selection-panel').innerText.includes('降低长期饥饿风险')`
        ),
      'explicit answer shown'
    )
    assert.equal(fixture.state.posts.length, 1)
    try {
      await checkCaptureAndFollowup({ ...context, fixture, ids, note })
    } catch (error) {
      console.error(await ui.evaluate(`document.querySelector('.selection-panel')?.innerText`))
      await context.screenshot('desktop-selection-failure.png')
      throw error
    }
    report.checks.push(
      'selection text opens source-owned chat; local hit costs zero; explicit model reply, preview capture, followup and cancellation'
    )
  } finally {
    for (const response of fixture.state.pending) {
      response.destroy()
    }
    if (provider) {
      await removeFixtureProvider(context)
    }
    for (const id of new Set(ids)) {
      await request(ui, 'knowledge.delete', { id })
    }
    await new Promise((resolve) => fixture.server.close(resolve))
    await fill('.inline-search', original)
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.knowledge-card').length===1`),
      'restore original reading fixture'
    )
    await ui.evaluate(`document.querySelector('.knowledge-card').click()`)
    await ui.evaluate(`document.querySelector('.selection-panel .section-title button')?.click()`)
  }
}

// 通过界面删除以同步运行期接口列表；避免测试清理留下不存在的活动配置。
async function removeFixtureProvider({ ui, waitFor }) {
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('设置')).click()`
  )
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.provider-card')`),
    'provider cleanup visible'
  )
  await ui.evaluate(`(() => {
    const previous=window.confirm; window.confirm=()=>true;
    [...document.querySelectorAll('.provider-card button')].find(b=>b.innerText.trim()==='删除').click();
    window.confirm=previous;
  })()`)
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.provider-card')`),
    'provider cleanup synchronized'
  )
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('探索')).click()`
  )
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.inline-search')`),
    'return after provider cleanup'
  )
}

// 保存预览可编辑且不会增加调用；追问带上必要历史，切页和窄屏均保留。
async function checkCaptureAndFollowup(context) {
  const { ui, fill, click, waitFor, screenshot, fixture, ids } = context
  await click('预览并保存回答')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="问答入库正文"]')`),
    'capture preview'
  )
  assert.match(
    await ui.evaluate(`document.querySelector('[aria-label="问答入库正文"]').value`),
    /阅读背景/
  )
  await fill('[aria-label="问答入库标题"]', '选区回答已保存')
  await click('确认保存回答')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.selection-panel').innerText.includes('已入库')`),
    'capture committed'
  )
  const saved = await request(ui, 'knowledge.search', {
    query: '选区回答已保存',
    scope: 'knowledge'
  })
  ids.push(
    ...saved.items
      .filter((item) => item.title === '选区回答已保存')
      .map((item) => item.knowledge_id)
  )
  assert.equal(fixture.state.posts.length, 1)
  await fill('[aria-label="选区问题"]', '继续举一个公平调度例子')
  await click('发送问题')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelectorAll('.selection-turn').length===2 && !document.querySelector('.session-task')`
      ),
    'followup local lookup complete'
  )
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.selection-turn .markdown-content').length===2`),
    'followup complete'
  )
  assert.equal(fixture.state.posts.length, 2)
  assert.equal(JSON.parse(fixture.state.posts[1].input).history.length, 1)
  await screenshot('desktop-selection-chat-wide.png')
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('资料库')).click()`
  )
  assert.equal(await ui.evaluate(`!!document.querySelector('[aria-label="选区问题"]')`), false)
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('探索')).click()`
  )
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.selection-turn').length===2`),
    'return restores chat'
  )
  await checkNarrow(context)
  await checkSupplementCapture(context)
  await checkCancellation(context)
}

// 同一来源可作为明确选择的补充目标；保存必须保留原正文且不增加模型调用。
async function checkSupplementCapture({ ui, fill, click, waitFor, screenshot, fixture, note }) {
  await click('预览并保存回答')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="问答入库正文"]')`),
    'followup capture preview'
  )
  await fill('[aria-label="搜索补充目标"]', note.title)
  await click('搜索补充目标')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.selection-target').innerText.includes('追加到：选区问答验收背景')`
      ),
    'supplement target found'
  )
  await click('追加到：选区问答验收背景')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.selection-capture').innerText.includes('原笔记保留')`),
    'target current version selected'
  )
  await screenshot('desktop-selection-capture.png')
  await click('确认保存回答')
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.selection-capture')`),
    'supplement committed'
  )
  const current = await request(ui, 'knowledge.get', { id: note.id })
  assert.equal(current.content, note.content)
  assert.equal(current.supplements.length, 1)
  assert.equal(fixture.state.posts.length, 2)
}

// 在途取消等待后台真实终态，残缺回答不能进入保存入口。
async function checkCancellation(context) {
  const { ui, fill, click, waitFor, fixture } = context
  fixture.state.hold = true
  await fill('[aria-label="选区问题"]', '公平调度取消验收')
  await click('发送问题')
  await waitFor(async () => fixture.state.posts.length === 3, 'held actual request')
  await click('取消当前任务')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.selection-panel').innerText.includes('本轮已取消')`),
    'cancelled terminal shown'
  )
  assert.equal(
    (await request(ui, 'usage.list')).filter((item) => item.purpose === 'selection-answer').length,
    3
  )
}

// 仅保存本机合成接口，清理由测试所有者负责。
async function saveFixtureProvider({ ui, fill, click, waitFor }, fixture) {
  await click('设置问答模型')
  await fill('.provider-form input[placeholder="例如：我的 GPT 接口"]', '选区合成接口')
  await fill('.provider-form input[type=url]', fixture.url)
  await fill('.provider-form input[type=password]', 'synthetic-selection-key')
  await fill('[aria-label="手动模型 ID"]', 'selection-fixture')
  await click('手动添加')
  await ui.evaluate(`(() => {
    const element = document.querySelector('[aria-label="默认模型"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,'selection-fixture');
    element.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await click('保存接口')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.provider-card')?.innerText.includes('选区合成接口')`),
    'fixture provider saved from form'
  )
  const configs = (await request(ui, 'bootstrap')).providers
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('探索')).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.selection-model')?.innerText.includes('selection-fixture')`
      ),
    'current chat model agrees with active provider'
  )
  return configs.find((item) => item.name === '选区合成接口').id
}

// 窄屏只覆盖当前阅读区，面板内部滚动，不撑开窗口。
async function checkNarrow({ ui, screenshot }) {
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true)
    await screenshot('desktop-selection-chat-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 由知识卡片进入正文，再通过真实选区入口建立会话。
async function openFixtureChat({ ui, fill, click, waitFor }, note) {
  await fill('.inline-search', note.title)
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.knowledge-card').length===1`),
    'selection fixture listed'
  )
  await ui.evaluate(`document.querySelector('.knowledge-card').click()`)
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='选区问答验收背景'`),
    'selection fixture opened'
  )
  await selectQuote(ui, note.content)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.selection-trigger')`),
    'selection action appears'
  )
  await click('就选中文字提问')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="选区问题"]')`),
    'conversation opened'
  )
}
