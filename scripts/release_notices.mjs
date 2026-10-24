// 文件：release_notices.mjs
// 层：发布构建
// 作用：收集前端运行依赖、Electron 与冻结工具的许可证和版本。
// 说明：仅生成随包声明，不把声明完整等同于法律审核或真实环境验收。
import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const destination = join(root, 'build', 'notices')
const require = createRequire(import.meta.url)
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const seen = new Set()
const manifest = []

// exports 未公开 package.json 时按已锁定的实际依赖目录寻找声明。
async function packageFile(name, parent) {
  try {
    return require.resolve(`${name}/package.json`, { paths: [parent] })
  } catch {
    // Windows 上逐级查 node_modules，保持与 Node 的依赖查找顺序一致。
    let current = parent
    while (true) {
      const candidate = join(current, 'node_modules', name, 'package.json')
      try {
        await readFile(candidate)
        return candidate
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
      }
      const next = resolve(current, '..')
      if (next === current) {
        throw new Error(`Cannot resolve runtime package ${name}`)
      }
      current = next
    }
  }
}

// 沿运行依赖闭包收集包内原始声明，明确排除仅构建时使用的依赖树。
async function collect(name, parent = root) {
  const packagePath = await packageFile(name, parent)
  if (seen.has(packagePath)) {
    return
  }
  seen.add(packagePath)
  const directory = resolve(packagePath, '..')
  const value = JSON.parse(await readFile(packagePath, 'utf8'))
  const output = join(destination, 'javascript', value.name.replaceAll('/', '_'))
  await mkdir(output, { recursive: true })
  const licenses = (await readdir(directory)).filter((file) =>
    /^(license|copying|notice)/i.test(file)
  )
  if (!licenses.length) {
    throw new Error(`Missing license material: ${value.name}`)
  }
  for (const file of licenses) {
    await copyFile(join(directory, file), join(output, file))
  }
  manifest.push({
    name: value.name,
    version: value.version,
    license: value.license,
    files: licenses
  })
  for (const dependency of Object.keys(value.dependencies ?? {})) {
    await collect(dependency, directory)
  }
}

await mkdir(destination, { recursive: true })
for (const name of Object.keys(lock.packages[''].dependencies)) {
  await collect(name)
}
for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
  await copyFile(join(root, 'node_modules', 'electron', 'dist', file), join(destination, file))
}
await writeFile(join(destination, 'javascript.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(
  join(destination, 'README.txt'),
  'Third-party notices for KnowledgeBase. Electron/Chromium and Python dependency licenses are included.\n' +
    'The worker is built with PyInstaller 6.22.3 (GPL-2.0-or-later with bootloader distribution exception).\n' +
    'CPU ONNX Runtime, NumPy and tokenizers are included with Python dependency notices.\n' +
    'The optional MIT BGE-small-zh-v1.5 INT8 model is downloaded separately on explicit user action.\n' +
    'No OCR model or OCR runtime is shipped. API providers are configured by the user.\n'
)
