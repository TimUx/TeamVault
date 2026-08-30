# TeamVault – Admin Guide

Betrieb und Verwaltung der Instanz. Für den Alltag der Endanwender: [User Guide](user-guide.md).

**Entwickler:** Timo Braun · Version der laufenden Instanz: `GET /api/version` oder `teamvault -version` (auch in der Web-UI Sidebar/Footer).

## 1. Rollen

| Rolle | Rechte (Auszug) |
|-------|-----------------|
| `platform_admin` | Tenants, Storage-Migration, plattformweite Übersicht |
| `tenant_admin` | User, Gruppen, LDAP, SMTP, Policy, Audit, API-Keys, Escrow-Pubkey |
| `member` | Vault nur für eigene/geteilte Secrets |

Der erste User aus dem Setup-Wizard erhält **beide** Admin-Rollen.

## 2. Erstinstallation

Ausführlich inkl. One-Liner: [**Installationsanleitung**](install-guide.md).

### 2.1 Voraussetzungen

- **Docker** + Compose v2 **oder** Go 1.23+
- Persistentes Datenverzeichnis / Volume
- Unlock-Keyfile ≥ **32 Byte** hohe Entropie (kein Passwort)

### 2.2 One-Liner

```bash
# Docker (empfohlen)
curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.sh | bash

# Go (ohne Container)
curl -fsSL https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.sh | bash
```

```powershell
# Docker
irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-docker.ps1 | iex

# Go
irm https://raw.githubusercontent.com/TimUx/TeamVault/main/scripts/install-go.ps1 | iex
```

### 2.3 Unlock-Key und `.env`

Der Unlock-Key entsperrt nur die Config-DB. Vault-Secrets bleiben Zero-Knowledge.

**Empfohlen:** Keyfile + `.env` (Compose lädt `.env` automatisch; Key-Bytes nie in die `.env` schreiben).

