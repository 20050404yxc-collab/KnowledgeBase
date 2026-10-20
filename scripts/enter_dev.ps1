# 文件：enter_dev.ps1
# 层：维护脚本
# 作用：激活项目虚拟环境与专用缓存路径。
# 说明：不承载知识业务，不读取正式 API 凭据。
$projectRoot = Split-Path -Parent $PSScriptRoot
$activateScript = Join-Path $projectRoot '.venv\Scripts\Activate.ps1'
# 虚拟环境缺失时终止，不落入全局 Python 环境继续安装。
if (-not (Test-Path -LiteralPath $activateScript)) {
    throw 'Missing project virtual environment. See docs/确认页/个人知识库/开发环境.md.'
}
. $activateScript
# 只配置本次终端环境，依赖缓存与模型资源保留独立存储位置。
$env:PIP_CACHE_DIR = 'D:\dev-tools\cache\pip'
$env:npm_config_cache = 'D:\dev-tools\cache\npm'
$env:ELECTRON_CACHE = 'D:\dev-tools\cache\electron'
$env:electron_config_cache = 'D:\dev-tools\cache\electron'
$env:HF_HOME = 'D:\dev-tools\cache\huggingface'
$env:KB_OCR_MODEL_DIR = 'D:\dev-models\KnowledgeBase\rapidocr'
Write-Output "Development environment: $projectRoot"
