$ErrorActionPreference = "SilentlyContinue"

$Root = $PSScriptRoot
$launcher = Join-Path $Root "一键启动.cmd"

Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$launcher`"" -WorkingDirectory $Root
exit 0
