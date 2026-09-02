# TeamVault Security Assessment Report

**Date:** 2026-09-02  
**Scope:** Full repository + isolated localhost test instance (`127.0.0.1:18090`, `data/security-pentest/`)  
**Method:** Architecture review, source code review, dynamic API tests, attack simulation (A0–E), dependency scan (`govulncheck`), secret pattern scan  
**Constraint:** Fictional credentials only; no production systems. Findings from the 2026-09-02 assessment were remediated in-tree (see Remediation Status below).

---

# Executive Summary

TeamVault’s **Zero-Knowledge storage model is sound**: vault payloads and master passwords are not recoverable from a stolen database alone; login and vault unlock are correctly separated; cross-tenant IDOR was not demonstrated.

**Remediated in this follow-up:** intra-tenant BOLA on share/rotate/delete (owner-only), `group-member-keys` unbound group leak, `session_hours` server TTL wiring, CSRF Origin ignoring `X-Forwarded-Host`, LDAP `EscapeDN`, admin UI HTML escaping, and `jwt/v5` bump for GO-2025-3553.

No Critical finding (no remote vault plaintext disclosure, no auth bypass, no cross-tenant secret read) was confirmed. Residual architectural risk **OQ-22** (malicious delivered JS) remains by design for browser-based ZK.

---

# Architecture Assessment

| Layer | Assessment |
|-------|------------|
| Client crypto | Argon2id → MK; X25519 identity; AES-256-GCM payloads; NaCl box envelopes — solid |
| Server role | Ciphertext store + auth session + sealed config — aligns with ZK vs storage |
| Multi-tenant | Row-level `tenant_id`; session-bound; store filters consistent |
| Sessions | Opaque `tv_session`, HttpOnly, SameSite=Lax; no JWT |
| Hardening | CSP, X-Frame-Options DENY, Origin check on mutating cookie APIs |
| Deploy | Distroless nonroot; unlock key not in image |

Trust boundaries match `docs/planning/crypto-design.md` §8. The main design/implementation gap is **secret capabilities** documented as `{read, write, share, admin}` but implemented as **envelope ⇒ full control**.

---

# Threat Model

## Assets

- Vault master password, user private key (SK), data keys (DK), secret plaintext  
- Recovery kit / escrow private key (Shamir shares)  
- Session cookies, API keys (`tvk_…`), `MASTER_UNLOCK_KEY`  
- Sealed config (LDAP/SMTP), audit integrity  
- Integrity of delivered `cryptocore.js` / `app.js`

## Trust Boundaries

1. Client ↔ API (TLS expected)  
2. Client crypto ↔ storage (ciphertext only)  
3. Tenant A ↔ Tenant B (logical isolation)  
4. Login auth ↔ vault unlock  
5. Process unlock key ↔ vault payloads (must not decrypt vault)  
6. Delivered JS integrity (OQ-22)

## Attacker Models Tested

| ID | Model | Result summary |
|----|--------|----------------|
| A0 | Unauthenticated | Health/version public; admin 401; setup token one-shot; login failures uniform 401 |
| A1 | Member (`attacker`) | Admin APIs 403; shared-secret BOLA confirmed (delete/rotate/re-share); group key leak |
| A2/A3 | Tenant/platform admin | Escrow/RBAC already covered by existing `finding_*` tests; not re-broken |
| A4 | DB theft | No plaintext marker / master password in SQLite dump |
| A5 | Compromised server/JS | Residual OQ-22; server cannot decrypt without client keys |
| A6 | Supply chain | Actions tag-pinned; transitive JWT vuln via WebAuthn |

---

# Findings

Sorted by original severity. Status reflects post-remediation (2026-09-02 follow-up). Confirmed PoCs live in `go test -mod=mod ./internal/server/ -run TestPentest`.

## Remediation Status

| ID | Original | Status |
|----|----------|--------|
| PENT-01 | Medium BOLA share/rotate/delete | **Fixed** — owner required; rotate must keep owner envelope |
| PENT-02 | Medium group-member-keys leak | **Fixed** — group must already be shared with secret |
| PENT-03 | Medium session_hours | **Fixed** — `Sessions.SetTTL` on policy update + boot from policy |
| PENT-04 | Medium TrustForwarded CSRF | **Fixed** — `csrfHost` uses PublicURL or `r.Host`, not X-Forwarded-Host |
| PENT-05 | Low–Medium LDAP DN | **Fixed** — `ldap.EscapeDN` on DN template path |
| PENT-06 | Low HTML injection | **Fixed** — `escapeHtml` on reported sinks |
| PENT-07 | Low jwt GO-2025-3553 | **Fixed** — `jwt/v5` → v5.2.2 |
| CAP-ACL | Fine-grained share capabilities | **Done** — stored + enforced; UI picker; cannot grant above own |
| OQ-22-SRI | Delivered JS integrity | **Partial** — sha384 SRI for critical scripts (residual if server serves bad JS) |

