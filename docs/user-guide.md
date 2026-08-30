# TeamVault – User Guide

Anleitung für den Alltag: Anmelden, Vault nutzen, teilen, Absichern.  
Installation: [Installationsanleitung](install-guide.md) · Betrieb: [Admin Guide](admin-guide.md).

Version und Entwickler (Timo Braun) sehen Sie unten in der App bzw. unter Login.

![Login](images/login.png)

## 1. Zwei Passwörter — warum?

| Geheimnis | Zweck |
|-----------|--------|
| **Login-Passwort** (oder Passkey + optional TOTP) | Session beim Server |
| **Master-Passwort** | Entschlüsselt Ihren privaten Schlüssel **nur im Browser** |

Der Server sieht niemals Ihr Master-Passwort und niemals Klartext-Secrets (Zero-Knowledge).

## 2. Erste Anmeldung

1. URL Ihrer Instanz öffnen → **Login**
2. **Organisation** (Dropdown der Mandanten), Username, Login-Passwort (TOTP falls aktiv)
3. Optional **Passkey** statt Passwort (wenn registriert)

Die zuletzt gewählte Organisation wird im Browser gemerkt. Bei genau einem Mandanten ist dieser vorausgewählt.

Oben rechts: **Hilfe** (ohne Login) öffnet die Client-Anleitungen unter `/help`. Hinweis unter dem Formular: Version und Entwickler. Passkeys betreffen nur den Login — der Vault braucht weiterhin das Master-Passwort.

Nach dem Login (oder nach Onboarding) erscheint **Vault entsperren**:

![Vault entsperren](images/vault-unlock.png)

## 3. Vault-Onboarding (einmalig)

Beim ersten Vault-Zugriff:

1. Master-Passwort wählen (≥12 Zeichen) und wiederholen  
2. **Schlüssel erzeugen** (läuft lokal im Browser)  
3. **Recovery-Kit** einmalig sicher speichern (Passwortmanager offline, Tresor, …)  
4. Weiter zur App

![Onboarding](images/onboard.png)

![Recovery-Kit](images/onboard-recovery-kit.png)

Ohne Master-Passwort **und** ohne Recovery-Kit (bzw. ohne Admin-Escrow-Prozess) sind Ihre Secrets **nicht wiederherstellbar**.

## 4. Vault entsperren

Nach dem Login erscheint **Vault entsperren**. Master-Passwort eingeben → **Entsperren** (auch mit **Enter**).

- Bei Inaktivität (Default ca. 15 Minuten) sperrt die App den Vault erneut (opakes Overlay).
- Logout beendet die Server-Session; der Schlüssel im Speicher wird gelöscht.

Oben rechts: Theme-Umschalter als **Sonne/Mond-Icon** (wird lokal gespeichert). Die Sidebar nutzt flache Inline-Icons neben den Menüpunkten. Auf schmalen Viewports: Menü-Taste öffnet die Sidebar (Schließen mit Backdrop oder **Escape**).

![Dark Theme](images/theme-dark.png)

## 5. Secrets

Nach dem Entsperren: linke **Sidebar** mit Icons. Unter Vault getrennt:

| Menü | Inhalt |
|------|--------|
| **Meine Secrets** | Einträge, die Sie angelegt haben (`created_by` = Sie) |
| **Geteilt mit mir** | Einträge mit Zugriff, die jemand anderes angelegt hat |
| **Neu anlegen** | Formular für einen neuen Eintrag |
| **Import** | Dateien aus anderen Passwortmanagern übernehmen |
| **Sicherung** | Verschlüsselte `.tvbak`-Backup / Wiederherstellen |

Kein vermischter „Alle“-Eintrag. Clientseitige **Suche** und **Ordner**-Filter gelten jeweils für die aktive Ansicht. In der Liste können Sie Einträge per Checkbox für den Export auswählen.

**Ansicht:** Standard ist **Tabelle**; Umschalter Liste / Tabelle / Kacheln (Preference lokal im Browser). Tabelle und Kacheln laden zusätzlich Benutzer, Tags und Favorit (clientseitig entschlüsselt); Liste zeigt Titel und Ordner.

![Meine Secrets – Tabelle (Standard)](images/vault-secrets-table.png)

![Meine Secrets – Liste](images/vault-secrets.png)

![Meine Secrets – Kacheln](images/vault-secrets-tiles.png)

![Navigation](images/nav-sidebar.png)

![Geteilt mit mir](images/vault-shared.png)

### Anlegen

Sidebar **Neu anlegen**: Titel, Ordner, Benutzername und Passwort sind immer sichtbar. Weitere Felder über **Feld hinzufügen**:

