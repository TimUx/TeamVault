# TeamVault – Security Review Checklist (Pre-Production)

Vor dem Betrieb mit echten Zugangsdaten: externes Audit + internes Walkthrough gegen diese Liste.

## Zero-Knowledge & Crypto

- [x] Server-/DB-Dumps enthalten keine Vault-Klartexte, Master-Passwörter oder Private Keys (ZK gegen Storage, nicht gegen ausgeliefertes JS — `crypto-design.md` §8 / OQ-22)
- [x] Client-Crypto nur WebCrypto / libsodium (NaCl); keine eigenen Primitive
- [x] Argon2id für Vault-Master-Passwort; Login-Hash getrennt (Argon2id); KDF-Params am User-Key-Blob
- [x] Secret-Titel clientseitig verschlüsselt; Suche nur clientseitig
- [x] Sharing: pro Empfänger eigene Envelope; kein Gruppen-Passwort
- [x] Rechteentzug erzwingt DK-Rotation; Gruppen-Mitglied-Remove löscht Envelopes und verlangt Client-Rotation
- [x] Escrow-Private-Key nie serverseitig gespeichert; Share-Split offline; Pubkey-Replace nur nach k-aus-n Challenge
- [x] Gruppen-Catch-up nicht still beim Unlock; TOFU-Fingerprint vor Wrap

## Auth & Sessions

- [x] LDAP nur Login-Bind; Autorisierung lokal
- [x] Disabled User/Tenant blockiert Login auch bei gültigem LDAP
- [x] TOTP-Secrets at-rest nur als undurchsichtige Blobs; Codes nicht geloggt
- [x] Session-Cookies HttpOnly; Idle-/Session-Timeouts konfiguriert (OQ-17)
- [x] Onboarding-Gate: ohne Vault-Keys kein Secret-Zugriff
- [x] API-Key Scope `read` blockiert Admin/Mutationen; `vault` nur Secret-/Vault-Mutationen; alle API-Keys von TOTP/WebAuthn/Passwort-Wechsel ausgeschlossen; Legacy-Keys ohne Scopes nur read-only GET
- [x] Secret-Create/Rotate/Share/Share-Group/Member-Remove: Mutation + Audit in derselben Transaktion; fail-hard bei Audit-Fehler
- [x] Optional: Admin-List nur Secrets mit eigenem Envelope (`admin_secrets_envelope_only`)
- [x] Delete/Share nur mit gültigem Envelope; Share-Empfänger onboarded im Tenant

## Config & Bootstrap

- [x] Genau ein externes Secret: `MASTER_UNLOCK_KEY` (Keyfile/Secret-Mount in Prod; `.env` nur Pfad)
- [x] Unlock-Key nie in Logs/Traces; Mindestentropie ≥32 Byte
- [x] Extension-CRX-Signing-Key nicht im Git; CI-Secret `TV_EXTENSION_SIGNING_KEY`; Release-Image ohne Secret schlägt fehl
- [x] LDAP/SMTP/API-Key-Material nur in sealed Config-DB
- [x] API-Key-Klartext nur einmal angezeigt; Speicherung gehasht
- [x] Storage-Migration: Bestätigungspflicht; Rollback-Plan dokumentiert
- [x] Postgres-Backend bis Implementierung abgelehnt (sqlite/json)
- [x] Compose nutzt CI/GHCR-Images; Unlock-Keyfile per Mount (kein Key im Image)

## Ops & Hardening

- [x] TLS terminiert vor App (oder TLS am Listener); HSTS wo sinnvoll
- [x] Keine Telemetrie/CDN (Air-Gap, OQ-19)
- [x] Backup: sealed Config + Vault-Store; Admin-UI Snapshot + Restore (`RESTORE`); User-`.tvbak`
- [x] Audit-Log-Review-Prozess; kritische Actions (migrate, recovery-mode, share/rotate, backup) sichtbar
- [x] Rate-Limits / Lockout für Login (falls nicht vorhanden: nachziehen)
- [x] Dependency- und Container-Image-Scan
- [x] Server `ReadHeaderTimeout` / Read/Write/Idle-Timeouts gesetzt
- [x] Reverse-Proxy: Origin durchreichen; `TEAMVAULT_TRUST_FORWARDED` Default aus; Startup-WARN bei Aktivierung
- [x] Install-Runbook: One-Liner Docker/Go, `.env.example` (`docs/install-guide.md`)

## UI / Client

- [x] Master-Passwort und SK nur im Speicher; Clear bei Logout/Idle-Lock
- [x] Keine Secrets in `localStorage` / URL / Analytics
- [x] CSP und Trusted Types soweit praktikabel
- [x] Escrow-Gen: kein voller SK im DOM; Shares + Download
- [x] Extension Fill/Copy nur bei voller Origin (Scheme+Host+Port); Abbruch nach Navigation
- [x] Skip-Link, `aria-live` für Status/Fehler, Lock-Dialog mit Escape

## Dokumentation

- [x] Runbook: Unlock-Key-Rotation, Escrow-Recovery-Ritual, Storage-Migration
- [x] Installationsanleitung (Docker/Go One-Liner, GHCR, `.env`) — `docs/install-guide.md`
- [x] Threat-Model aktualisiert (Admin-Escrow vs User-Kit Trade-offs)
- [ ] Live-Pentest / externes Audit (Prozess, nicht Code)

**Referenz:** `.cursor/rules/security-principles.mdc`, `docs/phase*-security-self-check.md`, `docs/phase9-13-security-self-check.md`, `docs/install-guide.md`
