// 文件：check_installer.mjs
// 层：验证／安装器
// 作用：编译并运行实际 NSIS 页面取值、路径校验和定位提交的隔离测试。
// 说明：仅测试副本替换系统目录，不安装正式程序或写正式注册表。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, symlink, access } from 'node:fs/promises'
import { resolve, join, parse, basename } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const fixture = await mkdtemp(join(tmpdir(), 'kb-installer-'))
const profile = join(fixture, 'profile')
const data = join(fixture, '中文 数据')
const program = join(fixture, 'program')
const linked = join(fixture, 'linked')
const occupied = join(fixture, 'occupied')
const conflict = join(fixture, 'conflict')
const original = join(fixture, 'original')
const wrongType = join(fixture, 'wrong_type')
const linkedEntry = join(fixture, 'linked_entry')
const orphaned = join(fixture, 'orphaned')
await Promise.all(
  [profile, data, program, occupied, conflict, original, wrongType, linkedEntry, orphaned].map(
    (path) => mkdir(path)
  )
)
await Promise.all([
  symlink(data, linked, 'junction'),
  writeFile(join(data, 'ordinary.txt'), 'ordinary file retained'),
  writeFile(join(occupied, 'original.txt'), 'program target must be dedicated'),
  mkdir(join(conflict, 'sessions')),
  writeFile(join(original, 'knowledge.sqlite3'), 'original synthetic database'),
  writeFile(join(wrongType, 'knowledge.sqlite3'), 'synthetic database'),
  writeFile(join(wrongType, 'sources'), 'not a directory'),
  writeFile(join(linkedEntry, 'knowledge.sqlite3'), 'synthetic database'),
  symlink(data, join(linkedEntry, 'sources'), 'junction'),
  writeFile(join(orphaned, 'knowledge.sqlite3-wal'), 'orphaned database companion')
])
// 不依赖特定盘符：仓库 build 与系统临时目录分盘时覆盖实际分盘选择。
const alternate = await mkdtemp(join(root, 'build', 'installer-fixture-'))
const newProgram = join(fixture, 'installSoftware', 'KnowledgeBase')
const newData = join(fixture, 'BaiduNetdiskDownload', 'KnowledgeData')
const longData = join(fixture, 'a'.repeat(90), 'b'.repeat(80))
assert.ok(longData.length > 220)
const cases = [
  { name: 'new screenshot layout 1', program: newProgram, data: newData },
  {
    name: 'new screenshot layout 2',
    program: join(fixture, 'programslearning'),
    data: join(fixture, 'programs', 'Data')
  },
  { name: 'Chinese spaces and nested directories', data: join(fixture, '新增 目录', '知序 数据') },
  { name: 'ordinary root file retained' },
  { name: 'shared sibling prefix', program: join(fixture, 'Data'), data: join(fixture, 'Data2') },
  {
    name: 'dot segments and trailing separator',
    data: join(fixture, 'unused') + '\\..\\中文 数据\\'
  },
  { name: 'above old 220 character limit', data: longData },
  { name: 'separate destination disk', data: join(alternate, 'data') },
  { name: 'existing library reused', data: original },
  {
    name: 'new folder directly below drive root',
    program: join(parse(alternate).root, basename(fixture))
  },
  { name: 'identical roots rejected', data: program, error: /相互包含/ },
  { name: 'data inside program rejected', data: join(program, 'data'), error: /相互包含/ },
  { name: 'program inside data rejected', program: join(data, 'program'), error: /相互包含/ },
  { name: 'normalized overlap rejected', data: program + '\\nested\\..', error: /相互包含/ },
  { name: 'trailing dot alias rejected', data: program + '.', error: /相互包含/ },
  { name: 'case alias rejected', data: program.toUpperCase(), error: /相互包含/ },
  { name: 'disk root rejected', data: parse(fixture).root, error: /磁盘根目录/ },
  {
    name: 'relative program preserves first error',
    program: 'relative',
    data: program,
    error: /完整目录/
  },
  { name: 'empty data preserves first error', data: '', error: /完整目录/ },
  { name: 'network path rejected', data: '\\\\server\\share\\data', error: /完整目录/ },
  { name: 'junction ancestor rejected', data: join(linked, 'child'), error: /链接/ },
  { name: 'file ancestor rejected', data: join(data, 'ordinary.txt', 'child'), error: /文件/ },
  { name: 'nonempty program protected', program: occupied, error: /程序位置必须是空/ },
  { name: 'managed directory takeover blocked', data: conflict, error: /已有 sources/ },
  { name: 'managed entry type conflict', data: wrongType, error: /类型冲突/ },
  { name: 'managed entry junction rejected', data: linkedEntry, error: /链接/ },
  { name: 'orphaned database companion protected', data: orphaned, error: /数据库辅助文件/ },
  { name: 'original database missing', data: newData, required: '1', error: /找不到原数据库/ }
]
let include = await readFile(join(root, 'installer', 'paths.nsh'), 'utf8')
include = include.replaceAll('$APPDATA\\KnowledgeBase', '$KBFixtureProfile')
await writeFile(join(fixture, 'paths_fixture.nsh'), '\uFEFF' + include.replace(/^\uFEFF/, ''))
const output = join(fixture, 'result.txt')
const records = join(fixture, 'records.txt')

