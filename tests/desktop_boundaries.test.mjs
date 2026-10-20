// 文件：desktop_boundaries.test.mjs
// 层：验证／桌面协议和请求生命周期
// 作用：验证未知消息、超时、重复标识和晚到结果。
// 说明：动态编译被测 TS 模块，使用虚拟计时器，不启动正式应用。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { transformSync } from '@swc/core'

// 模块无运行时本地依赖，转换后从内存加载实际实现。
async function loadModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const { code } = transformSync(source, {
    jsc: { target: 'es2022', parser: { syntax: 'typescript' } },
    module: { type: 'es6' }
  })
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}

const validation = await loadModule('../apps/desktop/shared/protocol_validation.ts')
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
