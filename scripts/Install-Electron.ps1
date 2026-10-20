$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$electronRoot = Join-Path $projectRoot 'node_modules\electron'
$package = Get-Content -Raw (Join-Path $electronRoot 'package.json') | ConvertFrom-Json
$assetName = "electron-v$($package.version)-win32-x64.zip"
$cacheRoot = 'D:\dev-tools\cache\electron'
$zipPath = Join-Path $cacheRoot $assetName
$checksums = Get-Content -Raw (Join-Path $electronRoot 'checksums.json') | ConvertFrom-Json
$expectedHash = $checksums.$assetName
if (-not $expectedHash) { throw "Missing official checksum for $assetName" }
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
$cachedHash = if (Test-Path -LiteralPath $zipPath) { (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }
if ($cachedHash -ne $expectedHash) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/electron/electron/releases/tags/v$($package.version)"
    $asset = $release.assets | Where-Object name -eq $assetName
    if (-not $asset) { throw "No official release asset: $assetName" }
    Invoke-WebRequest -Uri $asset.url -Headers @{Accept='application/octet-stream'} -OutFile $zipPath -TimeoutSec 300
}
$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw "SHA-256 mismatch: $zipPath" }
Expand-Archive -LiteralPath $zipPath -DestinationPath (Join-Path $electronRoot 'dist') -Force
[IO.File]::WriteAllText((Join-Path $electronRoot 'path.txt'), 'electron.exe', [Text.UTF8Encoding]::new($false))
Write-Output "Electron $($package.version) installed; SHA-256 $actualHash"
