// 文件：check_project_ui.mjs
// 层：维护验证
// 作用：验证资格理由、分层目录和项目资料核对入口。
// 说明：只响应本机模拟模型，不触发真实公开项目检索。
import assert from 'node:assert/strict'

// 项目点保留，职责任务被排除；无关附件即使存在也不能直接生成。
export async function checkProjectUi(context) {
  const { ui, fill, click, waitFor, fixture, finish, screenshot, attachmentPath } = context
  let count = fixture.state.posts.length
  await click('本地路径')
  await fill('.modal input', attachmentPath)
  await click('解析并加入')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.attachment.ready') !== null`),
    'attach unrelated project material'
  )
  await fill('#question', '项目工件流转如何实现，以及简历职责润色')
  await click('生成学习目录')
  count++
  await waitFor(async () => fixture.state.posts.length === count, 'project plan')
  finish(fixture, {
    points: [
      { title: '工件队列实现', theme: '项目实践', facet: '项目如何实现工件队列' },
      { title: '职责润色', theme: '简历', facet: '润色职责描述' }
    ]
  })
  count++
  await waitFor(async () => fixture.state.posts.length === count, 'project qualification')
  const points = JSON.parse(fixture.state.posts.at(-1).input).points
  finish(fixture, {
    decisions: [
      {
        id: points[0].id,
        decision: 'keep',
        reason: '可学习的具体实现',
        category: '项目实践',
        subcategory: '工件流转项目',
        project_required: true,
        material_request: '请提供工件队列实现代码与架构',
        search_terms: 'C++ bounded queue'
      },
      { id: points[1].id, decision: 'exclude', reason: '职责润色属于任务，不是知识点' }
    ]
  })
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelectorAll('.directory-point').length === 1 && document.body.innerText.includes('职责润色属于任务')`
      ),
    'qualified project directory'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.directory-group h3').innerText`),
    '项目实践'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.directory-subgroup h4').innerText`),
    '工件流转项目'
  )
  await ui.evaluate(`document.querySelector('.directory-point').click()`)
  await click('学习这个知识点')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.project-context')?.innerText.includes('请提供工件队列')`
      ),
    'project asks for materials'
  )
  assert.equal(fixture.state.posts.length, count)
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="公开项目检索词"]').value`),
    'C++ bounded queue'
  )
  await verifyInsufficientMaterials(context, count)
  await ui.evaluate(`document.querySelector('.project-context').scrollIntoView({block: 'center'})`)
  await screenshot('desktop-project-materials.png')
  context.report.checks.push(
    'qualification reasons and category/subcategory tree; project asks for related material; unrelated attachment cannot unlock generation; visible editable public query and explicit consent controls'
  )
}

// 有附件不代表有项目证据，核对失败后普通学习仍必须被门禁拦截。
async function verifyInsufficientMaterials(context, count) {
  const { ui, click, waitFor, fixture, finish } = context
  await click('核对当前附件是否足够')
  count++
  await waitFor(async () => fixture.state.posts.length === count, 'irrelevant project materials')
  finish(fixture, {
    sufficient: false,
    reason: '当前附件讲解数据库事务，与工件队列项目无关；请补充实现代码',
    citation_ids: []
  })
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.project-context')?.innerText.includes('与工件队列项目无关')`
      ),
    'insufficient materials shown'
  )
  await click('学习这个知识点')
  await waitFor(
    () =>
      ui.evaluate(`!document.querySelector('.composer-caption [aria-label="生成模型"]').disabled`),
    'project gate ended'
  )
  assert.equal(fixture.state.posts.length, count)
}

// 拆解未完成时切页继续审核，终态写回探索且不渲染到其他分区。
export async function checkLatePage(context) {
  const { ui, fill, click, waitFor, fixture, finish } = context
  const count = fixture.state.posts.length + 1
  await fill('#question', '等待时切页的独立目录')
  await click('生成学习目录')
  await waitFor(async () => fixture.state.posts.length === count, 'pending plan')
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b => b.textContent.trim().endsWith('常用')).click()`
  )
  await waitFor(
    () => ui.evaluate(`document.querySelector('[aria-label="常用页面"]') !== null`),
    'switch during pending plan'
  )
  finish(fixture, { points: [{ title: '晚到知识', theme: '晚到主题', facet: '不能显示到常用页' }] })
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('[aria-label="筛选已有知识"]').value === '常用页面专属'`),
    'owned filter survives late request'
  )
  assert.equal(
    await ui.evaluate(
      `!document.querySelector('#question') && !document.querySelector('.directory-panel') && !document.body.innerText.includes('晚到知识')`
    ),
    true
  )
  await waitFor(
    async () => fixture.state.posts.length === count + 1,
    'review continues while hidden'
  )
  const points = JSON.parse(fixture.state.posts.at(-1).input).points
  finish(fixture, {
    decisions: points.map((p) => ({
      id: p.id,
      decision: 'keep',
      reason: '可复用概念',
      category: '晚到主题',
      subcategory: '通用方法',
      project_required: false
    }))
  })
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.session-task')`),
    'hidden plan completes'
  )
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  await waitFor(
    () =>
      ui.evaluate(`!document.querySelector('.composer-caption [aria-label="生成模型"]').disabled`),
    'completed hidden request releases controls'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.directory-point').innerText.includes('晚到知识')`),
    true
  )
  context.report.checks.push(
    'pending plan and independent review continue across navigation; results remain on origin page without leaking into buckets'
  )
}
