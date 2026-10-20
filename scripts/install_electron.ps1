# 文件：install_electron.ps1
# 层：维护脚本
# 作用：校验官方指纹并准备锁定的 Electron。
# 说明：不承载知识业务，不读取正式 API 凭据。
# 失败立即停止，避免继续使用缺失或未校验的运行资源。
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$electronRoot = Join-Path $projectRoot 'node_modules\electron'
$package = Get-Content -Raw (Join-Path $electronRoot 'package.json') | ConvertFrom-Json
$assetName = "electron-v$($package.version)-win32-x64.zip"
$cacheRoot = 'D:\dev-tools\cache\electron'
$zipPath = Join-Path $cacheRoot $assetName
$checksums = Get-Content -Raw (Join-Path $electronRoot 'checksums.json') | ConvertFrom-Json
$expectedHash = $checksums.$assetName
# 缺少官方指纹时拒绝安装，不能把网络下载成功当作完整性验证。
if (-not $expectedHash) {
    throw "Missing official checksum for $assetName"
}
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
# 缓存存在且指纹一致时直接复用，其他情况重新获取官方发布资源。
$cachedHash = ''
if (Test-Path -LiteralPath $zipPath) {
    $cachedHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
if ($cachedHash -ne $expectedHash) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/electron/electron/releases/tags/v$($package.version)"
    $asset = $release.assets | Where-Object name -eq $assetName
    if (-not $asset) {
        throw "No official release asset: $assetName"
    }
    $downloadOptions = @{
        Uri = $asset.url
        Headers = @{ Accept = 'application/octet-stream' }
        OutFile = $zipPath
        TimeoutSec = 300
    }
    Invoke-WebRequest @downloadOptions
}
# 下载与缓存都再次核对指纹，只有匹配才解压到本项目运行目录。
$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "SHA-256 mismatch: $zipPath"
}
Expand-Archive -LiteralPath $zipPath -DestinationPath (Join-Path $electronRoot 'dist') -Force
[IO.File]::WriteAllText(
    (Join-Path $electronRoot 'path.txt'),
    'electron.exe',
    [Text.UTF8Encoding]::new($false)
)
Write-Output "Electron $($package.version) installed; SHA-256 $actualHash"
