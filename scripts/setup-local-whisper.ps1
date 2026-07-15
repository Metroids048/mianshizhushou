param(
  [ValidateSet("tiny", "base", "small")]
  [string]$Model = "base"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $root "requirements-local-whisper.txt"
$worker = Join-Path $PSScriptRoot "local_whisper_worker.py"
$modelRoot = Join-Path $root ".data\whisper-models"

agent-python -m pip install --only-binary=:all: -r $requirements
agent-python $worker --model $Model --download-root $modelRoot --warmup
Write-Host "本地 Whisper 已就绪。启动前设置 ASR_PROVIDER=local-whisper。"
