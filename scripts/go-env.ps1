# Dot-source or run before go mod / go test in this repo.
# Requires: .\scripts\goproxy-corp.ps1 running in another terminal.
$env:Path = "C:\Program Files\Go\bin;" + $env:Path
$env:GOPROXY = "http://127.0.0.1:18080"
$env:GOSUMDB = "off"
Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:http_proxy, Env:https_proxy -ErrorAction SilentlyContinue
Write-Host "GOPROXY=$env:GOPROXY  GOSUMDB=$env:GOSUMDB"
