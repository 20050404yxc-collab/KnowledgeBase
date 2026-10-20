// 文件：check_settings_ui.mjs
// 层：维护验证
// 作用：在隔离桌面验证设置、独立计价和全历史用量展示。
// 说明：系统目录打开由宿主单测模拟，桌面测试不启动文件管理器。
import assert from 'node:assert/strict'

// 选择值通过原生事件进入 React，价格保存使用实际表单。
async function choose(ui, selector, value) {
  await ui.evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new Event('change',{bubbles:true}));})()`)
}

// 页内切换保留草稿和价格，离开模型发现后不能接受迟到结果。
async function checkPaths(context) {
  const { ui, fill, click, waitFor, screenshot, fixture } = context
  await click('编辑')
  await fill('.provider-form input[placeholder="例如：我的 GPT 接口"]', '设置保留草稿')
  fixture.state.slow = null
  await fill('.provider-form input[type=url]', fixture.url.replace('/v1', '/slow/v1'))
  await click('获取模型列表')
  await waitFor(async () => !!fixture.state.slow, 'settings slow model discovery')
  await click('存储与日志')
  fixture.state.slow.end(JSON.stringify({ data: [{ id: 'stale-settings-model' }] }))
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.storage-row').length===4`),
    'actual storage paths'
  )
  const paths = await ui.evaluate(`window.knowledgeBase.storagePaths()`)
  const boot = await ui.evaluate(`window.knowledgeBase.request('bootstrap')`)
  assert.equal(paths.data, boot.data_dir)
  assert.equal(paths.database, paths.data + '\\knowledge.sqlite3')
  assert.equal(paths.logs, paths.data + '\\logs')
  assert.equal(paths.sources, paths.data + '\\sources')
  const shown = await ui.evaluate(`document.querySelector('.storage-settings').innerText`)
  assert.ok(Object.values(paths).every((path) => shown.includes(path)))
  assert.equal(await ui.evaluate(`document.querySelectorAll('.storage-row button').length`), 3)
  await ui.evaluate(`window.scrollTo(0,0)`)
  await screenshot('desktop-storage-settings.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true)
    await screenshot('desktop-storage-settings-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  await click('API 配置')
  assert.equal(await ui.evaluate(`document.body.innerText.includes('stale-settings-model')`), false)
  await fill('.provider-form input[type=url]', fixture.url)
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.provider-form input[placeholder="例如：我的 GPT 接口"]').value`
    ),
    '设置保留草稿'
  )
}

// 分别配置币种和价格，零价格仍有效，切换计价模型不能覆盖另一项。
async function priceDraft(context) {
  const { ui, fill, click, waitFor, screenshot } = context
  await choose(ui, '[aria-label="计价模型"]', 'fixture-a')
  await ui.evaluate(`document.querySelector('[aria-label="添加模型价格"]').click()`)
  await fill('[aria-label="模型输入单价"]', '0')
  await fill('[aria-label="模型输出单价"]', '0')
  await choose(ui, '[aria-label="计价模型"]', 'fixture-b')
  await ui.evaluate(`document.querySelector('[aria-label="添加模型价格"]').click()`)
  await fill('[aria-label="模型输入单价"]', '3')
  await fill('[aria-label="模型输出单价"]', '4')
  await choose(ui, '[aria-label="模型计价币种"]', 'CNY')
  await choose(ui, '[aria-label="计价模型"]', 'fixture-a')
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="模型输入单价"]').value`),
    '0'
  )
  await choose(ui, '[aria-label="计价模型"]', 'fixture-b')
  await ui.evaluate(
    `document.querySelector('.model-price-settings').scrollIntoView({block:'center'})`
  )
  await screenshot('desktop-model-prices.png')
  assert.equal(
    await ui.evaluate(
      `getComputedStyle(document.querySelector('.model-price-toggle')).flexDirection`
    ),
    'row'
  )
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true)
    await ui.evaluate(
      `document.querySelector('.model-price-settings').scrollIntoView({block:'center'})`
    )
    await screenshot('desktop-model-prices-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  await click('保存修改')
  await waitFor(async () => {
    const [p] = (await ui.evaluate(`window.knowledgeBase.request('bootstrap')`)).providers
    return p.model_prices.length === 2 && p.name === '设置保留草稿'
  }, 'independent model prices saved')
}

// 使用实际 ProviderClient 调用本机 SSE，核对真实模型单价快照与用量。
async function checkPriceAttempts(context) {
  const { ui, fixture, configId, click, waitFor, screenshot } = context
  fixture.state.reply = () => ({ result: 'OK' })
  const before = await ui.evaluate(`window.knowledgeBase.request('usage.summary')`)
  for (const model of ['fixture-b', 'fixture-a']) {
    await ui.evaluate(
      `window.knowledgeBase.request('providers.test',{id:${JSON.stringify(configId)},model:${JSON.stringify(model)}})`
    )
    const [attempt] = await ui.evaluate(`window.knowledgeBase.request('usage.list')`)
    assert.equal(attempt.model, model)
    assert.equal(attempt.input_tokens, 10)
    assert.equal(attempt.output_tokens, 20)
    assert.ok(Math.abs(attempt.cost - (model === 'fixture-b' ? 0.00011 : 0)) < 1e-12)
    assert.equal(attempt.currency, model === 'fixture-b' ? 'CNY' : 'USD')
  }
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.endsWith('用量统计')).click()`
  )
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.usage-summary')`),
    'usage summary visible'
  )
  const after = await ui.evaluate(`window.knowledgeBase.request('usage.summary')`)
  assert.equal(after.calls, before.calls + 2)
  assert.equal(after.total_tokens, before.total_tokens + 60)
  assert.ok(after.currencies.some((item) => item.currency === 'CNY' && item.estimated > 0))
  await ui.evaluate(`window.scrollTo(0,0)`)
  await screenshot('desktop-token-summary.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true)
    await screenshot('desktop-token-summary-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  fixture.state.reply = null
}

// 在既有模型流程完成后验证新设置，不改变前序用例的调用顺序。
export async function checkSettingsUi(context) {
  await context.ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.endsWith('设置')).click()`
  )
  await checkPaths(context)
  await priceDraft(context)
  await checkPriceAttempts(context)
  context.report.checks.push(
    'settings actual paths and preserved draft; per-model optional prices with zero and CNY; actual call snapshots and full-history token summary; wide/narrow layouts'
  )
}