| Typ | Inhalt |
|-----|--------|
| Website (URL) | Mehrfach möglich |
| TOTP-Seed | base32 oder `otpauth://` |
| Notizen / Tags / Favorit | wie bisher |
| SSH Private/Public Key | Paste oder **Datei laden** |
| S3 Access / Secret Key | Zugangsdaten |
| Zertifikat (PEM) | Paste oder Datei |
| Freitext / Geheimnis | Custom-Felder |

Titel und Payload werden vor dem Upload verschlüsselt; der Server speichert nur Ciphertext.

Optional direkt beim Anlegen **User** und **Gruppen** zum Teilen auswählen (nur onboardete Ziele).

**Generator:** Länge und Symbole einstellen → **Generator** füllt das Passwortfeld (CSPRNG im Browser).

![Secret anlegen](images/vault-create.png)

### Öffnen & Bearbeiten

In der Liste **Öffnen** — Detail erscheint als **Modal** über der Liste (Schließen mit Button, Backdrop oder **Escape**). Klartext nur im Browser. Felder mit **Kopieren** / **Anzeigen**; Key/Zertifikat zusätzlich **Download**. Live-**TOTP** erscheint, wenn ein Seed hinterlegt ist. Mehrere Websites werden einzeln angezeigt.

**Bearbeiten** im Modal: Titel, Ordner, Benutzername, Passwort, Tags, Notizen — Speichern verschlüsselt clientseitig (`PUT /api/secrets/{id}`).

![Secret-Detail (Modal)](images/vault-secret-detail.png)

### Teilen

Im Secret-Detail einen anderen User wählen → **Teilen**.  
Jeder Empfänger erhält einen eigenen Umschlag um den Datenschlüssel (kein gemeinsames Gruppenpasswort). Empfänger müssen im gleichen Tenant **onboarded** sein.

Admins und Gruppenmitglieder können eine **Gruppe** wählen → **Gruppe teilen** (Mitglieder sehen nur eigene Gruppen; pro Mitglied eigener Envelope). Empfänger sehen den Eintrag unter **Geteilt mit mir**.

### Ordner

Beim Anlegen einen **Ordner**-Namen setzen. Die Liste filtert nach Ordner; die Suche trifft Titel und Ordnernamen (clientseitig).

![Ordner-Filter](images/vault-folder-filter.png)

### TOTP im Eintrag

Über **Feld hinzufügen → TOTP-Seed** (base32 oder `otpauth://`). In der Detailansicht erscheint der aktuelle 6-stellige Code mit Countdown und **Kopieren**.

### Mehrere Websites

Mehrfach **Website (URL)** hinzufügen. Import aus Bitwarden übernimmt alle `uris`. Die Extension matcht den aktiven Tab gegen jede hinterlegte URL.

### Import

Sidebar **Import**: Datei wählen. Unterstützte Formate:

- TeamVault JSON / verschlüsselte `.tvbak`
- Bitwarden JSON (Login-Einträge)
- KeePass XML, KeePassXC-CSV
- Chrome/Edge- und Firefox-CSV
- LastPass-CSV, 1Password-CSV, 1Password 1PUX (`export.data`)
- Proton Pass JSON
- generisches CSV (`title,username,password,url,…`)

Nach dem Parsen erscheint eine **Vorschau** — einzelne, mehrere oder alle Einträge anhaken, dann **Auswahl importieren**. Verschlüsselte `.tvbak` erst mit Backup-Passwort entsperren. Parsing und Verschlüsselung laufen nur im Browser; der Server sieht nur Ciphertext.

![Import](images/vault-import.png)

### Export

In der Secrets-Liste Einträge per Checkbox wählen (eines, mehrere, oder **Alle geladenen**). Ohne Auswahl gelten die **sichtbaren** Einträge (aktueller Ordner/Suche).

- **Export TeamVault** — vollständiges JSON inkl. Extra-Felder
- **Export Bitwarden** — Login-Subset, unverschlüsselt
- **Export CSV** — Klartext
- **Export verschlüsselt** — `.tvbak` mit eigenem Backup-Passwort (Argon2id)

Im Secret-Detail: **Dieses Secret exportieren**. Bestätigung, weil Klartext auf Disk landet (außer `.tvbak`). Es werden nur Einträge exportiert, die Sie entschlüsseln können — der Server sieht den Klartext nicht.

![Export-Buttons](images/vault-export.png)

### Sicherung (Backup / Restore)

Sidebar **Sicherung**: alle für Sie entschlüsselbaren Secrets als verschlüsselte `.tvbak` herunterladen. Wiederherstellen legt die Einträge **neu** an (bestehende bleiben). Backup-Passwort mindestens 12 Zeichen, getrennt vom Master-Passwort und Unlock-Key aufbewahren.

