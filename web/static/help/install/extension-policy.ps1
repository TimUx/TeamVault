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
  foreach ($browser in @(
    @("$hive\Software\Policies\Google\Chrome", "Chrome"),
    @("$hive\Software\Policies\Microsoft\Edge", "Edge")
  )) {
    New-Item -Path $browser[0] -Force | Out-Null
    Set-ItemProperty -Path $browser[0] -Name "ExtensionSettings" -Value $pJson -Type String
    Set-ItemProperty -Path $browser[0] -Name "ExtensionInstallSources" -Value $sJson -Type String
    Write-Host "  $($browser[1]): $($browser[0])"
  }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
  Apply-Policy "HKLM:"
  Write-Host "Richtlinie für alle Benutzer (HKLM) gesetzt." -ForegroundColor Green
} else {
  Apply-Policy "HKCU:"
  Write-Host "Richtlinie nur für Sie (HKCU). Für alle Nutzer: als Administrator ausführen." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Extension-ID: $extId"
Write-Host "Nutzer: $Base/help/extension → „Extension installieren“"
