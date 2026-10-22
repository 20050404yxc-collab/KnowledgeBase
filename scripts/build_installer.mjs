// 文件：build_installer.mjs
// 层：发布构建
// 作用：调用锁定安装构建器并复用本机已校验的工具目录。
// 说明：工具覆盖仅用于构建，不加入安装包或用户运行流程。
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const environment = { ...process.env }
const candidates = {
  ELECTRON_BUILDER_NSIS_DIR: 'build/tools/nsis',
  ELECTRON_BUILDER_NSIS_RESOURCES_DIR: 'build/tools/nsis-resources',
  ELECTRON_BUILDER_7ZIP_PATH: 'build/tools/7zip/7zip/bin/7za.exe',
  ELECTRON_BUILDER_RCEDIT_PATH: 'build/tools/rcedit'
}
for (const [name, path] of Object.entries(candidates)) {
  if (!environment[name]) {
    try {
      await access(resolve(root, path))
      environment[name] = resolve(root, path)
    } catch (error) {
      // 没有本机覆盖时由 electron-builder 按锁定校验和准备官方工具。
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  }
}
const child = spawn(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--config',
    'electron-builder.yml',
    '--win',
    'nsis',
    '--x64',
    '--publish',
    'never',
    ...process.argv.slice(2)
  ],
  { cwd: root, env: environment, stdio: 'inherit', windowsHide: true }
)
child.on('error', (error) => {
  throw error
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
