# TeamVault – Roadmap Phase 9+

**Status:** Phasen 9–13 weitgehend umgesetzt (2026-08-26).  
**Weiter deferred (bewusst):** Bitwarden-Send / Einmal-Links, PWA/native Mobile, SCIM/IdP-Provisioning, Postgres-Driver.  
React-Frontend: **abgesagt** (Vanilla bleibt) — siehe OQ-01 / `docs/phase9-13-security-self-check.md`.  
Client-Export (JSON/CSV) und Self-Service Passwort-Wechsel: umgesetzt (Findings-Stufenplan Stufe 5).  
**Post-Stufenplan (2026-08):** atomare `RotateSecret`, API-Key-Scopes `read`/`vault`/`admin`, `GET /api/groups`, Secret-List-Batching, Trivy in CI, Extension Copy Host-Gate, Audit fail-hard auf kritischen Mutationen.

**Canvas:** interaktive Scorecard/Findings neben dem Chat (Cursor Canvas)  
**Ziel:** Notwendige vs. optionale Anpassungen in umsetzbare Phasen gliedern.

> Historische Scorecard/Findings unten beschreiben den Stand *vor* Phase 9–13 / Findings-/Post-Stufenplan und dienen der Nachvollziehbarkeit — aktuelle Ops-Checklist: `SECURITY-REVIEW-CHECKLIST.md`.

---

## Gesamteinschätzung

| Dimension | Score | Kurzfazit |
|-----------|------:|-----------|
| Funktion / MVP | 7.5/10 | Kernflows da; Suche, Gruppen-Share, Firefox, React fehlen |
| Security / ZK | 7/10 | ZK-Kern stark; Cookie Secure, TOTP-Seal, Sessions, Headers offen |
| Performance | 5/10 | N+1 Secret-Liste, keine Pagination, In-Memory-Sessions |
| UX / Einfachheit | 4.5/10 | Monolith-UI, Admin unterm Vault, JSON-Detail, `alert()`-Idle |
| Ops / Prod-Reife | 6.5/10 | Docker/CI ok; Runbooks, Multi-Instanz, Header-Hardening offen |
| Clients | 6/10 | `tvcli` standalone gut; Extension Autofill/Firefox dünn |

**Fazit:** Für einen internen Zero-Knowledge-MVP ist die fachliche und kryptografische Basis solide. Vor Betrieb mit echten Secrets sind **Phase 9 (Hardening)** und **Phase 10 (UX-Kern)** notwendig. **Phase 11** wird mit wachsender Datenmenge spürbar. Ab **Phase 12** optional.

---

## Stärken (nicht aufweichen)

1. Zero-Knowledge-Kern (`internal/cryptocore` + `web/static/cryptocore.js`) über Web / CLI / Extension
2. Sharing: Envelope pro User; Entzug ⇒ Rotation (Prinzip 7)
3. Hybrid-Auth: LDAP nur Login-Bind; Rechte lokal
4. Bootstrap: genau ein Unlock-Key; sealed Config
5. Testabdeckung über Phasen; Docker + CI + standalone `tvcli`

---

## Priorisierte Findings

| Schwere | Bereich | Finding | Referenz |
|---------|---------|---------|----------|
| Hoch | Security | Session-Cookie ohne `Secure` | `internal/server/server.go` |
| Hoch | Security | TOTP at-rest nur Base64, kein Config-AEAD | `internal/auth/totp/totp.go` |
| Hoch | Ops | Sessions + Login-Rate-Limit nur In-Memory | `internal/auth/session`, `mvp_gaps.go` |
| Mittel | Security | Kaum Security-Headers (CSP/HSTS/XFO) für Web-UI | HTTP-Handler |
| Mittel | Security | Extension `host_permissions: https://*/*` | `clients/extension/manifest.json` |
| Mittel | Perf | N+1: Liste decryptet Titel via `GET /secrets/{id}` | `web/static/app.js` |
| Mittel | UX | Admin + Vault eine Seite; Detail als JSON | `renderApp` / `openSecret` |
| Mittel | Funktion | Client-Suche fehlt (OQ-12) | UI |
| Mittel | Funktion | Recovery-Moduswechsel ohne Re-Onboard (OQ-03) | Admin/Tenant-API |
| Niedrig | Clients | Autofill naiv; kein Firefox-`browser`-Polyfill | `content.js` |
| Niedrig | Produkt | Geplant React/TS, geliefert Vanilla-JS-Monolith | `web/static` |

Weitere Punkte aus `SECURITY-REVIEW-CHECKLIST.md` bleiben vor Prod abzuhaken (TLS-Terminierung, Backup-Restore-Test, externes Audit).

---

## Phase 9 – Prod-Hardening *(notwendig)*

**Fokus:** Security- & Ops-Mindeststandard vor echten Secrets.

