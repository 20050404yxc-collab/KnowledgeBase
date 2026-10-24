// 文件：check_memory_ui.mjs
// 层：维护验证
// 作用：验证长期记忆控制、普通问答入口与探索三排上限。
// 说明：只操作本次隔离数据库，不下载模型或调用外部接口。
import assert from 'node:assert/strict'

// 设置使用真实控件保存；重启阶段独立核对相同偏好仍然存在。
export async function checkMemoryUi(context, restarted = false) {
  const { ui, click, waitFor, screenshot, report } = context
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('设置')).click()`
  )
  await click('记忆与检索')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="回答详略"]')`),
    'memory settings loaded'
  )
  if (restarted) {
    assert.equal(
      await ui.evaluate(`document.querySelector('[aria-label="回答详略"]').value`),
      '详细'
    )
    report.checks.push('explicit local answer preference survives actual desktop restart')
    await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
    return
  }
  await ui.evaluate(`(() => {
    const previous=window.confirm;window.confirm=()=>true;
    [...document.querySelectorAll('.memory-settings button')].find(b=>b.innerText==='清空全部记忆').click();
    window.confirm=previous;
  })()`)
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.memory-settings').innerText.includes('累计主动阅读 0 天次')`
      ),
    'memory reset is reflected'
  )
  await ui.evaluate(`(() => {
    const select=document.querySelector('[aria-label="回答详略"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'详细');
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await waitFor(
    () =>
      ui.evaluate(
        `(async()=> (await window.knowledgeBase.request('memory.get')).settings.detail==='详细')()`
      ),
    'preference persisted'
  )
  await screenshot('desktop-memory-settings.png')
  assert.equal((await ui.evaluate(`window.knowledgeBase.request('semantic.status')`)).ready, false)
  await checkExplorationCap(context)
}

// 十二条新知识验证先全库排序再截断；清理后恢复既有测试库。
async function checkExplorationCap(context) {
  const { ui, click, fill, waitFor, report } = context
  const ids = await ui.evaluate(`(async()=> {
    const ids=[];for(let i=0;i<12;i++) {
      const note=await window.knowledgeBase.request('knowledge.save',{title:'记忆布局验收'+i,content:'合成布局正文'});
      ids.push(note.id);
    }
    await window.knowledgeBase.request('knowledge.get',{id:ids[0]});return ids;
  })()`)
  try {
    await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
    await fill('.inline-search', '')
    await waitFor(
      () =>
        ui.evaluate(`document.querySelectorAll('.exploration-grid .knowledge-card').length===9`),
      'top nine exploration cards'
    )
    assert.ok(
      (await ui.evaluate(`document.querySelector('.knowledge-card').innerText`)).includes(
        '记忆布局验收0'
      )
    )
    await checkGridSizes(context)
    await fill('#question', '合成普通问题的解释')
    await click('AI 回答 ↗')
    await waitFor(
      () =>
        ui.evaluate(
          `document.querySelector('.selection-panel')?.innerText.includes('尚未配置可用模型')`
        ),
      'primary direct answer searches without provider'
    )
    assert.equal(
      await ui.evaluate(`document.querySelector('.selection-panel h2').innerText`),
      'AI 回答'
    )
    const memory = await ui.evaluate(`window.knowledgeBase.request('memory.get')`)
    assert.ok(memory.topics.some((item) => item.kind === '概念' && item.count > 0))
    await click('收起问答')
    report.checks.push(
      'memory reset and explicit preference controls; direct-answer default; reading rank and responsive exploration caps 9/6/3'
    )
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
    for (const id of ids) {
      await ui.evaluate(
        `window.knowledgeBase.request('knowledge.delete',{id:${JSON.stringify(id)}})`
      )
    }
    await ui.evaluate(
      `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('设置')).click()`
    )
    await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
    await fill('#question', '')
    await waitFor(
      () => ui.evaluate(`document.querySelectorAll('.knowledge-card').length===1`),
      'restore library after memory fixtures'
    )
  }
}

// 检查真实可见卡片的行坐标，不能仅凭 CSS 文本声称满足三排。
async function checkGridSizes({ ui, screenshot }) {
  for (const [width, count] of [
    [1440, 9],
    [1000, 6],
    [720, 3]
  ]) {
    await ui.command('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    })
    const cards = await ui.evaluate(
      `[...document.querySelectorAll('.exploration-grid .knowledge-card')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.getBoundingClientRect().top)`
    )
    assert.equal(cards.length, count)
    assert.equal(new Set(cards).size, 3)
    await screenshot('desktop-exploration-' + width + '.png')
  }
  await ui.command('Emulation.clearDeviceMetricsOverride')
}
