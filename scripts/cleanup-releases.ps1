# Prune old v1.3.x patch releases/tags (keep latest only) on Gitea and GitHub.
# Gitea: no HTTP proxy. GitHub: CONNECT proxy 127.0.0.1:18081 (corp network).
# Usage:
#   .\scripts\cleanup-releases.ps1              # dry-run
#   .\scripts\cleanup-releases.ps1 -Apply       # delete releases + remote tags
#   .\scripts\cleanup-releases.ps1 -Apply -GitHubOnly   # after Gitea already cleaned

param(
  [string]$KeepTag = "v1.3.26",
  [switch]$Apply,
  [switch]$GitHubOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Get-BasicAuthHeader {
  param([string]$HostName)
  $credIn = "protocol=https`nhost=$HostName`n`n"
  $credOut = $credIn | git credential fill
  $user = ($credOut | Select-String '^username=').ToString().Substring(9)
  $pass = ($credOut | Select-String '^password=').ToString().Substring(9)
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
  return @{ Authorization = "Basic $b64"; Accept = 'application/json' }
}

$tagsToDrop = @(git tag -l "v1.3.*" | Where-Object { $_ -ne $KeepTag })
if ($tagsToDrop.Count -eq 0 -and $GitHubOnly) {
  $keepVer = [version]($KeepTag -replace '^v', '')
  $tagsToDrop = @(0..25 | ForEach-Object { "v1.3.$_" } | Where-Object { $_ -ne $KeepTag })
}
$tagsToDrop = $tagsToDrop | Sort-Object { [version]($_ -replace '^v','') }
if ($tagsToDrop.Count -eq 0) {
  Write-Host "No v1.3.x tags to prune (keeping $KeepTag)."
  exit 0
}

Write-Host "Keeping: $KeepTag"
Write-Host "Prune $($tagsToDrop.Count) tags: $($tagsToDrop -join ', ')"
if (-not $Apply) {
  Write-Host "Dry-run only. Re-run with -Apply to delete releases and remote tags."
  exit 0
}

. (Join-Path $PSScriptRoot "corp-proxy-env.ps1")
Start-CorpConnectProxyIfNeeded
$proxy = $script:CorpConnectProxyUrl
$gitCurl = "C:\Users\tbrau\AppData\Local\Programs\Git\mingw64\bin\curl.exe"
try {
  & $gitCurl -fsSL --max-time 20 --proxy $proxy "https://api.github.com/zen" | Out-Null
} catch {
  Write-Warning "GitHub API not reachable via proxy - release delete may fail; tag batch push will still be attempted."
}

if (-not $GitHubOnly) {
  $giteaHost = $env:TV_GITEA_HOST
  if (-not $giteaHost) {
    throw "Set TV_GITEA_HOST (or scripts/corp-proxy.local.ps1) before pruning Gitea releases."
  }
  $giteaH = Get-BasicAuthHeader $giteaHost
  $giteaReleases = Invoke-RestMethod -Uri "https://$giteaHost/git/api/v1/repos/CC-3.3/TeamVault/releases?limit=100" -Headers $giteaH
  foreach ($rel in $giteaReleases) {
    if ($tagsToDrop -contains $rel.tag_name) {
      Write-Host "Gitea release delete: $($rel.tag_name) (id=$($rel.id))"
      Invoke-RestMethod -Method Delete -Uri "https://$giteaHost/git/api/v1/repos/CC-3.3/TeamVault/releases/$($rel.id)" -Headers $giteaH | Out-Null
    }
  }
}

# --- GitHub releases ---
$ghH = Get-BasicAuthHeader "github.com"
$ghAuth = $ghH.Authorization
$page = 1
do {
  $ghUrl = "https://api.github.com/repos/TimUx/TeamVault/releases?per_page=100" + "&page=$page"
  $json = & $gitCurl -fsSL --max-time 60 --proxy $proxy -H "Authorization: $ghAuth" -H "Accept: application/vnd.github+json" $ghUrl
  $rels = $json | ConvertFrom-Json
  foreach ($rel in $rels) {
    if ($tagsToDrop -contains $rel.tag_name) {
      Write-Host "GitHub release delete: $($rel.tag_name) (id=$($rel.id))"
      & $gitCurl -fsSL --max-time 60 --proxy $proxy -X DELETE -H "Authorization: $ghAuth" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/TimUx/TeamVault/releases/$($rel.id)" | Out-Null
    }
  }
  $page++
} while ($rels.Count -eq 100)

# --- Remote tags ---
$delRefs = $tagsToDrop | ForEach-Object { ":refs/tags/$_" }
if (-not $GitHubOnly) {
  Write-Host "Gitea: batch delete $($delRefs.Count) tags..."
  git -c http.proxy= push origin @delRefs
}
Write-Host "GitHub: batch delete $($delRefs.Count) tags..."
git -c "http.proxy=$proxy" push github @delRefs

foreach ($tag in $tagsToDrop) {
  git rev-parse --verify "refs/tags/$tag" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    git tag -d $tag | Out-Null
  }
}
Write-Host "Done. Remaining v1.3.x tag: $KeepTag"
