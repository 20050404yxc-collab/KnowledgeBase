$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$mainPath = Join-Path $projectRoot 'out\main\index.js'
foreach ($requiredPath in @($electronPath, $pythonPath, $mainPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Missing $requiredPath. See README.md; prepare dependencies and run npm run build."
    }
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $electronPath -ArgumentList ('"{0}"' -f $projectRoot) -WorkingDirectory $projectRoot -WindowStyle Normal
