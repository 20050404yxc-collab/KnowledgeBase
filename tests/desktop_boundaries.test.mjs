// 文件：desktop_boundaries.test.mjs
// 层：验证／桌面协议和请求生命周期
// 作用：验证未知消息、超时、重复标识和晚到结果。
// 说明：动态编译被测 TS 模块，使用虚拟计时器，不启动正式应用。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { transformSync } from '@swc/core'

// 模块无运行时本地依赖，转换后从内存加载实际实现。
async function loadModule(relativePath, replacements = {}) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  // 仅测试显式替换导入地址，以受控能力验证实际编排而不连接桌面或付费服务。
  for (const [key, value] of Object.entries(replacements)) {
    source = source.replaceAll(key, value)
  }
  const { code } = transformSync(source, {
    jsc: { target: 'es2022', parser: { syntax: 'typescript' } },
    module: { type: 'es6' }
  })
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}

const librarySource = await readFile(
  new URL('../apps/desktop/shared/library_validation.ts', import.meta.url),
  'utf8'
)
const libraryCode = transformSync(librarySource, {
  jsc: { target: 'es2022', parser: { syntax: 'typescript' } },
  module: { type: 'es6' }
}).code
const validation = await loadModule('../apps/desktop/shared/protocol_validation.ts', {
  "'./library_validation'": JSON.stringify(
    'data:text/javascript;base64,' + Buffer.from(libraryCode).toString('base64')
  )
})
const { markdownForDisplay } = await loadModule(
  '../apps/desktop/renderer/src/features/knowledge/markdown_display.ts'
)

// 实际上传编排只替换受限 API，Unicode 分段、取消和提交规则照常执行。
test('long text preserves untouched pages and cancels incomplete staged saves', async () => {
  const stub = `let respond; export const configure = (value) => { respond = value };
    export const api = { request: (...args) => respond(...args) };
    export const errorText = (error) => error.message; export const reportFeedback = () => {};`
  const url = 'data:text/javascript;base64,' + Buffer.from(stub).toString('base64')
  const { configure } = await import(url)
  const { saveTextPage } = await loadModule(
    '../apps/desktop/renderer/src/features/knowledge/long_text_edit.ts',
    {
      "'../../shared/api/client'": JSON.stringify(url)
    }
  )
  let parts = [],
    offset = 0,
    committed = false,
    discarded = false,
    active = true
  const original = ['原文第一段', '待编辑', '尾段独有约束']
  configure(async (operation, params) => {
    assert.equal(operation, 'knowledge.text')
    if (params.action === 'begin') {
      return { edit_id: 'edit', offset: 0 }
    }
    if (params.action === 'read') {
      return { content: original[params.page] }
    }
    if (params.action === 'append') {
      assert.equal(params.offset, offset)
      const length = Array.from(params.content).length
      assert.ok(length <= 12000)
      offset += length
      parts.push(params.content)
      return { offset }
    }
    if (params.action === 'discard') {
      discarded = true
      return { discarded: true }
    }
    assert.equal(params.chars, offset)
    committed = true
    return { saved: true, id: 'note' }
  })
  const target = { id: 'note', version: 'version', title: '合成知识' }
  const replacement = '😀'.repeat(25000)
  await saveTextPage(target, 1, 3, replacement, () => active)
  assert.equal(parts.join(''), original[0] + replacement + original[2])
  assert.equal(committed, true)
  parts = []
  offset = 0
  committed = false
  await assert.rejects(
    saveTextPage(target, 1, 3, replacement, () => {
      if (parts.length) {
        active = false
      }
      return active
    }),
    /未提交/
  )
  assert.equal(committed, false)
  assert.equal(discarded, true)
})

// 分页和暂存结果不得用负数、缺失字段或空对象伪装成功。
test('long text result validation rejects incomplete and invalid counts', () => {
  for (const value of [
    {},
    { content: 'x' },
    { edit_id: 'e', offset: -1 },
    { content: 'x', version: 'v', page: 1, pages: 1 },
    { saved: true }
  ]) {
    assert.throws(() => validation.decodeResult('knowledge.text', value))
  }
  assert.equal(
    validation.decodeResult('knowledge.text', { content: 'x', version: 'v', page: 0, pages: 1 })
      .content,
    'x'
  )
  assert.equal(
    validation.decodeResult('knowledge.text', { edit_id: 'e', offset: 12000 }).offset,
    12000
  )
})

