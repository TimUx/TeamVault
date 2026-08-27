# TeamVault Browser-Extension – Kurzanleitung

Step-by-step für Endanwender. Interaktive Fassung: **`/help/extension`** auf Ihrer Instanz.

![Hilfe Extension](images/help-extension.png)

## Installation

### Einzeiler

**Windows:**

```powershell
$env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension.ps1" | iex
```

**Linux / macOS:**

```bash
curl -fsSL "https://IHRE-VAULT-URL/help/install/extension.sh" | TEAMVAULT_URL="https://IHRE-VAULT-URL" bash
```

Lädt `teamvault-extension.zip` von `/downloads/` und entpackt es lokal. Danach Extension im Browser „entpackt laden“.

### Chrome / Edge (manuell)

1. Ordner mit `manifest.json` bereitlegen (Einzeiler oder Git: `clients/extension`).
2. `chrome://extensions` / `edge://extensions` → Entwicklermodus → **Entpackte Erweiterung laden**.
3. Ordner wählen.

### Firefox (manuell)

1. `about:debugging#/runtime/this-firefox`
2. **Temporäres Add-on laden** → `manifest.json`
3. Hinweis: nach Firefox-Neustart erneut laden (ohne signiertes XPI).

## Einrichten

1. Popup öffnen → Server-URL = Ihre TeamVault-URL.
2. Bei HTTPS: optionale Host-Berechtigung für die Domain erlauben.
3. Login (Tenant / User / Passwort) → Master-Passwort (nur lokal).

## Nutzen

1. Seite öffnen, die zur Secret-URL passt.
2. Popup → Eintrag → **Fill** oder **Copy**.
3. Ohne Domain-Match: Aktion wird blockiert (Phishing-Schutz).

Admin: `scripts/pack-clients.ps1` erzeugt `dist/teamvault-extension.zip` → nach `<data-dir>/downloads/` kopieren.
