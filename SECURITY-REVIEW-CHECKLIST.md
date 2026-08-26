# teamVault – Security Review Checklist (Pre-Production)

Vor dem Betrieb mit echten Zugangsdaten: externes Audit + internes Walkthrough gegen diese Liste.

## Zero-Knowledge & Crypto

- [ ] Server-/DB-Dumps enthalten keine Vault-Klartexte, Master-Passwörter oder Private Keys
- [ ] Client-Crypto nur WebCrypto / libsodium (NaCl); keine eigenen Primitive
- [ ] Argon2id für Vault-Master-Passwort; Login-Hash getrennt (Argon2id)
- [ ] Secret-Titel clientseitig verschlüsselt; Suche nur clientseitig
- [ ] Sharing: pro Empfänger eigene Envelope; kein Gruppen-Passwort
- [ ] Rechteentzug erzwingt DK-Rotation; alte Key-Versionen ungültig
- [ ] Escrow-Private-Key nie serverseitig gespeichert; Share-Split offline (Shamir k/n)

## Auth & Sessions

- [ ] LDAP nur Login-Bind; Autorisierung lokal
- [ ] Disabled User/Tenant blockiert Login auch bei gültigem LDAP
- [ ] TOTP-Secrets at-rest nur als undurchsichtige Blobs; Codes nicht geloggt
- [ ] Session-Cookies HttpOnly; Idle-/Session-Timeouts konfiguriert (OQ-17)
- [ ] Onboarding-Gate: ohne Vault-Keys kein Secret-Zugriff

## Config & Bootstrap

- [ ] Genau ein externes Secret: `MASTER_UNLOCK_KEY` (Keyfile/Secret-Mount in Prod)
- [ ] Unlock-Key nie in Logs/Traces; Mindestentropie ≥32 Byte
- [ ] LDAP/SMTP/API-Key-Material nur in sealed Config-DB
- [ ] API-Key-Klartext nur einmal angezeigt; Speicherung gehasht
- [ ] Storage-Migration: Bestätigungspflicht; Rollback-Plan dokumentiert

## Ops & Hardening

- [ ] TLS terminiert vor App (oder TLS am Listener); HSTS wo sinnvoll
- [ ] Keine Telemetrie/CDN (Air-Gap, OQ-19)
- [ ] Backup: sealed Config + Vault-Store; Restore-Test ohne Klartext-Exposition
- [ ] Audit-Log-Review-Prozess; kritische Actions (migrate, recovery-mode, share/rotate) sichtbar
- [ ] Rate-Limits / Lockout für Login (falls nicht vorhanden: nachziehen)
- [ ] Dependency- und Container-Image-Scan

## UI / Client

- [ ] Master-Passwort und SK nur im Speicher; Clear bei Logout/Idle-Lock
- [ ] Keine Secrets in `localStorage` / URL / Analytics
- [ ] CSP und Trusted Types soweit praktikabel

## Dokumentation

- [ ] Runbook: Unlock-Key-Rotation, Escrow-Recovery-Ritual, Storage-Migration
- [ ] Threat-Model aktualisiert (Admin-Escrow vs User-Kit Trade-offs)

**Referenz:** `.cursor/rules/security-principles.mdc`, `docs/phase*-security-self-check.md`