// 模拟受限 API 只替换网络边界，批量状态和逐项控制使用实际实现。
async function batchFixture() {
  const stub = `let respond; export const configure = (value) => { respond = value };
    export const api = { request: (...args) => respond(...args) };
    export const errorText = (error) => error.message;`
  const url = 'data:text/javascript;base64,' + Buffer.from(stub).toString('base64')
  const client = await import(url)
  const batch = await loadModule(
    '../apps/desktop/renderer/src/features/exploration/directory_batch.ts',
    {
      "'../../shared/api/client'": JSON.stringify(url)
    }
  )
  return { ...client, ...batch }
}

// 单项错误不能阻断其他选择，补充预览和资料不足都不能被自动确认保存。
test('batch continues after failure and preserves review/material outcomes', async () => {
  const { configure, generateBatch, api } = await batchFixture()
  const calls = []
  const outcomes = []
  configure(async (_operation, params) => {
    calls.push(params)
    if (params.point_id === 'fail') {
      throw new Error('合成单项失败')
    }
    return params.point_id === 'review'
      ? { review: true, notice: '待核对' }
      : { project: { status: 'materials', message: '缺项目资料' }, notice: '未收录' }
  })
  await generateBatch({
    points: [
      { id: 'fail' },
      { id: 'review', target_id: 'original' },
      { id: 'project', project_required: true }
    ],
    input: { plan_id: 'plan', model: 'fixed-model' },
    current: () => true,
    request: api.request,
    progress: () => {},
    receive: (value) => outcomes.push(value)
  })
  assert.equal(outcomes.length, 3)
  assert.equal(outcomes[0].message, '合成单项失败')
  assert.equal(outcomes[1].answer.review, true)
  assert.equal(outcomes[2].message, '缺项目资料')
  assert.deepEqual(
    calls.map((c) => c.action),
    ['learn', 'supplement', 'learn']
  )
  assert.ok(calls.every((c) => c.model === 'fixed-model'))
  assert.equal(calls[1].target_id, 'original')
})

