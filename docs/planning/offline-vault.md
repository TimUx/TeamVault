# TeamVault – Offline-Vault (Ciphertext-Cache + PWA)

**Status:** Schnitt 1–3 umgesetzt (ab v1.3.0, produktiv)  
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
| Browser-HTTP-Cache | Kein strukturiertes Vault-Snapshot; Session-Cookies helfen offline nicht |
| CLI | Kein lokaler Stand; jeder Aufruf braucht API |

PWA allein löst das **nicht**: ein Service Worker kann die App-Shell (HTML/JS/Crypto-Libs) offline liefern, aber ohne lokal vorgehaltene Ciphertexts bleibt der Vault leer.

---

## 2. Empfohlene Lösung

**Zwei Schichten, beide nötig:**

1. **Ciphertext-Snapshot in IndexedDB** (automatisch nach Online-Unlock, opt-in pro Gerät)
2. **PWA-light** (Web App Manifest + Service Worker) für App-Shell ohne Netz

Modell wie Bitwarden/Vaultwarden: einmal online anmelden und entsperren, danach auf dem **selben Browserprofil** lesen, solange der Snapshot gültig ist. Entschlüsselung weiter **nur im Speicher**, weiter **nur mit Master-Passwort** (Argon2id). Der Server sieht weiterhin nie Klartext.

```text
Online (Firmennetz)
  Login (LDAP/lokal + TOTP) → Session
  Master-Passwort → SK im RAM
  API: Keys + Secret-Ciphertexts + Envelopes
       └─ Kopie (weiterhin Ciphertext) → IndexedDB

Offline (kein Netz / nicht im Firmennetz)
  Service Worker liefert UI + cryptocore.js
  Kein Login, keine Session, kein LDAP
  Master-Passwort → SK aus cached encrypted_private_key
  Lesen aus IndexedDB, Entschlüsseln im RAM
  Schreiben: gesperrt (v1)
```

---

## 3. Was lokal liegt — und was nie

IndexedDB speichert **dieselben Blobs wie der Server**, nicht mehr:

| Objekt | Persistiert? |
|--------|----------------|
| `encrypted_private_key` + Salt/Nonce + Argon2-Params | Ja |
| Secret-Ciphertext, Titel-Ciphertext, Envelope, `key_version` | Ja |
| Snapshot-Metadaten (`user_id`, `tenant_id`, `synced_at`, TTL) | Ja |
| Master-Passwort, MK, SK, DK | **Nein** (nur RAM, Idle-Lock wie heute) |
| Login-Passwort, TOTP-Secret, Session-Cookie | **Nein** |
| Entschlüsselte Titel/Payloads | **Nein** (Checklist: keine Secrets in `localStorage`) |

Kein zweites Backup-Passwort (im Gegensatz zu `.tvbak`). Unlock-Pfad bleibt der bestehende: Argon2id → MK → SK → Envelope → DK → Payload.

`.tvbak` bleibt das **manuelle** Migrations-/Backup-Format. Der Offline-Cache ist kein Export und kein Restore.

---

## 4. Warum IndexedDB + PWA (und nicht nur eins von beiden)

| Ansatz | Urteil |
|--------|--------|
| Nur Service Worker cached `/api/secrets` | Ungeeignet: Session-gebunden, schwer zu TTL/Wipe, Klartext-Risiko falls je Metadaten klar wären; SW soll **keine** Vault-API cachen |
| Nur IndexedDB ohne PWA | Daten da, aber nach Browser-Neustart ohne Netz oft **kein** `app.js`/`cryptocore.js` (HTTP-Cache unzuverlässig) |
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
4. Hintergrund: alle für den User zugänglichen Secrets (Envelope vorhanden) nachladen, Snapshot schreiben.
5. Manifest erlaubt „Zum Startbildschirm / App installieren“.

### 5.2 Jede weitere Online-Session

Nach Unlock: Snapshot **ersetzen** (nicht mergen). So verschwinden serverseitig rotierte/entzogene Einträge beim nächsten Sync. Pagination: Cache-Job lädt restliche Seiten, bis `total` erreicht.

### 5.3 Offline öffnen