| # | Arbeitspaket | Akzeptanz |
|---|--------------|-----------|
| 9.1 | Cookie `Secure` wenn TLS / `X-Forwarded-Proto` | Cookie nur über HTTPS gesetzt |
| 9.2 | Origin/Referer-Check für Cookie-Session state-changing POSTs | Cross-Site POST ohne Origin abgelehnt |
| 9.3 | TOTP-Secret mit Config-Unlock-AEAD versiegeln | DB-Dump ohne Unlock-Key ≠ nutzbares TOTP |
| 9.4 | Security-Headers: CSP (strict-ish), `X-Content-Type-Options`, `frame-ancestors 'none'` | Header in Responses |
| 9.5 | Session-Store: persistiert (SQLite) **oder** dokumentiert Single-Node + Restart-Verhalten | Entscheidung + Umsetzung |
| 9.6 | Rate-Limit: dokumentieren / optional Redis-fähig | Multi-Node-Hinweis |
| 9.7 | Extension: `optional_host_permissions` oder Server-Whitelist | Manifest enger |
| 9.8 | CI: `govulncheck` / Image-Scan; Checklist-Walkthrough | Pipeline-Job grün |

**Nicht in 9:** React-Rewrite, neue Secret-Felder.

---

## Phase 10 – UX-Kern *(notwendig für Adoption)*

**Fokus:** Einfachheit, Haptik, klare mentale Modelle.

| # | Arbeitspaket | Akzeptanz |
|---|--------------|-----------|
| 10.1 | App-Shell: Navigation Vault / Konto / Admin (rollenabhängig) | Admin nicht unter Secrets-Scroll |
| 10.2 | Secret-Detail: Titel, User, Passwort, Notizen + Copy | Kein Raw-JSON als Default |
| 10.3 | Clientseitige Suche/Filter auf entschlüsselten Titeln | Filterfeld filtert Liste |
| 10.4 | Idle-Lock: Overlay „Vault gesperrt“ statt `alert()` | Kein Blocking-Dialog |
| 10.5 | Onboarding/Recovery-Kit: Download/Copy-Button, klare Warnung | Kit einmal speicherbar |
| 10.6 | Extension: besseres Form-Matching; `browser` Polyfill (Firefox) | Chrome, Edge, Firefox ladbar |
| 10.7 | TOTP-Setup: QR statt Klartext-Secret in UI | Secret nicht dauerhaft sichtbar |

Vanilla-JS refactor in Module ok; **kein** Pflicht-React in Phase 10.

---

## Phase 11 – Performance *(notwendig bei Wachstum)*

| # | Arbeitspaket | Akzeptanz |
|---|--------------|-----------|
| 11.1 | `GET /api/secrets` inkl. eigener Envelope (+ Titel-Cipher) | Liste ohne N× Detail-GET |
| 11.2 | Pagination / Cursor für Secrets, Users, Audit | Default-Limit serverseitig |
| 11.3 | Batch-Decrypt parallel (Worker/async) mit Concurrency-Cap | UI bleibt responsive |
| 11.4 | Argon2-Presets (schnell/empfohlen/stark) in Admin-UI | Defaults dokumentiert |

---

## Phase 12 – Produkt-Features *(optional)*

| # | Arbeitspaket | Abhängigkeit |
|---|--------------|--------------|
| 12.1 | Payload-Felder: URL, TOTP-Seed (clientverschlüsselt), Tags | Phase 10.2 |
| 12.2 | Ordner / Favoriten (Metadaten ciphertext oder client-index) | 11.1 |
| 12.3 | Gruppen-Share: UI wählt Gruppe → Envelopes für alle Member | Prinzip 5 einhalten |
| 12.4 | Recovery-Moduswechsel + Pflicht-Re-Onboarding (OQ-03) | Audit + Bestätigung |
| 12.5 | Rolle `auditor` (read-only Audit) | OQ-08 |
| 12.6 | SMTP-Templates produktiv (Invite, Disable-Hinweis) | MVP-Gaps |

---

## Phase 13 – Plattform-Evolution *(optional)*

| # | Arbeitspaket | Hinweis |
|---|--------------|---------|
| 13.1 | Frontend React/TS | **Abgesagt** — Vanilla JS bleibt (OQ-01 Nachtrag) |
| 13.2 | PostgreSQL Storage-Backend | Storage-Interface schon abstrahiert |
| 13.3 | Dark Theme (OQ-18) | Brand-Tokens vorhanden |
| 13.4 | Mobile-Layout / PWA-light | Nur HTTPS |
| 13.5 | Externe IdP / SCIM | Nur wenn Org es fordert |

---

## Empfohlene Umsetzungsreihenfolge

```text
Phase 9 Hardening  →  Phase 10 UX-Kern  →  Phase 11 Performance
        →  (optional) Phase 12 Features  →  Phase 13 Plattform
```

**Definition of Done pro Phase:** Security-Self-Check-Datei `docs/phaseN-security-self-check.md`, Tests grün, README/Guides aktualisiert.

---

## Abgrenzung

| Nicht Ziel dieser Roadmap | Begründung |
|---------------------------|------------|
| Bitwarden-Protokoll-Kompatibilität | Explizit verboten (Sicherheitsregeln) |
| Serverseitiges Master-Passwort hinter Passkey | Verletzt ZK (OQ-04) |
| Gruppen-Shared-Password | Verletzt Prinzip 5 |

---

## Nächster konkreter Schritt

1. Phase-9-Tickets anlegen (9.1–9.8).  
2. Parallel Wireframe App-Shell (10.1) ohne Backend-Änderung.  
3. Prod-Go/No-Go erst nach 9 + Checklist-Walkthrough.
