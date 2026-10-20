// 文件：check_merge_ui.mjs
// 层：维护验证
// 作用：在隔离 Electron 中验证逐组合并和只读原文入口。
// 说明：原文与模型均为合成数据，最终只选择完整提取稿。
import assert from 'node:assert/strict'

// React 的 select 必须经原生 setter 派发，不能只改 DOM 属性。
async function choose(ui, selector, value) {
  await ui.evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new Event('change',{bubbles:true})); })()`)
}

// 对候选使用真实输入引用，其他内容返回相关但保持独立。
function mergeReply(body, fallback) {
  const input = JSON.parse(body.input)
  if (
    input.left &&
    input.right &&
    input.left.text.includes('MERGE_SHARED') &&
    input.right.text.includes('MERGE_SHARED')
  ) {
    const quotes = [input.left, input.right].map((part) => ({
      source_id: part.source_id,
      locator: part.locator,
      quote: 'MERGE_SHARED'
    }))
    return {
      kind: 'partial-overlap',
      reason: '两份原文含共同概念和各自限定',
      overlap: quotes,
      unique: [input.left, input.right].map((part) => ({
        source_id: part.source_id,
        locator: part.locator,
        quote: part.text
      })),
      conflict: []
    }
  }
  return fallback(body)
}

// 逐组决定时验证默认未决定，只有本轮合成重复组被明确接受。
async function decideGroups(context, ids) {
  const { ui, click, fill, waitFor, screenshot } = context
  await click('核对重复组')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="重构覆盖与来源核对"] .pagination')`),
    'merge groups visible'
  )
  const total = await ui.evaluate(
    `Number(document.querySelector('[aria-label="重构覆盖与来源核对"] .pagination span').innerText.match(/共 ([0-9]+)/)[1])`
  )
  let found = false
  for (let page = 0; page < total; page++) {
    const text = await ui.evaluate(`document.querySelector('[aria-label="重复组决定"]').innerText`)
    assert.ok(text.includes('undecided'))
    if (ids.every((id) => text.includes(id))) {
      found = true
      await choose(ui, '[aria-label="重复组决定"] select', ids[0])
      await fill('[aria-label="重复组决定"] label:nth-of-type(1) input', '合并界面保留点')
      await fill('[aria-label="重复组决定"] label:nth-of-type(2) input', '合并验收')
      await fill('[aria-label="重复组决定"] label:nth-of-type(3) input', '完整来源')
      await choose(ui, '[aria-label="重复组决定"] div select', 'auto')
      await screenshot('desktop-merge-decision.png')
      await click('确认本组合并结构')
      await waitFor(
        () =>
          ui.evaluate(
            `document.querySelector('[aria-label="重复组决定"] h4')?.innerText.includes('merge')`
          ),
        'explicit merge choice'
      )
    } else {
      await click('保持独立，不合并')
      await waitFor(
        () =>
          ui.evaluate(
            `document.querySelector('[aria-label="重复组决定"] h4')?.innerText.includes('keep')`
          ),
        'explicit keep choice'
      )
    }
    if (page + 1 < total) {
      await ui.evaluate(
        `document.querySelector('[aria-label="重构覆盖与来源核对"] .pagination button:last-child').click()`
      )
      await waitFor(
        () =>
          ui.evaluate(
            `document.querySelector('[aria-label="重复组决定"] h4')?.innerText.includes('undecided')`
          ),
        'next unreviewed group'
      )
    }
  }
  assert.equal(found, true)
}

// 完整原文稿与模型解释为两个复选框，后者不随合并自动接受。
async function selectMergeContent({ ui, click, waitFor, screenshot }) {
  await click('确认目录，准备内容调整')
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('[aria-label="重构内容差异"]') && !document.querySelector('.session-task')`
      ),
    'merge content ready',
    30000
  )
  assert.equal(
    await ui.evaluate(
      `[...document.querySelectorAll('button')].find((button)=>button.textContent.trim()==='仅应用目录').disabled`
    ),
    true
  )
  assert.equal(
    await ui.evaluate(`document.querySelectorAll('.content-change input:checked').length`),
    0
  )
  const total = await ui.evaluate(
    `Number(document.querySelector('[aria-label="重构内容差异"] .pagination span').innerText.match(/共 ([0-9]+)/)[1])`
  )
  for (let page = 0; page < total; page++) {
    const text = await ui.evaluate(`document.querySelector('.content-change').innerText`)
    if (text.includes('合并界面保留点') && text.includes('原文提取')) {
      assert.ok(text.includes('UNIQUE_ALPHA') && text.includes('UNIQUE_BETA'))
      await ui.evaluate(`document.querySelector('.content-change input').click()`)
      await screenshot('desktop-merge-content.png')
      return
    }
    await ui.evaluate(
      `document.querySelector('[aria-label="重构内容差异"] .pagination button:last-child').click()`
    )
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.content-change').innerText !== ${JSON.stringify(text)}`
        ),
      'next merge suggestion'
    )
  }
  throw Error('Missing complete merge extraction')
}

