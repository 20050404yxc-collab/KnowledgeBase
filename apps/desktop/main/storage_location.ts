// 文件：storage_location.ts
// 层：Electron 桌面宿主
// 作用：读取安装时确认的数据位置并防止静默创建替代知识库。
// 说明：安装版忽略 KB_DATA_DIR；测试与开发继续使用隔离目录。
import { access, lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface StorageLocation {
  data: string
  locator?: string
  databaseRequired: boolean
}

// 普通目录不能通过链接绕进安装目录或另一个实际位置。
export async function validateDataDirectory(data: string, program: string): Promise<void> {
  if (!isAbsolute(data) || data.startsWith('\\\\') || resolve(data) === parse(data).root) {
    throw new Error('数据位置必须是本地磁盘上的专用目录')
  }
  const inside = (parent: string, child: string) => {
    const value = relative(parent, child)
    return value === '' || (!value.startsWith('..') && !isAbsolute(value))
  }
  if (inside(program, data) || inside(data, program)) {
    throw new Error('程序目录与数据目录不能相同或相互包含')
  }
  // 任一父目录是链接也拒绝，防止卸载或副本清理作用于其他目标。
  let current = resolve(data)
  while (current !== dirname(current)) {
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('数据目录及父目录必须是普通目录，不能使用链接')
    }
    current = dirname(current)
  }
  await access(data, constants.R_OK | constants.W_OK)
  for (const child of ['sources', 'sessions', 'logs', 'knowledge.sqlite3']) {
    try {
      const info = await lstat(join(data, child))
      if (info.isSymbolicLink()) {
        throw new Error('数据目录包含链接，请检查后重试')
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }
  }
}

// 安装器写 UTF-16 INI；兼容其首次创建和程序更新后的 UTF-8 格式。
export function decodeStorageLocator(bytes: Buffer): { data: string; required: boolean } {
  if (bytes.length > 16_384) {
    throw new Error('安装路径配置过大，请重新运行安装包修复')
  }
  const text =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8').replace(/^\uFEFF/, '')
  const lines = text.trim().split(/\r?\n/)
  const values = new Map<string, string>()
  if (lines.shift() !== '[KnowledgeBase]') {
    throw new Error('安装路径配置损坏，请重新运行安装包修复')
  }
  for (const line of lines) {
    const match = /^(DataDir|DatabaseRequired)=(.*)$/.exec(line)
    if (!match || values.has(match[1])) {
      throw new Error('安装路径配置损坏，请重新运行安装包修复')
    }
    values.set(match[1], match[2])
  }
  const data = values.get('DataDir')
  const required = values.get('DatabaseRequired')
  if (!data || !isAbsolute(data) || !/^[01]$/.test(required ?? '')) {
    throw new Error('安装路径配置无效，请重新运行安装包修复')
  }
  return { data, required: required === '1' }
}

// 开发不读取安装定位；安装版必须有明确记录且不能回退到默认空库。
export async function resolveStorageLocation(options: {
  packaged: boolean
  profile: string
  program: string
  environment: NodeJS.ProcessEnv
}): Promise<StorageLocation> {
  if (!options.packaged) {
    return {
      data: resolve(options.environment.KB_DATA_DIR || options.profile),
      databaseRequired: false
    }
  }
  const locator = join(options.profile, 'storage.ini')
  const parsed = decodeStorageLocator(await readFile(locator))
  await validateDataDirectory(parsed.data, options.program)
  if (parsed.required) {
    const info = await lstat(join(parsed.data, 'knowledge.sqlite3'))
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('原知识数据库不可用；请恢复原数据位置，不要新建空库')
    }
  }
  return { data: resolve(parsed.data), locator, databaseRequired: parsed.required }
}

// 后台完成建库后才标记必须保留数据库；原子替换避免半写配置。
export async function markDatabaseInitialized(location: StorageLocation): Promise<void> {
  if (!location.locator || location.databaseRequired) {
    return
  }
  await access(join(location.data, 'knowledge.sqlite3'), constants.R_OK)
  const temporary = location.locator + '.' + randomUUID() + '.tmp'
  const text = `[KnowledgeBase]\r\nDataDir=${location.data}\r\nDatabaseRequired=1\r\n`
  await writeFile(temporary, '\uFEFF' + text, { encoding: 'utf16le', flag: 'wx' })
  await rename(temporary, location.locator)
  location.databaseRequired = true
}
