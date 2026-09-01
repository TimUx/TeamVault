# TeamVault extension — user installer
#   $env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension-user.ps1" | iex

$ErrorActionPreference = "Stop"
$Base = ($env:TEAMVAULT_URL).TrimEnd("/")
if (-not $Base) { $Base = (Read-Host "TeamVault-URL").TrimEnd("/") }

$meta = Invoke-RestMethod -Uri "$Base/api/client-downloads" -UseBasicParsing
$updateUrl = "$Base$($meta.extension.update_url)"
$policy = @{ $meta.extension.id = @{ installation_mode = "normal_installed"; update_url = $updateUrl } }
$pJson = ($policy | ConvertTo-Json -Compress -Depth 5)
$sJson = (@("$Base/*") | ConvertTo-Json -Compress)
foreach ($root in @(
  "HKCU:\Software\Policies\Google\Chrome",
  "HKCU:\Software\Policies\Microsoft\Edge"
)) {
  New-Item -Path $root -Force | Out-Null
  Set-ItemProperty -Path $root -Name "ExtensionSettings" -Value $pJson -Type String
  Set-ItemProperty -Path $root -Name "ExtensionInstallSources" -Value $sJson -Type String
}
Write-Host "Browser-Richtlinie für Ihren Benutzer gesetzt."
Start-Process "$Base/help/extension#install"
