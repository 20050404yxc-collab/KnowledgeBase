// 文件：check_project_reference_ui.mjs
// 层：桌面验证
// 作用：验证项目目录引用登记、按需复用及资料库管理入口。
// 说明：只读取测试临时目录，充分性响应来自本机模拟服务。
import { navigateUi } from './ui_navigation.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// 在真实桌面登记目录，自动材料核对仍保留不足门禁，不制造项目知识。
export async function checkProjectReferenceUi(context) {
  const { ui, fill, click, waitFor, fixture, finish, attachmentPath, screenshot, report } = context
  const path = join(dirname(attachmentPath), 'project-reference-fixture')
  await mkdir(path)
  await writeFile(join(path, 'queue.cpp'), 'void queue() { /* PROJECT_REF_UNIQUE */ }', 'utf8')
  await fill('[aria-label="项目路径标签"]', '工件流转项目')
  await fill('[aria-label="项目文件夹路径"]', path)
  await click('保存项目路径')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.project-reference-row')?.innerText.includes('工件流转项目')`
      ),
    'registered path row'
  )
  const rows = await ui.evaluate(`window.knowledgeBase.request('projects.list')`)
  const reference = rows.find((row) => row.label === '工件流转项目')
  assert.equal(reference.path, path)
  assert.equal(await ui.evaluate(`typeof window.knowledgeBase.chooseFolder`), 'function')
  await click('查看目录')
  await waitFor(
    () =>
      ui.evaluate(
        `document.querySelector('.project-references pre')?.innerText.includes('queue.cpp')`
      ),
    'directory-only preview'
  )
  const count = fixture.state.posts.length
  await click('使用已登记项目生成')
  await waitFor(
    async () => fixture.state.posts.length === count + 1,
    'registered project verification'
  )
  const prompt = JSON.parse(fixture.state.posts.at(-1).input)
  assert.ok(JSON.stringify(prompt.evidence).includes('PROJECT_REF_UNIQUE'))
  assert.ok(!JSON.stringify(prompt).includes(path))
  finish(fixture, {
    sufficient: false,
    reason: '合成片段不足以证明工件流程，需进一步定位相关文件',
    citation_ids: []
  })
  await waitFor(
    () => ui.evaluate(`!document.querySelector('.session-task, .working')`),
    'insufficient registered source is gated'
  )
  await ui.evaluate(
    `document.querySelector('.project-references').scrollIntoView({block: 'center'})`
  )
  assert.equal(await ui.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  await screenshot('desktop-project-reference.png')
  await verifyLibraryReference(context, reference)
  report.checks.push(
    'labeled project path registration, bounded directory preview, automatic evidence without folder import, insufficient evidence gate, material-library edit/remove; originals preserved'
  )
}

// 资料库能更新标签和移除登记，原件路径仅作为本地元数据展示。
async function verifyLibraryReference({ ui, fill, click, waitFor }, reference) {
  await navigateUi(ui, '资料库')
  await waitFor(
    () => ui.evaluate(`document.querySelector('.project-reference-row') !== null`),
    'reference visible in material library'
  )
  await click('编辑路径／标签')
  await fill('[aria-label="项目路径标签"]', '工件流转项目已编辑')
  await click('保存项目路径')
  await waitFor(
    () =>
      ui.evaluate(`document.querySelector('.project-reference-row')?.innerText.includes('已编辑')`),
    'reference metadata edited'
  )
  // 确认仅在本次点击期间替换，避免影响后续测试自己的确认行为。
  await ui.evaluate(
    `(() => { const previous = window.confirm; window.confirm = () => true; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '移除登记').click(); window.confirm = previous })()`
  )
  await waitFor(
    async () => (await ui.evaluate(`window.knowledgeBase.request('projects.list')`)).length === 0,
    'reference removed'
  )
  assert.ok(
    (await readFile(join(reference.path, 'queue.cpp'), 'utf8')).includes('PROJECT_REF_UNIQUE')
  )
  await ui.evaluate(`document.querySelectorAll('.nav-item')[0].click()`)
}
