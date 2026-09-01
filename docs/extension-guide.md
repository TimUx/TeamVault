# TeamVault Browser-Extension – Kurzanleitung

Step-by-step für Endanwender. Interaktive Fassung: **`/help/extension`** auf Ihrer Instanz.

![Konto → Clients](images/account-clients.png)

## Installation (normal, empfohlen)

Ohne Entwicklermodus — aber **nur mit Browser-Richtlinie**. Chrome/Edge installieren `.crx` nicht aus dem Download-Ordner; der Installationsdialog erscheint nur, wenn `ExtensionSettings` und `ExtensionInstallSources` gesetzt sind.

1. **`/help/extension`** oder **Konto → Clients** öffnen.
2. **Schritt 1 — Einrichtung:** PowerShell-Einzeiler (setzt Richtlinie unter HKCU):

```powershell
$env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension-user.ps1" | iex
```

**Fehler „Registrierungszugriff unzulässig“:** Ihre Firmen-GPO blockiert `HKCU\Software\Policies`. → IT muss Schritt 1 zentral ausführen (siehe unten) oder Sie nutzen [Entwicklermodus](#erweitert-entwicklermodus-fallback).

3. **Schritt 2 — Installieren:** Chrome/Edge **neu starten**, dann **Extension installieren** klicken. Erst jetzt erscheint der Installationsdialog.

**IT (alle PCs):** Einmalig als Administrator:

```powershell
$env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension-policy.ps1" | iex
```

Richtlinien-Vorlagen: `/downloads/extension/chrome-policy.json`, `chrome-install-sources.json`.

### Wenn PowerShell blockiert ist (Antimalware / Firmenrichtlinie)

`irm … | iex` wird in vielen Umgebungen von Antimalware oder App-Control blockiert — das ist normal.

**Endanwender (Schritt 2):** In `/help/extension` oder **Konto → Clients** auf **Extension installieren** klicken — dafür ist kein PowerShell nötig, sobald die Browser-Richtlinie gesetzt ist.

**Schritt 1 ohne Pipe:**

1. Im Browser `$Base/help/install/extension-user.ps1` öffnen → **Speichern unter**
2. In einer PowerShell (nicht als Pipe):  
   `$env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; powershell -NoProfile -ExecutionPolicy Bypass -File .\extension-user.ps1`

Wenn auch das blockiert wird: **IT** rollt die Vorlagen von `/downloads/extension/chrome-policy.json` und `chrome-install-sources.json` per GPO/Intune aus (ohne Skript).

### Linux / macOS

```bash
curl -fsSL "https://IHRE-VAULT-URL/help/install/extension-user.sh" | TEAMVAULT_URL="https://IHRE-VAULT-URL" bash
```

Chrome/Edge unter Linux benötigen ebenfalls IT-Richtlinien.

## Firefox

TeamVault ist nicht im Mozilla-Add-on-Store (internes, selbst gehostetes Add-on, ID `teamvault@local`).

### Temporär (ein PC, Test)

1. `teamvault-extension.zip` von `/downloads/` entpacken.
2. `about:debugging#/runtime/this-firefox` → **Temporäres Add-on laden** → `manifest.json` im Ordner wählen.
3. Gilt bis zum nächsten Firefox-Neustart.

### Dauerhaft (Unternehmen)

IT legt eine Firefox-[`policies.json`](https://mozilla.github.io/policy-templates/) ab, z. B. mit Vorlage `/downloads/extension/firefox-policy.json`:

- `Extensions.Install` → URL zu `https://IHRE-VAULT-URL/downloads/teamvault-extension.xpi`
- oft zusätzlich `xpinstall.signatures.required` = `false` (nur Enterprise-Policies)

## Erweitert: Entwicklermodus (Fallback)

Nur wenn die normale Installation nicht möglich ist:

```powershell
$env:TEAMVAULT_URL='https://IHRE-VAULT-URL'; irm "$env:TEAMVAULT_URL/help/install/extension.ps1" | iex
```

```bash
curl -fsSL "https://IHRE-VAULT-URL/help/install/extension.sh" | TEAMVAULT_URL="https://IHRE-VAULT-URL" bash
```

Lädt `teamvault-extension.zip`, entpackt lokal, dann **Entpackte Erweiterung laden** in `chrome://extensions`.

## Einrichten

1. Popup öffnen → Server-URL = Ihre TeamVault-URL.
2. Bei HTTPS: optionale Host-Berechtigung für die Domain erlauben.
3. Login (Tenant / User / Passwort) → Master-Passwort (nur lokal).

## Nutzen

1. Seite öffnen, die zur Secret-URL passt.
2. Popup → Eintrag filtern (Alle / Privat / Geteilt) → **Fill** oder **Copy**.
3. Ohne URL im Secret: Fill/Copy erlaubt. Mit URL: Aktion nur bei Domain-Match (Phishing-Schutz).

Admin: `scripts/pack-clients.ps1` erzeugt CLI + Extension-Artefakte (`dist/`) → im Docker-Image unter `/opt/teamvault/bundled-downloads`.
