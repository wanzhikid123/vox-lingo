$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/load-runtime.ps1')
try { $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 3 } catch {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port ist belegt, aber diese Anwendung antwortet nicht. Es wurde kein Prozess beendet." }
  Write-Host 'Vox-Lingo ist bereits beendet.'
  return
}
if ($health.app -ne 'KI-Englischlehrerin') { throw 'Dieser Port gehört zu einer anderen Anwendung. Es wurde kein Prozess beendet.' }
$body = @{ directory = $PSScriptRoot } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$localUrl/api/shutdown" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5 | Out-Null
for ($attempt = 0; $attempt -lt 240; $attempt++) {
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host 'Vox-Lingo wurde beendet. Der zugehörige Browsertab kann geschlossen werden.'
    return
  }
  Start-Sleep -Milliseconds 500
}
throw 'Die Anwendung schließt noch Anfragen ab. Bitte gleich erneut versuchen.'
