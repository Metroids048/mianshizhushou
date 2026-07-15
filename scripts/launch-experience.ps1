$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

function Reset-LogFile([string]$Path) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) {
      New-Item -ItemType File -Path $Path | Out-Null
      return $true
    }

    [System.IO.File]::WriteAllText($Path, "")
    return $true
  } catch {
    Write-Host "Log file is currently in use, continuing without resetting: $Path"
    return $false
  }
}

function Test-EndpointReady([string]$Url) {
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Open-Frontend([string]$Url) {
  $browserCandidates = @("msedge.exe", "chrome.exe")
  foreach ($browser in $browserCandidates) {
    $command = Get-Command $browser -ErrorAction SilentlyContinue
    if ($command) {
      Start-Process -FilePath $command.Source -ArgumentList $Url | Out-Null
      return $true
    }
  }

  Start-Process $Url | Out-Null
  return $true
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install from https://nodejs.org/"
  exit 1
}

Write-Host "Running local environment checks..."
& node .\scripts\doctor.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

$logsDir = Join-Path $Root "logs"
if (-not (Test-Path -LiteralPath $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$serverLog = Join-Path $logsDir "server.log"
$devLog = Join-Path $logsDir "dev.log"

$backendUrl = "http://127.0.0.1:8787/api/health"
$frontendUrl = "http://127.0.0.1:5173/"
$backendReady = Test-EndpointReady $backendUrl
$frontendReady = Test-EndpointReady $frontendUrl

if ($backendReady -and $frontendReady) {
  Write-Host "Frontend and backend are already running."
  Write-Host "Frontend: $frontendUrl"
  Write-Host "Backend: $backendUrl"
  Write-Host "Logs: $serverLog ; $devLog"
  Write-Host "Opening browser..."
  [void](Open-Frontend $frontendUrl)
  exit 0
}

[void](Reset-LogFile $serverLog)
[void](Reset-LogFile $devLog)

if (-not $backendReady) {
  Write-Host "Starting backend http://127.0.0.1:8787 ..."
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run server >> `"$serverLog`" 2>&1" `
    -WorkingDirectory $Root `
    -WindowStyle Minimized
} else {
  Write-Host "Backend already available: $backendUrl"
}

if (-not $frontendReady) {
  Write-Host "Starting frontend http://127.0.0.1:5173 ..."
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev >> `"$devLog`" 2>&1" `
    -WorkingDirectory $Root `
    -WindowStyle Minimized
} else {
  Write-Host "Frontend already available: $frontendUrl"
}

Write-Host "Waiting for services (up to 60s)..."

$deadline = (Get-Date).AddSeconds(60)

while ((Get-Date) -lt $deadline) {
  $serverLogReady = (Test-Path -LiteralPath $serverLog) -and ((Get-Item -LiteralPath $serverLog).Length -ge 0)
  $devLogReady = (Test-Path -LiteralPath $devLog) -and ((Get-Item -LiteralPath $devLog).Length -ge 0)
  if (-not $backendReady) { $backendReady = Test-EndpointReady $backendUrl }
  if (-not $frontendReady) { $frontendReady = Test-EndpointReady $frontendUrl }
  if ($backendReady -and $frontendReady -and $serverLogReady -and $devLogReady) { break }
  Start-Sleep -Seconds 1
}

if ($backendReady -and $frontendReady) {
  Write-Host "Ready."
  Write-Host "Frontend: $frontendUrl"
  Write-Host "Backend: $backendUrl"
  Write-Host "Logs: $serverLog ; $devLog"
  Write-Host "Opening browser..."
  [void](Open-Frontend $frontendUrl)
  exit 0
}

Write-Host "Services not ready."
Write-Host "Frontend target: $frontendUrl"
Write-Host "Backend target: $backendUrl"
Write-Host "Check logs: $serverLog ; $devLog"
if (-not $frontendReady -and -not $backendReady) {
  Write-Host "Status: frontend and backend are both unavailable."
} elseif (-not $frontendReady) {
  Write-Host "Status: frontend is unavailable."
} elseif (-not $backendReady) {
  Write-Host "Status: backend is unavailable."
}
if (Test-Path -LiteralPath $serverLog) {
  Write-Host "Last backend log lines:"
  Get-Content -LiteralPath $serverLog -Tail 20
}
if (Test-Path -LiteralPath $devLog) {
  Write-Host "Last frontend log lines:"
  Get-Content -LiteralPath $devLog -Tail 20
}
Write-Host "Browser was not opened because startup did not finish."
exit 1
