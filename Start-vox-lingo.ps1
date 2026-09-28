param([switch]$NoBrowser, [switch]$Restart)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/load-runtime.ps1')
Set-Location -LiteralPath $PSScriptRoot
$alreadyRunning = $false
try { $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2; $alreadyRunning = $health.app -eq 'KI-Englischlehrerin' } catch { }
if ($alreadyRunning -and $Restart) {
  $state = Invoke-RestMethod -Uri "$localUrl/api/home" -TimeoutSec 3
  if (@($state.history | Where-Object status -eq 'active').Count -gt 0) { throw 'Bitte die laufende Stunde vor dem Neustart beenden.' }
  if ((Invoke-RestMethod -Uri "$localUrl/api/preparation" -TimeoutSec 3).busy) { throw 'Bitte warten, bis die Vorbereitung abgeschlossen ist.' }
  & (Join-Path $PSScriptRoot 'Stop-vox-lingo.ps1')
  $alreadyRunning = $false
}
if (-not $alreadyRunning) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port ist belegt. Bitte KI_PORT ändern oder die zugehörige Anwendung beenden." }
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Die Installation der Abhängigkeiten ist fehlgeschlagen.' }
  }
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Die Anwendung konnte nicht erstellt werden.' }
  New-Item -ItemType Directory -Path $localSettings.dataDir -Force | Out-Null
  $nodePath = (Get-Command node).Source
  $serverPath = Join-Path $PSScriptRoot 'server/index.js'
  Start-Process -FilePath $nodePath -ArgumentList @("`"$serverPath`"") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localSettings.dataDir 'server.log') -RedirectStandardError (Join-Path $localSettings.dataDir 'server-error.log') | Out-Null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try { $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 1; if ($health.app -eq 'KI-Englischlehrerin') { $alreadyRunning = $true; break } } catch { }
  }
  if (-not $alreadyRunning) { throw 'Der lokale Dienst wurde nicht gestartet. Bitte server-error.log in KI_DATA_DIR prüfen.' }
}
if (-not $NoBrowser) { Start-Process $localUrl }
Write-Host "Vox-Lingo ist bereit: $localUrl"
