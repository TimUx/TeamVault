# TeamVault Clients

**Endnutzer-Anleitungen:** [CLI](../docs/cli-guide.md) · [Extension](../docs/extension-guide.md) · [User Guide](../docs/user-guide.md)  
**Server-Installation:** [Installationsanleitung](../docs/install-guide.md)  
Auf der laufenden Instanz: **`/help`**, **`/help/cli`**, **`/help/extension`**.

## Crypto (geteilt)

| Client | Modul |
|--------|--------|
| WebUI | `web/static/cryptocore.js` |
| Extension | `clients/extension/cryptocore.js` (= Kopie von `clients/js/cryptocore.js`) |
| CLI | `internal/cryptocore` (Go, Phase 2) |

Keine eigene Kryptologik in Extension/CLI — nur die Phase-2-Primitive.

Bei Änderungen an der JS-Crypto: `web/static/cryptocore.js` ist die Quelle; nach `clients/js/` und `clients/extension/` kopieren. CI prüft die SHA-256-Gleichheit der drei Dateien.

## CLI (`tvcli`)

Standalone-Binaries (kein Go/Laufzeit nötig): **Windows** und **Linux**, amd64 + arm64.

```powershell
# Release-Build (CGO_ENABLED=0, Cross-Compile)
.\scripts\build-tvcli.ps1
# → dist/tvcli-windows-amd64.exe
# → dist/tvcli-linux-amd64
# → dist/tvcli-windows-arm64.exe
# → dist/tvcli-linux-arm64
```

CI (Tag `v*`): `.github/workflows/tvcli.yml` baut die Artefakte und veröffentlicht sie am GitHub-Release.

```bash
./scripts/build-tvcli.sh
```

Auslieferung: passende Datei kopieren und ausführen (Windows: `.exe`, Linux: `chmod +x`).

```powershell
# Dev
go run ./cmd/tvcli -base http://127.0.0.1:8080 login -tenant t1 -user admin
go run ./cmd/tvcli whoami
go run ./cmd/tvcli secrets list
go run ./cmd/tvcli secrets get -id sec_…
go run ./cmd/tvcli secrets create -title "VPN" -username alice
go run ./cmd/tvcli secrets update -id sec_… -title "VPN neu" -notes "…"
go run ./cmd/tvcli secrets create -title "Git" -username git `
  -url https://git.example.local -ssh-private-file .\id_ed25519 -tags infra,git
go run ./cmd/tvcli secrets create -title "S3" -s3-access AKIA… -s3-secret … `
  -cert-file .\tls.crt -extra secret=AppToken:s3cr3t
go run ./cmd/tvcli version
# oder API-Key:
$env:TEAMVAULT_API_KEY = "tvk_…"
go run ./cmd/tvcli whoami
```

`secrets create` Flags (Auswahl): `-urls`, `-url` (wiederholbar), `-notes`, `-totp`, `-tags`, `-favorite`, `-folder`, `-visibility private|shared`, `-share-user` / `-share-group` (wiederholbar), `-ssh-private[-file]`, `-ssh-public[-file]`, `-s3-access`, `-s3-secret`, `-cert[-file]`, `-extra` / `-extra-file` (`type=label:value`). `secrets update -id …` ändert nur gesetzte Felder. `secrets list` nutzt paginierte API-Antworten. `secrets get` gibt den Payload als JSON aus.

## Extension (MV3)

### Chrome / Edge

1. Extensions → Entwicklermodus → „Entpackt laden“
2. Ordner `clients/extension` wählen
3. Server-URL setzen, Login, Master-Passwort → Secrets listen / Passwort kopieren / **Fill**
4. Filter **Alle / Privat / Geteilt**; Badge zeigt Sichtbarkeit. **Fill** und **Copy**: ohne URL immer; mit URL nur bei Tab-Domain-Match (Phishing-Schutz)

`host_permissions` decken localhost ab. Für HTTPS-Server: optional_host_permissions (`https://*/*`) über die Extension-Details freigeben (oder beim ersten Zugriff erlauben).

### Firefox

1. `about:debugging` → This Firefox → „Load Temporary Add-on…“
2. `clients/extension/manifest.json` wählen
3. Gleicher Popup-Flow wie Chrome

Firefox nutzt `browser_specific_settings.gecko` und die `browser`-API (Polyfill in `popup.js` / `content.js`: `const api = typeof browser !== "undefined" ? browser : chrome`). Background ist MV3 `service_worker` (`background.js`) — kein separates `scripts`-Array nötig ab Firefox 109+.

Session-Cookies gelten für die Server-Origin (host_permissions / optional hosts).

### CRX-Signatur (Maintainer)

Der Chrome/Edge-Signing-Key liegt **nicht** im Repo. Er bestimmt die stabile Extension-ID.

| Umgebung | Quelle |
|----------|--------|
| Lokal | gitignored `clients/extension/teamvault.pem` (legt `go run ./cmd/pack-extension` bei Bedarf an) |
| CI / Image-Push | GitHub Actions Secret **`TV_EXTENSION_SIGNING_KEY`** (vollständiges PKCS#8-PEM) |

`manifest.json` `"key"` ist der **öffentliche** Schlüssel und darf versioniert werden; er muss zum privaten Key passen.

Release-Images (`main`, Tags) **scheitern ohne Secret** — es wird kein offizielles CRX mit Wegwerf-ID gebaut. PRs und Docs-Screenshots dürfen einen ephemeren Key erzeugen.

Secret setzen (PEM nie in Tickets/Chat): GitHub → Settings → Secrets and variables → Actions → `TV_EXTENSION_SIGNING_KEY`. Lokal dieselbe Datei behalten und im Firmen-Secret-Store sichern. Rotation: neuen Key erzeugen, Secret ersetzen, öffentlichen `key` im Manifest committen (neue Extension-ID → Policy-Rollout anpassen).

## Shamir Escrow

```powershell
# nach Escrow-Keypair in der Admin-UI, oder:
go run ./cmd/tvcli escrow-split -k 3 -n 5 -in escrow.sk
go run ./cmd/tvcli escrow-combine share1.hex share2.hex share3.hex
```

Browser: Admin-UI „Escrow-Keypair + Shares“ (vendored `secrets.js-grempe`).

## Extension Autofill

Nach Unlock listet das Popup Secrets; Einträge mit passender URL-Host zur aktiven Tab-Domain stehen oben.

- **Fill** — Username/Passwort (und TOTP-Feld, falls erkannt) im aktiven Tab via Content-Script; Keys bleiben nur im Popup.
- **Copy** — Passwort in die Zwischenablage; ebenfalls nur bei Host-Match (wie Fill).
- Domain-Match: Host der Secret-URL vs. Tab-Hostname (inkl. Subdomains).
- Form-Heuristik in `content.js`: username/email, password, otp/totp/mfa; React-freundliches Value-Setzen.
