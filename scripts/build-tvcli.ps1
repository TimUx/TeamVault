# Cross-compile standalone tvcli binaries (Windows + Linux, amd64).
# Pure Go / CGO_ENABLED=0 — no libc or Go toolchain needed at runtime.
#
# Usage (from repo root):
#   . .\scripts\go-env.ps1   # optional corp GOPROXY
#   .\scripts\build-tvcli.ps1
#
# Output: dist/tvcli-windows-amd64.exe, dist/tvcli-linux-amd64

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:Path = "C:\Program Files\Go\bin;" + $env:Path
$env:CGO_ENABLED = "0"

$Version = "dev"
$Commit = "none"
try {
  $Version = (git describe --tags --always --dirty 2>$null)
  if (-not $Version) { $Version = "dev" }
} catch { }
try {
  $Commit = (git rev-parse --short HEAD 2>$null)
  if (-not $Commit) { $Commit = "none" }
} catch { }

$Ldflags = "-s -w -X main.version=$Version -X main.commit=$Commit"
$OutDir = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Targets = @(
  @{ GOOS = "windows"; GOARCH = "amd64"; Name = "tvcli-windows-amd64.exe" }
  @{ GOOS = "linux";   GOARCH = "amd64"; Name = "tvcli-linux-amd64" }
  @{ GOOS = "windows"; GOARCH = "arm64"; Name = "tvcli-windows-arm64.exe" }
  @{ GOOS = "linux";   GOARCH = "arm64"; Name = "tvcli-linux-arm64" }
)

foreach ($t in $Targets) {
  $env:GOOS = $t.GOOS
  $env:GOARCH = $t.GOARCH
  $out = Join-Path $OutDir $t.Name
  Write-Host "Building $($t.Name) ..."
  & go build -trimpath -ldflags $Ldflags -o $out ./cmd/tvcli
  if ($LASTEXITCODE -ne 0) { throw "go build failed for $($t.Name)" }
}

Remove-Item Env:GOOS -ErrorAction SilentlyContinue
Remove-Item Env:GOARCH -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Standalone binaries (CGO_ENABLED=0):"
Get-ChildItem $OutDir -Filter "tvcli-*" | ForEach-Object {
  "{0,12:N0}  {1}" -f $_.Length, $_.FullName
}
Write-Host "version=$Version commit=$Commit"
