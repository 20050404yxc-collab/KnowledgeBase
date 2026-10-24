// 文件：check_batch_ui.mjs
// 层：维护验证
// 作用：验证多选取消、项目一次提交和三个分区的简洁提问。
// 说明：使用隔离桌面与本机合成模型，不访问真实接口。
import assert from 'node:assert/strict'

// 建立三个同类点，审核仍经过真实协议和独立模型响应。
async function planBatch(context, project = false) {
  const { ui, fill, click, waitFor, fixture, finish } = context
  await fill(
    '#question',
    project ? '批量项目的队列、线程与应答如何实现' : '批量校验的重试、超时与幂等'
  )
  let count = fixture.state.posts.length
  await click('生成学习目录')
  await waitFor(async () => fixture.state.posts.length === count + 1, 'batch plan')
  finish(fixture, {
    points: ['重试机制', '超时边界', '幂等提交'].map((name) => ({
      title: `批量${project ? '项目' : '校验'}${name}`,
      theme: '批量验证',
      facet: name
    }))
  })
  count += 2
  await waitFor(async () => fixture.state.posts.length === count, 'batch review')
  const points = JSON.parse(fixture.state.posts.at(-1).input).points
  finish(fixture, {
    decisions: points.map((p) => ({
      id: p.id,
      decision: 'keep',
      reason: '可复用技术',
      category: '批量验证',
      subcategory: project ? '同一个项目' : '通用方法',
      project_required: project,
      material_request: '请提供队列和线程实现',
      search_terms: 'queue'
    }))
  })
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelectorAll('.directory-point').length === 3 && !document.querySelector('.composer-caption [aria-label="生成模型"]').disabled`
      ),
    'batch directory ready'
  )
  return count
}

// 取消第二个在途请求后第三项不得启动，第一项已提交知识必须保留。
export async function checkBatchUi(context) {
  const { ui, click, waitFor, fixture, finish, screenshot, report } = context
  const count = await planBatch(context)
  await ui.evaluate(`document.querySelector('[aria-label="全选 批量验证"]').click()`)
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.directory-row input:checked').length`),
    3
  )
  await click('生成所选知识点')
  await waitFor(async () => fixture.state.posts.length === count + 1, 'batch first generation')
  await ui.evaluate(`document.querySelectorAll('.directory-point')[2].click()`)
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.directory-detail').innerText.includes('批量校验幂等提交')`
      ),
    'reading selection changes during generation'
  )
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('知识库')).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('.session-task') && !!document.querySelector('[aria-label="知识库页面"]')`
      ),
    'batch remains active on library'
  )
  finish(fixture, {
    title: '第一项',
    content: '批量保存成功的第一项完整知识。',
    citation_ids: [],
    recommendations: []
  })
  await waitFor(async () => fixture.state.posts.length === count + 2, 'batch second generation')
  assert.equal(
    await ui.evaluate(`document.querySelector('.session-task strong').innerText`),
    '探索'
  )
  await ui.evaluate(`document.querySelector('.session-task button').click()`)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.batch-panel')`),
    'return to running batch'
  )
  const slowResponse = fixture.state.response
  await ui.evaluate(`document.querySelector('.batch-panel button:last-child').click()`)
  await waitFor(
    () =>
      ui.evaluate(`!document.querySelector('.composer-caption [aria-label="生成模型"]').disabled`),
    'batch cancelled'
  )
  // 迟到的模型响应不能恢复已撤销的批量循环。
  if (!slowResponse.destroyed) {
    slowResponse.end()
  }
  assert.equal(fixture.state.posts.length, count + 2)
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.directory-point small')[0].innerText`),
    '已有知识'
  )
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.directory-point small')[2].innerText`),
    '待学习'
  )
  assert.equal(
    await ui.evaluate(
      `!document.querySelector('.directory-panel .point-actions') && !!document.querySelector('.directory-detail .batch-panel')`
    ),
    true
  )
  await ui.evaluate(
    `document.querySelector('.knowledge-workspace').scrollIntoView({block: 'start'})`
  )
  await screenshot('desktop-batch-cancel.png')
  report.checks.push(
    'category multiselect; reading and navigation preserve sequential generation; explicit cancellation stops later points and retains committed first point; right-side controls'
  )
  await checkProjectBatch(context)
  await checkBucketQuestions(context)
}

