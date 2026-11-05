# TeamVault – Offline-Vault (Ciphertext-Cache + PWA)

**Status:** STANDARD in Web und Desktop; FIDO2-PRF für HARDWARE und COMBINED in Web/PWA implementiert. Plattform und Tenant können Mindestfaktoren vorgeben. Desktop-FIDO2, TPM und weitere Richtlinien stehen aus.
**Bezug:** Sicherheitsprinzipien 1–5, 7–9; OQ-04, OQ-12, OQ-17, OQ-19; [`crypto-design.md`](crypto-design.md)  
**Nicht Ziel:** Native Mobile-Apps, Bitwarden-Protokoll, Write-Queue v1

---

## 1. Problem

TeamVault ist heute ein **Online-Vault**: Login (lokal/LDAP + ggf. TOTP im zweiten Schritt) braucht den Server, Unlock holt `encrypted_private_key` per API, Secrets kommen paginiert vom Server. Ohne Firmennetz / ohne Route zur Instanz gibt es keinen Zugriff.

Bestehende Näherungen reichen nicht:

| Mechanismus | Warum kein Offline-Vault |
|-------------|--------------------------|
| In-Memory-`secretsCache` (`app.js`) | Verschwindet bei Tab-Close / Reload |
| `.tvbak` | Manuell; enthält nach Entpacken **Klartext**; Restore legt **neue** Secrets an |
| Browser-HTTP-Cache | Statische App-Shell wird per `no-store` ausgeliefert; Service Worker umgeht den HTTP-Cache für Netzwerk-Assets und verwendet nur den versionierten Offline-Shell-Cache |
| CLI | Kein lokaler Stand; jeder Aufruf braucht API |

PWA allein löst das **nicht**: ein Service Worker kann die App-Shell (HTML/JS/Crypto-Libs) offline liefern, aber ohne lokal vorgehaltene Ciphertexts bleibt der Vault leer.

---

## 2. Empfohlene Lösung

**Zwei Schichten, beide nötig:**

1. **Verschlüsselter Snapshot in IndexedDB** (Opt-in pro Gerät; nur mit dem eingerichteten zusätzlichen Schlüssel synchronisierbar)
2. **PWA-light** (Web App Manifest + Service Worker) für App-Shell ohne Netz

Das Profil **STANDARD** verlangt Master-Passwort und einen unabhängigen, clientseitig erzeugten 256-Bit-Software-Key. Ein zufälliger 256-Bit-DEK verschlüsselt den vollständigen Snapshot mit AES-256-GCM; HKDF-SHA-256 leitet aus dem Software-Key den Schlüssel zum Wrappen des DEK ab. Identität, Origin, Profil, Faktoren, Policy-Version und Keyslot-Metadaten sind als AAD authentifiziert. Der Key wird nie mit dem Cache gespeichert und bei Sperren aus dem Arbeitsspeicher entfernt.

Im Web verwenden **HARDWARE** und **COMBINED** versionierte FIDO2-PRF-Keyslots. Jeder registrierte Key kann einen zufälligen gemeinsamen Root-Key öffnen; bei COMBINED leitet HKDF den Slot-Key aus PRF-Ergebnis **und** Software-Key ab. Der Root-Key schützt den zufälligen Snapshot-DEK. User-Präsenz und Verifikation sind erforderlich, ein fehlendes PRF-Ergebnis wird abgelehnt. Beim Entfernen eines Keys werden Root-Key und Keyset-ID rotiert und alle verbleibenden Keys erneut bestätigt, bevor die Kopie atomar ersetzt wird.

Beispiel für STANDARD:

```text
Online (Firmennetz)
  Login (LDAP/lokal + TOTP) → Session
  Master-Passwort → SK im RAM
  API: Keys + Secret-Ciphertexts + Envelopes
       └─ Ciphertext-Snapshot → AES-256-GCM mit zufälligem DEK
            └─ DEK per unabhängigem Software-Key gewrappt → IndexedDB

Offline (kein Netz / nicht im Firmennetz)
  Service Worker liefert UI + cryptocore.js
  Kein Login, keine Session, kein LDAP
  Software-Key → DEK → Snapshot im RAM
  Master-Passwort → SK aus cached encrypted_private_key
  Lesen und Entschlüsseln im RAM
  Schreiben: gesperrt (v1)
```

