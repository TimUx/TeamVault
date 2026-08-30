# TeamVault tvcli installer (Windows)
# Usage:
#   $env:TEAMVAULT_URL='https://vault.example'; irm "$env:TEAMVAULT_URL/help/install/tvcli.ps1" | iex

$ErrorActionPreference = "Stop"

$Base = $env:TEAMVAULT_URL
if (-not $Base) {
  $Base = Read-Host "TeamVault-URL (z.B. https://vault.firma.local)"
}
$Base = $Base.TrimEnd("/")

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$Name = "tvcli-windows-$Arch.exe"
$Url = "$Base/downloads/$Name"

$DestDir = Join-Path $env:LOCALAPPDATA "TeamVault\bin"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Dest = Join-Path $DestDir "tvcli.exe"

Write-Host "Lade $Url …"
try {
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
} catch {
  Write-Host ""
  Write-Host "Download fehlgeschlagen. Liegt die Datei unter $Url ?" -ForegroundColor Yellow
  Write-Host "Admin: scripts/build-tvcli.ps1 ausführen und nach <data-dir>/downloads/ kopieren." -ForegroundColor Yellow
  throw
}

Write-Host "Installiert: $Dest"
Write-Host ""
Write-Host "Optional PATH für diese Sitzung:"
Write-Host "  `$env:Path = '$DestDir;' + `$env:Path"
Write-Host ""
Write-Host "Test:"
Write-Host "  & '$Dest' -base $Base version"
Write-Host "  & '$Dest' -base $Base login -tenant IHR-TENANT -user IHR-USER"
