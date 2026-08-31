# TeamVault — Go one-liner installer (slim dir; no full git clone)
#
#   irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.ps1 | iex
#
# Optional:
#   $env:TEAMVAULT_DIR = "D:\teamvault"   # skips path prompt when set
#   $env:TEAMVAULT_REF = "v1.1.1"         # default: latest GitHub release, else main
#   $env:TEAMVAULT_PORT = "9090"          # optional pin; default = first free from 8080
#   $env:TEAMVAULT_SKIP_RUN = "1"
#   $env:TEAMVAULT_BUILD = "1"            # keep full source tree (dev; git clone)

$ErrorActionPreference = "Stop"

$RepoRef = if ($env:TEAMVAULT_REF) { $env:TEAMVAULT_REF } else { $null }
$ForceBuild = $env:TEAMVAULT_BUILD -eq "1"
$SkipRun = $env:TEAMVAULT_SKIP_RUN -eq "1"
$RepoUrl = if ($env:TEAMVAULT_REPO) { $env:TEAMVAULT_REPO } else { "https://github.com/TimUx/TeamVault.git" }
$GitHubRepo = if ($env:TEAMVAULT_GITHUB) { $env:TEAMVAULT_GITHUB } else { "TimUx/TeamVault" }
$DefaultDir = Join-Path $env:USERPROFILE "teamvault"

function Need-Cmd([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Fehlt: $Name — bitte installieren und erneut ausführen."
  }
}

function Prompt-InstallDir([string]$Default) {
  if ($env:TEAMVAULT_DIR) {
    return [IO.Path]::GetFullPath($env:TEAMVAULT_DIR)
  }
  Write-Host ""
  $reply = Read-Host "Installationspfad [$Default]"
  if ([string]::IsNullOrWhiteSpace($reply)) {
    $reply = $Default
  }
  $reply = $reply.Trim()
  if ($reply.StartsWith("~")) {
    $reply = Join-Path $env:USERPROFILE $reply.Substring(1).TrimStart("\", "/")
  }
  return [IO.Path]::GetFullPath($reply)
}

function Test-PortInUse([int]$Port) {
  try {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listeners) { return $true }
  } catch { }
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(200)
    if ($ok -and $client.Connected) {
      $client.Close()
      return $true
    }
    $client.Close()
  } catch { }
  return $false
}

function Find-FreePort([int]$Start) {
  for ($p = $Start; $p -lt ($Start + 100); $p++) {
    if (-not (Test-PortInUse $p)) { return $p }
  }
  throw "Kein freier Listen-Port im Bereich $Start–$($Start + 99)."
}

function Resolve-Port {
  if ($env:TEAMVAULT_PORT) {
    $forced = [int]$env:TEAMVAULT_PORT
    if (Test-PortInUse $forced) {
      throw "Port $forced ist belegt. Anderen Port setzen: `$env:TEAMVAULT_PORT=…"
    }
    return $forced
  }
  $preferred = 8080
  if (Test-Path ".env") {
    $line = Get-Content ".env" | Where-Object { $_ -match '^TEAMVAULT_PUBLISH_PORT=' } | Select-Object -First 1
    if ($line) {
      $existing = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
      if ($existing -match '^\d+$') {
        $n = [int]$existing
        if (-not (Test-PortInUse $n)) { return $n }
        $preferred = $n
      }
    }
  }
  $picked = Find-FreePort $preferred
  if ($picked -ne 8080) {
    Write-Host "==> Verwende freien Listen-Port $picked"
  }
  return $picked
}

function Set-EnvKey([string]$File, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $File) { $lines = Get-Content $File }
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match ("^" + [regex]::Escape($Key) + "=")) {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $out = @($out) + "$Key=$Value" }
  Set-Content -Encoding ascii -Path $File -Value $out
}

function Fetch-Raw([string]$Base, [string]$Rel, [string]$Out) {
  $url = "$Base/$Rel"
  Write-Host "    ← $Rel"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$Out.tmp"
  Move-Item -Force "$Out.tmp" $Out
}

function Resolve-SourceRef {
  if ($RepoRef) { return $RepoRef }
  try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$GitHubRepo/releases/latest"
    if ($rel.tag_name) { return $rel.tag_name }
  } catch { }
  return "main"
}

function Get-RawBase([string]$Ref) {
  if ($Ref -eq "main" -or $Ref -eq "master" -or $Ref -eq "develop") {
    return "https://raw.githubusercontent.com/$GitHubRepo/$Ref"
  }
  return "https://raw.githubusercontent.com/$GitHubRepo/$Ref"
}

function Get-ArchiveUrl([string]$Ref) {
  if ($Ref -eq "main" -or $Ref -eq "master" -or $Ref -eq "develop") {
    return "https://github.com/$GitHubRepo/archive/refs/heads/$Ref.tar.gz"
  }
  if ($Ref.StartsWith("v")) {
    return "https://github.com/$GitHubRepo/archive/refs/tags/$Ref.tar.gz"
  }
  return "https://github.com/$GitHubRepo/archive/refs/heads/$Ref.tar.gz"
}

