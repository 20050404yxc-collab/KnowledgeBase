// 文件：check_library_ui.mjs
// 层：维护验证
// 作用：验证全库重构确认、跨页阶段推进和完整分类树。
// 说明：仅隔离数据和本机模拟接口，不发送真实知识。
import assert from 'node:assert/strict'
import { readDiagnosticLog } from './diagnostic_fixtures.mjs'
import { checkMergeUi } from './check_merge_ui.mjs'
import { verifyPlanetPages } from './check_planet_ui.mjs'

// 校验摘要失败的后台记录只包含固定字段、规则和上下文索引。
async function assertSummaryFailure(logDir, requestId) {
  const text = await readDiagnosticLog(logDir, 'worker')
  const rows = text.trim().split('\n').map(JSON.parse)
  const failure = rows.find(
    (row) =>
      row.event === 'step.failed' &&
      row.step === 'library.validate_summary' &&
      row.request_id === requestId
  )
  assert.equal(failure.errors[0].validation.field, '知识要点')
  assert.equal(failure.errors[0].validation.rule, 'required_text')
  assert.equal(failure.errors[0].validation.actual_type, 'list')
  assert.equal(failure.errors[0].validation.limit, 1600)
  assert.ok(
    rows.some((row) => row.event === 'library.summary_context' && row.request_id === requestId)
  )
  assert.ok(!text.includes('private-summary-body'))
}

// 重现截图中的红色摘要校验提示，编号必须关联到具体校验原因且原知识不变。
async function checkSummaryFailure({ ui, click, waitFor, fixture, logDir, report, screenshot }) {
  fixture.state.reply = () => ({ summary: ['private-summary-body'] })
  await click('重构知识库')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('[aria-label="重构覆盖与来源核对"] [role="alert"]')?.innerText.includes('知识要点无效')`
      ),
    'failed summary pauses with source context'
  )
  const rows = (await readDiagnosticLog(logDir, 'worker')).trim().split('\n').map(JSON.parse)
  const failure = rows.findLast(
    (row) => row.event === 'step.failed' && row.step === 'library.validate_summary'
  )
  await assertSummaryFailure(logDir, failure.request_id)
  await screenshot('desktop-summary-error.png')
  await click('取消并丢弃草案')
  fixture.state.reply = null
  report.checks.push(
    'invalid model summary pauses both workers with safe validation rule and source context'
  )
}

// 导航按可见名称定位，新增页面不改变测试目标。
async function go(ui, page) {
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith(${JSON.stringify(page)})).click()`
  )
}

// 仅合成要点、分类及整理建议，不放宽生产模型校验。
function reply(body) {
  const input = JSON.parse(body.input)
  if ('chunk' in input) {
    return { summary: input.title + ' 的概念及限制条件' }
  }
  if ('left' in input && 'right' in input) {
    return { kind: 'related', reason: '不同来源保持独立', overlap: [], unique: [], conflict: [] }
  }
  if ('items' in input) {
    return {
      assignments: input.items.map((item) => ({
        id: item.id,
        category: '重构大类',
        subcategory: '整理小类',
        reason: '根据要点整理'
      }))
    }
  }
  return {
    content:
      input.mode === 'replace' ? input.original + '\n\n结构整理说明。' : '手工正文另附整理建议。',
    reason: '改善知识结构'
  }
}

// 执行目录预览、内容差异和原子应用，保留未选更新与手工知识正文。
async function runRestructureFlow(context, manual, original, count) {
  const { ui, click, waitFor, fixture, finish, screenshot } = context
  await click('重构知识库')
  await waitFor(async () => fixture.state.posts.length >= count + 1, 'first overview stage')
  await go(ui, '资料库')
  assert.equal(await ui.evaluate(`!!document.querySelector('.session-task')`), true)
  await screenshot('desktop-background-task.png')
  fixture.state.reply = reply
  for (const entry of [...fixture.state.pending]) {
    if (!entry.response.destroyed && !entry.response.writableEnded) {
      finish(fixture, reply(entry.body))
    }
  }
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.session-task')`),
    'all overview and directory stages complete hidden',
    30000
  )
  await go(ui, '知识库')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="重构目录预览"] .outline-change')`),
    'directory awaiting confirmation'
  )
  const unmodified = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.get', {id:${JSON.stringify(manual.id)}})`
  )
  assert.equal(!!unmodified.category, false)
  assert.equal(unmodified.content, manual.content)
  assert.equal(
    fixture.state.posts.slice(count).some((b) => 'mode' in JSON.parse(b.input)),
    false
  )
  await screenshot('desktop-restructure-outline.png')
  await decideExistingGroups(context)
  await click('确认目录，准备内容调整')
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('[aria-label="重构内容差异"]') && !document.querySelector('.session-task')`
      ),
    'content changes ready',
    30000
  )
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.content-change input:checked').length`),
    0
  )
  await selectManualSuggestion(context, manual.id)
  await screenshot('desktop-restructure-diff.png')
  await checkNarrowDiff(context)
  await click('确认目录并应用所选更新（1）')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('重构已保存')`),
    'atomic library apply'
  )
  const applied = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.get', {id:${JSON.stringify(manual.id)}})`
  )
  assert.equal(applied.content, manual.content)
  assert.equal(applied.supplements.length, 1)
  assert.equal(applied.category, '重构大类')
  assert.equal(applied.subcategory, '整理小类')
  for (const item of original.filter((i) => i.id !== manual.id)) {
    const current = await ui.evaluate(
      `window.knowledgeBase.request('knowledge.get', {id:${JSON.stringify(item.id)}})`
    )
    assert.equal(current.content.slice(0, 260), item.content)
  }
  await click('关闭重构结果')
  fixture.state.reply = null
}

