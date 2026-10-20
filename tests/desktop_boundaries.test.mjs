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

const validation = await loadModule('../apps/desktop/shared/protocol_validation.ts')
const { markdownForDisplay } = await loadModule(
  '../apps/desktop/renderer/src/features/knowledge/markdown_display.ts'
)

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
  const { configure, generateBatch } = await batchFixture()
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
    requestId: () => 'request',
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
  const { configure, generateBatch } = await batchFixture()
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
    requestId: () => 'request',
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
