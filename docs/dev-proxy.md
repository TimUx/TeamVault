# Entwicklung hinter Firmenproxy (NTLM)

Direktes `HTTP_PROXY=http://proxyits…:8080` schlägt fehl, weil Tools **keine Windows-NTLM-Credentials** mitsenden. Lösung: lokale Proxies, die `DefaultNetworkCredentials` nutzen.

## Übersicht

| Was | Lokaler Proxy | Start |
|-----|----------------|-------|
| **Git, GitHub, npm, npx, Playwright, curl, gh, …** | `http://127.0.0.1:18081` | `.\scripts\git-connect-proxy.ps1` |
| **Go-Module** (`go mod`, `GOPROXY`) | `http://127.0.0.1:18080` | `.\scripts\goproxy-corp.ps1` |

Hilfsskript (Env + optional Proxy starten):

```powershell
. .\scripts\corp-proxy-env.ps1
Start-CorpConnectProxyIfNeeded   # optional
Set-CorpProxyEnv
```

---

## CONNECT-Proxy (Port 18081) — Git, npm, Playwright, …

Terminal 1 — dauerhaft laufen lassen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-connect-proxy.ps1
```

Terminal 2 — Beispiele:

```powershell
. .\scripts\corp-proxy-env.ps1
Set-CorpProxyEnv

# Git / GitHub
git -c http.proxy=http://127.0.0.1:18081 push github main

# npm / npx
npm install --prefix .\scripts --no-fund --no-audit
npx --prefix .\scripts playwright install chromium

# Einzelbefehl mit Auto-Start des Proxys
Invoke-WithCorpProxy -StartProxy { npx --prefix .\scripts playwright install chromium }
```

### Playwright (Screenshot-Skripte, CI lokal)

Playwright lädt Chromium/Firefox/WebKit **nicht** über Go — immer CONNECT-Proxy verwenden:

```powershell
. .\scripts\corp-proxy-env.ps1
Start-CorpConnectProxyIfNeeded
Set-CorpProxyEnv
npm install --prefix .\scripts --no-fund --no-audit
npx --prefix .\scripts playwright install chromium
```

`scripts\capture-docs-screenshots.ps1` setzt den Proxy automatisch vor `npm`/`playwright install`.

Falls Chromium trotzdem fehlt: `TV_BROWSER_CHANNEL=msedge` oder `TV_BROWSER_EXECUTABLE` (siehe Admin-Guide).

---

## Go-Module-Proxy (Port 18080)

Go sendet **keine** Windows-Proxy-Credentials. Direktes `HTTP_PROXY=…:8080` → `authenticationrequired`.

Terminal 1:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\goproxy-corp.ps1
```

Terminal 2:

```powershell
$env:Path = "C:\Program Files\Go\bin;" + $env:Path
$env:GOPROXY = "http://127.0.0.1:18080"
$env:GOSUMDB = "off"   # falls sum.golang.org blockiert
go mod tidy
go test ./...
```

Optional dauerhaft (User-Scope):

```powershell
go env -w GOPROXY=http://127.0.0.1:18080
go env -w GOSUMDB=off
```

(`goproxy-corp.ps1` muss laufen, bevor Module geladen werden.)

---

## Agenten / CI-Hinweis

**Regel:** Kein externer Download ohne einen der lokalen Proxies. Das gilt für alle Tools und Sprachen — auch Playwright-Browser, npm-Pakete, Git-Push zu GitHub, `docker pull`, etc.
