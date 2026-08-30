# Phase 9–13 Security Self-Check

## Phase 9 – Hardening

| # | Check | Status |
|---|--------|--------|
| 9.1 | Cookie `Secure` when TLS / X-Forwarded-Proto | OK |
| 9.2 | Origin check for mutating `/api/*` (cookie sessions) | OK |
| 9.3 | TOTP sealed with config AEAD; legacy base64 readable | OK |
| 9.4 | CSP, nosniff, frame-ancestors, HSTS when HTTPS | OK |
| 9.5 | Sessions persisted to `data/sessions.json` | OK |
| 9.6 | Rate-limit by host (not host:port); multi-node note in docs | OK |
| 9.7 | Extension optional_host_permissions + Firefox gecko id | OK |
| 9.8 | CI `govulncheck` + Trivy image scan (HIGH/CRITICAL) | OK |

## Phase 10 – UX

| # | Check | Status |
|---|--------|--------|
| 10.1 | App nav Vault / Konto / Admin | OK (web UI) |
| 10.2 | Structured secret fields + copy | OK |
| 10.3 | Client-side title search | OK |
| 10.4 | Idle lock overlay (no alert) | OK |
| 10.5 | Recovery-kit copy/download | OK |
| 10.6 | Extension autofill + browser polyfill | OK |
| 10.7 | TOTP secret collapsed by default | OK |

## Phase 11 – Performance

| # | Check | Status |
|---|--------|--------|
| 11.1 | List secrets includes own envelope (batch envelopes + key versions) | OK |
| 11.2 | Pagination limit/offset | OK |
| 11.3 | Parallel title decrypt with cap | OK (UI) |
| 11.4 | Argon2 presets API | OK |

## Phase 12 – Features

| # | Check | Status |
|---|--------|--------|
| 12.1 | Payload url/totp_seed/tags/favorite | OK (client) |
| 12.2 | collection_id folders | OK |
| 12.3 | Group share envelopes + `GET /api/groups` for members | OK |
| 12.4 | Recovery mode + REONBOARD confirm | OK |
| 12.5 | auditor role on audit API | OK |
| 12.6 | Mail templates (existing MVP) | Partial |

## Phase 13 – Platform

| # | Check | Status |
|---|--------|--------|
| 13.1 | React rewrite | Abgesagt — Vanilla bleibt (OQ-01) |
| 13.2 | Postgres stub package | Stub |
| 13.3 | Dark theme | OK |
| 13.4 | Mobile CSS | OK |
| 13.5 | External IdP/SCIM | Deferred |

## Post-Stufenplan (nach Findings 1–5)

| # | Check | Status |
|---|--------|--------|
| P1 | `RotateSecret` atomic; empty/invalid envelopes rejected before mutate | OK |
| P2 | API-Key scopes `read` / `vault` / `admin` enforced | OK |
| P3 | Extension Fill **and** Copy host-gated | OK |
| P4 | Export Klartext-Confirm; critical audit fail-hard | OK |
| P5 | Live-Pentest / externes Audit | Offen (Prozess) |
