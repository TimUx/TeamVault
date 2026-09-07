# Phase 8 – Clients / OpenAPI Security Self-Check

| # | Check | Status |
|---|--------|--------|
| 1 ZK | CLI nutzt nur `internal/cryptocore`; Extension nur `cryptocore.js` | OK |
| Duplikat | Keine eigene Crypto in CLI/Extension | OK |
| API-Keys | Bearer `tvk_…`; Hash in Config; gebunden an User/Tenant; Scopes `read`/`vault`/`admin`; Revoke wirkt | OK |
| OpenAPI | `docs/openapi.yaml` + `GET /openapi.yaml` | OK |
| Extension | SK nur Popup-Memory; Service Worker hält keine Keys; Ausfüllen/Kopieren-Host-Gate | OK |
| CLI | Master-Passwort nur lokal (Prompt); Session-Cookie 0600 | OK |

**Hinweis:** Autofill über Content-Script ist produktiv; Ausfüllen und Kopieren nur bei Secret-URL↔Tab-**Origin**-Match (Schema+Host+Port).
