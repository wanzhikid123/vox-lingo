$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Bitte Node.js ab Version 24 installieren.' }
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 24) { throw 'KI-Englischlehrerin benötigt Node.js ab Version 24.' }
foreach ($keyName in @('OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($keyName, 'Process'))) {
    $configuredKey = [Environment]::GetEnvironmentVariable($keyName, 'User')
    if ([string]::IsNullOrWhiteSpace($configuredKey)) { $configuredKey = [Environment]::GetEnvironmentVariable($keyName, 'Machine') }
    if (-not [string]::IsNullOrWhiteSpace($configuredKey)) { [Environment]::SetEnvironmentVariable($keyName, $configuredKey, 'Process') }
    $configuredKey = $null
  }
}
$settingsJson = & node (Join-Path $PSScriptRoot 'local-settings.js')
if ($LASTEXITCODE -ne 0) { throw 'Ungültige .env-Konfiguration.' }
$localSettings = $settingsJson | ConvertFrom-Json
$port = [int]$localSettings.port
$localUrl = "http://127.0.0.1:$port"
