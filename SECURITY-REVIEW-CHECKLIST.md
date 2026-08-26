# TeamVault – Security Review Checklist (Pre-Production)

Vor dem Betrieb mit echten Zugangsdaten: externes Audit + internes Walkthrough gegen diese Liste.

## Zero-Knowledge & Crypto

- [x] Server-/DB-Dumps enthalten keine Vault-Klartexte, Master-Passwörter oder Private Keys
- [x] Client-Crypto nur WebCrypto / libsodium (NaCl); keine eigenen Primitive
- [x] Argon2id für Vault-Master-Passwort; Login-Hash getrennt (Argon2id)
- [x] Secret-Titel clientseitig verschlüsselt; Suche nur clientseitig
- [x] Sharing: pro Empfänger eigene Envelope; kein Gruppen-Passwort
- [x] Rechteentzug erzwingt DK-Rotation; alte Key-Versionen ungültig
- [x] Escrow-Private-Key nie serverseitig gespeichert; Share-Split offline (Shamir k/n)

## Auth & Sessions

- [x] LDAP nur Login-Bind; Autorisierung lokal
- [x] Disabled User/Tenant blockiert Login auch bei gültigem LDAP
- [x] TOTP-Secrets at-rest nur als undurchsichtige Blobs; Codes nicht geloggt
- [x] Session-Cookies HttpOnly; Idle-/Session-Timeouts konfiguriert (OQ-17)
- [x] Onboarding-Gate: ohne Vault-Keys kein Secret-Zugriff
- [x] API-Key Scope `read` blockiert Admin/Mutationen; Cookie-Mutationen brauchen Origin
- [x] Delete/Share nur mit gültigem Envelope; Share-Empfänger onboarded im Tenant

## Config & Bootstrap

- [x] Genau ein externes Secret: `MASTER_UNLOCK_KEY` (Keyfile/Secret-Mount in Prod)
- [x] Unlock-Key nie in Logs/Traces; Mindestentropie ≥32 Byte
- [x] LDAP/SMTP/API-Key-Material nur in sealed Config-DB
- [x] API-Key-Klartext nur einmal angezeigt; Speicherung gehasht
- [x] Storage-Migration: Bestätigungspflicht; Rollback-Plan dokumentiert
- [x] Postgres-Backend bis Implementierung abgelehnt (sqlite/json)

## Ops & Hardening

- [x] TLS terminiert vor App (oder TLS am Listener); HSTS wo sinnvoll
- [x] Keine Telemetrie/CDN (Air-Gap, OQ-19)
- [x] Backup: sealed Config + Vault-Store; Restore-Test ohne Klartext-Exposition
- [x] Audit-Log-Review-Prozess; kritische Actions (migrate, recovery-mode, share/rotate) sichtbar
- [x] Rate-Limits / Lockout für Login (falls nicht vorhanden: nachziehen)
- [x] Dependency- und Container-Image-Scan
- [x] Server `ReadHeaderTimeout` / Read/Write/Idle-Timeouts gesetzt
- [x] Reverse-Proxy: Origin durchreichen; `TEAMVAULT_TRUST_FORWARDED` Default aus

## UI / Client

- [x] Master-Passwort und SK nur im Speicher; Clear bei Logout/Idle-Lock
- [x] Keine Secrets in `localStorage` / URL / Analytics
- [x] CSP und Trusted Types soweit praktikabel
- [x] Escrow-Gen: kein voller SK im DOM; Shares + Download
- [x] Extension Fill/Copy nur bei Host-Match

## Dokumentation

- [x] Runbook: Unlock-Key-Rotation, Escrow-Recovery-Ritual, Storage-Migration
- [x] Threat-Model aktualisiert (Admin-Escrow vs User-Kit Trade-offs)
- [ ] Live-Pentest / externes Audit (Prozess, nicht Code)

**Referenz:** `.cursor/rules/security-principles.mdc`, `docs/phase*-security-self-check.md`, `docs/phase9-13-security-self-check.md`
