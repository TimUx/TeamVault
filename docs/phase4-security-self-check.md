# Phase 4 – Auth / Onboarding Security Self-Check

| # | Check | Status |
|---|--------|--------|
| 1 ZK | Master-Passwort nur clientseitig (`cryptocore.js` / Go-Tests); API nimmt nur Ciphertext-Blobs | OK |
| 4 Argon2id | Client-KDF + Login-Hash getrennt | OK |
| 6 LDAP | Optional Bind-only; JIT-Provision; Autorisierung lokal | OK |
| 9 Onboarding | Gate bis `onboarded_at`; Vault-Keys-Endpoint erst danach | OK |
| 10 Recovery | User-Kit material gespeichert; Escrow-Pubkey Admin-API; Moduswechsel → Re-Onboarding | OK |
| 2FA | TOTP setup/enable; Login verlangt Code wenn enabled | OK |

**Hinweis:** Admin-Escrow-Onboarding UI braucht gesetzten Escrow-Pubkey; User-Kit ist der Default-Pfad im Wizard.
