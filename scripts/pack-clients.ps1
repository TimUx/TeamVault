# Pack client artifacts into dist/ for admins to copy into <data-dir>/downloads/
# Usage (repo root):
#   .\scripts\pack-clients.ps1
#
# Output:
#   dist/tvcli-windows-amd64.exe, …
#   dist/teamvault-extension.zip

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

& "$PSScriptRoot\build-tvcli.ps1"

$ExtDir = Join-Path $Root "clients\extension"
$OutZip = Join-Path $Root "dist\teamvault-extension.zip"
if (Test-Path $OutZip) { Remove-Item -Force $OutZip }

# Compress contents of extension folder (manifest at zip root)
Compress-Archive -Path (Join-Path $ExtDir "*") -DestinationPath $OutZip -Force

Write-Host ""
Write-Host "Fertig. Nach dem Server-Start nach <data-dir>/downloads/ kopieren, z.B.:"
Write-Host "  New-Item -ItemType Directory -Force data\downloads | Out-Null"
Write-Host "  Copy-Item dist\tvcli-* data\downloads\"
Write-Host "  Copy-Item dist\teamvault-extension.zip data\downloads\"
Write-Host "Dann: $((Get-Item $OutZip).FullName)"