// 资料核对返回时恰好取消，不得再启动正文生成或后一个知识点。
test('batch cancellation between material audit and generation stops subsequent requests', async () => {
  const { configure, generateBatch, api } = await batchFixture()
  const calls = []
  let current = true
  configure(async (_operation, params) => {
    calls.push(params)
    current = false
    return { project: { status: 'material-ready' }, notice: '已核对' }
  })
  await generateBatch({
    points: [
      { id: 'a', project_required: true },
      { id: 'b', project_required: true }
    ],
    input: { plan_id: 'plan' },
    attachmentIds: ['selected-project-file'],
    current: () => current,
    request: api.request,
    progress: () => {},
    receive: () => {}
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'materials')
  assert.deepEqual(calls[0].attachment_ids, ['selected-project-file'])
})

// 只修复明确的普通标签；代码、转义、链接、数学符号和存储原文不变。
test('display Markdown repairs a paired label without removing literal symbols', () => {
  const raw = '- **整体开发与设备接入： **独立负责'
  assert.equal(markdownForDisplay(raw), '- **整体开发与设备接入：** 独立负责')
  const protectedText = [
    '```cpp',
    raw,
    '```',
    '`**标签： **代码`',
    '\\**标签： **转义',
    '[地址](https://example.test/a(**标签： **))',
    '    **标签： **缩进代码',
    'a ** b ** c',
    '* 星号',
    '## 标题',
    '[ref]: https://example.test/**标签： **',
    '<span>**标签： **HTML</span>'
  ].join('\n')
  assert.equal(markdownForDisplay(protectedText), protectedText)
  assert.equal(raw, '- **整体开发与设备接入： **独立负责')
})

// 新增审核、层级分类与项目结果字段和旧样例兼容，损坏的新字段必须拒绝。
test('review, taxonomy and project result fields are runtime checked', () => {
  const answer = {
    content: '',
    citations: [],
    recommendations: [],
    notice: '',
    project: {
      status: 'candidates',
      revision: 'r1',
      message: '选择示例',
      material_request: '项目代码',
      search_terms: 'queue',
      candidates: [
        {
          id: 'a/b',
          name: 'a/b',
          url: 'https://github.com/a/b',
          locator: 'README.md',
          excerpt: 'test',
          retrieved_at: '2026-10-20'
        }
      ]
    }
  }
  assert.equal(validation.decodeResult('knowledge.learn', answer), answer)
  assert.throws(() =>
    validation.decodeResult('knowledge.learn', {
      ...answer,
      project: { ...answer.project, revision: false }
    })
  )
  assert.throws(() =>
    validation.decodeResult('knowledge.learn', {
      ...answer,
      project: { ...answer.project, candidates: [{}] }
    })
  )
  const point = {
    id: 'p',
    title: 'RAII',
    theme: '编程语言／C++',
    category: '编程语言',
    subcategory: 'C++',
    facet: '生命周期',
    target_id: '',
    status: '待学习',
    citation_ids: [],
    candidates: [],
    project_required: false
  }
  const plan = {
    plan_id: 's',
    points: [point],
    excluded: [{ title: '润色', decision: 'exclude', reason: '任务' }],
    search: { items: [], total: 0, page: 0, notice: '' },
    notice: ''
  }
  assert.equal(validation.decodeResult('question.plan', plan), plan)
  assert.throws(() =>
    validation.decodeResult('question.plan', { ...plan, points: [{ ...point, category: 3 }] })
  )
})
const { RequestRegistry, REQUEST_TIMEOUT_MS } = await loadModule(
  '../apps/desktop/main/request_registry.ts'
)

// 与 Python 共用真实响应样例，保护协议字段与离线行为的一致性。
test('shared protocol samples pass operation and runtime result validation', async () => {
  const samples = JSON.parse(
    await readFile(new URL('../contracts/protocol_samples.json', import.meta.url), 'utf8')
  )
  for (const { request, response } of samples.scenarios) {
    assert.equal(validation.isOperation(request.operation), true)
    assert.equal(validation.isWorkerMessage(response), true)
    assert.equal(response.id, request.id)
    assert.deepEqual(validation.decodeResult(request.operation, response.result), response.result)
  }
  for (const { operation, result } of samples.dto_samples) {
    assert.deepEqual(validation.decodeResult(operation, result), result)
  }
})

// 只有真实结构能进入受限 API，泛型声明不能让损坏结果通过。
test('protocol rejects malformed messages and operation results', () => {
  for (const value of [
    null,
    [],
    1,
    {},
    { type: 'result', id: 'x' },
    { type: 'stream', id: 'x', delta: 1 },
    { type: 'unknown' }
  ]) {
    assert.equal(validation.isWorkerMessage(value), false)
  }
  assert.equal(validation.isWorkerMessage({ type: 'ready', version: 'test0.03' }), true)
  assert.equal(validation.isWorkerEvent({ type: 'stream', id: 'x', delta: '片段' }), true)
  assert.equal(validation.isOperation('constructor'), false)
  assert.equal(validation.isOperation('providers.models'), true)
  assert.throws(
    () => validation.decodeResult('providers.models', { models: [42], partial: false }),
    /格式无效/
  )
  assert.deepEqual(
    validation.decodeResult('providers.models', { models: ['model-a'], partial: false }),
    { models: ['model-a'], partial: false }
  )
  assert.throws(() => validation.decodeResult('knowledge.get', { id: 'x' }), /格式无效/)
  assert.throws(() => validation.decodeResult('providers.test', { message: 42 }), /格式无效/)
  assert.deepEqual(validation.decodeResult('usage.list', []), [])
})

// 超时撤销关联，晚到成功不能复活请求，也不会留存计时器。
test('timeout cancels once and ignores late results', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const registry = new RequestRegistry()
  let cancelled = 0
  const result = registry.register('timeout', () => {
    cancelled++
  })
  const rejected = assert.rejects(result, /任务超时/)
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  await rejected
  registry.settle('timeout', { saved: true })
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(cancelled, 1)
  assert.equal(registry.has('timeout'), false)
})

// 先完成的成功保留终态，后到取消或超时不能变成失败。
test('completion releases timer and duplicate IDs preserve the first request', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const registry = new RequestRegistry()
  let cancelled = 0
  const first = registry.register('same', () => {
    cancelled++
  })
  await assert.rejects(
    registry.register('same', () => {}),
    /正在执行/
  )
  registry.settle('same', 'committed')
  registry.settle('same', undefined, new Error('late cancellation'))
  context.mock.timers.tick(REQUEST_TIMEOUT_MS)
  assert.equal(await first, 'committed')
  assert.equal(cancelled, 0)
})

// 后台退出要结算每个请求，重试可以重新使用已经释放的标识。
test('worker exit rejects all pending requests and permits retry', async () => {
  const registry = new RequestRegistry()
  const results = ['one', 'two'].map((id) =>
    assert.rejects(
      registry.register(id, () => {}),
      /后台中断/
    )
  )
  registry.failAll(new Error('后台中断'))
  await Promise.all(results)
  const retried = registry.register('one', () => {})
  registry.settle('one', 'ready')
  assert.equal(await retried, 'ready')
})

