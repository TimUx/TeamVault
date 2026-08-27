# TeamVault

Self-hosted, **Zero-Knowledge** Passwortmanager für Firmennetze (Multi-Tenant).  
Secrets und Titel werden nur im Browser entschlüsselt — Server und Storage sehen ausschließlich Ciphertext.

![Login](docs/images/login.png)

## Was die App kann

| Bereich | Funktionen |
|---------|------------|
| **Vault** | Secrets anlegen/öffnen (Titel, User, Passwort, Extra-Felder, TOTP), Suche/Ordner, Import/Export |
| **Sharing** | Pro berechtigtem User eigener Datenschlüssel (asymmetrisch); Entzug mit Pflicht-Rotation |
| **Auth** | Lokales Login immer; optional LDAP/AD nur für Bind; TOTP; Passkeys (nur Login); Self-Service Passwort-Wechsel |
| **Onboarding** | Erzwungenes Master-Passwort + Schlüsselpaar; Recovery-Kit oder Admin-Escrow (Shamir) |
| **Admin** | User/Gruppen, LDAP, SMTP, Krypto/Policy, Audit, API-Keys (`read`/`vault`/`admin`), Tenants, Storage-Migration |
| **Clients** | Web-UI, CLI (`tvcli`), Browser-Extension (Chrome/Edge/Firefox; Fill/Copy mit Host-Gate) |

![Vault mit Sidebar und Secrets](docs/images/vault-secrets.png)

## Sicherheitsprinzipien (kurz)

1. Zero-Knowledge — kein Klartext-Secret auf dem Server  
2. Client-Crypto — WebCrypto / NaCl / Argon2id  
3. Hybrid-Auth — LDAP nur Login, Rechte immer lokal  
4. Ein externes Bootstrap-Secret: Unlock-Keyfile (≥32 Byte Entropie)

Details: [`.cursor/rules/security-principles.mdc`](.cursor/rules/security-principles.mdc)

## Dokumentation

| Guide | Zielgruppe |
|-------|------------|
| [**User Guide**](docs/user-guide.md) | Alltag: Login, Onboarding, Vault, Sharing, Export, Passwort-Wechsel |
| [**CLI Guide**](docs/cli-guide.md) | tvcli installieren & nutzen (auch in der App: `/help/cli`) |
| [**Extension Guide**](docs/extension-guide.md) | Browser-Extension (auch: `/help/extension`) |
| [**Admin Guide**](docs/admin-guide.md) | Betrieb: Setup-Wizard, User/LDAP/SMTP, Escrow, Proxy/TLS, Backup, CI |
| [**Roadmap**](docs/planning/roadmap-phase9plus.md) | Weitere Ausbaupfade (Hardening, UX, Perf, Features) |
| [**Vergleich Password Manager**](docs/planning/competitive-comparison.md) | TeamVault vs. Bitwarden, Vaultwarden, Passbolt, … |
| [Clients](clients/README.md) | CLI-Binaries & Extension |
| [OpenAPI](docs/openapi.yaml) | REST-API (`GET /openapi.yaml` am Server) |
| [Planung](docs/planning/) | Architektur, Crypto, Entscheidungen |

## Entwickler & Version

**Entwickler:** Timo Braun  

Die laufende Version liefert `GET /api/version` bzw. `teamvault -version` (Build-Infos per `-ldflags`). In der Web-UI erscheint Version und Entwickler im Footer bzw. in der Sidebar.

## Stack

| Schicht | Technologie |
|---------|-------------|
| Backend | Go (`cmd/teamvault`) |
| Web-UI | Vanilla JS eingebettet (`web/static`) |
| Client-Crypto | `web/static/cryptocore.js` / `internal/cryptocore` (Argon2id, NaCl) |
| Storage | SQLite (Default) oder JSON-File |
| Clients | `tvcli` (standalone Win/Linux), Browser-Extension |

## Schnellstart (Entwicklung)

Firmennetz / Module: [`docs/dev-proxy.md`](docs/dev-proxy.md).

```powershell
$env:Path = "C:\Program Files\Go\bin;" + $env:Path
$env:GOPROXY = "http://127.0.0.1:18080"   # Corp-Proxy; sonst proxy.golang.org
$env:GOSUMDB = "off"
# Unlock-Keyfile ≥32 Byte Zufall
$env:TEAMVAULT_MASTER_UNLOCK_KEY_FILE = ".\unlock.key"
go test ./...
go run ./cmd/teamvault -addr :8080
```

Danach im Browser: **http://127.0.0.1:8080/setup** → Wizard → Login → Onboarding → Vault.

![Setup: Tenant & Admin](docs/images/setup-tenant.png)

## Docker

Unlock-Key **nicht** ins Image legen — als Datei mounten:

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
# openssl rand -out secrets/teamvault_unlock 48
docker compose up -d --build
# → http://127.0.0.1:8080/setup
```

Dateien: `Dockerfile`, `docker-compose.yml`, `.dockerignore`. Persistenz: Volume `teamvault_data`.

## CLI & Extension

```powershell
.\scripts\build-tvcli.ps1
# → dist/tvcli-windows-amd64.exe, dist/tvcli-linux-amd64, …
.\dist\tvcli-windows-amd64.exe -base http://127.0.0.1:8080 login -tenant demo -user admin
```

Extension: Ordner `clients/extension` in Chrome/Edge (Entwicklermodus) laden — siehe [clients/README.md](clients/README.md).

## CI (Gitea Actions)

Ubuntu-Runner: Tests, `govulncheck`, Docker-Build, **Trivy-Image-Scan** (HIGH/CRITICAL), dann Package-Push.

- Workflow: [`.gitea/workflows/ci.yml`](.gitea/workflows/ci.yml)  
- Image z. B. `git.example.internal/cc-3.3/teamvault:latest`  
- Optional: Secret `REGISTRY_TOKEN`, Vars `REGISTRY` / `GOPROXY` / `GOSUMDB`

## Bootstrap-Unlock

| Umgebung | Variable |
|----------|----------|
| Prod | `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` (Keyfile/Secret-Mount) |
| Dev | `TEAMVAULT_MASTER_UNLOCK_KEY` (Fallback) |

Der Key entsperrt nur die **verschlüsselte Config** — keine Vault-Klartexte.

## Überblick

TeamVault umfasst Setup-Wizard, Zero-Knowledge-Vault, Sharing mit Envelope-Rotation, Admin (User/LDAP/SMTP/Policy/Escrow/API-Keys), Passkeys (nur Login), OpenAPI, CLI und Browser-Extension.

Betriebs-Checkliste: [`SECURITY-REVIEW-CHECKLIST.md`](SECURITY-REVIEW-CHECKLIST.md)

![Dark Theme](docs/images/theme-dark.png)
