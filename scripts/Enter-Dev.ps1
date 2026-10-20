# Run with: . .\scripts\Enter-Dev.ps1
$projectRoot = Split-Path -Parent $PSScriptRoot
$activateScript = Join-Path $projectRoot '.venv\Scripts\Activate.ps1'
if (-not (Test-Path -LiteralPath $activateScript)) {
    throw 'Missing project virtual environment. See docs/确认页/个人知识库/开发环境.md.'
}
. $activateScript
$env:PIP_CACHE_DIR = 'D:\dev-tools\cache\pip'
$env:npm_config_cache = 'D:\dev-tools\cache\npm'
$env:ELECTRON_CACHE = 'D:\dev-tools\cache\electron'
$env:electron_config_cache = 'D:\dev-tools\cache\electron'
$env:HF_HOME = 'D:\dev-tools\cache\huggingface'
$env:KB_OCR_MODEL_DIR = 'D:\dev-models\KnowledgeBase\rapidocr'
Write-Output "Development environment: $projectRoot"
