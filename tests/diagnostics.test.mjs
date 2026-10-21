// 文件：diagnostics.test.mjs
// 层：验证／桌面日志
// 作用：验证滚动写入、诊断失败隔离及界面白名单。
// 说明：动态编译源码，使用隔离临时目录，不启动正式桌面。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { transformSync } from '@swc/core'
import { readDiagnosticLog } from '../scripts/diagnostic_fixtures.mjs'

// 导入地址由本测试构造，源码和依赖使用实际实现。
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  for (const [key, value] of Object.entries(replacements)) {
    source = source.replaceAll(key, JSON.stringify(value))
  }
  const { code } = transformSync(source, {
    jsc: { target: 'es2022', parser: { syntax: 'typescript' } },
    module: { type: 'es6' }
  })
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}

const errorUrl = await moduleUrl('../apps/desktop/shared/diagnostic_error.ts')
const { diagnosticError, requestError } = await import(errorUrl)
const { DiagnosticLog } = await import(
  await moduleUrl('../apps/desktop/main/diagnostics.ts', {
    "'../shared/diagnostic_error'": errorUrl
  })
)
const libraryUrl = await moduleUrl('../apps/desktop/shared/library_validation.ts')
const protocolUrl = await moduleUrl('../apps/desktop/shared/protocol_validation.ts', {
  "'./library_validation'": libraryUrl
})
const { rendererDiagnostic } = await import(
  await moduleUrl('../apps/desktop/main/renderer_diagnostics.ts', {
    "'../shared/protocol_validation'": protocolUrl
  })
)

// 请求编号始终可由提示检索，原错误保留且异常标识不能注入其他提示。
test('visible request failures include a searchable correlation id', () => {
  const original = new TypeError('合成校验失败')
  const error = requestError(original, 'safe-id')
  assert.equal(error.message, '合成校验失败\n日志请求 ID：safe-id')
  assert.equal(error.cause, original)
  assert.equal(requestError(original, 'bad\nprivate'), original)
  assert.equal(requestError(null, 'safe-id').message, '操作未完成，请重试\n日志请求 ID：safe-id')
  assert.deepEqual(
    rendererDiagnostic({
      event: 'feedback_error',
      request_id: 'safe-id',
      reason: 'request_failed',
      message: 'private'
    }),
    { kind: 'feedback_error', reason: 'request_failed', request_id: 'safe-id' }
  )
  assert.deepEqual(rendererDiagnostic({ event: 'feedback_error', reason: 'private' }), {
    kind: 'feedback_error'
  })
})

// 含换行的错误正文也不能伪装成栈帧；只保留实际技术位置与系统码。
test('error diagnostics remove messages, paths and private multiline text', () => {
  const error = new Error('private-token\n    at C:/private/fake.js:1:2')
  error.code = 'EACCES'
  error.stack += '\n    at parse (C:/Users/private/app.js:20:4)'
  const detail = diagnosticError(error)
  assert.equal(detail.error_type, 'Error')
  assert.equal(detail.code, 'EACCES')
  assert.ok(detail.frames.includes('app.js:20:4'))
  assert.ok(
    detail.frames.every((frame) => /^(?:diagnostics\.test\.mjs|app\.js):\d+:\d+$/.test(frame))
  )
  assert.ok(!JSON.stringify(detail).includes('private'))
  assert.deepEqual(diagnosticError({ secret: 'private' }), {
    error_type: 'UnknownError',
    frames: []
  })
})

// 不可信界面只能传递允许事件和有界技术字段，不能注入日志正文或文件路径。
test('renderer diagnostics whitelist metadata and discard arbitrary payloads', () => {
  assert.equal(rendererDiagnostic({ event: 'arbitrary', content: 'private' }), null)
  const result = rendererDiagnostic({
    event: 'request_failed',
    operation: 'knowledge.save',
    request_id: 'safe-id',
    elapsed_ms: 14.2,
    error_type: 'TypeError',
    message: 'private',
    key: 'private',
    frames: ['app.js:12:3', 'C:/private/document.js:1:1', 'private\napp.js:1:1']
  })
  assert.deepEqual(result, {
    kind: 'request_failed',
    operation: 'knowledge.save',
    request_id: 'safe-id',
    elapsed_ms: 14,
    error_type: 'TypeError',
    frames: 'app.js:12:3'
  })
  assert.deepEqual(
    rendererDiagnostic({ event: 'error', operation: 'constructor', elapsed_ms: Infinity }),
    { kind: 'error' }
  )
})

