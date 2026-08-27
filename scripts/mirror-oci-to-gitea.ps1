# Mirror public container images into the Gitea registry using Windows
# DefaultNetworkCredentials against the corporate HTTP proxy (no Docker Desktop).
#
# Usage:
#   .\scripts\mirror-oci-to-gitea.ps1
#   .\scripts\mirror-oci-to-gitea.ps1 -Only golang
#
# Requires: crane.exe (downloaded automatically if missing)

param(
    [ValidateSet("all", "golang", "distroless", "trivy")]
    [string]$Only = "all",
    [string]$CorpProxy = "http://proxy.example.internal:8080",
    [string]$GiteaRegistry = "git.example.internal",
    [string]$Owner = "cc-3.3",
    [string]$WorkRoot = "$env:TEMP\teamvault-oci-mirror",
    [string]$CraneDir = "$env:TEMP\crane-bin"
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Net;
using System.Text;

public static class CorpHttp {
  static CorpHttp() {
    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
    ServicePointManager.DefaultConnectionLimit = 16;
  }

  static WebClient Client(string proxy) {
    var wc = new WebClient();
    wc.Proxy = new WebProxy(proxy);
    wc.Proxy.Credentials = CredentialCache.DefaultNetworkCredentials;
    wc.Encoding = Encoding.UTF8;
    return wc;
  }

  public static byte[] GetBytes(string url, string proxy, string authHeader, string accept) {
    using (var wc = Client(proxy)) {
      if (!string.IsNullOrEmpty(authHeader)) wc.Headers[HttpRequestHeader.Authorization] = authHeader;
      if (!string.IsNullOrEmpty(accept)) wc.Headers[HttpRequestHeader.Accept] = accept;
      return wc.DownloadData(url);
    }
  }

  public static string GetString(string url, string proxy, string authHeader, string accept) {
    return Encoding.UTF8.GetString(GetBytes(url, proxy, authHeader, accept));
  }

  public static void GetFile(string url, string path, string proxy, string authHeader, string accept) {
    Directory.CreateDirectory(Path.GetDirectoryName(path));
    using (var wc = Client(proxy)) {
      if (!string.IsNullOrEmpty(authHeader)) wc.Headers[HttpRequestHeader.Authorization] = authHeader;
      if (!string.IsNullOrEmpty(accept)) wc.Headers[HttpRequestHeader.Accept] = accept;
      wc.DownloadFile(url, path);
    }
  }
}
"@

function Ensure-Crane {
    $crane = Join-Path $CraneDir "crane.exe"
    if (Test-Path $crane) { return $crane }
    New-Item -ItemType Directory -Force -Path $CraneDir | Out-Null
    $zip = Join-Path $env:TEMP "crane_windows_amd64.tar.gz"
    Write-Host "Downloading crane..."
    [CorpHttp]::GetFile(
        "https://github.com/google/go-containerregistry/releases/download/v0.20.2/go-containerregistry_Windows_x86_64.tar.gz",
        $zip, $CorpProxy, $null, $null)
    tar -xzf $zip -C $CraneDir
    if (-not (Test-Path $crane)) { throw "crane.exe missing after extract" }
    return $crane
}

function Get-GitCred {
    $credOut = ("protocol=https`nhost=git.example.internal`npath=git/CC-3.3/TeamVault.git`n" | git credential fill 2>$null)
    $u = ($credOut | Where-Object { $_ -match '^username=' }) -replace '^username=', ''
    $p = ($credOut | Where-Object { $_ -match '^password=' }) -replace '^password=', ''
    if (-not $u -or -not $p) { throw "No git credentials for Gitea" }
    return @{ User = $u; Pass = $p }
}

function Get-DockerHubToken([string]$repo) {
    $url = "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull"
    $json = [CorpHttp]::GetString($url, $CorpProxy, $null, $null) | ConvertFrom-Json
    return $json.token
}

function Get-GcrToken([string]$repo) {
    # Public distroless images allow anonymous pull via token endpoint
    $url = "https://gcr.io/v2/token?service=gcr.io&scope=repository:${repo}:pull"
    try {
        $json = [CorpHttp]::GetString($url, $CorpProxy, $null, $null) | ConvertFrom-Json
        return $json.token
    } catch {
        return $null
    }
}

function Save-Blob([string]$registryBase, [string]$repo, [string]$digest, [string]$auth, [string]$blobDir) {
    $hex = $digest -replace '^sha256:', ''
    $dest = Join-Path $blobDir $hex
    if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) {
        Write-Host "  blob cached $digest"
        return
    }
    $url = "$registryBase/v2/$repo/blobs/$digest"
    Write-Host "  blob $digest"
    [CorpHttp]::GetFile($url, $dest, $CorpProxy, $auth, $null)
}

