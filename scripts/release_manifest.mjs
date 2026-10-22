// 文件：release_manifest.mjs
// 层：发布构建
// 作用：生成安装包校验和与明确标注验收边界的发布清单。
// 说明：不发布到外部服务，不把本机构建当作干净机器安装验收。
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const name = `KnowledgeBase-Setup-${packageInfo.version}-x64.exe`
const path = join(root, 'release', name)
const sha256 = createHash('sha256')
  .update(await readFile(path))
  .digest('hex')
await writeFile(path + '.sha256', `${sha256}  ${name}\n`)
await writeFile(
  join(root, 'release', 'release-manifest.json'),
  JSON.stringify(
    {
      product: '知序',
      version: packageInfo.version,
      platform: 'Windows x64',
      file: name,
      bytes: (await stat(path)).size,
      sha256,
      signature: 'unsigned',
      automaticUpdates: false,
      notices: 'installed resources/notices and resources/worker/_internal',
      verification:
        'See task-specs/20261021-02-windows-distribution/verification.md for actual evidence. Building does not certify clean-machine installation or real-provider quality.'
    },
    null,
    2
  ) + '\n'
)
console.log(`${name}: ${sha256}`)
