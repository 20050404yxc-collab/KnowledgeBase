// 文件：storage_location.test.mjs
// 层：验证／安装数据位置
// 作用：验证实际定位读取、目录隔离与旧库丢失后的拒绝回退。
// 说明：全部使用临时目录，不读取正式配置或凭据。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transformSync } from '@swc/core'

const source = await readFile(
  new URL('../apps/desktop/main/storage_location.ts', import.meta.url),
  'utf8'
)
const { code } = transformSync(source, {
  jsc: { target: 'es2022', parser: { syntax: 'typescript' } },
  module: { type: 'es6' }
})
const storage = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

// 独立 profile 与数据位置模拟安装器输出，不调用 Windows 正式用户目录。
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kb-location-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'),
    data = join(root, '中文 数据'),
    program = join(root, 'program')
  await Promise.all([profile, data, program].map((path) => mkdir(path)))
  const locator = join(profile, 'storage.ini')
  await writeFile(
    locator,
    '\uFEFF[KnowledgeBase]\r\nDataDir=' + data + '\r\nDatabaseRequired=0\r\n',
    'utf16le'
  )
  return {
    profile,
    data,
    program,
    locator,
    packaged: true,
    environment: { KB_DATA_DIR: join(root, 'unexpected') }
  }
}

// 安装与开发的优先级不同，已有库丢失不能落到环境变量指定的空目录。
test('installed path ignores inherited overrides and requires the original initialized database', async (t) => {
  const input = await fixture(t)
  const location = await storage.resolveStorageLocation(input)
  assert.equal(location.data, input.data)
  await writeFile(join(input.data, 'knowledge.sqlite3'), 'synthetic database')
  await storage.markDatabaseInitialized(location)
  assert.equal(storage.decodeStorageLocator(await readFile(input.locator)).required, true)
  await rm(join(input.data, 'knowledge.sqlite3'))
  await assert.rejects(storage.resolveStorageLocation(input))
  const development = await storage.resolveStorageLocation({ ...input, packaged: false })
  assert.equal(development.data, input.environment.KB_DATA_DIR)
})

// 损坏、重复与相对路径配置明确失败，不默认为系统应用数据目录。
test('invalid, missing and unavailable locators cannot silently create a replacement library', async (t) => {
  const input = await fixture(t)
  for (const text of [
    '{}',
    '[KnowledgeBase]\nDataDir=relative\nDatabaseRequired=0',
    `[KnowledgeBase]\nDataDir=${input.data}\nDataDir=${input.data}\nDatabaseRequired=1`
  ]) {
    await writeFile(input.locator, text)
    await assert.rejects(storage.resolveStorageLocation(input))
  }
  await rm(input.locator)
  await assert.rejects(storage.resolveStorageLocation(input))
  await assert.rejects(storage.validateDataDirectory(join(input.data, 'missing'), input.program))
})

// 路径包含和目录链接会影响资源删除范围，必须拒绝而非仅比较字面量。
test('program overlap and linked data directories are rejected', async (t) => {
  const input = await fixture(t)
  await assert.rejects(storage.validateDataDirectory(input.data, input.data), /相互包含/)
  await assert.rejects(
    storage.validateDataDirectory(input.data, join(input.data, 'nested')),
    /相互包含/
  )
  const linked = join(input.profile, 'linked')
  await symlink(input.data, linked, 'junction')
  await assert.rejects(storage.validateDataDirectory(linked, input.program), /链接/)
  await symlink(input.profile, join(input.data, 'sessions'), 'junction')
  await assert.rejects(storage.validateDataDirectory(input.data, input.program), /链接/)
})

// 与安装器接受的普通文件和相似目录名前缀保持一致，避免安装成功后无法启动。
test('ordinary files, prefix siblings and longer data roots remain usable', async (t) => {
  const input = await fixture(t)
  await writeFile(join(input.data, 'ordinary.txt'), 'ordinary retained')
  const sibling = input.data + '2'
  await mkdir(sibling)
  await storage.validateDataDirectory(input.data, sibling)
  const longData = join(input.profile, 'a'.repeat(100), 'b'.repeat(100))
  await mkdir(longData, { recursive: true })
  assert.ok(longData.length > 220)
  await storage.validateDataDirectory(longData, input.program)
  assert.equal(await readFile(join(input.data, 'ordinary.txt'), 'utf8'), 'ordinary retained')
})
