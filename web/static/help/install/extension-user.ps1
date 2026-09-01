# TeamVault extension — user installer (Chrome / Edge)
#   $env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension-user.ps1" | iex
#
# Sets ExtensionSettings + ExtensionInstallSources under HKCU for Chrome and Edge.
# In many corporate environments HKCU\Software\Policies is locked — then IT must deploy
# extension-policy.ps1 (HKLM) or GPO/Intune. End users: use extension.ps1 (ZIP / dev mode).

$ErrorActionPreference = "Stop"
$Base = ($env:TEAMVAULT_URL).TrimEnd("/")
if (-not $Base) { $Base = (Read-Host "TeamVault-URL").TrimEnd("/") }

$meta = Invoke-RestMethod -Uri "$Base/api/client-downloads" -UseBasicParsing
$extId = $meta.extension.id
if (-not $extId) { throw "Extension nicht bereitgestellt — Server/Image aktualisieren." }

$updateUrl = "$Base$($meta.extension.update_url)"
$policy = @{ $extId = @{ installation_mode = "normal_installed"; update_url = $updateUrl } }
$pJson = ($policy | ConvertTo-Json -Compress -Depth 5)
$sJson = (@("$Base/*") | ConvertTo-Json -Compress)

function Set-BrowserExtensionPolicy {
  param([string]$Root, [string]$BrowserName)
  try {
    if (-not (Test-Path -LiteralPath $Root)) {
      New-Item -Path $Root -Force | Out-Null
    }
    Set-ItemProperty -Path $Root -Name "ExtensionSettings" -Value $pJson -Type String
    Set-ItemProperty -Path $Root -Name "ExtensionInstallSources" -Value $sJson -Type String
    Write-Host "  OK: $BrowserName ($Root)" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "  Fehler $BrowserName`: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

Write-Host "TeamVault Extension — Browser-Richtlinie (Benutzer)" -ForegroundColor Cyan
Write-Host "Extension-ID: $extId"
Write-Host ""

$ok = $false
$ok = (Set-BrowserExtensionPolicy "HKCU:\Software\Policies\Google\Chrome" "Chrome") -or $ok
$ok = (Set-BrowserExtensionPolicy "HKCU:\Software\Policies\Microsoft\Edge" "Edge") -or $ok

if ($ok) {
  Write-Host ""
  Write-Host "Richtlinie gesetzt. Chrome/Edge neu starten, dann:" -ForegroundColor Green
  Write-Host "  $Base/help/extension → Extension installieren"
  Start-Process "$Base/help/extension#install"
  exit 0
}

Write-Host ""
Write-Host "Registrierungszugriff verweigert (häufig durch Firmen-GPO)." -ForegroundColor Red
Write-Host ""
Write-Host "Option A — IT (empfohlen für alle Nutzer):" -ForegroundColor Cyan
Write-Host "  PowerShell als Administrator:"
Write-Host "  `$env:TEAMVAULT_URL='$Base'; irm `"`$env:TEAMVAULT_URL/help/install/extension-policy.ps1`" | iex"
Write-Host "  Oder GPO/Intune mit:"
Write-Host "    $Base/downloads/extension/chrome-policy.json"
Write-Host "    $Base/downloads/extension/chrome-install-sources.json"
Write-Host ""
Write-Host "Option B — Entwicklermodus (nur für Sie, ohne IT):" -ForegroundColor Cyan
Write-Host "  `$env:TEAMVAULT_URL='$Base'; irm `"`$env:TEAMVAULT_URL/help/install/extension.ps1`" | iex"
Write-Host "  Danach chrome://extensions → Entwicklermodus → Entpackte Erweiterung laden"
Write-Host ""
Write-Host "Hinweis: .crx nur herunterladen ohne Dialog ist normal, wenn Schritt 1 fehlschlägt." -ForegroundColor Yellow
exit 1
