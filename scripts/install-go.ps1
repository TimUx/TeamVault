# TeamVault — Go one-liner installer (Windows PowerShell, local process)
#
#   irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.ps1 | iex
#
# Optional:
#   $env:TEAMVAULT_DIR = "$env:USERPROFILE\teamvault"
#   $env:TEAMVAULT_PORT = "8080"
#   $env:TEAMVAULT_SKIP_RUN = "1"

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:TEAMVAULT_REPO) { $env:TEAMVAULT_REPO } else { "https://github.com/TimUx/TeamVault.git" }
$RepoRef = if ($env:TEAMVAULT_REF) { $env:TEAMVAULT_REF } else { "main" }
$Dest = if ($env:TEAMVAULT_DIR) { $env:TEAMVAULT_DIR } else { Join-Path $env:USERPROFILE "teamvault" }
$Port = if ($env:TEAMVAULT_PORT) { $env:TEAMVAULT_PORT } else { "8080" }
$SkipRun = $env:TEAMVAULT_SKIP_RUN -eq "1"

function Need-Cmd([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Fehlt: $Name — bitte installieren und erneut ausführen."
  }
}

Need-Cmd git
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

Write-Host "==> TeamVault Go-Installation"
Write-Host "    Ziel: $Dest (Go $goVer)"

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

@(
  "TEAMVAULT_PUBLISH_PORT=$Port"
  "TEAMVAULT_UNLOCK_KEY_HOST=./secrets/teamvault_unlock"
  "TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest"
  "TEAMVAULT_ADDR=:${Port}"
  "TEAMVAULT_DATA_DIR=./data"
  "TEAMVAULT_MASTER_UNLOCK_KEY_FILE=./secrets/teamvault_unlock"
) | Set-Content -Encoding ascii ".env"

Write-Host "==> Lade Go-Module …"
go mod download
if ($LASTEXITCODE -ne 0) { throw "go mod download fehlgeschlagen" }

$Bin = Join-Path "bin" "teamvault.exe"
Write-Host "==> Baue $Bin …"
go build -trimpath -o $Bin ./cmd/teamvault
if ($LASTEXITCODE -ne 0) { throw "go build fehlgeschlagen" }

Write-Host ""
Write-Host "Vorbereitung fertig."
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