// 一次路径上传为同项目全部点提供资料；逐点核对和引用仍必须真实通过。
async function checkProjectBatch(context) {
  const { ui, fill, click, waitFor, fixture, finish, attachmentPath, screenshot, report } = context
  const count = await planBatch(context, true)
  await fill('[aria-label="项目资料本地路径"]', attachmentPath)
  await click('加入资料')
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.project-material-group > button').disabled`),
    'project group material parsed'
  )
  await checkProjectDrop(context)
  await click('补充资料并生成本项目全部知识点')
  for (let index = 0; index < 3; index++) {
    await waitFor(
      async () => fixture.state.posts.length === count + index * 2 + 1,
      'project point material audit'
    )
    const input = JSON.parse(fixture.state.posts.at(-1).input)
    assert.ok(input.evidence.length)
    finish(fixture, {
      sufficient: true,
      reason: '合成实现证据充分',
      citation_ids: [input.evidence[0].id]
    })
    await waitFor(
      async () => fixture.state.posts.length === count + index * 2 + 2,
      'project point generation'
    )
    const prompt = JSON.parse(fixture.state.posts.at(-1).input)
    finish(fixture, {
      title: '项目实现',
      content: `合成项目实现知识点 ${index}。`,
      citation_ids: [prompt.evidence[0].id],
      recommendations: []
    })
  }
  await waitFor(
    () =>
      ui.evaluate(
        `Array.from(document.querySelectorAll('.directory-point small')).every((n) => n.innerText === '已有知识')`
      ),
    'all project points saved'
  )
  assert.equal(fixture.state.posts.length, count + 6)
  await ui.evaluate(`document.querySelector('.project-materials').scrollIntoView({block: 'start'})`)
  await screenshot('desktop-project-batch.png')
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    await ui.evaluate(
      `document.querySelector('.project-materials').scrollIntoView({block: 'start'})`
    )
    assert.equal(
      await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`),
      true
    )
    await screenshot('desktop-project-batch-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  report.checks.push(
    'one right-side path upload and one submission generates every project point with independent material audits and citations'
  )
}

// 原生文件对象经拖放事件进入项目框，冒泡不得导致全局再加入一次。
async function checkProjectDrop({ ui, attachmentPath, waitFor }) {
  const count = await ui.evaluate(`document.querySelectorAll('.composer .attachment').length`)
  await ui.evaluate(
    `(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'project-drop-fixture'; input.hidden = true; document.body.append(input) })()`
  )
  const { root } = await ui.command('DOM.getDocument')
  const { nodeId } = await ui.command('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#project-drop-fixture'
  })
  await ui.command('DOM.setFileInputFiles', { nodeId, files: [attachmentPath] })
  await ui.evaluate(`(() => {
    const input = document.querySelector('#project-drop-fixture'); const data = new DataTransfer(); data.items.add(input.files[0]);
    document.querySelector('.project-upload').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: data})); input.remove()
  })()`)
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.project-material-group > button').disabled`),
    'dropped project file parsed'
  )
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.composer .attachment').length`),
    count
  )
}

// 三个页面都通过同一规划与审核流程提问，离开后探索的问题及目录原样保留。
async function checkBucketQuestions(context) {
  const { ui, fill, click, waitFor, fixture, finish, screenshot, report } = context
  const exploration = await ui.evaluate(`document.querySelector('#question').value`)
  for (let index = 1; index <= 3; index++) {
    await ui.evaluate(
      `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith(${JSON.stringify(['常用', '在学', '归档'][index - 1])})).click()`
    )
    await waitFor(
      () => ui.evaluate(`!!document.querySelector('[aria-label="知识提问内容"]')`),
      'compact bucket question'
    )
    assert.equal(
      await ui.evaluate(
        `document.querySelector('[aria-label="知识提问"]').querySelectorAll('input,button').length`
      ),
      4
    )
    assert.ok(
      await ui.evaluate(
        `document.querySelector('.bucket-learning').innerText.includes('费用') && !!document.querySelector('.bucket-learning .model-picker')`
      )
    )
    const count = fixture.state.posts.length
    await fill('[aria-label="知识提问内容"]', `分区${index}的独立知识问题`)
    await ui.evaluate(
      `[...document.querySelectorAll('.knowledge-question button')].find(b=>b.innerText==='生成学习目录').click()`
    )
    await waitFor(
      async () => fixture.state.posts.length === count + 1,
      'bucket uses exploration planner'
    )
    const prompt = JSON.parse(fixture.state.posts.at(-1).input)
    assert.equal(prompt.question, `分区${index}的独立知识问题`)
    finish(fixture, {
      points: [{ title: `分区${index}专属目录`, theme: '分区问答', facet: '知识方法' }]
    })
    await waitFor(async () => fixture.state.posts.length === count + 2, 'bucket independent review')
    const points = JSON.parse(fixture.state.posts.at(-1).input).points
    finish(fixture, {
      decisions: points.map((p) => ({
        id: p.id,
        decision: 'keep',
        reason: '技术方法',
        category: '分区问答',
        subcategory: '通用方法',
        project_required: false
      }))
    })
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.directory-point')?.innerText.includes('分区${index}专属目录')`
        ),
      'bucket owned directory'
    )
  }
  await screenshot('desktop-bucket-question.png')
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  await waitFor(() => ui.evaluate(`!!document.querySelector('#question')`), 'return to exploration')
  assert.equal(await ui.evaluate(`document.querySelector('#question').value`), exploration)
  assert.equal(await ui.evaluate(`document.querySelectorAll('.directory-point').length`), 3)
  report.checks.push(
    'all three compact bucket questions use exploration planning, with independent directories and preserved exploration state'
  )
}