// 经真实分类导航打开保留点，原文查看不会切换到可编辑表单。
async function checkOriginalUi({ ui, click, fill, waitFor, screenshot }, sourceId) {
  await fill('[aria-label="筛选已有知识"]', '合并界面保留点')
  await click('全部分类')
  for (const label of ['合并验收', '完整来源']) {
    const selector = `.planet-node:not(.planet-hidden):not(.planet-center)`
    await waitFor(
      () =>
        ui.evaluate(
          `[...document.querySelectorAll('${selector}')].some(b=>b.innerText.includes(${JSON.stringify(label)}))`
        ),
      'original source category'
    )
    await ui.evaluate(
      `[...document.querySelectorAll('${selector}')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click()`
    )
  }
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.planet-leaf')`),
    'merged leaf visible'
  )
  await ui.evaluate(`document.querySelector('.planet-leaf').click()`)
  await waitFor(
    () =>
      ui.evaluate(
        `[...document.querySelectorAll('summary')].some(s=>s.innerText.includes('查看整理／合并前原文'))`
      ),
    'original source entry'
  )
  await ui.evaluate(
    `[...document.querySelectorAll('summary')].find(s=>s.innerText.includes('查看整理／合并前原文')).click()`
  )
  await ui.evaluate(
    `[...document.querySelectorAll('details button')].find(b=>b.innerText.includes(${JSON.stringify(sourceId)})).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('[aria-label="只读原文"]')?.innerText.includes('UNIQUE_BETA')`
      ),
    'original source text'
  )
  assert.equal(
    await ui.evaluate(
      `document.querySelector('[aria-label="只读原文"]').querySelectorAll('textarea,input,[contenteditable]').length`
    ),
    0
  )
  await ui.evaluate(
    `document.querySelector('[aria-label="只读原文"]').scrollIntoView({block:'center'})`
  )
  await screenshot('desktop-merge-original.png')
  await fill('[aria-label="筛选已有知识"]', '')
  await click('全部分类')
}

// 完整界面操作后验证旧链接、单一检索命中和原文只读展示。
export async function checkMergeUi(context, fallback) {
  const { ui, fixture, click, waitFor, screenshot, report } = context
  const ids = await ui.evaluate(`(async()=>{const ids=[];for (const suffix of ['ALPHA','BETA']) {
    const item=await window.knowledgeBase.request('knowledge.save',{title:'合并界面'+suffix,content:'MERGE_SHARED common concept evidence qualification original source constraint UNIQUE_'+suffix});ids.push(item.id)
  }return ids})()`)
  fixture.state.reply = (body) => mergeReply(body, fallback)
  await click('重构知识库')
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('[aria-label="重构目录预览"] .outline-change') && !document.querySelector('.session-task')`
      ),
    'merge outline complete',
    30000
  )
  await decideGroups(context, ids)
  await selectMergeContent(context)
  await click('确认目录并应用所选更新（1）')
  await waitFor(
    () => ui.evaluate(`document.body.innerText.includes('重构已保存')`),
    'merge committed'
  )
  const current = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.get',{id:${JSON.stringify(ids[1])}})`
  )
  assert.equal(current.id, ids[0])
  assert.equal(current.content.includes('UNIQUE_ALPHA'), true)
  assert.equal(
    current.supplements.some((part) => part.content.includes('UNIQUE_BETA')),
    true
  )
  assert.equal(
    current.supplements.some((part) => part.title.includes('模型补充')),
    false
  )
  const result = await ui.evaluate(
    `window.knowledgeBase.request('knowledge.search',{query:'UNIQUE_BETA'})`
  )
  assert.equal(result.items.filter((hit) => hit.knowledge_id === ids[0]).length, 1)
  await click('关闭重构结果')
  await ui.evaluate(
    `(async()=>{let node=await window.knowledgeBase.request('knowledge.tree',{path:['重构大类','整理小类']});return node.total})()`
  )
  await checkOriginalUi(context, ids[1])
  fixture.state.reply = null
  report.checks.push(
    'explicit duplicate merge retains both unique tails, rejects directory-only, defaults model explanations off, resolves old IDs, deduplicates source search and displays read-only originals'
  )
  await screenshot('desktop-merge-applied.png')
}
