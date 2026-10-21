// 文件：diagnostic_fixtures.mjs
// 层：维护验证／日志读取
// 作用：按日期和数字序号读取隔离测试的进程日志。
// 说明：只读测试传入目录；支持进程重启和容量分段。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 进程名称限定为测试使用的两种日志；数字排序避免第十份排在第二份以前。
export async function readDiagnosticLog(directory, processName) {
  if (!['desktop', 'worker'].includes(processName)) {
    throw new Error('Unknown diagnostic process')
  }
  const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-[1-9]\\d*-${processName}\\.log$`)
  const names = (await readdir(directory))
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
  const contents = await Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')))
  return contents.join('')
}
