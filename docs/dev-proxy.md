# Go-Module hinter Firmenproxy

Go sendet **keine** Windows-Proxy-Credentials. Direktes `HTTP_PROXY=…:8080` schlägt daher mit `authenticationrequired` fehl.

## Lösung: lokaler Modul-Proxy

Terminal 1 — einmal starten (nutzt DefaultNetworkCredentials gegen den Firmenproxy):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\goproxy-corp.ps1
```

Default: lauscht auf `http://127.0.0.1:18080`, Upstream `https://proxy.golang.org` via `http://proxy.example.internal:8080`.

Terminal 2 — Go darüber laufen lassen:

```powershell
$env:Path = "C:\Program Files\Go\bin;" + $env:Path
$env:GOPROXY = "http://127.0.0.1:18080"
$env:GOSUMDB = "off"   # falls sum.golang.org ebenfalls blockiert
Set-Location H:\Documents\git\TeamVault
go mod tidy
go test ./...
```

Optional dauerhaft (User-Scope):

```powershell
go env -w GOPROXY=http://127.0.0.1:18080
go env -w GOSUMDB=off
```

(Dann muss `goproxy-corp.ps1` laufen, bevor Module geladen werden.)
