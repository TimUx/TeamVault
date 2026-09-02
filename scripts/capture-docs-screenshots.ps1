# Regenerates docs/images/*.png (Windows, ohne Docker).
# Voraussetzung: Go 1.23+, Node.js + npm (scripts/package.json / Playwright).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:TV_CAPTURE_PORT) { $env:TV_CAPTURE_PORT } else { "8099" }
$Data = if ($env:TV_CAPTURE_DATA) { $env:TV_CAPTURE_DATA } else { Join-Path $env:TEMP "tv-screenshot-data" }
$Secrets = Join-Path $Data "secrets"
if (-not $env:TV_CAPTURE_DATA -and (Test-Path $Data)) {
  Remove-Item -Recurse -Force $Data
}
New-Item -ItemType Directory -Force -Path $Data, $Secrets | Out-Null
if (-not (Test-Path (Join-Path $Secrets "unlock"))) {
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [IO.File]::WriteAllBytes((Join-Path $Secrets "unlock"), $bytes)
}

$node = $env:TV_NODE
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node -and (Test-Path "C:\Program Files\nodejs\node.exe")) { $node = "C:\Program Files\nodejs\node.exe" }
if (-not $node) { throw "Node.js nicht gefunden. Bitte Node installieren oder TV_NODE setzen." }

$env:TEAMVAULT_ADDR = ":$Port"
$env:TEAMVAULT_DATA_DIR = $Data
$env:TEAMVAULT_MASTER_UNLOCK_KEY_FILE = Join-Path $Secrets "unlock"

Write-Host "Packing client artifacts for screenshots..."
go run ./cmd/pack-extension
& "$PSScriptRoot\build-tvcli.ps1"
$env:TEAMVAULT_BUNDLED_DOWNLOADS = Join-Path $Root "dist"

$serverBin = Join-Path $env:LOCALAPPDATA "teamvault-screenshot-server.exe"
if (Test-Path $serverBin) { Remove-Item -Force $serverBin }
Write-Host "Building server binary for fresh go:embed…"
go build -a -trimpath -o $serverBin ./cmd/teamvault
if ($LASTEXITCODE -ne 0) { throw "go build failed" }

$server = Start-Process -FilePath $serverBin `
  -WorkingDirectory $Root -PassThru -WindowStyle Hidden
try {
  $deadline = (Get-Date).AddMinutes(2)
  do {
    Start-Sleep -Seconds 2
    try {
      $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
      break
    } catch { if ((Get-Date) -gt $deadline) { throw "TeamVault did not start on :$Port" } }
  } while ($true)

  $nm = Join-Path $Root "scripts\node_modules"
  if (-not (Test-Path (Join-Path $nm "playwright"))) {
    . (Join-Path $PSScriptRoot "corp-proxy-env.ps1")
    Start-CorpConnectProxyIfNeeded
    Set-CorpProxyEnv
    npm install --prefix (Join-Path $Root "scripts") --no-fund --no-audit
    npx --prefix (Join-Path $Root "scripts") playwright install chromium
  }

  $env:TV_URL = "http://127.0.0.1:$Port"
  $env:TV_CAPTURE_DATA = $Data
  if (-not $env:TV_BROWSER_CHANNEL -and -not $env:TV_BROWSER_EXECUTABLE) {
    # Default: Playwright Chromium (Edge headless often attaches to an existing session on Windows).
    $pwChromium = Join-Path $env:LOCALAPPDATA "ms-playwright\chromium-*\chrome-win64\chrome.exe"
    $pwMatch = Get-Item $pwChromium -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pwMatch) {
      $env:TV_BROWSER_CHANNEL = "msedge"
    }
  }
  & $node (Join-Path $Root "scripts\capture-docs-screenshots.mjs")
  Write-Host "Screenshots written to docs/images/"
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
