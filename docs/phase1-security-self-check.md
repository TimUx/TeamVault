# Phase 1 – Security self-check

Against the non-negotiable principles:

| # | Prinzip | Status in Phase 1 |
|---|---------|-------------------|
| 1 | Zero-Knowledge | OK – store holds only opaque blobs; no decrypt APIs |
| 2 | Client-side crypto | N/A yet (Phase 2/3) – server does not implement vault crypto |
| 3 | Audited libs only | OK – AES-GCM via Go stdlib; HKDF-SHA256 (RFC 5869) for config KDF |
| 4 | Argon2id for master PW | N/A – unlock key is high-entropy keyfile; Argon2id reserved for client vault KDF |
| 5 | Per-user sharing envelopes | Schema ready (`key_envelopes`); crypto in Phase 2/5 |
| 6 | Hybrid auth | N/A (Phase 4); user model has `auth_backend` |
| 7 | Revoke → rotate | `InvalidateKeyVersion` marks envelopes revoked |
| 8 | Storage ciphertext-only | Enforced by API types (`TitleCiphertext`, `CiphertextBlob`) |
| 9 | Onboarding gate | Flag `Initialized` / user `onboarded_at` prepared; UX Phase 3/4 |
| 10 | Key recovery | Tenant fields `recovery_mode`, `escrow_allowed` stored; flows later |

**Abweichungen:** Keine offenen Phase-1-Blocker. Modul-Download über lokalen Corp-GoProxy (`scripts/goproxy-corp.ps1`).

**Betrieb:** `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` bevorzugt; Env nur Dev.