---

## 3. Was lokal liegt — und was nie

IndexedDB speichert einen **authentifizierten, durch das gewählte Profil verschlüsselten Snapshot**:

| Objekt | Persistiert? |
|--------|----------------|
| Verschlüsselter Snapshot mit `encrypted_private_key`, Salt/Nonce, Argon2-Params und Secret-Ciphertexts | Ja |
| Snapshot-DEK und ggf. FIDO2-Root-Key, mit HKDF-SHA-256/AES-256-GCM geschützt | Ja, nur als gewrappter Ciphertext |
| Nicht geheime Envelope-Metadaten (Identität, Origin, Profil, Faktoren, TTL, Keyslot) | Ja, kryptografisch als AAD gebunden |
| Software-Key, FIDO2-PRF-Ergebnis, unverschlüsselter Root-Key, Master-Passwort, MK, SK, DK | **Nein** (nur RAM; Key und Vault-Schlüssel werden beim Sperren verworfen) |
| Login-Passwort, TOTP-Secret, Session-Cookie | **Nein** |
| Entschlüsselte Titel/Payloads und Key-Datei-Inhalt | **Nein** (keine Speicherung in IndexedDB/localStorage/Einstellungen) |

Kein zweites Backup-Passwort (im Gegensatz zu `.tvbak`). Unlock-Pfad bleibt der bestehende: Argon2id → MK → SK → Envelope → DK → Payload.

`.tvbak` bleibt das **manuelle** Migrations-/Backup-Format. Der Offline-Cache ist kein Export und kein Restore.

---

## 4. Warum IndexedDB + PWA (und nicht nur eins von beiden)

| Ansatz | Urteil |
|--------|--------|
| Nur Service Worker cached `/api/secrets` | Ungeeignet: Session-gebunden, schwer zu TTL/Wipe, Klartext-Risiko falls je Metadaten klar wären; SW soll **keine** Vault-API cachen |
| Nur IndexedDB ohne PWA | Daten da, aber ohne installierte PWA-Shell fehlen nach Browser-Neustart weiterhin die benötigten App-Assets |
| Native App / Extension als einziger Offline-Weg | Extension hat eigenen Origin (kein shared IndexedDB); native Apps sind Roadmap-deferred |
| `.tvbak` automatisch nach Disk schreiben | UX schlecht; Klartext-in-Hülle; Restore-Semantik falsch |
| Write-Queue (offline anlegen/ändern) | Konflikte, Audit, Rotation/Entzug — **nicht v1** |

PWA-Voraussetzung: **Secure Context** (HTTPS oder localhost). Internes HTTP ohne TLS: App-Shell-Offline fällt aus; Ciphertext-Cache in IndexedDB kann trotzdem helfen, solange der Tab/die installierte Shell schon geladen war. Install-Guide muss TLS für Offline-PWA festhalten (konsistent Roadmap 13.4).

---

## 5. Ablauf

### 5.1 Erstmalig online (Einrichtung)

1. User loggt sich wie bisher ein und entsperrt mit Master-Passwort.
2. Tenant-Policy erlaubt Offline (`offline_cache_allowed`, Default: an, Admin kann aus).
3. Prompt einmalig: **„Vault auf diesem Gerät auch ohne Netzwerk vorhalten?“** — explizites Opt-in, kein stilles Spiegeln auf fremde/gemeinsame PCs.
4. Unter **Konto → Offline-Vault** ein zulässiges Profil wählen. Für STANDARD oder COMBINED einen Software-Key erzeugen und herunterladen oder eine Key-Datei laden; TeamVault hält ihn nur im Arbeitsspeicher. Für HARDWARE oder COMBINED mindestens einen FIDO2-Key registrieren.
5. Explizit synchronisieren: zugängliche Secrets nachladen, vollständigen Snapshot verschlüsseln und die Keyslots speichern.
6. Manifest erlaubt „Zum Startbildschirm / App installieren“.

