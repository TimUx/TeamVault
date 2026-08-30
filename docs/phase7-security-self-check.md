# Phase 7 – Passkeys / WebAuthn Security Self-Check

| # | Check | Status |
|---|--------|--------|
| OQ-04 | Passkey nur Login; kein Vault-Unlock; Master-PW nie hinter Passkey | OK |
| OQ-20 | Optional nach TOTP-Baseline; TOTP bleibt parallel nutzbar | OK |
| 1 ZK | Ceremony speichert nur Public Key + Credential-ID; keine Vault-Keys | OK |
| Auth | Register nur authentifiziert; Login begin/finish rate-limited | OK |
| TOTP | Wenn TOTP enabled → zusätzlich Code bei Passkey-Login | OK |
| UI | Hinweis „Vault braucht Master-Passwort“ bei Register/Login | OK |

**Abweichung:** Vollständige Browser-Ceremony (create/get) ist manuell/UI zu testen; Unit-Tests decken Begin + Persistenz + Delete.