function Get-ArchiveTopDir([string]$Ref) {
  if ($Ref.StartsWith("v")) {
    return "TeamVault-$($Ref.Substring(1))"
  }
  return "TeamVault-$Ref"
}

function Get-ReleaseAssetName {
  $arch = "amd64"
  if ($env:PROCESSOR_ARCHITECTURE -match "ARM") { $arch = "arm64" }
  return "teamvault-windows-$arch.exe"
}

function Get-ReleaseDownloadUrl([string]$Ref, [string]$Asset) {
  $tag = if ($Ref.StartsWith("v")) { $Ref } else { "v$Ref" }
  return "https://github.com/$GitHubRepo/releases/download/$tag/$Asset"
}

function Build-BinaryInDir([string]$Src, [string]$Out) {
  Write-Host "==> Baue Binary (Go) …"
  Push-Location $Src
  try {
    go mod download
    if ($LASTEXITCODE -ne 0) { throw "go mod download fehlgeschlagen" }
    go build -trimpath -o $Out ./cmd/teamvault
    if ($LASTEXITCODE -ne 0) { throw "go build fehlgeschlagen" }
  } finally {
    Pop-Location
  }
}

function Download-ReleaseBinary([string]$Ref, [string]$Dest) {
  $asset = Get-ReleaseAssetName
  $url = Get-ReleaseDownloadUrl $Ref $asset
  Write-Host "==> Lade Release-Binary ($Ref) …"
  Write-Host "    ← $asset"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$Dest.tmp"
    Move-Item -Force "$Dest.tmp" $Dest
    return $true
  } catch {
    Remove-Item -Force "$Dest.tmp" -ErrorAction SilentlyContinue
    return $false
  }
}

