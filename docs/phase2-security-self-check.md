# Phase 2 – Crypto-Kern Security Self-Check

Modul: [`internal/cryptocore`](../internal/cryptocore)

| # | Prinzip | Status |
|---|---------|--------|
| 1 | Zero-Knowledge | OK – Modul ist clientseitig; Server-Code darf Unlock/Decrypt nicht auf Vault-Daten anwenden (dokumentiert im Package-Kommentar) |
| 2 | Client-Crypto | OK – Go-Kern für CLI; Browser-Port/WASM folgt mit denselben Testvektoren |
| 3 | Auditierte Libs | OK – `golang.org/x/crypto` (argon2, nacl/box, nacl/secretbox) + stdlib AES-GCM |
| 4 | Argon2id | OK – `argon2.IDKey` für Master-Passwort / Recovery-Kit |
| 5 | Per-User Envelopes | OK – `SealDataKeyForRecipient` / `OpenDataKeyEnvelope` (NaCl box) |
| 7 | Rotation | OK – `RotateSecret` + `ErrRevokedVersion` / AAD an `key_version` |
| 8–10 | Storage / Onboarding / Recovery | Schema + Kit-Seal vorbereitet; UX in Phase 3/4 |

**Getestete Grenzfälle:** falsches Master-Passwort, korrupte Ciphertexts, falscher DK, falscher Empfänger, revoked `key_version`, AAD-Tampering, Recovery-Kit falsch.

**Abweichung:** Noch kein TypeScript/libsodium.js-Build (Node-Install im Netz ausstehend). Go-Kern ist die spezifizierte, getestete Referenz; Frontend muss dagegen konform sein.
