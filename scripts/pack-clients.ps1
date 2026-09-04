# Pack client artifacts into dist/ for admins to copy into <data-dir>/downloads/
# Usage (repo root):
#   .\scripts\pack-clients.ps1
#
# Output:
#   dist/tvcli-windows-amd64.exe, …
#   dist/teamvault-extension.zip
#
# Desktop-App (Wails) wird hier NICHT gebaut — sie benötigt WebView2 nativ auf
# Windows bzw. WebKitGTK nativ auf Linux und kann nicht im (Cross-Compile-)
# Docker-Build mitgebaut werden. Separat bauen:
#   .\scripts\build-desktop.ps1 -Installer   (Windows, auf diesem Rechner)
#   ./scripts/build-desktop.sh               (Linux, auf einem Linux-Rechner)
# Ergebnis danach ebenfalls nach <data-dir>/downloads/ kopieren.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

& "$PSScriptRoot\build-tvcli.ps1"

Write-Host "Packing extension (crx/xpi)…"
go run ./cmd/pack-extension

Write-Host ""
Write-Host "Fertig. Nach dem Server-Start nach <data-dir>/downloads/ kopieren, z.B.:"
Write-Host "  New-Item -ItemType Directory -Force data\downloads | Out-Null"
Write-Host "  Copy-Item dist\tvcli-* data\downloads\"
Write-Host "  Copy-Item dist\teamvault-extension.* data\downloads\"
Write-Host "  Copy-Item -Recurse dist\extension data\downloads\"
Write-Host "  Copy-Item dist\teamvault-desktop-* data\downloads\  # nach separatem build-desktop.ps1/.sh"
