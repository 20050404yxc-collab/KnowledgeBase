# 文件：start_knowledgebase.ps1
# 层：维护脚本
# 作用：检查依赖并启动桌面窗口。
# 说明：不承载知识业务，不读取正式 API 凭据。
# 失败立即停止，避免继续使用缺失或未校验的运行资源。
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$mainPath = Join-Path $projectRoot 'out\main\index.js'
# 所有必需入口就绪才启动；缺失文件向调用终端报告恢复方式。
foreach ($requiredPath in @($electronPath, $pythonPath, $mainPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Missing $requiredPath. See README.md; prepare dependencies and run npm run build."
    }
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
# 这是用户主动启动的桌面窗口，运行目录限定为当前工程。
$launchOptions = @{
    FilePath = $electronPath
    ArgumentList = ('"{0}"' -f $projectRoot)
    WorkingDirectory = $projectRoot
    WindowStyle = 'Normal'
}
Start-Process @launchOptions
