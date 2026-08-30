# TeamVault – Installationsanleitung

Schnelle Erstinstallation (Unlock-Keyfile, `.env`, Start).  
Betrieb und Admin-Themen danach: [Admin Guide](admin-guide.md).

**Entwickler:** Timo Braun · Repo: [github.com/TimUx/TeamVault](https://github.com/TimUx/TeamVault) · aktuelle Release-Tags: `v1.1.1` und neuer

## Welche Variante?

| Variante | Voraussetzung | Wann |
|----------|---------------|------|
| **Docker** (empfohlen) | Docker + Compose v2 | Produktion / einfacher Betrieb |
| **Go** | Go 1.23+ | Entwicklung / ohne Container |

**Docker-One-Liner** fragt nach dem Installationspfad (Enter = `~/teamvault`) und legt dort nur Betriebdateien an (`docker-compose.yml`, `.env`, Unlock-Keyfile) — **kein** vollständiger Git-Clone. Das Image kommt von **GHCR**.  
**Go-One-Liner** nutzt dieselben Prinzipien: Pfad-Abfrage, freier Port, schlanke Installation (`bin/teamvault`, `.env`, `secrets/`, `data/`) — **kein** Repo-Clone. Binary von GitHub Release (Fallback: einmaliger Build aus Quell-Archiv). Unlock-Key nur in der Keyfile.

## One-Liner: Docker

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.ps1 | iex
```

Der Installer fragt nach dem **Installationspfad** (Enter = `~/teamvault`), lädt nur Compose/Env von GitHub Raw, wählt den **ersten freien Host-Port ab 8080** und schreibt ihn in `.env` (`TEAMVAULT_PUBLISH_PORT`). Setup-URL steht am Ende der Ausgabe, z. B. `http://127.0.0.1:8081/setup`.

Optional:

| Variable | Bedeutung | Default |
|----------|-----------|---------|
| `TEAMVAULT_DIR` | Installationsverzeichnis (überspringt die Abfrage) | Prompt, Vorschlag `~/teamvault` |
| `TEAMVAULT_PORT` | Host-Port festsetzen (muss frei sein) | erster freier Port ab `8080` |
| `TEAMVAULT_REF` | Branch/Tag für Raw-Dateien | `main` |
| `TEAMVAULT_BUILD=1` | Lokal bauen (braucht Quellcode / Clone) statt GHCR-Pull | aus |

Ohne Prompt (Automation):

```bash
TEAMVAULT_DIR=/opt/teamvault bash -c 'curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash'
```

Beispiel Port festsetzen:

```bash
TEAMVAULT_PORT=9090 bash -c 'curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash'
```

Stoppen / Logs / Update:

```bash
cd ~/teamvault
# Update Compose-Datei + Image: One-Liner erneut, oder:
docker compose pull && docker compose up -d
docker compose logs -f
docker compose down
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

Der Installer fragt nach dem **Installationspfad**, lädt `.env.example`, holt `bin/teamvault` vom **neuesten GitHub-Release** (oder baut einmalig aus einem Quell-Archiv — ohne Git-Clone) und wählt den **ersten freien Port ab 8080**. Go ≥ 1.23 nur nötig, wenn kein passendes Release-Binary existiert.

Optional:

| Variable | Bedeutung | Default |
|----------|-----------|---------|
| `TEAMVAULT_DIR` | Installationsverzeichnis (überspringt die Abfrage) | Prompt, Vorschlag `~/teamvault` |
| `TEAMVAULT_REF` | Release-Tag oder Branch | neuester Release-Tag, sonst `main` |
| `TEAMVAULT_PORT` | Listen-Port festsetzen | erster freier Port ab `8080` |
| `TEAMVAULT_BUILD=1` | Vollständiger Quell-Checkout im Installationsverzeichnis (Dev) | aus |
| `TEAMVAULT_SKIP_RUN=1` | Nur vorbereiten, nicht starten | aus |

Nur vorbereiten, nicht starten:

```bash
TEAMVAULT_SKIP_RUN=1 curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.sh | bash
cd ~/teamvault
set -a; source .env; set +a
./bin/teamvault
```

## Was die Skripte anlegen

| Pfad | Docker | Go |
|------|--------|-----|
| Installationsverzeichnis | `docker-compose.yml`, `.env`, `secrets/` | `bin/teamvault`, `.env`, `secrets/`, `data/` |
| `secrets/teamvault_unlock` | Unlock-Keyfile — **separat sichern**. Docker: Datei `644`, Verzeichnis `700` (Container = nonroot). Go: `600` reicht |
| `.env` | Ports, Image-Tag, Keyfile-Pfad | Ports, `TEAMVAULT_ADDR`, Data-Dir |
| Persistenz | Docker-Volume `teamvault_data` | `./data/` |

Kein vollständiger Git-Clone in der Standard-Installation. `TEAMVAULT_BUILD=1` lädt den Quellcode für lokale Builds (Docker-Image bzw. Go-Entwicklung).

## `.env` und Unlock-Key

Für Docker ist eine `.env` sinnvoll: Compose liest sie automatisch (Port, Image, Keyfile-Pfad).

```bash
cp .env.example .env
mkdir -m 700 -p secrets
openssl rand -out secrets/teamvault_unlock 48
chmod 644 secrets/teamvault_unlock   # Container läuft als nonroot; secrets/ bleibt 700
docker compose pull && docker compose up -d
```

| Variable | Rolle |
|----------|--------|
| `TEAMVAULT_PUBLISH_PORT` | Host-Port (Compose) |
| `TEAMVAULT_UNLOCK_KEY_HOST` | Host-Pfad zum Keyfile (Compose-Mount) |
| `TEAMVAULT_IMAGE` | CI-Image, Default `ghcr.io/timux/teamvault:latest` |
| `TEAMVAULT_PULL_POLICY` | Compose-Pull, Default `always` |
| `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` | Pfad für den Go-Prozess (`.env` sourcen) |
| `TEAMVAULT_ADDR` / `TEAMVAULT_DATA_DIR` | Bind-Adresse / Datenverzeichnis (Go) |

**Image pinnen (empfohlen für Prod):**

```bash
# in .env
TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:1.1.1
```

CI-Tags (Workflow `.github/workflows/docker.yml`):

| Event | Beispiel-Tags |
|-------|----------------|
| Push `main` | `latest`, `main`, `sha-…` |
| Tag `v1.1.1` | `1.1.1`, `1.1` |

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
mkdir -p secrets
openssl rand -out secrets/teamvault_unlock 48
chmod 644 secrets/teamvault_unlock   # Docker nonroot; secrets/ auf 700 halten
docker compose pull && docker compose up -d   # GHCR: ghcr.io/timux/teamvault:latest
# optional SemVer: TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:1.1.1
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
| Port belegt | One-Liner wählt automatisch den nächsten freien Port ab 8080; Pin: `TEAMVAULT_PORT=…` |
| `permission denied` auf Unlock-Key | Container = nonroot: `chmod 700 secrets && chmod 644 secrets/teamvault_unlock` |
| GHCR-Pull fehlgeschlagen | `docker login ghcr.io`; Package öffentlich/sichtbar? Sonst `TEAMVAULT_BUILD=1` / `docker-compose.build.yml` |
| Go zu alt | Go 1.23+ von [go.dev/dl](https://go.dev/dl/) |
| Setup erscheint erneut | Anderes Data-Dir oder anderes Unlock-Keyfile |
| Altes Image | `docker compose pull` — `TEAMVAULT_PULL_POLICY=always` ist Default |

## Verwandte Doku

- [Admin Guide](admin-guide.md) — Betrieb, LDAP, Backup, Proxy  
- [User Guide](user-guide.md) — Vault, Import/Export, Sicherung  
- [README](../README.md) — Überblick  
- [SECURITY-REVIEW-CHECKLIST](../SECURITY-REVIEW-CHECKLIST.md) — Prod-Checkliste  