function Export-ImageToOci {
    param(
        [string]$Name,
        [string]$RegistryBase,   # https://registry-1.docker.io
        [string]$Repo,           # library/golang
        [string]$Reference,      # 1.23.3-bookworm
        [string]$Token,
        [string]$OutDir
    )

    if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
    $blobDir = Join-Path $OutDir "blobs\sha256"
    New-Item -ItemType Directory -Force -Path $blobDir | Out-Null

    $auth = if ($Token) { "Bearer $Token" } else { $null }
    $acceptList = "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"
    $manifestUrl = "$RegistryBase/v2/$Repo/manifests/$Reference"
    Write-Host "=== $Name : fetch manifest $Repo`:$Reference ==="
    $raw = [CorpHttp]::GetBytes($manifestUrl, $CorpProxy, $auth, $acceptList)
    $text = [Text.Encoding]::UTF8.GetString($raw)
    $man = $text | ConvertFrom-Json

    # Resolve platform-specific manifest if index/list
    if ($man.mediaType -match 'manifest.list|image.index' -or $man.manifests) {
        $chosen = $man.manifests | Where-Object {
            $_.platform.os -eq 'linux' -and ($_.platform.architecture -eq 'amd64' -or $_.platform.architecture -eq 'x86_64')
        } | Select-Object -First 1
        if (-not $chosen) { throw "No linux/amd64 manifest in index for $Repo`:$Reference" }
        $digest = $chosen.digest
        Write-Host "  index -> $digest ($($chosen.platform.os)/$($chosen.platform.architecture))"
        $raw = [CorpHttp]::GetBytes("$RegistryBase/v2/$Repo/manifests/$digest", $CorpProxy, $auth, "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json")
        $text = [Text.Encoding]::UTF8.GetString($raw)
        $man = $text | ConvertFrom-Json
        $manifestDigest = $digest
    } else {
        # Compute digest of manifest bytes
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hash = $sha.ComputeHash($raw)
        $manifestDigest = "sha256:" + ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    }

    # Save manifest blob
    $manHex = $manifestDigest -replace '^sha256:', ''
    [IO.File]::WriteAllBytes((Join-Path $blobDir $manHex), $raw)

    # Config + layers
    $cfgDigest = $man.config.digest
    Save-Blob $RegistryBase $Repo $cfgDigest $auth $blobDir
    foreach ($layer in $man.layers) {
        Save-Blob $RegistryBase $Repo $layer.digest $auth $blobDir
    }

    # OCI layout files
    '{"imageLayoutVersion":"1.0.0"}' | Set-Content -Path (Join-Path $OutDir "oci-layout") -Encoding ASCII -NoNewline

    $manifestDesc = @{
        mediaType = $(if ($man.mediaType) { $man.mediaType } else { "application/vnd.docker.distribution.manifest.v2+json" })
        digest    = $manifestDigest
        size      = $raw.Length
    }
    $index = @{
        schemaVersion = 2
        mediaType     = "application/vnd.oci.image.index.v1+json"
        manifests     = @($manifestDesc)
    } | ConvertTo-Json -Compress -Depth 8
    [IO.File]::WriteAllText((Join-Path $OutDir "index.json"), $index)

    Write-Host "  OCI layout ready: $OutDir"
    return $OutDir
}

function Push-Oci([string]$crane, [string]$layoutDir, [string]$dest, [hashtable]$cred) {
    Write-Host "=== push $dest ==="
    $env:DOCKER_CONFIG = Join-Path $WorkRoot "docker-config"
    New-Item -ItemType Directory -Force -Path $env:DOCKER_CONFIG | Out-Null
    # Login to Gitea (direct — in NO_PROXY / internal)
    & $crane auth login $GiteaRegistry -u $cred.User -p $cred.Pass
    if ($LASTEXITCODE -ne 0) { throw "crane auth login failed" }
    # Clear proxy for push to internal registry
    $oldHttp = $env:HTTP_PROXY; $oldHttps = $env:HTTPS_PROXY
    $env:HTTP_PROXY = $null; $env:HTTPS_PROXY = $null; $env:http_proxy = $null; $env:https_proxy = $null
    try {
        & $crane push $layoutDir $dest
        if ($LASTEXITCODE -ne 0) { throw "crane push failed for $dest" }
    } finally {
        $env:HTTP_PROXY = $oldHttp; $env:HTTPS_PROXY = $oldHttps
    }
    Write-Host "OK $dest"
}

# ---- main ----
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
$crane = Ensure-Crane
$cred = Get-GitCred

$jobs = @()
if ($Only -eq "all" -or $Only -eq "golang") {
    $jobs += @{
        Name = "golang"
        RegistryBase = "https://registry-1.docker.io"
        Repo = "library/golang"
        Reference = "1.23.3-bookworm"
        Dest = "$GiteaRegistry/$Owner/golang:1.23.3-bookworm"
        TokenFn = { Get-DockerHubToken "library/golang" }
    }
}
if ($Only -eq "all" -or $Only -eq "distroless") {
    $jobs += @{
        Name = "distroless"
        RegistryBase = "https://gcr.io"
        Repo = "distroless/static-debian12"
        Reference = "nonroot"
        Dest = "$GiteaRegistry/$Owner/distroless-static:nonroot"
        TokenFn = { Get-GcrToken "distroless/static-debian12" }
    }
}
if ($Only -eq "all" -or $Only -eq "trivy") {
    $jobs += @{
        Name = "trivy"
        RegistryBase = "https://registry-1.docker.io"
        Repo = "aquasec/trivy"
        Reference = "latest"
        Dest = "$GiteaRegistry/$Owner/trivy:latest"
        TokenFn = { Get-DockerHubToken "aquasec/trivy" }
    }
}

foreach ($j in $jobs) {
    $token = & $j.TokenFn
    $layout = Join-Path $WorkRoot $j.Name
    Export-ImageToOci -Name $j.Name -RegistryBase $j.RegistryBase -Repo $j.Repo `
        -Reference $j.Reference -Token $token -OutDir $layout | Out-Null
    Push-Oci $crane $layout $j.Dest $cred
}

Write-Host ""
Write-Host "All mirrors done. Runner can pull:"
foreach ($j in $jobs) { Write-Host "  docker pull $($j.Dest)" }
