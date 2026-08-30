# Phase 5 – Secrets / Sharing / Admin Security Self-Check

| # | Check | Status |
|---|--------|--------|
| 1 ZK | Secret-APIs akzeptieren nur Ciphertext + Envelopes; keine Klartextfelder | OK |
| 7 Rotate | `InvalidateKeyVersion` vor neuer Version; alte Envelopes nicht mehr listbar | OK |
| Share | Nur Caller mit Envelope darf share/rotate; Empfänger onboarded; pro User eigene Envelope | OK |
| Rotate | Atomar (`RotateSecret`); leere/ungültige Envelopes → 400 vor Mutation | OK |
| Create | Atomar (`CreateSecret`: Meta + Ciphertext + Envelopes); `secret.create` Audit fail-hard | OK |
| Admin-List | Optional `admin_secrets_envelope_only`: Admins nur Secrets mit eigenem Envelope | OK |
| accessible-secrets | Batch-Envelopes wie List-Secrets (kein N+1) | OK |
| Titles | Title bleibt Ciphertext (OQ-12); Client-AES-GCM mit KeyVersion-AAD | OK |
| Admin | Users/Groups nur `tenant_admin`/`platform_admin`; Public-Keys nur für Onboarded | OK |
| UI | Master-Passwort nur im Browser (`unlockPrivateKey`); SK nur in Memory | OK |

**Hinweis:** Revoke = Pflicht-Rotation (`POST /api/secrets/{id}/rotate`) ohne Envelope für entfernte User.