// 先确认目录，再核对差异；未选更新保持原样，手工知识只追加。
export async function checkLibraryUi(context) {
  const { ui, waitFor, fixture, report } = context
  const manual = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.save', {title:'重构手工保护',content:'手工正文逐字保留'})`
  )
  await go(ui, '知识库')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="知识库页面"]')`),
    'library page'
  )
  await checkSummaryFailure(context)
  const original = await ui.evaluate(`window.knowledgeBase.request('knowledge.list')`)
  const count = fixture.state.posts.length
  await runRestructureFlow(context, manual, original, count)
  await checkMergeUi(context, reply)
  await verifyCompleteTree(context)
  report.checks.push(
    'library overview continues across pages; final directory confirmation precedes content preparation; diffs default unselected; selected manual suggestion appended; other bodies preserved; all four complete trees'
  )
}

// 窄窗口仍可查看双列差异，不允许页面横向溢出。
async function checkNarrowDiff({ ui, screenshot }) {
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(
      await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`),
      true
    )
    await screenshot('desktop-restructure-diff-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 分页查看正文差异直到目标条目，勾选行为由真实 React 复选框触发。
async function selectManualSuggestion({ ui, click, waitFor }, id) {
  const previewCount = await ui.evaluate(
    `Number(document.querySelector('[aria-label="重构内容差异"] .pagination span').innerText.match(/共 ([0-9]+)/)[1])`
  )
  for (let page = 0; page < previewCount; page++) {
    if (
      await ui.evaluate(
        `document.querySelector('.content-change label').innerText.includes('重构手工保护')`
      )
    ) {
      assert.equal(
        await ui.evaluate(
          `document.querySelector('.content-change label').innerText.includes('追加整理')`
        ),
        true
      )
      await ui.evaluate(`document.querySelector('.content-change input').click()`)
      return
    }
    const old = await ui.evaluate(`document.querySelector('.content-change label').innerText`)
    await ui.evaluate(
      `document.querySelector('[aria-label="重构内容差异"] .pagination button:last-child').click()`
    )
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.content-change label').innerText !== ${JSON.stringify(old)}`
        ),
      'next suggestion'
    )
  }
  throw Error('Missing manual content suggestion: ' + id)
}

// 超过旧列表上限的知识仍全部计数并可逐页查看；各分区先过滤后聚合。
async function verifyCompleteTree(context) {
  const { ui, fill, waitFor, screenshot } = context
  const ids = await ui.evaluate(`(async () => { const ids=[]; for (let i=0;i<205;i++) {
    const item = await window.knowledgeBase.request('knowledge.save',{title:'完整树条目'+i,content:'完整树合成知识正文'+i});
    await window.knowledgeBase.request('knowledge.bucket',{id:item.id,bucket:'常用'}); ids.push(item.id)
  } return ids })()`)
  await go(ui, '资料库')
  await go(ui, '常用')
  await fill('[aria-label="筛选已有知识"]', '完整树条目')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText === '205'`),
    'complete tree count'
  )
  await verifyPlanetPages(context, ids.length)
  await ui.evaluate(`window.scrollTo(0,0)`)
  await screenshot('desktop-saved-tree.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.planet-leaf').length === 4`),
      'narrow bounded nodes'
    )
    await ui.evaluate(`document.querySelector('.planet-canvas').scrollIntoView({block:'center'})`)
    assert.equal(
      await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`),
      true
    )
    await screenshot('desktop-saved-tree-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 候选默认未决定，模拟用户明确逐组保留独立来源。
async function decideExistingGroups({ ui, click, waitFor }) {
  await click('核对重复组')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="重构覆盖与来源核对"] .pagination')`),
    'duplicate list'
  )
  const total = await ui.evaluate(
    `Number(document.querySelector('[aria-label="重构覆盖与来源核对"] .pagination span').innerText.match(/共 ([0-9]+)/)[1])`
  )
  for (let page = 0; page < total; page++) {
    await click('保持独立，不合并')
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('[aria-label="重复组决定"] h4')?.innerText.includes('keep')`
        ),
      'explicit keep decision'
    )
    if (page + 1 < total) {
      await ui.evaluate(
        `document.querySelector('[aria-label="重构覆盖与来源核对"] .pagination button:last-child').click()`
      )
      await waitFor(
        () =>
          ui.evaluate(
            `document.querySelector('[aria-label="重复组决定"] h4')?.innerText.includes('undecided')`
          ),
        'next duplicate group'
      )
    }
  }
}
