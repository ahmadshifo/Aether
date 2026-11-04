$ErrorActionPreference = 'Stop'
$nativeRoot = Split-Path -Parent $PSScriptRoot
$recordPath = Join-Path $nativeRoot 'validation/artifacts/live-services.json'
if (!(Test-Path -LiteralPath $recordPath)) { throw 'No verified preview process record exists.' }
$record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
foreach ($service in $record.listeners) {
  $currentProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $service.pid)
  if (!$currentProcess) { continue }
  if (!$service.createdAt -or $currentProcess.CommandLine -ne $service.commandLine -or $currentProcess.CreationDate.ToUniversalTime().Ticks -ne ([datetime]$service.createdAt).ToUniversalTime().Ticks) {
    throw "Process $($service.pid) no longer matches this app's recorded preview. Nothing was stopped for it."
  }
  Stop-Process -Id $service.pid
  Write-Output "Stopped Aether native preview listener on port $($service.port)."
}
