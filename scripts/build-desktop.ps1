# Build the TeamVault Desktop client (Wails v2) for Windows.
# Produces a *portable* .exe (no installer, no admin rights needed to run).
# Pass -Installer to additionally build a per-user NSIS installer (no
# admin rights either: "user" install scope writes only to the profile).
#
# Usage (from repo root, on Windows):
#   .\scripts\build-desktop.ps1
#   .\scripts\build-desktop.ps1 -Installer
#
# Output: dist/teamvault-desktop-windows-amd64.exe
#         dist/teamvault-desktop-windows-amd64-setup.exe (with -Installer)

param(
  [switch]$Installer
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $Root "clients\desktop")

$Version = "dev"
try {
  $Version = (git -C $Root describe --tags --always --dirty 2>$null)
  if (-not $Version) { $Version = "dev" }
} catch { }

$OutDir = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$wails = Get-Command wails -ErrorAction SilentlyContinue
if (-not $wails) {
  Write-Host "Installing wails CLI..."
  $env:GOBIN = Join-Path $Root ".tmp\gobin"
  go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0
  $wailsExe = Join-Path $env:GOBIN "wails.exe"
} else {
  $wailsExe = $wails.Source
}

Write-Host "Building teamvault-desktop (windows/amd64, version=$Version)..."
& $wailsExe build -clean -platform windows/amd64 -ldflags "-X main.version=$Version"

$Bin = "build\bin\teamvault-desktop.exe"
if (-not (Test-Path $Bin)) {
  throw "Build output not found at $Bin"
}
Copy-Item $Bin (Join-Path $OutDir "teamvault-desktop-windows-amd64.exe") -Force

if ($Installer) {
  Write-Host "Building per-user NSIS installer (no admin rights required)..."
  & $wailsExe build -clean -platform windows/amd64 -nsis -installscope user -ldflags "-X main.version=$Version"
  $SetupBin = Get-ChildItem "build\bin\*-amd64-installer.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($SetupBin) {
    Copy-Item $SetupBin.FullName (Join-Path $OutDir "teamvault-desktop-windows-amd64-setup.exe") -Force
  }
}

Write-Host ""
Write-Host "Portable binary (no admin rights required to run):"
Get-ChildItem (Join-Path $OutDir "teamvault-desktop-windows-*") | Format-Table -AutoSize
Write-Host "version=$Version"
