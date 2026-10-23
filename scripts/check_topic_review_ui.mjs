// 文件：check_topic_review_ui.mjs
// 层：维护验证
// 作用：验证审核漏项通过实际桥接显示具体原因和请求编号。
// 说明：使用既有隔离桌面和本机模型，不访问正式数据或接口。
import assert from 'node:assert/strict'

// 模型成功返回但漏审时，界面保留本地命中且不得出现可学习的残缺目录。
export async function checkTopicReviewUi(context) {
  const { ui, fixture, fill, click, waitFor, screenshot } = context
  const before = fixture.state.posts.length
  fixture.state.reply = (body) =>
    body.instructions.includes('"decisions"')
      ? { decisions: [] }
      : { points: [{ title: '审核完整性', theme: '软件设计', facet: '逐项判断' }] }
  try {
    await ui.evaluate(
      `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.endsWith('探索')).click()`
    )
    await waitFor(() => ui.evaluate(`!!document.querySelector('#question')`), 'exploration form')
    await ui.evaluate(`(() => {
      const select = document.querySelector('[aria-label="AI 学习范围"]')
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'knowledge')
      select.dispatchEvent(new Event('change',{bubbles:true}))
    })()`)
    await ui.evaluate(
      `window.knowledgeBase.request('knowledge.save',{title:'审核回归本地知识',content:'无需调用模型即可打开的本地知识'})`
    )
    await fill('#question', '审核回归本地知识')
    await click('生成学习目录 ↗')
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('[role="status"]')?.innerText.includes('应有 1 项，返回 0 项')`
        ),
      'specific review-count failure'
    )
    const notice = await ui.evaluate(`document.querySelector('[role="status"]').innerText`)
    assert.match(notice, /日志请求 ID：[a-zA-Z0-9-]{1,80}/)
    assert.equal(fixture.state.posts.length, before + 2)
    assert.equal(await ui.evaluate(`document.querySelectorAll('.directory-point').length`), 0)
    assert.equal(
      await ui.evaluate(
        `document.querySelector('.local-results')?.innerText.includes('审核回归本地知识')`
      ),
      true
    )
    const review = fixture.state.posts.at(-1)
    const targets = JSON.parse(review.input)
    assert.equal(targets.expected_count, 1)
    assert.equal(targets.candidates, undefined)
    assert.equal(review.text.format.schema.properties.decisions.minItems, 1)
    await ui.evaluate(`window.scrollTo(0,0)`)
    await screenshot('desktop-topic-review-failure.png')
    context.report.checks.push(
      'topic review missing decision: precise count and request reference displayed; local results retained; no partial directory or retry'
    )
  } finally {
    fixture.state.reply = null
  }
}