Die WebUI kann HARDWARE oder COMBINED mit einem oder mehreren externen FIDO2-Keys einrichten. Browser und Key müssen WebAuthn-PRF und Benutzerverifikation unterstützen; HTTPS mit DNS-Namen oder `localhost` ist erforderlich. COMBINED benötigt zusätzlich den Software-Key.

### 5.2 Jede weitere Online-Session

Nach Online-Unlock und explizitem Sync: Snapshot **ersetzen** (nicht mergen). Dafür müssen die zum Profil gehörenden Faktoren verfügbar sein: der Software-Key bei STANDARD und COMBINED sowie ein registrierter FIDO2-Key bei HARDWARE und COMBINED. So verschwinden serverseitig rotierte/entzogene Einträge beim nächsten Sync. Pagination: Cache-Job lädt restliche Seiten, bis `total` erreicht.

### 5.3 Offline öffnen

1. `GET /api/me` bzw. Login schlägt fehl / `navigator.onLine === false`.
2. UI: Banner **Offline** + Master-Passwort und die zum Profil gehörenden Keys (kein LDAP, kein Offline-TOTP).
3. Snapshot vorhanden, nicht abgelaufen und Origin/Identität gültig → die erforderlichen Keys geben den DEK frei; danach entschlüsselt das Master-Passwort den privaten Benutzerschlüssel.
4. Liste/Detail aus Snapshot; Anlegen, Teilen, Rotieren, Import: disabled mit Hinweis „Nur online“.
5. Idle-Lock unverändert (SK aus RAM, Ciphertext bleibt in IndexedDB).

### 5.4 Zurück online

Nächster erfolgreicher Login+Unlock ermöglicht mit den für das Profil erforderlichen Keys einen expliziten Sync, der den Snapshot ersetzt. UI-Hinweis bei abgelaufenem oder älterem Snapshot.

---

## 6. Policy, TTL, Wipe

Ohne Steuerung wäre jedes entsperrte Notebook eine Kopie des User-Vaults. Deshalb **Tenant-Policy + Geräte-Opt-in**.

| Einstellung | Vorschlag |
|-------------|-----------|
| `offline_cache_allowed` | Plattform-Admin, Default **an** (`nil` = erlaubt) |
| `offline_key_requirement` | Plattform und Tenant: `ANY`, `SOFTWARE`, `HARDWARE` oder `COMBINED`; wirksam ist die Vereinigung der geforderten Faktoren |
| Max. Alter | **30 Tage** (fest in `offline-store.js`, `TTL_MS`) |
| Opt-in pro Browserprofil | Pflicht; `localStorage` `tv-offline-optin` |
| Faktor | Master-Passwort + Software-Key (STANDARD), FIDO2 (HARDWARE) oder beide (COMBINED, nur Web) |
| Software-Key-Aufbewahrung | Nur externer Download oder manuelle Eingabe; nie in Anwendungsspeichern |
| Logout | **Cache behalten** (kein Wipe) |
| Idle-Lock / Tab zu | Verschlüsselter Snapshot bleibt; Software-Key und SK werden aus dem Arbeitsspeicher entfernt |
| User deaktiviert / Rechte entzogen | Wirkt **erst beim nächsten Online-Sync**; bis TTL bleibt alte Kopie (siehe §7) |

Zusätzlich: sichtbarer Status „Zuletzt synchronisiert … · Offline möglich bis …“.

Die aktuellen Web- und Desktop-Clients fragen die Richtlinie vor dem Erstellen und unmittelbar vor dem Speichern der Kopie erneut ab. Sie binden die dabei wirksame Schlüsselanforderung authentifiziert an neue Kopien; ändert sich diese während des Syncs, muss der Vorgang wiederholt werden. Neue FIDO2-Kopien authentifizieren zusätzlich die vollständige Keyslot-Liste; beim Hinzufügen eines Keys wird der Snapshot neu versiegelt. Fehlt die Schlüsselrichtlinie oder ist sie unbekannt, wird der Sync verweigert. Desktop unterstützt derzeit nur STANDARD und kann deshalb bei verpflichtendem FIDO2 keinen neuen Cache erstellen. Ältere bereits geschützte Kopien ohne diese Richtlinienmetadaten bleiben lesbar und erhalten sie beim nächsten Sync. Ältere oder manipulierte Clients können die Vorgabe ignorieren; bereits gespeicherte oder kopierte Caches bleiben nutzbar.

