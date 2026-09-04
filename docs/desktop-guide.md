# TeamVault Desktop – Kurzanleitung

Native Desktop-App für Linux und Windows (Wails v2 / Go). **Reine Vault-Funktionen** — keine Konto-&-Sicherung- oder Administrations-Screens; diese bleiben der Web-UI vorbehalten. Nutzt denselben Zero-Knowledge-Server (REST-API) wie Web-UI, `tvcli` und die Browser-Extension: Entschlüsselung findet ausschließlich lokal im Desktop-Prozess statt, niemals auf dem Server.

Interaktive Fassung auf der laufenden Instanz: **`/help/desktop`**.

![Konto & Sicherheit → Clients](images/account-clients.png)

Download: In der Web-App unter **Konto & Sicherheit → Clients** oder Hilfe **`/help/desktop`** — empfohlenes Artefakt für die erkannte Plattform, alternative Artefakte (AppImage/Installer) sowie alle Downloads (sichtbar nur, wenn der Plattform-Administrator die Desktop-Integration unter **Administration → Client-Integrationen** aktiviert hat; `/downloads/` bleibt immer verfügbar).

![Hilfe → Desktop-App](images/help-desktop-download.png)

## Was die App kann

| Bereich | Funktion |
|---------|----------|
| Vault | Secrets ansehen/anlegen/bearbeiten/löschen, Suche, Ordner, Favoriten, TOTP-Code-Anzeige |
| Offline | Ciphertext-Snapshot lokal zwischengespeichert (max. 30 Tage) — Lesen ohne Netzwerk möglich; Anlegen/Ändern/Löschen nur online |
| Tray | Icon in der Systemleiste: Öffnen / Sperren / Beenden; Fenster schließen minimiert optional in den Tray statt zu beenden |
| Autostart | Ein/Aus in den Einstellungen — ganz ohne Admin-/Root-Rechte |

**Nicht enthalten** (bewusst — dafür Web-UI nutzen): Onboarding/Registrierung, Passwort-/2FA-Selbstverwaltung, Sharing-Verwaltung (Empfänger hinzufügen/entziehen), jegliche Tenant- oder Plattform-Administration.

## Installation (ohne Adminrechte)

### Windows

1. `teamvault-desktop-windows-amd64.exe` vom Release herunterladen.
2. Direkt ausführen (portable — kein Installer nötig, kein UAC-Prompt).
3. Optional: `teamvault-desktop-windows-amd64-setup.exe` — Installer im **Pro-Benutzer-Modus** (schreibt nur ins Benutzerprofil `%LOCALAPPDATA%`, keine Adminrechte erforderlich).

### Linux

1. Portables Binary: `teamvault-desktop-linux-amd64` herunterladen, `chmod +x`, ausführen.
2. **Oder** AppImage: `teamvault-desktop-linux-amd64.AppImage` herunterladen, `chmod +x`, ausführen — keine Installation, kein root nötig.

WebKitGTK (`libwebkit2gtk-4.1`) muss auf dem System vorhanden sein (auf den meisten Desktop-Distributionen bereits installiert); die AppImage-Variante bündelt keine System-Bibliotheken wie GTK/WebKit selbst.

## Erste Schritte

1. **Server-URL + Mandant** eingeben → „Weiter“.
2. **Login** (Benutzername/Passwort, ggf. TOTP-Code) — identisch zum Web-Login.
3. **Master-Passwort** zum Entsperren des Vaults (verlässt nie das Gerät).
4. Vault-Liste: Suche, Ordner-Filter, Favoriten, Secret öffnen zum Ansehen/Kopieren/TOTP.

![Desktop-App – Vault-Ansicht](images/help-desktop.png)

Nach jedem erfolgreichen Online-Entsperren wird automatisch ein Ciphertext-Snapshot lokal aktualisiert (Einstellungen → „Offline-Sync“ auch manuell möglich).

## Offline nutzen

- Ohne Netzwerkverbindung: „Offline öffnen“ auf dem Verbinden-Bildschirm, dann Master-Passwort eingeben.
- Es wird ein gelber **Offline-Modus**-Hinweis angezeigt; Anlegen/Ändern/Löschen ist deaktiviert, bis wieder online entsperrt wurde.
- Cache-Gültigkeit: 30 Tage seit letztem Online-Sync (wie die Offline-PWA des Web-UI, siehe [`offline-vault.md`](planning/offline-vault.md)).
- In den Einstellungen kann die lokale Offline-Kopie jederzeit gelöscht werden.

## Autostart & Tray

- **Einstellungen → Autostart**: registriert einen reinen Pro-Benutzer-Eintrag (Windows: `HKCU\...\Run`; Linux: `~/.config/autostart/*.desktop`) — kein root/Admin nötig, wirkt nur für den aktuellen Benutzer.
- **Tray-Icon**: Rechtsklick/Klick → Öffnen, Sperren, Beenden. „Schließen minimiert in den Tray“ ist in den Einstellungen umschaltbar.

## Selbst bauen

```bash
./scripts/build-desktop.sh        # Linux: Binary + AppImage
```

```powershell
.\scripts\build-desktop.ps1              # Windows: portable .exe
.\scripts\build-desktop.ps1 -Installer   # zusätzlich Pro-Benutzer-NSIS-Installer
```

Quellcode: [`clients/desktop`](../clients/desktop) (eigenes Go-Modul, referenziert `internal/cryptocore` des Hauptmoduls). CI (Tag `v*`): `.github/workflows/release.yml`, Jobs `desktop-linux` / `desktop-windows`.