function Build-BinaryFromArchive([string]$Ref, [string]$Dest) {
  $url = Get-ArchiveUrl $Ref
  $top = Get-ArchiveTopDir $Ref
  $tmpdir = Join-Path ([IO.Path]::GetTempPath()) ("teamvault-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $tmpdir | Out-Null
  Write-Host "==> Lade Quell-Archiv ($Ref) — temporär, kein Repo-Clone …"
  Write-Host "    ← $($url.Split('/')[-1])"
  $tgz = Join-Path $tmpdir "src.tar.gz"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tgz
  tar -xzf $tgz -C $tmpdir
  $extracted = Join-Path $tmpdir $top
  if (-not (Test-Path $extracted)) {
    $extracted = (Get-ChildItem $tmpdir -Directory | Where-Object { $_.Name -ne (Split-Path $tgz -Leaf) } | Select-Object -First 1).FullName
  }
  if (-not (Test-Path (Join-Path $extracted "go.mod"))) {
    Remove-Item -Recurse -Force $tmpdir
    throw "Archiv unvollständig (go.mod fehlt)."
  }
  $tmpBin = Join-Path $tmpdir "teamvault.exe"
  Build-BinaryInDir $extracted $tmpBin
  New-Item -ItemType Directory -Force -Path (Split-Path $Dest -Parent) | Out-Null
  Move-Item -Force $tmpBin $Dest
  Remove-Item -Recurse -Force $tmpdir
}

function Ensure-SourceForBuild([string]$Ref, [string]$Dest) {
  Need-Cmd git
  if ((Test-Path "go.mod") -and (Test-Path "cmd/teamvault")) {
    if (Test-Path ".git") {
      Write-Host "==> Quellcode vorhanden — aktualisiere ($Ref) …"
      git fetch --depth 1 origin $Ref
      git checkout --force -B $Ref FETCH_HEAD
    }
    return
  }
  if ((Test-Path ".env") -or (Test-Path "secrets") -or (Test-Path "bin/teamvault.exe")) {
    throw "TEAMVAULT_BUILD=1 braucht leeres Verzeichnis oder bestehenden Quell-Checkout."
  }
  Write-Host "==> TEAMVAULT_BUILD=1 — klone Quellcode für Entwicklung …"
  $parent = Split-Path -Parent $Dest
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $tmp = Join-Path $parent ("teamvault-src-" + [guid]::NewGuid().ToString("n").Substring(0, 8))
  git clone --depth 1 --branch $Ref $RepoUrl $tmp
  Get-ChildItem -Force $tmp | ForEach-Object {
    Move-Item -Force $_.FullName (Join-Path $Dest $_.Name)
  }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

function Ensure-GoVersion {
  Need-Cmd go
  $goVerRaw = (go env GOVERSION)
  if (-not $goVerRaw) { $goVerRaw = (go version).Split(" ")[2] }
  $goVer = $goVerRaw -replace '^go', ''
  $parts = $goVer.Split('.')
  $major = [int]$parts[0]
  $minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
  if ($major -lt 1 -or ($major -eq 1 -and $minor -lt 23)) {
    throw "Go 1.23+ erforderlich (gefunden: $goVer). Install: https://go.dev/dl/"
  }
  return $goVer
}

function Ensure-Binary([string]$Ref, [string]$Dest) {
  $dir = Split-Path $Dest -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

  if ($ForceBuild) {
    Ensure-GoVersion | Out-Null
    Ensure-SourceForBuild $Ref (Get-Location).Path
    Build-BinaryInDir (Get-Location).Path $Dest
    return
  }

  if (Test-Path $Dest) {
    Write-Host "==> Binary vorhanden — belasse unverändert."
    return
  }

  if (Download-ReleaseBinary $Ref $Dest) { return }

  Write-Host "    (Kein Release-Binary — baue einmalig aus Quell-Archiv …)"
  Ensure-GoVersion | Out-Null
  Build-BinaryFromArchive $Ref $Dest
}

$SourceRef = Resolve-SourceRef
$RawBase = Get-RawBase $SourceRef
$goVer = $null
if (Get-Command go -ErrorAction SilentlyContinue) {
  try { $goVer = Ensure-GoVersion } catch { $goVer = $null }
}

Write-Host "==> TeamVault Go-Installation"
$Dest = Prompt-InstallDir $DefaultDir
Write-Host "    Ziel: $Dest (ohne vollständigen Repo-Clone)"
if ($goVer) {
  Write-Host "    Ref:  $SourceRef (Go $goVer)"
} else {
  Write-Host "    Ref:  $SourceRef"
}

if (-not (Test-Path $Dest)) {
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
}
Set-Location $Dest

if (-not $ForceBuild) {
  Write-Host "==> Lade Betriebsdateien ($RawBase) …"
  Fetch-Raw $RawBase ".env.example" ".env.example"
}

$Port = Resolve-Port
Write-Host "==> Listen-Port: $Port"

New-Item -ItemType Directory -Force -Path "data","secrets","bin" | Out-Null
$KeyRel = "secrets\teamvault_unlock"
$KeyFull = Join-Path (Get-Location) $KeyRel
if (-not (Test-Path $KeyFull)) {
  Write-Host "==> Erzeuge Unlock-Keyfile ($KeyRel) …"
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [IO.File]::WriteAllBytes($KeyFull, $bytes)
  Write-Host "    WICHTIG: Keyfile getrennt sichern — ohne Key keine Config."
} else {
  Write-Host "==> Unlock-Keyfile vorhanden — belasse unverändert."
}

if (-not (Test-Path ".env")) {
  Write-Host "==> Schreibe .env …"
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
  } else {
    @(
      "TEAMVAULT_PUBLISH_PORT=$Port"
      "TEAMVAULT_UNLOCK_KEY_HOST=./secrets/teamvault_unlock"
      "TEAMVAULT_ADDR=:${Port}"
      "TEAMVAULT_DATA_DIR=./data"
      "TEAMVAULT_MASTER_UNLOCK_KEY_FILE=./secrets/teamvault_unlock"
    ) | Set-Content -Encoding ascii ".env"
  }
}
Set-EnvKey ".env" "TEAMVAULT_PUBLISH_PORT" "$Port"
Set-EnvKey ".env" "TEAMVAULT_UNLOCK_KEY_HOST" "./secrets/teamvault_unlock"
Set-EnvKey ".env" "TEAMVAULT_ADDR" ":${Port}"
Set-EnvKey ".env" "TEAMVAULT_DATA_DIR" "./data"
Set-EnvKey ".env" "TEAMVAULT_MASTER_UNLOCK_KEY_FILE" "./secrets/teamvault_unlock"

$Bin = Join-Path "bin" "teamvault.exe"
Ensure-Binary $SourceRef (Join-Path (Get-Location) $Bin)

Write-Host ""
Write-Host "Vorbereitung fertig."
Write-Host "  Binary:     $(Join-Path $Dest $Bin)"
Write-Host "  Unlock-Key: $KeyFull"
Write-Host "  Data-Dir:   $(Join-Path $Dest 'data')"
Write-Host "  Env:        $(Join-Path $Dest '.env')"
Write-Host ""

if ($SkipRun) {
  Write-Host "Start manuell:"
  Write-Host "  cd `"$Dest`""
  Write-Host "  # .env laden und .\bin\teamvault.exe starten — siehe docs/install-guide.md"
  return
}

Write-Host "==> Starte TeamVault auf :${Port} …"
Write-Host "    Browser: http://127.0.0.1:${Port}/setup"
Write-Host "    Stoppen: Ctrl+C"
Write-Host ""

Get-Content ".env" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $k, $v = $_.Split('=', 2)
  Set-Item -Path "Env:$k" -Value $v
}
& $Bin
