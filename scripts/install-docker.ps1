# TeamVault — Docker one-liner installer (Compose + GHCR only; no full git clone)
#
#   irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.ps1 | iex
#
# Optional:
#   $env:TEAMVAULT_DIR = "D:\teamvault"   # skips path prompt when set
#   $env:TEAMVAULT_REF = "main"
#   $env:TEAMVAULT_PORT = "9090"   # optional pin; default = first free from 8080
#   $env:TEAMVAULT_BUILD = "1"     # local build (clones full repo)

$ErrorActionPreference = "Stop"

$RepoRef = if ($env:TEAMVAULT_REF) { $env:TEAMVAULT_REF } else { "main" }
$ForceBuild = $env:TEAMVAULT_BUILD -eq "1"
$RawBase = if ($env:TEAMVAULT_RAW_BASE) { $env:TEAMVAULT_RAW_BASE } else { "https://raw.githubusercontent.com/TimUx/TeamVault/$RepoRef" }
$RepoUrl = if ($env:TEAMVAULT_REPO) { $env:TEAMVAULT_REPO } else { "https://github.com/TimUx/TeamVault.git" }
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
  throw "Kein freier Host-Port im Bereich $Start–$($Start + 99)."
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
    Write-Host "==> Verwende freien Host-Port $picked"
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

function Fetch-Raw([string]$Rel, [string]$Out) {
  $url = "$RawBase/$Rel"
  Write-Host "    ← $Rel"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$Out.tmp"
  Move-Item -Force "$Out.tmp" $Out
}

function Ensure-SourceForBuild {
  Need-Cmd git
  if ((Test-Path "Dockerfile") -and (Test-Path "docker-compose.build.yml")) {
    if (Test-Path ".git") {
      Write-Host "==> Quellcode vorhanden — aktualisiere ($RepoRef) …"
      git fetch --depth 1 origin $RepoRef
      git checkout --force -B $RepoRef FETCH_HEAD
    }
    return
  }
  if ((Test-Path "docker-compose.yml") -or (Test-Path ".env") -or (Test-Path "secrets")) {
    throw @"
TEAMVAULT_BUILD=1 braucht den Quellcode (Dockerfile).
Dieses Verzeichnis ist eine Slim-Installation (nur Compose).
Anderes TEAMVAULT_DIR wählen oder Repo klonen und dort TEAMVAULT_BUILD=1 setzen.
"@
  }
  Write-Host "==> TEAMVAULT_BUILD=1 — klone Quellcode für lokalen Image-Build …"
  $parent = Split-Path -Parent $Dest
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $tmp = Join-Path $parent ("teamvault-src-" + [guid]::NewGuid().ToString("n").Substring(0, 8))
  git clone --depth 1 --branch $RepoRef $RepoUrl $tmp
  Get-ChildItem -Force $tmp | ForEach-Object {
    Move-Item -Force $_.FullName (Join-Path $Dest $_.Name)
  }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Need-Cmd docker
docker compose version | Out-Null

Write-Host "==> TeamVault Docker-Installation"
$Dest = Prompt-InstallDir $DefaultDir
Write-Host "    Ziel: $Dest (ohne vollständigen Repo-Clone)"
Write-Host "    Ref:  $RepoRef"

if (-not (Test-Path $Dest)) {
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
}
Set-Location $Dest

if ($ForceBuild) {
  Ensure-SourceForBuild
} else {
  Write-Host "==> Lade Docker-Dateien ($RawBase) …"
  Fetch-Raw "docker-compose.yml" "docker-compose.yml"
  Fetch-Raw ".env.example" ".env.example"
}

$Port = Resolve-Port
Write-Host "==> Host-Port: $Port"

$KeyRel = "secrets\teamvault_unlock"
$KeyFull = Join-Path (Get-Location) $KeyRel
if (-not (Test-Path $KeyFull)) {
  Write-Host "==> Erzeuge Unlock-Keyfile ($KeyRel) …"
  New-Item -ItemType Directory -Force -Path "secrets" | Out-Null
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
      "TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest"
      "TEAMVAULT_PULL_POLICY=always"
    ) | Set-Content -Encoding ascii ".env"
  }
}
Set-EnvKey ".env" "TEAMVAULT_PUBLISH_PORT" "$Port"
Set-EnvKey ".env" "TEAMVAULT_UNLOCK_KEY_HOST" "./secrets/teamvault_unlock"

Write-Host "==> Starte Container …"
$composeArgs = @("-f", "docker-compose.yml")
if ($ForceBuild) {
  Write-Host "==> TEAMVAULT_BUILD=1 — lokaler Build via docker-compose.build.yml"
  Set-EnvKey ".env" "TEAMVAULT_IMAGE" "teamvault:local"
  $composeArgs += @("-f", "docker-compose.build.yml")
  & docker compose @composeArgs up -d --build
  if ($LASTEXITCODE -ne 0) { throw "docker compose build/up fehlgeschlagen" }
} else {
  Set-EnvKey ".env" "TEAMVAULT_IMAGE" "ghcr.io/timux/teamvault:latest"
  & docker compose @composeArgs pull
  if ($LASTEXITCODE -ne 0) {
    throw "GHCR-Pull fehlgeschlagen. docker login ghcr.io prüfen oder TEAMVAULT_BUILD=1 für lokalen Build."
  }
  & docker compose @composeArgs up -d
  if ($LASTEXITCODE -ne 0) { throw "docker compose up fehlgeschlagen" }
}

Write-Host ""
Write-Host "Fertig. Browser öffnen:"
Write-Host "  http://127.0.0.1:${Port}/setup"
Write-Host ""
Write-Host "Unlock-Key: $KeyFull"
Write-Host "Konfig:     $(Join-Path $Dest '.env')"
Write-Host "Compose:    $(Join-Path $Dest 'docker-compose.yml')"
Write-Host "Stoppen:    cd `"$Dest`"; docker compose down"
Write-Host "Update:     gleichen One-Liner erneut ausführen"
Write-Host "Doku:       https://github.com/TimUx/TeamVault/blob/main/docs/install-guide.md"
