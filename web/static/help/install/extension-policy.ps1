# TeamVault extension — IT policy (Chrome / Edge)
# Usage (elevated empfohlen):
#   $env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension-policy.ps1" | iex

$ErrorActionPreference = "Stop"
$Base = ($env:TEAMVAULT_URL).TrimEnd("/")
if (-not $Base) { $Base = (Read-Host "TeamVault-URL").TrimEnd("/") }

$meta = Invoke-RestMethod -Uri "$Base/api/client-downloads" -UseBasicParsing
$extId = $meta.extension.id
if (-not $extId) { throw "Extension nicht bereitgestellt — Image/Server aktualisieren." }

$updateUrl = "$Base$($meta.extension.update_url)"
$policy = @{ $extId = @{ installation_mode = "normal_installed"; update_url = $updateUrl } }
$sources = @("$Base/*")
$pJson = ($policy | ConvertTo-Json -Compress -Depth 5)
$sJson = ($sources | ConvertTo-Json -Compress)

function Apply-Policy($hive) {
  $any = $false
  foreach ($browser in @(
    @("$hive\Software\Policies\Google\Chrome", "Chrome"),
    @("$hive\Software\Policies\Microsoft\Edge", "Edge")
  )) {
    try {
      if (-not (Test-Path -LiteralPath $browser[0])) {
        New-Item -Path $browser[0] -Force | Out-Null
      }
      Set-ItemProperty -Path $browser[0] -Name "ExtensionSettings" -Value $pJson -Type String
      Set-ItemProperty -Path $browser[0] -Name "ExtensionInstallSources" -Value $sJson -Type String
      Write-Host "  OK: $($browser[1]) $($browser[0])" -ForegroundColor Green
      $any = $true
    } catch {
      Write-Host "  Fehler $($browser[1]): $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
  return $any
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host "TeamVault Extension — IT-Richtlinie" -ForegroundColor Cyan
Write-Host "Extension-ID: $extId"
Write-Host ""

if ($admin) {
  if (Apply-Policy "HKLM:") {
    Write-Host ""
    Write-Host "Richtlinie für alle Benutzer (HKLM) gesetzt." -ForegroundColor Green
  } else {
    throw "Keine Richtlinie konnte geschrieben werden."
  }
} else {
  Write-Host "Nicht als Administrator — versuche nur HKCU …" -ForegroundColor Yellow
  if (-not (Apply-Policy "HKCU:")) {
    throw "Schreiben fehlgeschlagen. PowerShell als Administrator ausführen."
  }
  Write-Host ""
  Write-Host "Nur für den aktuellen Benutzer (HKCU). Für alle PCs: als Administrator wiederholen." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Nutzer: Browser neu starten, dann $Base/help/extension → Extension installieren"
