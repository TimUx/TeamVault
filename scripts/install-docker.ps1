# TeamVault — Docker one-liner installer (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.ps1 | iex
#
# Optional:
#   $env:TEAMVAULT_DIR = "$env:USERPROFILE\teamvault"
#   $env:TEAMVAULT_PORT = "8080"
#   $env:TEAMVAULT_BUILD = "1"   # lokal bauen statt GHCR

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:TEAMVAULT_REPO) { $env:TEAMVAULT_REPO } else { "https://github.com/TimUx/TeamVault.git" }
$RepoRef = if ($env:TEAMVAULT_REF) { $env:TEAMVAULT_REF } else { "main" }
$Dest = if ($env:TEAMVAULT_DIR) { $env:TEAMVAULT_DIR } else { Join-Path $env:USERPROFILE "teamvault" }
$Port = if ($env:TEAMVAULT_PORT) { $env:TEAMVAULT_PORT } else { "8080" }
$ForceBuild = $env:TEAMVAULT_BUILD -eq "1"

function Need-Cmd([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Fehlt: $Name — bitte installieren und erneut ausführen."
  }
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

Need-Cmd git
Need-Cmd docker
docker compose version | Out-Null

Write-Host "==> TeamVault Docker-Installation"
Write-Host "    Ziel: $Dest"

if (Test-Path (Join-Path $Dest ".git")) {
  Write-Host "==> Repo vorhanden — aktualisiere ($RepoRef) …"
  git -C $Dest fetch --depth 1 origin $RepoRef
  git -C $Dest checkout --force -B $RepoRef FETCH_HEAD
} else {
  Write-Host "==> Clone $RepoUrl ($RepoRef) …"
  $parent = Split-Path -Parent $Dest
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  git clone --depth 1 --branch $RepoRef $RepoUrl $Dest
}

Set-Location $Dest

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
    ) | Set-Content -Encoding ascii ".env"
  }
}
Set-EnvKey ".env" "TEAMVAULT_PUBLISH_PORT" $Port
Set-EnvKey ".env" "TEAMVAULT_UNLOCK_KEY_HOST" "./secrets/teamvault_unlock"

Write-Host "==> Starte Container (GHCR-Image) …"
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
Write-Host "Stoppen:    cd `"$Dest`"; docker compose down"
Write-Host "Doku:       https://github.com/TimUx/TeamVault/blob/main/docs/install-guide.md"