## FINDING-PENT-01 — Shared recipient has full secret control (BOLA) — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Medium (at discovery) |
| **Status** | Fixed |
| **CVSS 3.1 (est.)** | 6.5 (AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N) — integrity of shared secrets |
| **CWE** | CWE-639 / CWE-285 |
| **Component** | `internal/server/phase5.go` (`handleDeleteSecret`, `handleRotateSecret`, `handleShareSecret`), `phase12.go` (`handleShareGroup`) |

**Description:** Access checks only verify `callerHasEnvelope`. Any share recipient can delete the secret, rotate keys (including omitting the owner), and re-share to others.

**Cause:** Capability model from architecture docs not implemented; envelope presence treated as co-admin.

**Prerequisites:** Authenticated onboarded user with a valid envelope (legitimate share).

**PoC:** `TestPentestFindingSharedRecipientFullControl` — share to `attacker` → re-share / rotate / delete expect **403**.

**Impact:** Shared user can destroy or take over team secrets; trust model of “read-only share” cannot be enforced.

**Recommendation / Fix applied:** Owner (`CreatedBy`) required for share/rotate/delete; new group share requires owner; catch-up `share-group` allowed for envelope holders when group already linked; rotate rejects payloads missing owner envelope.

**Regression:** `TestPentestFindingSharedRecipientFullControl`.

---

## FINDING-PENT-02 — Unrelated group member public keys via secret endpoint — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Medium (at discovery) |
| **Status** | Fixed |
| **CVSS 3.1 (est.)** | 5.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N) |
| **CWE** | CWE-862 / CWE-200 |
| **Component** | `internal/server/phase12.go` `handleSecretGroupMemberKeys` |

**Description:** With any envelope on secret S, caller can query `GET /api/secrets/{id}/group-member-keys?group_id=G` for **any** tenant group G and receive usernames + public keys of onboarded members. Contrast: `handleGroupMemberKeysForShare` correctly requires membership/admin.

**PoC:** `TestPentestFindingGroupMemberKeysLeak` — expect **403**.

**Impact:** Facilitates lateral sharing and tenant user/key enumeration beyond intended share graph.

**Recommendation / Fix applied:** Require that `group_id` is already linked via `ListSecretGroupShares`. Initial share uses `GET /api/groups/{id}/member-keys`.

**Regression:** `TestPentestFindingGroupMemberKeysLeak`.

---

## FINDING-PENT-03 — `session_hours` policy not applied to server session TTL — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Medium (at discovery) |
| **Status** | Fixed |
| **CWE** | CWE-613 |
| **Component** | `internal/server/server.go`, `session.Store.SetTTL`, `handlePutPolicy` |

**Description:** Admin can set `session_hours` (e.g. 1); `/api/policy/client` reflects it, but new sessions still get ~8h cookie expiry.

**PoC:** `TestPentestFindingSessionHoursNotWired` — expect ~1h TTL after policy update.

**Impact:** Operators cannot shorten server-side session lifetime via policy; clients may idle-lock vault SK but HTTP session remains valid longer than intended.

**Recommendation / Fix applied:** Boot TTL from policy; `SetTTL` on policy PUT.

---

## FINDING-PENT-04 — CSRF Origin check trusts `X-Forwarded-Host` — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Medium (at discovery) |
| **Status** | Fixed |
| **CWE** | CWE-346 / CWE-940 |
| **Component** | `internal/server/hardening.go` `csrfHost` |

**Description:** When `TEAMVAULT_TRUST_FORWARDED` is true, `X-Forwarded-Host` overrides `Host` for Origin comparison. A same-site attacker who can inject forwarded headers (misconfigured proxy) can satisfy Origin checks with a forged Origin.

**PoC:** `TestPentestFindingTrustForwardedOrigin` — expect **403**.

**Impact:** Weakens CSRF defense when forwarded trust is enabled. Classic cross-site POST still mitigated by `SameSite=Lax` in modern browsers.

**Recommendation / Fix applied:** CSRF uses configured `PublicURL` host or raw `r.Host`; never `X-Forwarded-Host`.

---

## FINDING-PENT-05 — LDAP DN injection on non-search bind path — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Low–Medium (at discovery) |
| **Status** | Fixed |
| **CWE** | CWE-90 |
| **Component** | `internal/auth/ldapauth/ldapauth.go` |

**Description:** Fallback `uid=%s,%BaseDN` does not call `ldap.EscapeDN`. Search path correctly uses `EscapeFilter`.

