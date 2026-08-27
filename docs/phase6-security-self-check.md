# Phase 6 – Admin-UI Rest Security Self-Check

| # | Check | Status |
|---|--------|--------|
| Config | LDAP/SMTP-Secrets nur in sealed Config; API redaktiert Passwörter (`***`) | OK |
| 6 LDAP | Test-Bind = Service-Bind only; keine Autorisierung über LDAP | OK |
| Escrow | Private Escrow-Key nur clientseitig erzeugt; Server speichert Public Key | OK |
| Audit | Append-only Events; Export ohne Secret-Klartext | OK |
| API-Keys | Klartext einmalig; Speicherung nur SHA-256-Hash; Scopes read/vault/admin; Legacy ohne Scopes → read-only | OK |
| Audit | Kritische Admin-/Recovery-Pfade fail-hard (`appendAuditStrict`) | OK |
| Storage | Migration exportiert/importiert nur Ciphertext; Confirm=`MIGRATE` | OK |
| Tenants | Create/Disable nur `platform_admin` | OK |

**Abweichung / Folge:** Shamir-Split der Escrow-SK ist Admin-Offline-Prozess (OQ-13); keine serverseitige Share-Verwaltung im MVP.