// 所有负向用例调用无弹窗的完整校验；结果由 JS 判断具体错误而非仅判断失败。
function validationCase(value) {
  return String.raw`
  StrCpy $INSTDIR "${value.program ?? program}"
  StrCpy $KBData "${value.data ?? data}"
  StrCpy $KBRequired "${value.required ?? '0'}"
  Call KBValidateLocations
  FileWriteUTF16LE $7 "${value.name}|$KBError|$INSTDIR|$KBData$\r$\n"
`
}

// 隐藏原生 EDIT 控件走实际页面退出函数，避免只测辅助函数而遗漏取值回归。
function pageCase() {
  return String.raw`
  StrCpy $KBRequired "0"
  System::Call 'user32::CreateWindowExW(i 0,w "EDIT",w "${newProgram}",i 0,i 0,i 0,i 100,i 20,p 0,p 0,p 0,p 0)p.r9'
  StrCpy $KBProgramInput $9
  System::Call 'user32::CreateWindowExW(i 0,w "EDIT",w "${newData}",i 0,i 0,i 0,i 100,i 20,p 0,p 0,p 0,p 0)p.r9'
  StrCpy $KBDataInput $9
  Call KBLocationLeave
  FileWriteUTF16LE $7 "page leave|$KBError|$INSTDIR|$KBData$\r$\n"
  System::Call 'user32::DestroyWindow(p $KBProgramInput)'
  System::Call 'user32::DestroyWindow(p $KBDataInput)'
`
}

// 已有父目录的短名称也必须被识别为同一目录，不能绕过卸载隔离。
function aliasCase() {
  return String.raw`
  StrCpy $KBRequired "0"
  StrCpy $INSTDIR "${data}"
  System::Call 'kernel32::GetShortPathNameW(w "${data}", w .r5, i 1024) i.r6'
  StrCmp $6 "0" 0 +2
  StrCpy $5 "${data}"
  StrCpy $KBData "$5\new"
  Call KBValidateLocations
  FileWriteUTF16LE $7 "short name overlap|$KBError|$INSTDIR|$KBData$\r$\n"
`
}