// 串行追加不会交错 JSON；容量分段保留全部近期记录，最新错误保持脱敏。
test('desktop logger rotates bounded files and flushes the latest event', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'knowledgebase-logs-'))
  try {
    const logger = new DiagnosticLog(directory, 700)
    for (let index = 0; index < 40; index++) {
      logger.write('synthetic.step', { index, request_id: 'safe-id' })
    }
    logger.write('synthetic.error', {}, new Error('private-token-and-body'))
    await logger.flush()
    const files = await readdir(directory)
    assert.ok(files.length > 6)
    for (const file of files) {
      const text = await readFile(join(directory, file), 'utf8')
      assert.ok(Buffer.byteLength(text) <= 700)
      assert.ok(!text.includes('private-token-and-body'))
      assert.ok(
        text
          .trim()
          .split('\n')
          .every((line) => JSON.parse(line).session_id)
      )
    }
    const lines = (await readDiagnosticLog(directory, 'desktop')).trim().split('\n')
    assert.equal(lines.length, 41)
    assert.equal(JSON.parse(lines.at(-1)).event, 'synthetic.error')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// 不可写目录不会把写日志失败变成业务失败，拥塞计数仍可观察。
test('logger failure resolves flush and queue overload is recorded', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'knowledgebase-log-failure-'))
  const warnings = []
  context.mock.method(console, 'error', (value) => warnings.push(value))
  try {
    const blocked = join(directory, 'blocked')
    await writeFile(blocked, 'synthetic')
    const failing = new DiagnosticLog(blocked)
    failing.write('synthetic.failure', {}, new Error('private'))
    await failing.flush()
    assert.equal(warnings.length, 1)
    assert.ok(!warnings[0].includes('private'))
    const logger = new DiagnosticLog(join(directory, 'valid'))
    for (let index = 0; index < 1100; index++) {
      logger.write('synthetic.burst', { index })
    }
    await logger.flush()
    const rows = (await readDiagnosticLog(join(directory, 'valid'), 'desktop'))
      .trim()
      .split('\n')
      .map(JSON.parse)
    assert.ok(rows.some((row) => row.event === 'diagnostics.dropped' && row.dropped > 0))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// 每次启动独占新文件；当天有空号也延续最大序号，跨天从一开始。
test('each desktop startup creates a dated file without appending previous logs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'knowledgebase-log-sessions-'))
  const date = new Date(2026, 9, 21, 12)
  const now = () => date
  try {
    await writeFile(join(directory, '2026-10-21-9-desktop.log'), 'previous\n')
    const first = new DiagnosticLog(directory, undefined, now)
    const second = new DiagnosticLog(directory, undefined, now)
    first.write('first.start')
    second.write('second.start')
    await Promise.all([first.flush(), second.flush()])
    assert.equal(await readFile(join(directory, '2026-10-21-9-desktop.log'), 'utf8'), 'previous\n')
    const events = await Promise.all(
      [10, 11].map(
        async (index) =>
          JSON.parse(await readFile(join(directory, `2026-10-21-${index}-desktop.log`), 'utf8'))
            .event
      )
    )
    assert.deepEqual(events.sort(), ['first.start', 'second.start'])
    date.setDate(22)
    const nextDay = new DiagnosticLog(directory, undefined, now)
    nextDay.write('next.day')
    await nextDay.flush()
    assert.equal(
      JSON.parse(await readFile(join(directory, '2026-10-22-1-desktop.log'), 'utf8')).event,
      'next.day'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// 严格超过十四天才删除；只认本进程新旧日志，目录及其他数据不受影响。
test('desktop retention respects exact age and protects unrelated and active files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'knowledgebase-log-retention-'))
  let nowMs = new Date(2026, 9, 21, 12).getTime()
  const cutoff = nowMs - 14 * 86400000
  try {
    const ages = {
      '2026-10-01-1-desktop.log': cutoff - 1000,
      'desktop.log.1': cutoff - 1000,
      '2026-10-07-1-desktop.log': cutoff,
      '2026-10-06-1-desktop.log': cutoff + 1000,
      'worker.log': cutoff - 1000,
      'notes.txt': cutoff - 1000
    }
    for (const [name, time] of Object.entries(ages)) {
      await writeFile(join(directory, name), name)
      await utimes(join(directory, name), time / 1000, time / 1000)
    }
    await mkdir(join(directory, '2026-10-01-2-desktop.log'))
    const logger = new DiagnosticLog(directory, undefined, () => new Date(nowMs))
    logger.write('retention.start')
    await logger.flush()
    const names = await readdir(directory)
    assert.ok(!names.includes('2026-10-01-1-desktop.log') && !names.includes('desktop.log.1'))
    for (const name of Object.keys(ages).slice(2)) {
      assert.ok(names.includes(name), name)
    }
    assert.ok(names.includes('2026-10-01-2-desktop.log'))
    // 不重启也会在一天后的写入清理；当前文件即使陈旧也保留。
    const active = join(directory, '2026-10-21-1-desktop.log')
    await utimes(active, (cutoff - 1000) / 1000, (cutoff - 1000) / 1000)
    nowMs += 86400000
    logger.write('retention.next_day')
    await logger.flush()
    assert.ok(!(await readdir(directory)).includes('2026-10-07-1-desktop.log'))
    assert.equal((await readFile(active, 'utf8')).trim().split('\n').length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