```bash
cp .env.example .env
mkdir -p secrets
openssl rand -out secrets/teamvault_unlock 48
chmod 600 secrets/teamvault_unlock
# .env enthält z. B.:
#   TEAMVAULT_UNLOCK_KEY_HOST=./secrets/teamvault_unlock
#   TEAMVAULT_PUBLISH_PORT=8080
#   TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:latest
```

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force secrets | Out-Null
# openssl rand -out secrets/teamvault_unlock 48
```

| Variable | Verwendung |
|----------|------------|
| `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` | Pfad zum Keyfile (Prod) |
| `TEAMVAULT_MASTER_UNLOCK_KEY` | Nur Dev/Test-Fallback (Key-Bytes in Env) |
| `TEAMVAULT_PUBLISH_PORT` / `TEAMVAULT_UNLOCK_KEY_HOST` | Docker Compose via `.env` |

### 2.4 Start

```bash
docker compose up -d
# oder mit gesourcter .env:
set -a; source .env; set +a
go run ./cmd/teamvault
```

Browser: `/setup` — solange `initialized=false`.

### 2.5 Setup-Wizard

| Schritt | Inhalt |
|---------|--------|
| Willkommen | Kurzinfo Zero-Knowledge |
| Storage | SQLite (Default) oder JSON-File |
| Tenant/Admin | Erster Tenant + lokaler Admin (≥12 Zeichen Login-Passwort) |
| Krypto | Argon2id-Parameter (clientseitige Vault-KDF) |
| Recovery | `user_kit` und/oder Escrow erlaubt |
| Commit | Atomare Initialisierung |

#### Storage

![Setup Storage](images/setup-storage.png)

#### Tenant & lokaler Admin

![Tenant & Admin](images/setup-tenant.png)

#### Argon2id (Vault-KDF)

![Krypto / Argon2id](images/setup-crypto.png)

#### Key-Recovery

![Recovery](images/setup-recovery.png)

#### Review & Commit

![Review & Commit](images/setup-commit.png)

Nach dem Commit: Login → **Vault-Onboarding** (Master-Passwort) → App.

## 3. Admin-UI (nach Vault-Entsperren)

In der **Sidebar** unter **Administration** (sichtbar für `tenant_admin` / `platform_admin`; Auditoren nur **Audit**). Menüpunkte und Topbar-Theme nutzen flache Inline-SVG-Icons (kein externes Icon-CDN). Jeder Unterpunkt öffnet den jeweiligen Abschnitt.

### 3.1 Benutzer

![Benutzer](images/admin-users.png)

- Lokale User anlegen (Username + Login-Passwort ≥12)
- Status: active / disabled, Onboarding-Status, Auth-Backend (`local` / `ldap`)
- Disable statt Löschen (LDAP-Sync deaktiviert fehlende Accounts)
- Nach **Disable**: Hinweis, Secrets mit Envelope dieses Users zu **rotieren** (Zero-Knowledge — kein Auto-Rotate). Optional Liste der Secret-IDs (Meta only).

Kein Zugriff auf Master-Passwort, Private Keys oder Recovery-Kit-Klartext.

### 3.2 Gruppen

![Gruppen](images/admin-groups.png)

- Gruppen anlegen, Members über Group-ID (`grp_…`) + User-ID (`usr_…`)
- Rechte/Sharing bleiben über lokale Zuordnung — **keine** LDAP-Gruppen-Autorisierung
- Secrets können an Gruppen geteilt werden (pro Mitglied eigener Envelope) — siehe User Guide

### 3.3 LDAP / AD

Sidebar **Administration → LDAP**:

- Optional, **nur Login-Bind** (nie Autorisierung)
- Felder: Host, Port, Base DN, Bind DN/Passwort, User-Filter
- Test-Bind, Speichern, LDAP-Sync (fehlende → lokal disabled)
- Just-in-Time: erster erfolgreicher LDAP-Login legt lokalen User an (`auth_backend=ldap`)

### 3.4 SMTP

- Outbound-Mail (Einladungen/Hinweise je nach Ausbau)
- Host, Port, From, Credentials; Test-Button

### 3.5 Krypto & Policy

- Argon2-Defaults / Presets für neue Onboardings
- TOTP-Pflicht (Hinweis/Policy nach Login)
- Idle-Lock der Vault-Session (Default 15 min) — nur Client-Unlock
- **Admins: Secret-Liste nur mit Envelope** (`admin_secrets_envelope_only`): Wenn aktiv, sehen Tenant-Admins in der Secret-Liste nur Einträge, für die sie selbst ein Envelope haben (Inventar-Metadaten anderer Secrets ausgeblendet). Default: aus — Admins sehen alle Secret-Metadaten (IDs, Title-Ciphertext), Klartext bleibt Zero-Knowledge-geschützt.

### 3.6 Escrow & Shamir

Wenn Recovery-Modus Escrow erlaubt (Wizard-Schritt Recovery bzw. später umschalten mit Bestätigung `REONBOARD`):

1. In der Admin-UI **Escrow-Keypair + Shares** erzeugen (clientseitig)
2. Server speichert **nur** den Public Key
3. Private Shares offline verteilen (`k` von `n`); alternativ `tvcli escrow-split` / `escrow-combine`
4. Der vollständige Escrow-Private-Key wird **nicht** im DOM belassen — nur Shares (Anzeige + Download)

![Escrow / Recovery](images/admin-recovery.png)

**Hinweis:** Mode-Wechsel (`user_kit` ↔ `admin_escrow`) ist **blockiert**, solange der Tenant Secrets hat (kein Key-Wipe mit Datenverlust). Escrow-Flag ohne Mode-Wechsel bleibt möglich.

Der private Escrow-Key darf nie in Logs oder dauerhaft auf dem Server landen.

### 3.7 Audit & API-Keys

![API-Keys](images/admin-apikeys.png)

- Audit-Liste (Tenant-Ereignisse) — Fehlerhinweise erscheinen oben im Admin-Bereich; kritische Vault-Mutationen (Create/Share/Rotate/Delete) sowie Recovery-Reonboard und zentrale Admin-Mutationen scheitern, wenn der Audit-Schreibvorgang fehlschlägt
- API-Keys für Automation/CLI (`Authorization: Bearer …` / `TEAMVAULT_API_KEY`) — Token nur einmal anzeigen
- Scopes (**Pflicht** bei Neuanlage, mind. einer; UI-Checkboxen):

  | Scope | Wirkung |
  |-------|---------|
  | `read` | GET-Allowlist: me, Vault-Status/Keys, Secrets Liste/Detail, `GET /api/groups`, Presets/Policy |
  | `vault` | Secret-/Vault-Schreibaktionen (Create/Share/Rotate/Delete, …) |
  | `admin` | `/api/admin/*` — zusätzlich müssen die **User-Rollen** Admin erlauben |

- Cookie-Sessions ohne Scope-Einschränkung. **Legacy-Keys ohne Scopes** (`legacy_no_scopes` in der Key-Liste): nur **read-only** GET-Allowlist — keine Schreib- oder Admin-Aktionen. Key mit expliziten Scopes neu ausstellen und alten Key widerrufen.
- Nach User-Disable: Secrets mit Envelope dieses Users rotieren (Hinweis + Liste `accessible-secrets` in Admin-UI; kein Auto-Rotate wegen ZK)
- Tenant-Admins sehen standardmäßig in der Secret-Liste **Metadaten** (IDs, Title-Ciphertext) auch ohne eigenen Envelope — optional einschränkbar über Policy (siehe §3.5)

### 3.8 Tenants & Storage-Migration (`platform_admin`)

- Weitere Tenants anlegen
- Migration SQLite ↔ JSON: nur Ciphertext; Bestätigung `MIGRATE`

## 4. Docker & Package

Siehe [Installationsanleitung](install-guide.md) und Root-[README](../README.md#docker). Compose nutzt `.env` und mountet:

- Volume `/data` — Vault/Config
- Unlock-Datei → `/run/secrets/teamvault_unlock` (read-only), Host-Pfad über `TEAMVAULT_UNLOCK_KEY_HOST`

Default-Image: `ghcr.io/timux/teamvault:latest` (`TEAMVAULT_IMAGE`) — von CI nach Push auf `main` / Tags `v*` veröffentlicht. Compose hat **keinen** lokalen `build:`-Schritt; nur Pull.

Pin auf Release: `TEAMVAULT_IMAGE=ghcr.io/timux/teamvault:1.1.0` in `.env`.  
Lokaler Build nur bei Bedarf: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

Unlock-Key nie ins Image legen.

### 4.1 Client-Downloads (CLI & Extension)

Die Hilfe unter **`/help`** (Login-Header und Sidebar **Hilfe**) bietet Einzeiler-Installationen:

![Hilfe Übersicht](images/help.png)

Dafür Binaries/ZIP nach **`<data-dir>/downloads/`** legen (Server legt den Ordner beim Start an, ausgeliefert unter `/downloads/`):

```powershell
.\scripts\pack-clients.ps1
New-Item -ItemType Directory -Force data\downloads | Out-Null
Copy-Item dist\tvcli-* data\downloads\
Copy-Item dist\teamvault-extension.zip data\downloads\
```

Danach funktionieren z. B.:

```powershell
$env:TEAMVAULT_URL='https://vault.example'; irm "$env:TEAMVAULT_URL/help/install/tvcli.ps1" | iex
```

## 5. Backup

| Was | Hinweis |
|-----|---------|
| **Instanz-Snapshot** (Admin-UI) | Platform-Admin: *Tenants & Migration* → Snapshot herunterladen. Nur Ciphertext + Metadaten. Restore mit Bestätigung `RESTORE` ersetzt den Vault-Store. |
| Datenverzeichnis / Volume | Alternative: Datei-Kopie von SQLite/JSON + Config; enthält nur Ciphertext + Metadaten |
| Unlock-Keyfile | Separat, streng schützen — ohne Key keine Config |
| User-`.tvbak` | Clientseitige verschlüsselte Secrets-Sicherung (User-Guide); kein Ersatz für Instanz-Backup |
| Escrow-Shares / User-Recovery-Kits | Offline, nie zusammen mit Unlock-Key lagern |

### 5.1 Backup über die Admin-UI

1. Als `platform_admin` anmelden, Vault entsperren.
2. **Tenants & Migration → Snapshot herunterladen** (`GET /api/admin/backup`).
3. Unlock-Keyfile und User-Recovery-Kits **nicht** in derselben Ablage wie den Snapshot.
4. Restore: Snapshot-Datei wählen, `RESTORE` tippen → **Wiederherstellen**. Danach Login prüfen.

### 5.2 Backup-/Restore-Drill (kurz)

1. Instanz stoppen; Volume/`TEAMVAULT_DATA_DIR` und Unlock-Keyfile sichern — **oder** Snapshot aus der Admin-UI plus Unlock-Keyfile.
2. Auf Testsystem wiederherstellen; gleichen Unlock-Key mounten; starten (bei UI-Restore: laufende Instanz, Confirm `RESTORE`).
3. Login + Vault-Unlock prüfen — Klartext nur clientseitig.
4. Erfolg dokumentieren; Prod-Backup-Rhythmus festlegen.

## 6. Netzwerk & TLS

- App lauscht typischerweise hinter Reverse-Proxy mit TLS
- Bind: `TEAMVAULT_ADDR` / `-addr` (Default `:8080`)
- Passkeys brauchen HTTPS (bzw. `localhost`) und korrekte Relying-Party-URL
- Server-Timeouts: `ReadHeaderTimeout` 10s, `ReadTimeout` 60s, `WriteTimeout`/`IdleTimeout` 120s

### 6.1 Reverse-Proxy-Checkliste

- [ ] TLS am Proxy; App nur intern erreichbar
- [ ] `Origin` / `Referer` an die App durchreichen (Cookie-Mutationen prüfen Origin; leerer Origin bei Cookie → 403)
- [ ] `X-Forwarded-Proto` / `X-Forwarded-Host` nur setzen, wenn `TEAMVAULT_TRUST_FORWARDED=1` (Default: aus — nicht blind vertrauen). Bei Aktivierung loggt der Server beim Start `WARN: TEAMVAULT_TRUST_FORWARDED is enabled …` — nur hinter vertrauenswürdigem Edge-Proxy verwenden.
- [ ] HSTS am Proxy oder App (bei HTTPS)
- [ ] WebAuthn RP-ID/Origin passen zur öffentlichen URL

### 6.2 Single-Node / Sessions

Sessions, Login-Rate-Limits und Passkey-Challenges liegen **im Prozessspeicher** (Sessions zusätzlich optional in `sessions.json` unter Data-Dir). Mehrere Replicas ohne Sticky Sessions / gemeinsames Challenge-Store: Login und Passkeys können fehlschlagen. Empfehlung: **eine Replica** oder Sticky Sessions am Load-Balancer.

## 7. Troubleshooting

| Symptom | Check |
|---------|--------|
| Start schlägt fehl „missing unlock key“ | `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` gesetzt und lesbar? |
| Setup erscheint erneut | Falsches Data-Dir oder Unlock-Key? |
| LDAP-Login fehl | Test-Bind; Filter; User lokal nicht disabled |
| Passkey funktioniert nicht | HTTPS, RP-ID, Browser-Support |
| Vault „Idle gesperrt“ | Erneut Master-Passwort; Idle-Minuten in Policy |
| Cookie-POST „origin check failed“ | Proxy leitet Origin durch? |

## 8. Weiterführend

- Sicherheitsregeln: [`.cursor/rules/security-principles.mdc`](../.cursor/rules/security-principles.mdc)
- Admin-UI Scope (Planung): [planning/admin-ui-scope.md](planning/admin-ui-scope.md)
- OpenAPI: [openapi.yaml](openapi.yaml)
