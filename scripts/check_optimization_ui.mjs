// 文件：check_optimization_ui.mjs
// 层：维护验证
// 作用：验证搜索定位、阅读布局、资料导入和备份的完整用户路径。
// 说明：仅用隔离桌面、合成文件和测试启动器的文件选择队列。
import assert from 'node:assert/strict'
import { navigateUi } from './ui_navigation.mjs'

// 搜索翻页保持已应用条件，长正文命中不能停在第一页。
export async function checkOptimizationSearch(context) {
  const { ui, click, fill, waitFor, screenshot, report } = context
  const item = await ui.evaluate(`window.knowledgeBase.request('knowledge.save', {
    title:'优化长文定位', content:'前段普通文字。'.repeat(2000)+'末页定位专属词', category_path:['优化验收']})`)
  await fill('[aria-label="搜索知识与资料"]', '末页定位专属词')
  await click('搜索全库')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.global-search-hit').length===1`),
    'optimization search result'
  )
  assert.equal(await ui.evaluate(`!!document.querySelector('.search-excerpt mark')`), true)
  await ui.evaluate(`document.querySelector('.global-search-hit button').click()`)
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.long-content')?.innerText.includes('末页定位专属词')`),
    'search loads matching long-text page'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.long-content').innerText.includes('当前第 2 段')`),
    true
  )
  await screenshot('desktop-optimization-search-location.png')
  await ui.evaluate(`(async()=>{ for(let i=0;i<32;i++) await window.knowledgeBase.request('knowledge.save',{
    title:'优化分页测试'+i, content:'uniquepaginationneedle', category_path:['优化分页']}); })()`)
  await fill('[aria-label="搜索知识与资料"]', 'uniquepaginationneedle')
  await click('搜索全库')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.global-search-hit').length===30`),
    'optimization search first page'
  )
  await click('下一页搜索')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.global-search-hit').length===2`),
    'optimization search second page'
  )
  await fill('[aria-label="搜索分类"]', '未应用的筛选')
  await click('上一页搜索')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.global-search-hit').length===30`),
    'pagination keeps submitted filters'
  )
  await click('应用筛选')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.global-search-results')?.innerText.includes('0 条结果')`
      ),
    'explicit category filtering'
  )
  await fill('[aria-label="搜索分类"]', '')
  await click('应用筛选')
  await waitFor(
    () => ui.evaluate(`document.querySelectorAll('.global-search-hit').length===30`),
    'reset search filter'
  )
  // 删除本次合成记录，避免改变既有桌面测试的单条知识断言。
  await ui.evaluate(`(async()=>{ const hits=await window.knowledgeBase.request('knowledge.search',{query:'uniquepaginationneedle'});
    const page2=await window.knowledgeBase.request('knowledge.search',{query:'uniquepaginationneedle',page:1});
    for(const h of [...hits.items,...page2.items]) await window.knowledgeBase.request('knowledge.delete',{id:h.knowledge_id}); })()`)
  await checkLibraryReading(context)
  await ui.evaluate(
    `window.knowledgeBase.request('knowledge.delete',{id:${JSON.stringify(item.id)}})`
  )
  report.checks.push(
    'search highlight and matching long-text page; frozen pagination filters; explicit category apply; wide/narrow reading and scaled layout'
  )
}

// 进入知识库后经真实分类打开，不能复用搜索页独立选择冒充阅读状态。
async function checkLibraryReading(context) {
  const { ui, click, fill, waitFor, screenshot } = context
  await navigateUi(ui, '知识库')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.reading-workspace')`),
    'reading workspace'
  )
  await ui.evaluate(
    `document.querySelectorAll('button[aria-pressed]').forEach(b=>{if(b.textContent.trim()==='紧凑列表')b.click()})`
  )
  await click('全部分类')
  await fill('[aria-label="筛选已有知识"]', '优化长文定位')
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="展开分类：优化验收"]')`),
    'reading fixture category'
  )
  await ui.evaluate(`document.querySelector('[aria-label="展开分类：优化验收"]').click()`)
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('[aria-label="阅读知识：优化长文定位"]')`),
    'reading fixture node'
  )
  await ui.evaluate(`document.querySelector('[aria-label="阅读知识：优化长文定位"]').click()`)
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.reading-detail .answer-heading h2')?.innerText==='优化长文定位'`
      ),
    'library reading fixture'
  )
  await screenshot('desktop-optimization-reading-wide.png')
  await checkReadingSizes(context)
  await fill('[aria-label="筛选已有知识"]', '')
  await click('星球视图')
}

