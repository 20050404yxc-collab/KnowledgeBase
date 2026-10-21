// 文件：check_long_text_ui.mjs
// 层：维护验证
// 作用：验证长正文分页、段落编辑及未编辑部分保留。
// 说明：只使用隔离应用的受限 API 和合成正文，不调用真实模型。
import assert from 'node:assert/strict'

// 通过分段接口创建超过普通新建上限的已有正文，避免放宽普通创建契约。
async function seedLongText(ui) {
  return ui.evaluate(`(async()=>{
    const item=await window.knowledgeBase.request('knowledge.save',{title:'长文界面验收',content:'原件保留'});
    const current=await window.knowledgeBase.request('knowledge.get',{id:item.id});
    const session=await window.knowledgeBase.request('knowledge.text',{action:'begin',id:item.id,version:current.version,title:item.title});
    let offset=0;
    for(let i=0;i<14;i++) {
      const content=i===13?'最后独有约束 LONG_TEXT_END':'分段合成正文😀'.repeat(1500);
      const chars=Array.from(content);
      for(let j=0;j<chars.length;j+=12000){
        const part=await window.knowledgeBase.request('knowledge.text',{action:'append',edit_id:session.edit_id,offset,content:chars.slice(j,j+12000).join('')});offset=part.offset;
      }
    }
    await window.knowledgeBase.request('knowledge.text',{action:'commit',edit_id:session.edit_id,chars:offset});
    return {id:item.id,chars:offset};
  })()`)
}

// 从真实分类树打开知识，详情必须出现分页入口且没有危险的完整短文编辑入口。
async function openLongText({ ui, click, fill, waitFor }) {
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim().endsWith('资料库')).click()`
  )
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim().endsWith('知识库')).click()`
  )
  await fill('[aria-label="筛选已有知识"]', '长文界面验收')
  await click('全部分类')
  for (const label of ['未分类／待整理', '未细分']) {
    const selector = '.planet-node:not(.planet-hidden):not(.planet-center)'
    await waitFor(
      () =>
        ui.evaluate(
          `[...document.querySelectorAll('${selector}')].some(b=>b.innerText.includes(${JSON.stringify(label)}))`
        ),
      'long text category'
    )
    await ui.evaluate(
      `[...document.querySelectorAll('${selector}')].find(b=>b.innerText.includes(${JSON.stringify(label)})).click()`
    )
  }
  await waitFor(() => ui.evaluate(`!!document.querySelector('.planet-leaf')`), 'long text leaf')
  await ui.evaluate(`document.querySelector('.planet-leaf').click()`)
  await waitFor(() => ui.evaluate(`!!document.querySelector('.long-content')`), 'long text detail')
  assert.equal(
    await ui.evaluate(
      `[...document.querySelectorAll('.note-footer button')].some(b=>b.innerText==='编辑')`
    ),
    false
  )
}

// UI 只编辑第二段，其余完整长文在一次版本检查事务中保留。
export async function checkLongTextUi(context) {
  const { ui, click, fill, waitFor, screenshot, report } = context
  const seeded = await seedLongText(ui)
  assert.ok(seeded.chars > 120000)
  await openLongText(context)
  await click('下一段正文')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.long-content p').innerText.includes('当前第 2 段')`),
    'second body page'
  )
  await click('编辑本段')
  await fill('[aria-label="本段正文"]', 'SECOND_PAGE_EDIT 😀 保留其他段落')
  await screenshot('desktop-long-text-edit.png')
  await click('保存本段')
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('.long-content') && !document.querySelector('[aria-label="本段正文"]')`
      ),
    'long text staged save'
  )
  const complete = await ui.evaluate(`(async()=>{
    const item=await window.knowledgeBase.request('knowledge.get',{id:${JSON.stringify(seeded.id)}});
    let text='';let pages=1;
    for(let page=0;page<pages;page++){
      const part=await window.knowledgeBase.request('knowledge.text',{action:'read',id:item.id,version:item.version,page});pages=part.pages;text+=part.content;
    }
    return {text,chars:item.content_chars,originals:item.original_sources.length};
  })()`)
  assert.ok(complete.text.includes('SECOND_PAGE_EDIT 😀 保留其他段落'))
  assert.ok(complete.text.endsWith('LONG_TEXT_END') && complete.originals > 0)
  assert.equal(
    Array.from(complete.text).length,
    seeded.chars - 12000 + Array.from('SECOND_PAGE_EDIT 😀 保留其他段落').length
  )
  await ui.command('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false
  })
  try {
    assert.equal(
      await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`),
      true
    )
    await screenshot('desktop-long-text-narrow.png')
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
  await fill('[aria-label="筛选已有知识"]', '')
  await click('全部分类')
  report.checks.push(
    'long body beyond 120000 chars: paginated detail and atomic second-page edit preserve Unicode, untouched tail and original version; wide/narrow layouts'
  )
}