**Prerequisites:** LDAP enabled without service-bind search (direct DN template path); attacker-controlled username at login.

**Impact:** Potential bind DN manipulation depending on directory ACLs.

**Recommendation / Fix applied:** `ldap.EscapeDN(username)` on the template path.

---

## FINDING-PENT-06 — Stored HTML injection in admin UI sinks (CSP-mitigated) — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Low (at discovery) |
| **Status** | Fixed |
| **CWE** | CWE-79 |
| **Component** | `web/static/app.js` |

**Description:** Some admin UI strings are interpolated into `innerHTML` without `escapeHtml`. Current CSP (`script-src 'self'`, no `'unsafe-inline'`) blocks typical script XSS in modern browsers; residual UI spoofing remains.

**Recommendation / Fix applied:** `escapeHtml` on offline picker, passkey names, API key names, tenant list.

---

## FINDING-PENT-07 — Transitive JWT vulnerability (WebAuthn) — FIXED

| Field | Value |
|-------|--------|
| **Severity** | Low (at discovery) |
| **Status** | Fixed |
| **CWE** | CWE-770 |
| **Component** | `github.com/golang-jwt/jwt/v5` |

**Description:** `govulncheck` reports excessive memory allocation in JWT header parsing; reachable via WebAuthn registration finish path.

**Recommendation / Fix applied:** Bumped to `v5.2.2`.
---

## Informational

| ID | Topic | Notes |
|----|--------|-------|
| INFO-01 | Login rate limit in-memory / IP-only | **Improved:** per-user (tenant+username) limit 10/min in addition to IP 20/min; map growth bounded. Multi-node sync still open |
| INFO-02 | Absolute session TTL; multi-session | **Improved:** idle expiry via `UnlockIdleMinutes`; login revokes prior cookie sessions for the user |
| INFO-03 | Argon2 admin floor low | Platform min Memory 8192 KiB / Time 1 — weak if admin lowers presets |
| INFO-04 | CI Actions pin tags not SHAs | **Partial:** `security.yml` pins `actions/checkout` to full SHA; Dependabot added for actions/gomod; other workflows still tag-pinned |
| INFO-05 | govulncheck/Trivy absent from CI | Claimed in phase self-checks; not in workflows (addressed by new `security.yml`) |
| INFO-06 | OQ-22 malicious JS | Residual ZK break if app delivery compromised |
| INFO-07 | Secret scan hits | `TestLocalPassword` fixture; script `password=` parsing of credential helper output — **false positives** (not live secrets) |

### False positives explicitly marked

- SQL injection in SQLite store — parameterized queries only  
- Session fixation — server generates opaque IDs  
- Classic path traversal via `../` on downloads — rejected  
- Cross-tenant secret IDOR — blocked (confirmed by `TestPentestCrossTenantSecretBlocked`)

---

# Cryptography Assessment

| Topic | Verdict |
|-------|---------|
| Vault KDF | Client Argon2id, per-user params on key blob — OK |
| Login hash | Server Argon2id PHC — separate from vault — OK |
| Payload | AES-256-GCM, random 12-byte IV, AAD key_version — OK |
| Sharing | Per-recipient NaCl box of DK — OK (no group password) |
| Nonce reuse | Not found |
| Server decrypt of vault | Not implemented on API paths; cryptocore decrypt reserved for client/CLI |
| DB dump | Ciphertext + sealed SK + Argon2 hashes only — confirmed dynamically |
| Escrow | Pubkey only on server; Shamir split offline — OK |
| Offline store | IndexedDB holds sealed SK + ciphertext (not master password) — correct for offline ZK |

**ZK answers**

| Question | Answer |
|----------|--------|
| Can server know master password? | No (never sent) |
| Can server decrypt vault? | Not with honest client code; storage has ciphertext only |
| Where is KDF? | Client (`cryptocore.js` / CLI) |
| Where is encryption? | Client |
| Where is plaintext? | Client memory after unlock; cleared on idle lock/logout |
| Compromised server offline attack? | Brute-force Argon2id on sealed SK / login hashes only |
| Malicious JS? | Yes — can exfiltrate master password (OQ-22) |
| Server-manipulable crypto params? | Presets via platform admin with floors; user blob stores actual params |

---

# Authentication & Authorization

**Strengths:** Hybrid local/LDAP bind-only; TOTP pending token; WebAuthn login-only; onboard gate; API key scopes; platform vs tenant admin RBAC; Origin CSRF for cookies; uniform 401 on failed login (no obvious username enumeration message).

**Gaps (remaining):** INFO-rate-limit multi-node; OQ-22 residual (SRI helps only if delivery channel integrity holds).

---

# API Security

