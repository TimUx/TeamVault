# Mirror GitHub (github remote) -> Gitea (origin remote) from the firm network.
# Gitea is not reachable from GitHub Actions — run this locally after CI finished.
#
# Usage (repo root):
#   .\scripts\sync-github-to-gitea.ps1
#   .\scripts\sync-github-to-gitea.ps1 -Branch main

param(
  [string]$Branch = "main",
  [string]$GitHubRemote = "github",
  [string]$GiteaRemote = "origin"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. (Join-Path $PSScriptRoot "corp-proxy-env.ps1")
Start-CorpConnectProxyIfNeeded

$proxy = $script:CorpConnectProxyUrl

Write-Host "==> Fetch $GitHubRemote ($Branch + tags) via CONNECT proxy..."
git -c "http.proxy=$proxy" fetch $GitHubRemote $Branch --tags

$src = "$GitHubRemote/$Branch"
if (-not (git rev-parse --verify "$src" 2>$null)) {
  throw "Remote ref $src not found after fetch."
}

Write-Host "==> Push $src -> $GiteaRemote/$Branch (no proxy)..."
git -c http.proxy= push $GiteaRemote "${src}:${Branch}"

Write-Host "==> Push tags to $GiteaRemote..."
git -c http.proxy= push $GiteaRemote --tags

Write-Host "Done. Gitea ($GiteaRemote) is at $(git rev-parse --short $src)."