// 完整分类树和重构数据必须经过运行时验证，非法状态及正文模式不得触发流程。
test('library tree and restructure reject damaged responses', () => {
  assert.throws(() =>
    validation.decodeResult('knowledge.tree', {
      nodes: [{ key: 'k', label: '大类', count: -1, id: '', bucket: '' }],
      total: 1,
      revision: 'r',
      next_cursor: ''
    })
  )
  const summary = {
    draft_id: 'd',
    revision: 'r',
    status: 'planning',
    total: 1,
    covered: 0,
    classified: 0,
    prepared: 0,
    suggestions: 0
  }
  assert.equal(validation.decodeResult('library.restructure.plan', summary), summary)
  assert.throws(() =>
    validation.decodeResult('library.restructure.plan', { ...summary, status: 'unknown' })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.prepare', { ...summary, prepared: '1' })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.preview', {
      outline: [],
      suggestions: [
        {
          id: 'k',
          title: '事务',
          mode: 'overwrite-manual',
          original: '',
          content: '建议',
          reason: '理由',
          diff: ''
        }
      ],
      total: 1,
      page: 0
    })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.apply', { applied: true, count: 1 })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.plan', {
      ...summary,
      workers: [{ agent: 'A', covered: '1' }]
    })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.preview', {
      outline: [],
      suggestions: [],
      total: 1,
      page: 0,
      records: [{ source_id: 's', attempt_ids: [123] }]
    })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.preview', {
      outline: [],
      suggestions: [],
      total: 1,
      page: 0,
      duplicates: [{ decision: 'auto-merge' }]
    })
  )
  assert.throws(() =>
    validation.decodeResult('library.restructure.apply', {
      applied: true,
      count: 1,
      backup: 'recovery',
      source_count: -1
    })
  )
})

// 系统目录能力只信任当前主 frame，并只打开宿主固定目录。
test('storage capability rejects foreign frames and arbitrary paths', async () => {
  const stub = `export const handlers=new Map(); export const opened=[]; export let failure='';
    export const setFailure=(value)=>{failure=value};
    export const ipcMain={handle:(name,fn)=>handlers.set(name,fn)};
    export const shell={openPath:async(path)=>{opened.push(path);return failure}};`
  const url = 'data:text/javascript;base64,' + Buffer.from(stub).toString('base64')
  const host = await import(url)
  const logger =
    'data:text/javascript;base64,' +
    Buffer.from('export const diagnostic=()=>{}').toString('base64')
  const { registerStorageIpc } = await loadModule('../apps/desktop/main/storage_settings.ts', {
    "'electron'": JSON.stringify(url),
    "'./diagnostics'": JSON.stringify(logger)
  })
  const frame = {},
    contents = { mainFrame: frame },
    window = { webContents: contents }
  registerStorageIpc(() => window, 'D:/isolated-fixture/data')
  const event = { sender: contents, senderFrame: frame }
  const paths = host.handlers.get('kb:storage-paths')(event, 'test-request')
  assert.equal(validation.isStoragePaths(paths), true)
  assert.equal(validation.isStoragePaths({ ...paths, logs: null }), false)
  assert.throws(() => host.handlers.get('kb:storage-paths')({ ...event, senderFrame: {} }), /来源/)
  const open = host.handlers.get('kb:open-directory')
  await assert.rejects(open({ ...event, sender: {} }, 'data', 'test'), /来源/)
  for (const directory of ['../outside', paths.data, 'database', null]) {
    await assert.rejects(open(event, directory, 'test'), /无效目录/)
  }
  await assert.rejects(open(event, 'logs', 'bad/id'), /无效目录/)
  assert.equal(host.opened.length, 0)
  await open(event, 'logs', 'test-request')
  assert.deepEqual(host.opened, [paths.logs])
  host.setFailure('private system path failure')
  await assert.rejects(open(event, 'sources', 'test-request'), /无法打开目录/)
})

// 全历史 DTO 的未知值有效，非法汇总及模型价格在沙箱边界拒绝。
test('usage summary validates additive unknown values and rejects damaged responses', () => {
  const summary = {
    calls: 2,
    successful: 1,
    input_tokens: 10,
    output_tokens: null,
    total_tokens: 10,
    missing_input: 0,
    missing_output: 2,
    currencies: [{ currency: 'USD', cost: null, estimated: 0, unknown: 2 }]
  }
  assert.deepEqual(validation.decodeResult('usage.summary', summary), summary)
  for (const value of [
    { ...summary, total_tokens: '10' },
    { ...summary, currencies: [{ currency: 'USD' }] }
  ]) {
    assert.throws(() => validation.decodeResult('usage.summary', value))
  }
})
