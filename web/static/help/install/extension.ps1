# TeamVault extension unpacker (Windows)
# Usage:
#   $env:TEAMVAULT_URL='https://vault.example'; irm "$env:TEAMVAULT_URL/help/install/extension.ps1" | iex

$ErrorActionPreference = "Stop"

$Base = $env:TEAMVAULT_URL
if (-not $Base) {
  $Base = Read-Host "TeamVault-URL (z.B. https://vault.firma.local)"
}
$Base = $Base.TrimEnd("/")

$Url = "$Base/downloads/teamvault-extension.zip"
$DestRoot = Join-Path $env:LOCALAPPDATA "TeamVault"
$Zip = Join-Path $env:TEMP "teamvault-extension.zip"
$Dest = Join-Path $DestRoot "extension"

Write-Host "Lade $Url …"
try {
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
} catch {
  Write-Host ""
  Write-Host "Download fehlgeschlagen. Liegt teamvault-extension.zip unter /downloads/?" -ForegroundColor Yellow
  Write-Host "Admin: scripts/pack-clients.ps1 ausführen." -ForegroundColor Yellow
  Write-Host "Fallback: Git-Checkout → Ordner clients/extension manuell laden." -ForegroundColor Yellow
  throw
}

if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
Expand-Archive -Path $Zip -DestinationPath $Dest -Force

# zip may contain a top-level "extension" folder
$Manifest = Join-Path $Dest "manifest.json"
if (-not (Test-Path $Manifest)) {
  $inner = Get-ChildItem $Dest -Directory | Select-Object -First 1
  if ($inner -and (Test-Path (Join-Path $inner.FullName "manifest.json"))) {
    $Dest = $inner.FullName
    $Manifest = Join-Path $Dest "manifest.json"
  }
}

Write-Host ""
Write-Host "Extension entpackt nach:"
Write-Host "  $Dest"
Write-Host ""
Write-Host "Chrome / Edge:"
Write-Host "  1. chrome://extensions  bzw.  edge://extensions"
Write-Host "  2. Entwicklermodus an → Entpackte Erweiterung laden"
Write-Host "  3. Ordner wählen: $Dest"
Write-Host ""
Write-Host "Firefox:"
Write-Host "  about:debugging → This Firefox → Temporäres Add-on laden → manifest.json"
Write-Host ""
Write-Host "Im Popup Server-URL setzen: $Base"