Unauthenticated surface is limited (`/api/health`, `/api/version`, setup, login, WebAuthn login begin/finish, downloads). Mutating cookie APIs require Origin/Referer. Object-level checks are envelope-based (see findings). Mass assignment of roles is constrained by `actorMayModifyUser`.

---

# Dependency & Supply Chain

| Check | Result |
|-------|--------|
| `govulncheck ./...` | Tracked in CI (`security.yml`); jwt bump addressed GO-2025-3553 |
| Direct deps | Go 1.25.13; ldap, webauthn, otp, x/crypto, modernc sqlite |
| Frontend npm | Dev-only Playwright under `scripts/` |
| Container | Distroless nonroot; unlock not baked in |
| GitHub Actions | `security.yml` checkout SHA-pinned; Trivy FS HIGH/CRITICAL; Dependabot actions/gomod |
| SBOM | `go list -m all` artifact in CI |

---

# Attack Simulation

| Scenario | Executed | Outcome |
|----------|----------|---------|
| A0 public/setup/login | Live `:18090` + Go tests | Expected hardening; setup reuse 409 |
| A1 member → admin / IDOR | Live + `TestPentest*` | Admin 403; share BOLA / group keys confirmed |
| A4 DB dump | `TestPentestDBDumpNoPlaintext` | No plaintext markers |
| A5 server decrypt | Code + architecture | Server cannot decrypt vault payloads |
| CSRF / session policy | Go tests | PENT-03/04 confirmed |
| Cross-tenant | Go test | Blocked |

Test accounts (fictional): `admin`, `attacker`, `user2` / password fixture `Password1234!!!!` / vault markers `TEST_ONLY_*`.

Reproduce unit suite:

```bash
go test -mod=mod ./internal/server/ -run TestPentest -count=1
```

Local instance:

```powershell
.\scripts\security-pentest-run.ps1
```

---

# Security Test Coverage

- AuthN/AuthZ, sessions, CSRF Origin, tenant isolation  
- Secret share/rotate/delete BOLA  
- Group member key endpoint  
- ZK DB contents  
- LDAP/crypto unit packages  
- govulncheck + secret pattern scan  
- Existing remediation suites: `finding_stage*`, `finding_wave*`, `admin_rbac_test.go`

Not fully covered in this pass: interactive browser XSS PoC, LDAP live directory, multi-node rate-limit bypass, full container Trivy image scan (requires image build/pull), Git history deep secret mining tool (pattern scan of tree only).

---

# Recommended Remediation Plan

### Sofort (done)

1. ~~Fix `handleSecretGroupMemberKeys` authorization (PENT-02).~~  
2. ~~Restrict share/rotate/delete to owner; group catch-up rules (PENT-01).~~  
3. ~~CSRF host without client `X-Forwarded-Host` (PENT-04).~~

### Kurzfristig (done)

4. ~~Wire `session_hours` into session store TTL (PENT-03).~~  
5. ~~`EscapeDN` for LDAP DN template (PENT-05).~~  
6. ~~Escape remaining `innerHTML` sinks (PENT-06).~~  
7. ~~Bump jwt for GO-2025-3553 (PENT-07).~~

### Mittelfristig (partially done)

8. ~~Per-user login rate limit (+ IP) and rate-limiter map bound.~~ Distributed/multi-node RL still open.  
9. ~~Pin GitHub Actions checkout to commit SHA across workflows; Dependabot; Trivy FS + PR image scan.~~ Remaining action tags tracked by Dependabot.  
10. ~~Server-side session idle timeout (`UnlockIdleMinutes`) + revoke prior cookie sessions on login.~~  
13. ~~Capability-based ACL (`read|write|share|admin`) on shares + handler gates + UI picker.~~

### Langfristig

11. External pentest / audit (checklist open item).  
12. Further OQ-22 mitigations (signed releases, hardened delivery). SRI for critical scripts **shipped** in `web/embed.go` (partial mitigation).

---

# Residual Risks

- **OQ-22:** Compromised application JavaScript defeats client-side ZK.  
- Logical multi-tenant isolation depends on continued correct `tenant_id` filtering.  
- Offline IndexedDB ciphertext is readable to same-origin XSS/malware.  
- Admin escrow holders with enough Shamir shares can recover user SK (by design).  
- Single-node in-memory rate limits and session file store.

---

## Artifacts produced this assessment

| Artifact | Purpose |
|----------|---------|
| `internal/server/finding_pentest_test.go` | Reproducible PoCs / defense checks |
| `scripts/security-pentest-run.ps1` | Isolated localhost bootstrap |
| `data/security-pentest/` | Marked test data dir (gitignored via `/data/`) |
| `.github/workflows/security.yml` | PR-friendly security CI |
| `SECURITY-REPORT.md` | This report |