---

## 7. Sicherheitsfolgen (bewusst)

Der Cache ist ein zusätzlich verschlüsselter Snapshot aus Ciphertexts. Bei Profilen mit Software-Key ist der Schutz gegen Cache-Diebstahl nur unabhängig, solange ein Angreifer nicht gleichzeitig auf die Key-Datei zugreifen kann. Liegen beide Dateien auf demselben Gerät, kann vollständiger Dateisystemzugriff beide offenlegen.

| Risiko | Bewertung / Gegenmaßnahme |
|--------|---------------------------|
| Gestohlenes Notebook, OS entsperrt | Die zusätzlichen Profilfaktoren bleiben erforderlich; wenn eine benötigte Software-Key-Datei dort liegt, kann sie mit dem Cache entwendet werden. BitLocker/FileVault voraussetzen |
| Software-Key und Cache gemeinsam gestohlen | Master-Passwort bleibt erforderlich, um den privaten Benutzerschlüssel zu öffnen |
| Offline **ohne** Login-2FA | TOTP/LDAP schützen nur den Server-Login. Offline sind das Master-Passwort und die zusätzlichen Faktoren des gewählten Profils erforderlich |
| Rechteentzug während Offline | User liest alte Version bis TTL/Sync. Unvermeidbar bei jeder lokalen Kopie (auch `.tvbak`). Kurz TTL + Rotation bleibt serverseitig Pflicht |
| XSS liest IndexedDB | Cache ist zusätzlich verschlüsselt; kompromittiertes Client-JavaScript kann geladene Faktoren abgreifen. CSP beibehalten, SW nicht `eval` |
| Gemeinsamer Arbeitsplatz | Opt-in + „Gerät löschen“; kein Cache auf nicht persönlichem Gerät |
| Unlock per Windows-Hello / PIN statt MP | **Verboten** (OQ-04) — kein MK hinter Platform-Authenticator |

Alle Profile ergänzen den bestehenden Master-Passwort-Schutz. FIDO2-Hardware wird nicht attestiert: Browser- und WebAuthn-Prüfungen belegen ohne Attestation nicht die Echtheit physischer Hardware. Die TTL hängt von Clientsoftware und lokaler Uhr ab; kopierte Caches und vollständige Rollbacks lassen sich offline nicht zuverlässig widerrufen. TPM, Desktop-FIDO2, Offline-TOTP und zusätzliche Policy-Optionen wie variable TTL sind nicht implementiert.

---

## 8. PWA-Umsetzung (Web, Vanilla)

Die Web-Shell nutzt ein Manifest und einen Service Worker; die folgende Übersicht beschreibt die Offline-Bausteine.

| Baustein | Inhalt |
|----------|--------|
| `manifest.webmanifest` | `name`, `start_url: "/"`, `display: standalone`, Icons, Theme-Farbe (Brand) |
| Service Worker | **Precache** der Shell: `index.html`, `app.js`, `cryptocore.js`, `vault-io.js`, `import-parse.js`, `styles.css`, Vendor-WASM/JS. **Network-only** für `/api/*` — Vault-Daten nie im Cache Storage |
| Registration | Nur bei `window.isSecureContext`; Update via `skipWaiting` + Reload-Hinweis |
| CSP | `worker-src 'self'`; `manifest-src 'self'` |
| Air-Gap (OQ-19) | Keine CDN-Icons; Icons lokal |

Install-Prompt: dezent nach erfolgreichem Opt-in, nicht vor Login.

**LDAP:** Offline entfällt der Bind. Das ist akzeptabel, weil der Vault ohnehin am Master-Passwort hängt, nicht am Login-Passwort. UI muss das nicht als „Login übersprungen“ verstecken, sondern als „Offline-Entsperren“.

---

## 9. Client-Schnittstellen (v1 vs. später)

| Client | v1 | Später |
|--------|----|--------|
| Web-UI | IndexedDB + PWA, read-only offline | Optional Schreib-Queue |
| Desktop | STANDARD mit lokaler, verschlüsselter Kopie, read-only offline | Native FIDO2- und TPM-Integration |
| Browser-Extension | unverändert (Memory-only, Zero-Knowledge im SW) | Eigener Cache im Extension-Origin, nicht mit Web teilen |
| `tvcli` | unverändert | `tvcli vault sync` → Datei analog Snapshot (Ciphertext) |

