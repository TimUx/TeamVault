# Download Go toolchain via Windows DefaultNetworkCredentials (corp proxy) and
# publish it to the Gitea Generic Package Registry for runners/air-gap installs.
#
# Usage:
#   .\scripts\publish-go-toolchain.ps1
#   .\scripts\publish-go-toolchain.ps1 -Version 1.23.3
#
# Download URL on Gitea afterwards:
#   https://git.example.internal/git/api/packages/CC-3.3/generic/go-toolchain/<ver>/go<ver>.linux-amd64.tar.gz

param(
    [string]$Version = "1.23.3",
    [string]$GiteaBase = "https://git.example.internal/git",
    [string]$Owner = "CC-3.3",
    [string]$Package = "go-toolchain",
    [string]$CorpProxy = "http://proxy.example.internal:8080",
    [string]$OutDir = "$env:TEMP\teamvault-go-toolchain"
)

$ErrorActionPreference = "Stop"
$fileName = "go${Version}.linux-amd64.tar.gz"
$sources = @(
    "https://go.dev/dl/$fileName",
    "https://dl.google.com/go/$fileName"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$dest = Join-Path $OutDir $fileName

Add-Type -TypeDefinition @"
using System;
using System.Net;
public static class CorpDl {
  public static void File(string url, string path, string proxy) {
    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    var wc = new WebClient();
    wc.Proxy = new WebProxy(proxy);
    wc.Proxy.Credentials = CredentialCache.DefaultNetworkCredentials;
    wc.DownloadFile(url, path);
  }
}
"@

if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1MB) {
    $ok = $false
    foreach ($url in $sources) {
        try {
            Write-Host "Downloading $url ..."
            [CorpDl]::File($url, $dest, $CorpProxy)
            $ok = $true
            break
        } catch {
            Write-Warning "Failed: $($_.Exception.Message)"
        }
    }
    if (-not $ok) { throw "Could not download $fileName via corp proxy" }
}

Write-Host ("Downloaded {0:N1} MB" -f ((Get-Item $dest).Length / 1MB))

$credOut = ("protocol=https`nhost=git.example.internal`npath=git/CC-3.3/TeamVault.git`n" | git credential fill 2>$null)
$user = ($credOut | Where-Object { $_ -match '^username=' }) -replace '^username=', ''
$pass = ($credOut | Where-Object { $_ -match '^password=' }) -replace '^password=', ''
if (-not $user -or -not $pass) { throw "No git credentials for Gitea" }

$uploadUrl = "$GiteaBase/api/packages/$Owner/generic/$Package/$Version/$fileName"
Write-Host "Uploading to $uploadUrl ..."
$pair = "{0}:{1}" -f $user, $pass
$bytes = [Text.Encoding]::ASCII.GetBytes($pair)
$basic = [Convert]::ToBase64String($bytes)
Invoke-RestMethod -Method Put -Uri $uploadUrl -Headers @{ Authorization = "Basic $basic" } -InFile $dest -ContentType "application/octet-stream" | Out-Null
Write-Host "Published: $uploadUrl"
