# TeamVault – Installationsanleitung

Schnelle Erstinstallation mit allen Vorbereitungen (Repo, Unlock-Keyfile, `.env`, Start).  
Betrieb und Admin-Themen danach: [Admin Guide](admin-guide.md).

**Entwickler:** Timo Braun · Repo: [github.com/TimUx/TeamVault](https://github.com/TimUx/TeamVault)

## Welche Variante?

| Variante | Voraussetzung | Wann |
|----------|---------------|------|
| **Docker** (empfohlen) | Docker + Compose v2 | Produktion / einfacher Betrieb |
| **Go** | Go 1.23+ | Entwicklung / ohne Container |

Beide One-Liner klonen das Repo nach `~/teamvault` (überschreibbar), erzeugen ein Unlock-Keyfile (≥48 Zufallsbytes) und legen eine `.env` an. Der Unlock-Key selbst liegt **nur** in der Keyfile — nicht als Klartext in der `.env`.

## One-Liner: Docker

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.ps1 | iex
```

Danach: **http://127.0.0.1:8080/setup**

Optional:

| Variable | Bedeutung | Default |
|----------|-----------|---------|
| `TEAMVAULT_DIR` | Installationsverzeichnis | `$HOME/teamvault` |
| `TEAMVAULT_PORT` | Host-Port | `8080` |
| `TEAMVAULT_REF` | Branch/Tag | `main` |
| `TEAMVAULT_BUILD=1` | Lokal bauen (`docker-compose.build.yml`) statt GHCR-Pull | aus |

Beispiel anderer Port:

```bash
TEAMVAULT_PORT=9090 curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash
```

Stoppen / Logs:

```bash
cd ~/teamvault
docker compose down
docker compose logs -f
```

## One-Liner: Go (ohne Docker)

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.ps1 | iex
```

Das Skript prüft Go ≥ 1.23, klont das Repo, erzeugt Keyfile + `.env`, baut `bin/teamvault` und startet den Server (Stopp: Ctrl+C).

Nur vorbereiten, nicht starten:

```bash
TEAMVAULT_SKIP_RUN=1 curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.sh | bash
cd ~/teamvault
set -a; source .env; set +a
./bin/teamvault
```

## Was die Skripte anlegen

| Pfad | Inhalt |
|------|--------|
| `~/teamvault/` | Git-Checkout |
| `secrets/teamvault_unlock` | Unlock-Keyfile (chmod 600) — **separat sichern** |
| `.env` | Ports, Pfade (aus `.env.example`) — **kein** Key-Inhalt |
| `data/` (Go) bzw. Volume `teamvault_data` (Docker) | Persistente Config + Vault-Store (nur Ciphertext) |

## `.env` und Unlock-Key

Für Docker ist eine `.env` sinnvoll: Compose liest sie automatisch (Port, Image, Keyfile-Pfad).

```bash
cp .env.example .env
mkdir -p secrets
openssl rand -out secrets/teamvault_unlock 48
chmod 600 secrets/teamvault_unlock
docker compose up -d
```

| Variable | Rolle |
|----------|--------|
| `TEAMVAULT_PUBLISH_PORT` | Host-Port (Compose) |
| `TEAMVAULT_UNLOCK_KEY_HOST` | Host-Pfad zum Keyfile (Compose-Mount) |
| `TEAMVAULT_IMAGE` | CI-Image, Default `ghcr.io/timux/teamvault:latest` (kein lokaler Build) |
| `TEAMVAULT_PULL_POLICY` | Compose-Pull, Default `always` |
| `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` | Pfad für den Go-Prozess (Quelle: `.env` manuell sourcen) |
| `TEAMVAULT_ADDR` / `TEAMVAULT_DATA_DIR` | Bind-Adresse / Datenverzeichnis (Go) |

**Prod:** Unlock immer als Keyfile/Secret-Mount. Die Env-Variable `TEAMVAULT_MASTER_UNLOCK_KEY` (Key-Bytes direkt) ist nur Dev/Test-Fallback — die Install-Skripte setzen sie bewusst nicht.

## Nach dem Start

1. Browser: `/setup` — Storage, Tenant, Admin, Argon2, Recovery → Commit  
2. Login → Vault-Onboarding (Master-Passwort + Recovery-Kit)  
3. Weiter: [User Guide](user-guide.md) · [Admin Guide](admin-guide.md)

## Manuell (ohne One-Liner)

### Docker

```bash
git clone https://github.com/TimUx/TeamVault.git
cd TeamVault
cp .env.example .env
mkdir -p secrets && openssl rand -out secrets/teamvault_unlock 48
docker compose pull && docker compose up -d   # GHCR: ghcr.io/timux/teamvault:latest
# optional SemVer: TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:1.1.0
# lokaler Build: docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Go

```bash
git clone https://github.com/TimUx/TeamVault.git
cd TeamVault
mkdir -p data secrets bin
openssl rand -out secrets/teamvault_unlock 48
cp .env.example .env
# TEAMVAULT_MASTER_UNLOCK_KEY_FILE in .env zeigt auf ./secrets/teamvault_unlock
set -a; source .env; set +a
go build -o bin/teamvault ./cmd/teamvault
./bin/teamvault
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `missing unlock key` | Keyfile existiert? Pfad in `.env` / Compose-Mount korrekt? |
| Port belegt | `TEAMVAULT_PORT=9090` bzw. `TEAMVAULT_PUBLISH_PORT` |
| GHCR-Pull fehlgeschlagen | `docker login ghcr.io`; Package sichtbar? Sonst `TEAMVAULT_BUILD=1` / `docker-compose.build.yml` |
| Go zu alt | Go 1.23+ von [go.dev/dl](https://go.dev/dl/) |
| Setup erscheint erneut | Anderes Data-Dir oder anderes Unlock-Keyfile |

## Verwandte Doku

- [Admin Guide](admin-guide.md) — Betrieb, LDAP, Backup, Proxy  
- [README](../README.md) — Überblick  
- [SECURITY-REVIEW-CHECKLIST](../SECURITY-REVIEW-CHECKLIST.md) — Prod-Checkliste  