Kein Shared-Storage zwischen Web und Extension (verschiedene Origins). Bewusst getrennt halten.

---

## 10. Implementierungsschnitte

Nicht alles in einem PR.

| Schnitt | Lieferobjekt |
|---------|----------------|
| **A – Cache-Kern** | **umgesetzt** |
| **B – Vollständiger Snapshot** | **umgesetzt** (Delta-Sync, Fortschritt, atomarer Commit, TTL-Hinweise) |
| **C – PWA** | **umgesetzt** (`manifest.webmanifest`, `sw.js`, CSP `worker-src`/`manifest-src`, lokales Icon) |
| **D – Policy** | Offline-Erlaubnis und minimale Software-/Hardware-Faktoren auf Plattform- und Tenant-Ebene; weitere Policy-Optionen stehen aus |
| **E – Docs** | aktualisiert (Web, Desktop, Admin, Installation) |
| **F – STANDARD-Keyschutz** | Web und Desktop umgesetzt (AES-256-GCM-DEK, HKDF-SHA-256-Keyslot, Software-Key-Datei) |
| **G – Web-FIDO2** | HARDWARE/COMBINED mit PRF, mehreren Keyslots und Root-Key-Rotation beim Entfernen |

Web-Regressionen: `node --test web/tests/*.mjs`. Für den Chromium-Test mit virtuellen FIDO2-Authentikatoren nach Installation der bestehenden `scripts`-Abhängigkeiten (`npm ci --prefix scripts` und ggf. `npx --prefix scripts playwright install chromium`): `node --test scripts/test-offline-hardware.mjs`. Ein virtueller Authentikator ersetzt keinen Test mit einem physischen Key.

Akzeptanz Schnitt A+B (Minimum sinnvolles Feature):

- Online entsperren + Opt-in + Software-Key laden → Sync → Airplane-Mode → Reload → Master-Passwort und Software-Key → Secrets lesbar
- Logout „Gerät löschen“ → Offline-Unlock unmöglich
- TTL abgelaufen → Unlock blockiert mit Hinweis
- DevTools IndexedDB enthält keine Klartext-Passwörter/Titel
- `/api/*` erscheint nicht im SW-Precache

---

## 11. Offene Produktentscheidungen

Noch nicht verbaut, in Admin-UI-Defaults festzulegen:

1. Default `offline_cache_allowed` an oder aus (Compliance-Tenants)?
2. Default TTL 7 vs. 30 Tage?
3. Logout: Cache behalten vs. immer wischen (Empfehlung: behalten + expliziter Wipe)?
4. Extension-Offline in derselben Phase oder bewusst Web-first?

---

## 12. Abgrenzung

| Nicht in diesem Feature | Grund |
|-------------------------|--------|
| Offline **schreiben** / Sync-Queue | Konflikte, Audit, Rotation |
| Unlock ohne Master-Passwort (PIN, Hello, Passkey) | OQ-04 |
| Desktop-FIDO2, TPM, Offline-TOTP und erweiterte Richtlinien | Noch nicht implementiert; im Desktop nur STANDARD verfügbar |
| Klartext oder entschlüsselte Titel in IndexedDB | Prinzip 1 + Checklist |
| API-Responses im Service Worker cachen | Session-/Auth-Leak, falsche Semantik |
| Native iOS/Android | deferred (Roadmap 13.4 nativ) |
| `.tvbak` als Cache-Format | Klartext-Export-Semantik |

---

## 13. Verwandte Dokumente

- [`crypto-design.md`](crypto-design.md) — Schlüsselhierarchie, Offline-Brute-Force
- [`architecture.md`](architecture.md) — Clients sehen Klartext nur lokal
- [`roadmap-phase9plus.md`](roadmap-phase9plus.md) — 13.4 PWA-light bisher deferred
- [`open-questions.md`](open-questions.md) — OQ-04, OQ-17, OQ-19
- `SECURITY-REVIEW-CHECKLIST.md` — keine Secrets in `localStorage`