1. `GET /api/me` bzw. Login schlägt fehl / `navigator.onLine === false`.
2. UI: Banner **Offline** + Unlock nur Master-Passwort (kein LDAP, kein TOTP — ehrlich so labeln).
3. Snapshot vorhanden und nicht abgelaufen → Unlock über cached Key-Blob.
4. Liste/Detail aus Snapshot; Anlegen, Teilen, Rotieren, Import: disabled mit Hinweis „Nur online“.
5. Idle-Lock unverändert (SK aus RAM, Ciphertext bleibt in IndexedDB).

### 5.4 Zurück online

Nächster erfolgreicher Login+Unlock überschreibt den Snapshot. UI-Hinweis, falls `synced_at` älter als Schwellwert.

---

## 6. Policy, TTL, Wipe

Ohne Steuerung wäre jedes entsperrte Notebook eine Kopie des User-Vaults. Deshalb **Tenant-Policy + Geräte-Opt-in**.

| Einstellung | Vorschlag |
|-------------|-----------|
| `offline_cache_allowed` | Tenant-Admin, Default **an** (`nil` = erlaubt) |
| Max. Alter | **30 Tage** (fest in `offline-store.js`, `TTL_MS`) |
| Opt-in pro Browserprofil | Pflicht; `localStorage` `tv-offline-optin` |
| Logout | **Cache behalten** (kein Wipe) |
| Idle-Lock / Tab zu | Ciphertext bleibt; SK weg |
| User deaktiviert / Rechte entzogen | Wirkt **erst beim nächsten Online-Sync**; bis TTL bleibt alte Kopie (siehe §7) |

Zusätzlich: sichtbarer Status „Zuletzt synchronisiert … · Offline möglich bis …“.

---

## 7. Sicherheitsfolgen (bewusst)

Der Cache ist kryptographisch **äquivalent zu einem DB-Dump der User-Zeilen** auf dem Gerät. Das steht bereits im Threat Model („Offline-Brute-Force auf `encrypted_private_key`“ → Argon2id-Kosten).

| Risiko | Bewertung / Gegenmaßnahme |
|--------|---------------------------|
| Gestohlenes Notebook, OS entsperrt | Angreifer hat Ciphertext; ohne MP kein Klartext; BitLocker/FileVault voraussetzen (Doku) |
| Schwaches Master-Passwort | Gleiche Oberfläche wie Server-Dump; Tenant-Argon2 nicht aufweichen |
| Offline **ohne** Login-2FA | TOTP/LDAP schützen nur den Server-Login. Offline-Unlock = nur MP. Policy kann Cache verbieten |
| Rechteentzug während Offline | User liest alte Version bis TTL/Sync. Unvermeidbar bei jeder lokalen Kopie (auch `.tvbak`). Kurz TTL + Rotation bleibt serverseitig Pflicht |
| XSS liest IndexedDB | Wie XSS heute API-Ciphertexts lesen kann; SK weiter nur RAM; CSP beibehalten, SW nicht `eval` |
| Gemeinsamer Arbeitsplatz | Opt-in + „Gerät löschen“; kein Cache auf nicht persönlichem Gerät |
| Unlock per Windows-Hello / PIN statt MP | **Verboten** (OQ-04) — kein MK hinter Platform-Authenticator |

Kein zusätzliches Wrapping der Blobs mit einem Geräte-Schlüssel in v1: es würde eine zweite Unlock-Story erzeugen und OQ-04 berühren, ohne den Dump-Charakter zu ändern.

---

## 8. PWA-Umsetzung (Web, Vanilla)

Aktuell: `web/static/index.html` ohne Manifest/SW; CSP ohne `worker-src` (fällt auf `default-src 'self'` — SW von `/` ist damit grundsätzlich erlaubt, explizit setzen).

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
| **D – Policy** | **umgesetzt** (`offline_cache_allowed`, Admin-UI) |
| **E – Docs** | teilweise (Plan + Install-Hinweis HTTPS) |

Akzeptanz Schnitt A+B (Minimum sinnvolles Feature):

- Einmal online entsperrt + Opt-in → Airplane-Mode → Reload → Master-Passwort → Secrets lesbar
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
