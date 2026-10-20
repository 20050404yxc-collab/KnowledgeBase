// 文件：check_standards.mjs
// 层：维护验证
// 作用：检查自有 TS／JS 的文件头、函数规模、分支与导入边界。
// 说明：基于语法树检查，语义和资源所有权仍须评审及行为测试。
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseSync } from '@swc/core'

const ROOT = resolve(import.meta.dirname, '..')
const HEADER_LABELS = ['文件：', '层：', '作用：', '说明：']
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassMethod',
  'Constructor'
])

// 只递归指定源码目录，不进入依赖或构建产物。
async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    })
  )
  return results.flat().filter((path) => /\.(?:tsx?|mjs)$/.test(path))
}

// SWC 的位置以 UTF-8 字节计，中文源码不能用字符串下标直接截取。
function nodeText(buffer, node) {
  return buffer.subarray(node.span.start - 1, node.span.end - 1).toString()
}

// 跨功能只通过公开入口，renderer 不能访问 Node 或直接导入宿主模块。
function checkImport(path, source) {
  const errors = []
  const normalized = path.split(sep).join('/')
  const target = resolve(dirname(path), source).split(sep).join('/')
  if (
    normalized.includes('/renderer/') &&
    (source === 'electron' || source.startsWith('node:') || target.includes('/main/'))
  ) {
    errors.push('renderer 越过受限 API 边界')
  }
  const feature = normalized.match(/\/features\/([^/]+)\//)?.[1]
  const importedFeature = target.match(/\/features\/([^/]+)(?:\/|$)/)?.[1]
  if (
    feature &&
    importedFeature &&
    feature !== importedFeature &&
    !target.endsWith('/' + importedFeature) &&
    !target.endsWith('/index')
  ) {
    errors.push('跨功能导入必须使用公开入口')
  }
  return errors
}

// 逐节点检查分支和函数，JSX 的实现行也包含在函数规模内。
function checkTree(path, source, tree) {
  const errors = []
  const buffer = Buffer.from(source)
  const report = (node, message) => {
    const line = buffer
      .subarray(0, node.span.start - 1)
      .toString()
      .split('\n').length
    errors.push(`${relative(ROOT, path)}:${line}: ${message}`)
  }
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (FUNCTION_TYPES.has(node.type) && node.span && (node.body || node.function?.body)) {
      const count = nodeText(buffer, node)
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith('//')).length
      if (count > 80) {
        report(node, `函数超过 80 行：${count}`)
      }
    }
    if (node.type === 'IfStatement') {
      for (const key of ['consequent', 'alternate']) {
        const branch = node[key]
        if (branch && branch.type !== 'BlockStatement' && branch.type !== 'IfStatement') {
          report(branch, '控制分支必须使用大括号')
        }
      }
    }
    if (node.type === 'ImportDeclaration') {
      checkImport(path, node.source.value).forEach((message) => report(node, message))
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'span') {
        if (Array.isArray(value)) {
          value.forEach(visit)
        } else {
          visit(value)
        }
      }
    }
  }
  visit(tree)
  return errors
}

// 文件名例外仅保留框架要求的 electron.vite.config.ts 和测试工具后缀。
async function checkFile(path) {
  const source = await readFile(path, 'utf8')
  const lines = source.split(/\r?\n/)
  const errors = []
  HEADER_LABELS.forEach((label, index) => {
    if (!lines[index]?.startsWith('// ' + label)) {
      errors.push(`${relative(ROOT, path)}:${index + 1}: 缺少四行文件头`)
    }
  })
  const name = basename(path)
  const valid = /\.tsx$/.test(name)
    ? /^[A-Z][A-Za-z0-9]*\.tsx$/.test(name)
    : /^[a-z_][a-z0-9_]*(?:\.test)?\.(?:ts|mjs)$/.test(name)
  if (!valid && name !== 'main.tsx' && name !== 'electron.vite.config.ts') {
    errors.push(`${relative(ROOT, path)}: 文件名不符合命名规范`)
  }
  const tree = parseSync(source, { syntax: 'typescript', tsx: name.endsWith('.tsx') })
  return errors.concat(checkTree(path, source, tree))
}

const files = (
  await Promise.all(
    ['apps', 'contracts', 'scripts', 'tests'].map((directory) => listFiles(join(ROOT, directory)))
  )
).flat()
files.push(join(ROOT, 'electron.vite.config.ts'))
const errors = (await Promise.all(files.map(checkFile))).flat()
if (errors.length) {
  throw new Error(errors.join('\n'))
}
console.log(`TS／JS 规范检查通过：${files.length} 个文件；文件头、命名、函数规模、分支和导入边界。`)
