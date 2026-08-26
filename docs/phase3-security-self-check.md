# Phase 3 – Setup Wizard Security Self-Check

| # | Check | Status |
|---|--------|--------|
| Config | Atomarer Commit, kein `setup_incomplete` | OK |
| Admin | Immer `auth_backend=local`; Rollen platform+tenant admin | OK |
| Login-PW | Argon2id serverseitig, getrennt von Vault-MK | OK |
| ZK | Wizard speichert keine Vault-Master-Passwörter / Private Keys | OK |
| UI | Brand-Farben aus ui-brand; flaches Light-UI | OK |

**Hinweis:** React-Frontend kommt später; Phase 3 liefert eingebettetes Wizard/Login-UI für First-Run.