Instanz-weites Ciphertext-Backup (Tenants, User, Secrets): siehe [Admin Guide](admin-guide.md#5-backup).

### Zugriff entziehen

**Zugriff entziehen + rotieren** — Datenschlüssel wird neu erzeugt; alte Versionen sind ungültig. Die Rotation schreibt Ciphertext und neue Envelopes atomar (kein Zwischenzustand ohne gültige Umschläge).

### Löschen

**Löschen** entfernt den Eintrag (nicht rückgängig über den Server). Nur wer einen gültigen Envelope hat, darf löschen.

## 6. Konto: TOTP, Passkeys, Passwörter

Sidebar **Konto**:

![Konto](images/account.png)

### Login-2FA (TOTP)

1. **TOTP einrichten** → otpauth-URL in der Authenticator-App (**otpauth kopieren**)  
2. Code bestätigen → **Aktivieren**  
3. Beim nächsten Login Feld **TOTP** ausfüllen  

TOTP schützt das Login, **nicht** die Vault-Entschlüsselung.

### Passkeys

1. **Passkeys** → Namen vergeben → **Registrieren** (Browser/OS-Dialog)  
2. Beim Login: Tenant + Username → **Passkey**  

Passkeys ersetzen nur das Login — das Master-Passwort bleibt für den Vault nötig.

### Login-Passwort ändern

Nur bei **lokalem** Auth-Backend: aktuelles + neues Login-Passwort (≥12) → **Login-Passwort speichern**. LDAP-User ändern das Passwort in AD.

### Master-Passwort ändern

Aktuelles und neues Master-Passwort eingeben → **Master-Passwort speichern**. Der Private Key wird **nur im Browser** neu versiegelt; der Server speichert neue Ciphertexte. Bei Recovery-Modus `user_kit` erscheint ein neues Recovery-Kit (einmalig sichern).

## 7. Browser-Extension

Kurzanleitung in der App: Sidebar **Hilfe** bzw. Login **Hilfe** → **Browser-Extension**, oder direkt `/help/extension`. Markdown: [`docs/extension-guide.md`](extension-guide.md).

![Hilfe Extension](images/help-extension.png)

Kurz: Extension laden → Server-URL → Login/Unlock → auf passender Website **Fill** / **Copy** (nur bei Domain-Match).

## 8. CLI (`tvcli`)

Kurzanleitung: **Hilfe → CLI** bzw. `/help/cli`. Markdown: [`docs/cli-guide.md`](cli-guide.md).

![Hilfe CLI](images/help-cli.png)

Einzeiler und Alltagsbefehle stehen dort. API-Keys brauchen mindestens einen Scope:

| Scope | Erlaubt |
|-------|---------|
| `read` | GET-Allowlist (me, Vault-Status/Keys, Secrets Liste/Detail, eigene Gruppen) |
| `vault` | Secret-/Vault-Schreibaktionen (zusätzlich zu lesenden GETs) |
| `admin` | `/api/admin/*` (zusätzlich User-Rollen nötig) |

Nur `read` → keine Admin- oder Schreibaktionen. Cookie-Login ohne API-Key ist nicht scope-beschränkt.

**Legacy-Keys** (vor Scope-Pflicht angelegt, ohne `scopes`): nur lesende GET-Requests — für Automation/CLI neuen Key mit passenden Scopes ausstellen lassen.

## 9. Gute Praxis

- Master-Passwort lang und einzigartig; Recovery-Kit offline sichern  
- Login-Passwort ≠ Master-Passwort  
- Nach Teilen nur notwendige Personen; bei Austritt Admin um Entzug/Rotation bitten  
- Öffentliche/geteilte Rechner: nach Nutzung **Logout** und Browser schließen  
- Phishing: nur die bekannte Firmen-URL verwenden; Extension Fill/Copy nur bei Host-Match  
- Klartext-Export (JSON/CSV) sicher ablegen und zeitnah löschen  
- `.tvbak` und Backup-Passwort getrennt vom Unlock-Key und Master-Passwort aufbewahren  

## 10. Hilfe

Übersicht Web-App / CLI / Extension auf der Instanz unter **`/help`** (auch Sidebar **Hilfe** oder Login-Header):

![Hilfe Übersicht](images/help.png)

| Problem | Tipp |
|---------|------|
| Login ok, Vault nicht | Master-Passwort / Caps-Lock; Idle-Sperre |
| Recovery nötig | Kit + Anleitung des Admins (Escrow vs. User-Kit) |
| Passkey fehlt | Neu registrieren; Gerät/OS-Support prüfen |
| Secret „kein Zugriff“ | Noch nicht geteilt oder Rechte entzogen |
| Fill/Copy blockiert | Secret-URL passt nicht zum Tab-Host |
| Import leer / Format? | Vorschau prüfen; KeePass nur XML (kein `.kdbx`); `.tvbak` braucht Backup-Passwort |
| CLI/Extension-Install | `/help/cli` bzw. `/help/extension`; Admin muss `/downloads/` befüllen |

Technische API: [openapi.yaml](openapi.yaml) · Installation: [install-guide.md](install-guide.md) · Admin: [admin-guide.md](admin-guide.md)