// 窄窗口和缩放等价 CSS 宽度验证操作可达；恢复后不污染后续测试。
async function checkReadingSizes({ ui, click, waitFor, screenshot }) {
  try {
    for (const [width, label] of [
      [900, 'narrow'],
      [1024, '125'],
      [853, '150']
    ]) {
      await ui.command('Emulation.setDeviceMetricsOverride', {
        width,
        height: 850,
        deviceScaleFactor: 1,
        mobile: false
      })
      assert.equal(await ui.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true)
      await waitFor(
        () =>
          ui.evaluate(
            `getComputedStyle(document.querySelector('.reading-directory')).display==='none'`
          ),
        'narrow detail view'
      )
      await click('返回知识目录')
      assert.notEqual(
        await ui.evaluate(`getComputedStyle(document.querySelector('.reading-directory')).display`),
        'none'
      )
      await click('继续当前阅读')
      await screenshot(`desktop-optimization-reading-${label}.png`)
    }
  } finally {
    await ui.command('Emulation.clearDeviceMetricsOverride')
  }
}

// 真实按钮经文件选择队列导入，失败项可重试，完整备份和隔离恢复均走协议。
export async function checkOptimizationFiles({
  ui,
  click,
  waitFor,
  screenshot,
  report,
  choose,
  fixture,
  missing,
  repairMissing,
  output
}) {
  await navigateUi(ui, '资料库')
  await choose([fixture, missing])
  await click('选择文件导入')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.source-import')?.innerText.includes('导入失败')`),
    'one import failure'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('.source-import').innerText.includes('已保留')`),
    true
  )
  await screenshot('desktop-optimization-import.png')
  await repairMissing()
  await click('重试此资料')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelectorAll('.source-import li').length===2 &&
        [...document.querySelectorAll('.source-import li')].every(item=>item.innerText.includes('已保留'))`
      ),
    'failed import explicitly retried without losing successful item'
  )
  await navigateUi(ui, '设置')
  await click('备份与恢复')
  await choose([output])
  await click('创建完整备份')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.portable-data')?.innerText.includes('备份已完成并核对')`
      ),
    'portable backup',
    30000
  )
  const path = await ui.evaluate(
    `document.querySelector('.portable-data [role=status]').textContent.split('：')[1].split(' · ')[0]`
  )
  await choose([path])
  await click('校验备份目录')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.portable-data')?.innerText.includes('备份校验通过')`),
    'portable verification'
  )
  await choose([path], [output])
  await click('恢复到新隔离目录')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.portable-data')?.innerText.includes('隔离恢复完成')`),
    'isolated restore',
    30000
  )
  await screenshot('desktop-optimization-backup.png')
  await navigateUi(ui, '探索')
  await navigateUi(ui, '设置')
  await click('备份与恢复')
  assert.equal(
    await ui.evaluate(
      `document.querySelector('.portable-data')?.innerText.includes('隔离恢复完成')`
    ),
    true
  )
  await navigateUi(ui, '探索')
  report.checks.push(
    'actual source import UI keeps successful files and item errors, explicit retry succeeds; complete backup, checksum verification and non-overwriting isolated restore, receipt survives navigation'
  )
}

// 在同 profile 真实关闭前保护草稿，避免只测同一窗口内的内存状态。
export async function prepareOptimizationRestart({ ui, click, fill, waitFor, screenshot }) {
  await navigateUi(ui, '探索')
  await fill('#question', '跨重启问题草稿，不应自动发送')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.draft-protection')?.innerText.includes('已在本地保护')`
      ),
    'question draft durable'
  )
  await click('＋ 新建知识')
  await fill('.editor input', '跨重启笔记草稿')
  await fill('.editor textarea', '未正式保存的输入必须恢复')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.editor [role=status]')?.innerText.includes('已在本地保护')`
      ),
    'note draft durable'
  )
  await screenshot('desktop-optimization-draft-before-restart.png')
}

// 恢复不产生模型调用；Escape 经放弃确认返回焦点，放弃后持久清除。
export async function checkOptimizationRestart({ ui, click, waitFor, screenshot, report }) {
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.editor textarea')?.value==='未正式保存的输入必须恢复'`),
    'note restored after real restart'
  )
  assert.equal(
    await ui.evaluate(`document.querySelector('#question').value`),
    '跨重启问题草稿，不应自动发送'
  )
  await screenshot('desktop-optimization-draft-restored.png')
  // Tab 在最后一个控件处必须回到弹窗内部首个控件。
  await ui.evaluate(`document.querySelector('.editor .primary').focus()`)
  await ui.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
  assert.equal(await ui.evaluate(`document.activeElement.closest('.editor')!==null`), true)
  await ui.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await waitFor(
    () => ui.evaluate(`!!document.querySelector('.discard-warning')`),
    'escape confirms draft discard'
  )
  await click('继续编辑')
  assert.equal(
    await ui.evaluate(`document.querySelector('.editor textarea').value`),
    '未正式保存的输入必须恢复'
  )
  await click('取消')
  await click('放弃修改')
  await waitFor(
    () =>
      ui.evaluate(
        `(async()=> (await window.knowledgeBase.request('workspace.read',{slot:'note-探索'})).value===null)()`
      ),
    'discard tombstone durable'
  )
  const attempts = await ui.evaluate(`window.knowledgeBase.request('usage.list')`)
  assert.equal(attempts.length, 3)
  report.checks.push(
    'real restart restores durable question and note without API replay; modal Tab/Escape preserves input; explicit discard durably clears draft'
  )
}
