# Corp proxy helpers for npm, Playwright, git, curl, gh, docker pull, etc.
# Requires git-connect-proxy.ps1 on http://127.0.0.1:18081 (NTLM via DefaultNetworkCredentials).

$localCfg = Join-Path $PSScriptRoot "corp-proxy.local.ps1"
if (Test-Path $localCfg) { . $localCfg }

$script:CorpConnectProxyUrl = if ($env:TV_CORP_CONNECT_PROXY) { $env:TV_CORP_CONNECT_PROXY } else { "http://127.0.0.1:18081" }
$script:CorpHttpProxyUrl = $env:TV_CORP_HTTP_PROXY

function Set-CorpProxyEnv {
  $env:HTTP_PROXY = $script:CorpConnectProxyUrl
  $env:HTTPS_PROXY = $script:CorpConnectProxyUrl
  $env:ALL_PROXY = $script:CorpConnectProxyUrl
  # Internal hosts (e.g. Gitea) must bypass the CONNECT proxy — set via
  # TV_CORP_NO_PROXY / TV_GITEA_HOST in scripts/corp-proxy.local.ps1 (gitignored).
  # Tunneling them through the corp proxy often yields 502 / CONNECT aborted.
  $bypass = [System.Collections.Generic.List[string]]::new()
  foreach ($h in @("127.0.0.1", "localhost")) { $bypass.Add($h) }
  if ($env:TV_GITEA_HOST) { $bypass.Add($env:TV_GITEA_HOST.Trim()) }
  if ($env:TV_CORP_NO_PROXY) {
    foreach ($h in ($env:TV_CORP_NO_PROXY -split ",")) {
      $t = $h.Trim()
      if ($t) { $bypass.Add($t) }
    }
  }
  $env:NO_PROXY = ($bypass | Select-Object -Unique) -join ","
  $env:http_proxy = $env:HTTP_PROXY
  $env:https_proxy = $env:HTTPS_PROXY
  $env:all_proxy = $env:ALL_PROXY
  $env:no_proxy = $env:NO_PROXY
}

function Test-CorpConnectProxy {
  param([int]$Port = 18081)
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-CorpConnectProxyIfNeeded {
  param(
    [int]$Port = 18081,
    [int]$WaitSeconds = 15
  )
  if (Test-CorpConnectProxy -Port $Port) { return }
  $scriptPath = Join-Path $PSScriptRoot "git-connect-proxy.ps1"
  if (-not (Test-Path $scriptPath)) {
    throw "Missing $scriptPath - cannot start CONNECT proxy."
  }
  Write-Host "Starting CONNECT proxy on 127.0.0.1:$Port ..."
  Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath,
    "-ListenPort", $Port
  ) -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-CorpConnectProxy -Port $Port) { return }
    Start-Sleep -Milliseconds 400
  }
  throw "CONNECT proxy did not listen on port $Port within ${WaitSeconds}s."
}

function Invoke-WithCorpProxy {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Command,
    [switch]$StartProxy
  )
  if ($StartProxy) { Start-CorpConnectProxyIfNeeded }
  Set-CorpProxyEnv
  & $Command
}
