# TeamVault CLI (`tvcli`) – Kurzanleitung

Step-by-step für Endanwender. Interaktive Fassung auf der laufenden Instanz: **`/help/cli`**.

![Konto & Sicherheit → Clients](images/account-clients.png)

## Installation

### Einzeiler

**Windows (PowerShell):**

```powershell
$env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/tvcli.ps1" | iex
```

**Linux:**

```bash
curl -fsSL "https://IHRE-VAULT-URL/help/install/tvcli.sh" | TEAMVAULT_URL="https://IHRE-VAULT-URL" bash
```

Die Skripte laden das Binary von `https://…/downloads/` (im Docker-Image automatisch bereitgestellt).

In der Web-App: **Konto & Sicherheit → Clients** oder Hilfe **`/help/cli`** — Download und Installations-Einzeiler für Ihre Instanz (sichtbar nur, wenn der Plattform-Administrator die CLI-Integration unter **Administration → Client-Integrationen** aktiviert hat; `/downloads/` bleibt immer verfügbar).

### Manuell

1. Passende Datei von `/downloads/` holen (`tvcli-windows-amd64.exe`, `tvcli-linux-amd64`, …).
2. Ausführbar machen / in den PATH legen.

Admin-Build: `scripts/build-tvcli.ps1` bzw. `scripts/pack-clients.ps1` → nach `<data-dir>/downloads/` kopieren.

CI (Tag `v*`): `.github/workflows/tvcli.yml` baut die vier Standalone-Binaries und veröffentlicht sie am GitHub-Release.

## Einrichten

### Woher kommen URL, Tenant, Username und API-Key?

Nach der Anmeldung finden Sie unter **Konto & Sicherheit → Clients** eine persönliche CLI-Übersicht. Dort werden die Server-URL, der Tenant-Slug und Ihr Username angezeigt. Ein fertiger Login-Befehl kann direkt kopiert werden.

- **URL:** die URL Ihrer geöffneten TeamVault-Instanz
- **Tenant-Slug:** wird in der Clients-Übersicht für Ihre aktuelle Organisation angezeigt
- **Username:** Ihr TeamVault-Username, ebenfalls in der Clients-Übersicht
- **API-Key:** optional; ein Plattform-Administrator erstellt ihn unter **Administration → API-Keys**. Der Token wird nur bei der Erstellung angezeigt und muss sofort sicher gespeichert werden. Für Vault-Zugriff den Scope `vault` verwenden.

```powershell
tvcli -base https://IHRE-VAULT-URL login -tenant IHR-TENANT -user IHR-USER
```

Bei aktivem TOTP wird der Code interaktiv abgefragt (optional leer lassen, wenn kein TOTP eingerichtet). Alternativ kann der Code im selben Login-Request mitgegeben werden — die Web-App nutzt dagegen einen **zweiten Schritt** nach Passwort/Passkey.

Oder API-Key (Admin → API-Keys, Scope `read` / `vault`):

```powershell
$env:TEAMVAULT_API_KEY = "tvk_…"
tvcli -base https://IHRE-VAULT-URL whoami
```

Mit API-Key:

```powershell
$env:TEAMVAULT_API_KEY = "tvk_…"
tvcli -base https://IHRE-VAULT-URL whoami
```

## Nutzen

```powershell
tvcli secrets list
tvcli secrets get -id sec_…
tvcli secrets create -title "VPN" -username alice
tvcli secrets update -id sec_… -title "VPN neu" -notes "…"
```

Master-Passwort wird bei Bedarf **nur lokal** abgefragt.
