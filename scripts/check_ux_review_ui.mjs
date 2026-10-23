// 文件：check_ux_review_ui.mjs
// 层：维护验证
// 作用：验证同名草稿、手工分类、独立搜索和资料复用入口。
// 说明：复用隔离桌面和合成数据，所有动作不调用外部模型。
import assert from 'node:assert/strict'

// 通过真实表单验证同名失败后仍保留内容，改分类重试后移动并同步搜索。
export async function checkUxNotes(context) {
  const { ui, click, fill, waitFor, screenshot, report } = context
  const previous = await ui.evaluate(`document.querySelector('.answer-heading h2').innerText`)
  await ui.evaluate(
    `window.knowledgeBase.request('knowledge.save',{title:'体验同名校验',content:'旧文不能覆盖'})`
  )
  await click('＋ 新建知识')
  await fill('.editor input', '体验同名校验')
  await fill('.editor textarea', '用户新输入必须保留')
  await click('保存知识')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.editor-error')?.innerText.includes('同标题')`),
    'duplicate draft retained'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.editor textarea').value`),
    '用户新输入必须保留'
  )
  await screenshot('desktop-ux-save-conflict.png')
  await click('＋ 添加一级分类')
  await fill('[aria-label="第 1 级分类"]', '体验分类')
  await click('保存知识')
  await waitFor(
    () =>
      ui.evaluate(
        `!document.querySelector('.editor') && document.querySelector('.move-knowledge')?.innerText.includes('体验分类')`
      ),
    'manual category saved'
  )
  await click('移动分类')
  await fill('[aria-label="第 1 级分类"]', '体验新位置')
  await click('确认移动（不调用 AI）')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.move-knowledge')?.innerText.includes('位置：体验新位置')`
      ),
    'manual moved'
  )
  await screenshot('desktop-ux-move.png')
  await fill('[aria-label="搜索知识与资料"]', '体验新位置')
  await click('搜索全库')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.global-search-results')?.innerText.includes('体验同名校验')`
      ),
    'fixed global search'
  )
  assert.equal(
    await ui.evaluate(`getComputedStyle(document.querySelector('.topbar')).position`),
    'sticky'
  )
  await screenshot('desktop-ux-global-search.png')
  await checkNarrowUx(context, 'desktop-ux-global-search-narrow.png')
  const ids = await ui.evaluate(
    `(async()=> (await window.knowledgeBase.request('knowledge.search',{query:'体验同名校验'})).items.map(h=>h.knowledge_id))()`
  )
  for (const id of new Set(ids)) {
    await ui.evaluate(`window.knowledgeBase.request('knowledge.delete',{id:${JSON.stringify(id)}})`)
  }
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  await ui.evaluate(
    `[...document.querySelectorAll('.knowledge-card')].find(n=>n.innerText.includes(${JSON.stringify(previous)})).click()`
  )
  report.checks.push(
    'duplicate manual save retains draft; category create/move; fixed global local search; old note preserved'
  )
}

// 保存资料可阅读并显式复用，切回探索展示附件及文件限定范围。
export async function checkUxSources({ ui, click, waitFor, screenshot, report }) {
  await click('查看内容')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.source-reader')?.innerText.includes('事务')`),
    'retained source readable'
  )
  assert.equal(await ui.evaluate(`window.__documentExecuted === undefined`), true)
  await screenshot('desktop-ux-source-reader.png')
  await checkNarrowUx({ ui, screenshot }, 'desktop-ux-source-reader-narrow.png')
  await click('基于此资料提问')
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('#question') && !!document.querySelector('.attachment.ready')`
      ),
    'saved source attached'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('[aria-label="AI 学习范围"]').value`),
    'files'
  )
  assert.equal(await ui.evaluate(`document.querySelector('#question').value`), '')
  await waitFor(
    () =>
      ui.evaluate(
        `document.activeElement?.id === 'question' && document.querySelector('#question').getBoundingClientRect().top >= 0`
      ),
    'saved source reuse focuses visible question input'
  )
  await screenshot('desktop-ux-source-reuse.png')
  report.checks.push(
    'retained text safe reading; reuse opens composer with one saved attachment, file-only scope and no automatic model call'
  )
}

// 新搜索和资料阅读在窄窗口内仍完整布局，截图供人工核对文字及操作。
async function checkNarrowUx({ ui, screenshot }, name) {
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
    await screenshot(name)
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 显式展开整理入口并选择内容模式，保护既有全文整理回归。
export async function startOrganization({ ui, click, waitFor }) {
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.organization-setup')`),
    'organization setup ready after closing previous draft'
  )
  await ui.evaluate(`document.querySelector('.organization-setup').open=true`)
  await ui.evaluate(
    `[...document.querySelectorAll('input[name=organization-mode]')].at(-1).click()`
  )
  await click('生成整理方案')
}

// 首次目录缺省紧凑，各页选择独立保存；供同 profile 的真实重启验证。
export async function checkViewPreference({ ui, click, waitFor, report }, restarted = false) {
  await ui.evaluate(
    `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('知识库')).click()`
  )
  await waitFor(
    () =>
      ui.evaluate(
        `!!document.querySelector('.tree-view-switch') || !!document.querySelector('[aria-pressed]')`
      ),
    'tree view switch'
  )
  assert.equal(
    await ui.evaluate(
      `[...document.querySelectorAll('button[aria-pressed]')].find(b=>b.textContent.trim()===${JSON.stringify(restarted ? '星球视图' : '紧凑列表')}).getAttribute('aria-pressed')`
    ),
    'true'
  )
  if (!restarted) {
    await click('星球视图')
    await ui.evaluate(
      `[...document.querySelectorAll('.nav-item')].find(b=>b.innerText.trim().endsWith('归档')).click()`
    )
    assert.equal(
      await ui.evaluate(
        `[...document.querySelectorAll('button[aria-pressed]')].find(b=>b.textContent.trim()==='紧凑列表').getAttribute('aria-pressed')`
      ),
      'true'
    )
  }
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
  report.checks.push(
    restarted
      ? 'real restart preserves page-specific tree preference'
      : 'compact default; independent per-page persistent tree preference'
  )
}
