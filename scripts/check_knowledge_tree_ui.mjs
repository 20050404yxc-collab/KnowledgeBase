// 文件：check_knowledge_tree_ui.mjs
// 层：维护验证
// 作用：验证真实桌面中的深层导航、内部节点阅读和混合布局。
// 说明：使用隔离应用与本机模拟模型，不访问正式库或外部服务。
import assert from 'node:assert/strict'
import { checkCompactDeep } from './check_usability_ui.mjs'

// 通过实际问答与收录接口建立多层知识，避免绕过运行时路径校验。
async function seedTree({ ui, fixture }) {
  const base = ['编程语言', 'C++']
  const entries = [
    ['STL', base],
    ['容器', [...base, 'STL']],
    ['算法', [...base, 'STL']],
    ['vector', [...base, 'STL', '容器']],
    ['扩容机制', [...base, 'STL', '容器', 'vector']],
    ['容器使用注意', [...base, 'STL', '容器']]
  ]
  const saved = []
  try {
    for (const [title, path] of entries) {
      fixture.state.reply = () => ({
        eligible: true,
        project_required: false,
        reason: '可复用概念',
        title,
        content: `DEEPTREEVALIDATIONOCTOBER：${title}完整正文。`,
        citation_ids: [],
        category_path: path,
        recommendations: []
      })
      const answer = await ui.evaluate(
        `window.knowledgeBase.request('question', ${JSON.stringify({ query: `层级验收知识${title}`, scope: 'knowledge', purpose: 'question', attachment_ids: [] })})`
      )
      assert.deepEqual(answer.knowledge.category_path, path)
      saved.push(answer.knowledge)
    }
  } finally {
    fixture.state.reply = null
  }
  return saved
}

// 完整路径定位真实按钮，不依赖本层是否还有其他分类或知识。
async function enter({ ui, waitFor }, path) {
  await waitFor(
    () =>
      ui.evaluate(
        `Array.from(document.querySelectorAll('.planet-node:not(.planet-hidden)')).some(n=>n.dataset.path===${JSON.stringify(JSON.stringify(path))})`
      ),
    'deep branch exists'
  )
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.planet-node:not(.planet-hidden)')).find(n=>n.dataset.path===${JSON.stringify(JSON.stringify(path))}).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.planet-canvas').dataset.depth==='${path.length}' && !document.querySelector('.planet-status [role]')`
      ),
    'deep branch loaded'
  )
}

// 每种实际宽度都验证分支与正文区域没有几何交集，并保留阅读按钮。
async function checkLayout({ ui, screenshot }, narrow) {
  if (narrow) {
    await ui.command('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    })
  }
  try {
    await ui.evaluate(`new Promise(resolve=>setTimeout(resolve,850))`)
    const result = await ui.evaluate(`(() => {
      const leaves=Array.from(document.querySelectorAll('.saved-leaf')).map(n=>n.getBoundingClientRect());
      const planets=Array.from(document.querySelectorAll('.planet-node:not(.planet-hidden)')).map(n=>n.getBoundingClientRect());
      return {overflow:document.documentElement.scrollWidth>innerWidth, overlaps:leaves.some(a=>planets.some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)), mixed:!!document.querySelector('.planet-mixed-leaves'), read:!!document.querySelector('.tree-node-reading')}
    })()`)
    assert.deepEqual(result, { overflow: false, overlaps: false, mixed: true, read: true })
    await ui.evaluate(`document.querySelector('.saved-tree').scrollIntoView({block:'start'})`)
    await screenshot(`desktop-deep-tree${narrow ? '-narrow' : ''}.png`)
  } finally {
    if (narrow) {
      await ui.command('Emulation.clearDeviceMetricsOverride')
    }
  }
}

// STL 同时可阅读和展开；连续进入五层、阅读叶子及返回都保留实际路径。
export async function checkKnowledgeTreeUi(context) {
  const { ui, fill, waitFor, click, report } = context
  const saved = await seedTree(context)
  assert.equal(new Set(saved.map((item) => item.id)).size, 6)
  const tree = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.tree',{query:'DEEPTREEVALIDATIONOCTOBER'})`
  )
  assert.equal(tree.total, 6)
  const search = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.search',{query:'vector'})`
  )
  assert.ok(search.items.some((hit) => hit.knowledge_id === saved[4].id))
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(n=>n.textContent.trim().endsWith('知识库')).click()`
  )
  await click('星球视图')
  await fill('[aria-label="筛选已有知识"]', 'DEEPTREEVALIDATIONOCTOBER')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.saved-tree .count')?.innerText==='6'`),
    'deep tree count'
  )
  const path = ['编程语言', 'C++', 'STL', '容器', 'vector']
  for (let depth = 1; depth <= 3; depth++) {
    await enter(context, path.slice(0, depth))
  }
  await click('阅读本节点：STL')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='STL'`),
    'internal overview read'
  )
  await checkLayout(context, false)
  await checkLayout(context, true)
  await enter(context, path.slice(0, 4))
  await enter(context, path)
  await click('阅读本节点：vector')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='vector'`),
    'deep internal body read'
  )
  await waitFor(
    () =>
      ui.evaluate(
        `Array.from(document.querySelectorAll('.saved-leaf')).some(n=>n.textContent.includes('扩容机制'))`
      ),
    'deep leaf restored after usage refresh'
  )
  await ui.evaluate(
    `Array.from(document.querySelectorAll('.saved-leaf')).find(n=>n.textContent.includes('扩容机制')).click()`
  )
  await waitFor(
    () => ui.evaluate(`document.querySelector('.answer-heading h2')?.innerText==='扩容机制'`),
    'deep leaf read'
  )
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.planet-breadcrumbs button').length`),
    7
  )
  await click('返回上层')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.planet-canvas').dataset.depth==='4'`),
    'deep return'
  )
  const item = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.get',{id:${JSON.stringify(saved[0].id)}})`
  )
  assert.equal(item.content, 'DEEPTREEVALIDATIONOCTOBER：STL完整正文。')
  await checkCompactDeep(context)
  report.checks.push(
    'deep tree: full-path capture, readable internal nodes, five-level traversal/back, leaf reading and mixed wide/narrow layout'
  )
}