// 只在确认动作中提交隔离定位，验证可写父目录探测与重装保留原知识。
function commitCase() {
  return String.raw`
  Push "${newProgram}"
  Call KBProbeWritable
  FileWriteUTF16LE $7 "writable new parent|$KBError|$INSTDIR|$KBData$\r$\n"
  StrCpy $INSTDIR "${program}"
  StrCpy $KBData "${data}"
  !insertmacro customInstall
  ReadINIStr $0 "${profile}\storage.ini" "KnowledgeBase" "DataDir"
  StrCmp $0 "${data}" +2
  Abort "Wrong confirmed data path"
  FileOpen $0 "${data}\knowledge.sqlite3" w
  FileWrite $0 "synthetic knowledge retained"
  FileClose $0
  !insertmacro customInstall
  ReadINIStr $0 "${profile}\storage.ini" "KnowledgeBase" "DatabaseRequired"
  StrCmp $0 "0" +2
  Abort "Reinstall unexpectedly rewrote existing locator"
  FileClose $7
  FileOpen $0 "${output}" w
  FileWrite $0 "passed"
  FileClose $0
`
}
const script = String.raw`Unicode true
!include MUI2.nsh
!include LogicLib.nsh
!define VERSION "0.1.0"
Name "KB installer function test"
OutFile "${join(fixture, 'check.exe')}"
RequestExecutionLevel user
SilentInstall silent
Var KBFixtureProfile
!include "${join(fixture, 'paths_fixture.nsh')}"
Section
  FileOpen $7 "${records}" w
  StrCpy $KBFixtureProfile "${profile}"
  StrCpy $KBExistingProgram ""
${cases.map(validationCase).join('')}
${aliasCase()}
${pageCase()}
${commitCase()}
SectionEnd
!insertmacro MUI_LANGUAGE "SimpChinese"
`
await writeFile(join(fixture, 'check.nsi'), '\uFEFF' + script)

// 子进程有限等待；错误与超时均清理计时器，仅终止本次测试进程。
async function run(executable, args, environment = process.env) {
  await new Promise((accept, reject) => {
    const child = spawn(executable, args, {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (value) => {
      output += value
    })
    child.stderr.on('data', (value) => {
      output += value
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Installer fixture timed out'))
    }, 30_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      code === 0
        ? accept()
        : reject(new Error(output || `Installer fixture exit ${code}; fixture: ${fixture}`))
    })
  })
}
const nsis = process.env.ELECTRON_BUILDER_NSIS_DIR || join(root, 'build', 'tools', 'nsis')
await run(join(nsis, 'Bin', 'makensis.exe'), ['/V2', join(fixture, 'check.nsi')], {
  ...process.env,
  NSISDIR: nsis
})
await run(join(fixture, 'check.exe'), [])
const rows = (await readFile(records, 'utf16le'))
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split('|'))
assert.equal(rows.length, cases.length + 3)
cases.forEach((value, index) => {
  assert.equal(rows[index][0], value.name)
  // 负向验证具体分类，确保早期错误没有再被包含关系覆盖。
  if (value.error) {
    assert.match(rows[index][1], value.error, value.name)
  } else {
    assert.equal(rows[index][1], '', value.name)
    assert.equal(rows[index][2], resolve(value.program ?? program), value.name)
    assert.equal(rows[index][3], resolve(value.data ?? data), value.name)
  }
})
assert.deepEqual(rows.at(-2), ['page leave', '', newProgram, newData])
assert.match(rows.at(-3)[1], /相互包含/, 'short name overlap')
assert.equal(rows.at(-1)[1], '', 'writable parent')
await assert.rejects(access(newProgram), { code: 'ENOENT' })
await assert.rejects(access(newData), { code: 'ENOENT' })
assert.equal(await readFile(output, 'utf8'), 'passed')
assert.equal(
  await readFile(join(data, 'knowledge.sqlite3'), 'utf8'),
  'synthetic knowledge retained'
)
assert.equal(await readFile(join(data, 'ordinary.txt'), 'utf8'), 'ordinary file retained')
assert.equal(
  await readFile(join(occupied, 'original.txt'), 'utf8'),
  'program target must be dedicated'
)
console.log(
  JSON.stringify(
    {
      status: 'passed',
      fixture,
      checks: cases.map((value) => value.name),
      pageLeave: 'passed',
      locatorRetention: 'passed',
      splitDisk: parse(fixture).root !== parse(alternate).root
    },
    null,
    2
  )
)
