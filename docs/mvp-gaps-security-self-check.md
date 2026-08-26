# MVP-Lücken – Security Self-Check

| Gap | Umsetzung | Status |
|-----|-----------|--------|
| LDAP pro Tenant (OQ-09) | `ldap_connections[]` + CRUD APIs | OK |
| LDAP-Sync Disable (OQ-11) | `POST /api/admin/ldap/sync` + stündlicher Loop | OK |
| Shamir Escrow (OQ-13) | Browser `secrets.js` + CLI `tvcli escrow-split` (HashiCorp vendored) | OK |
| Mail-Templates | Config + Send bei Invite/Disable | OK |
| Idle-Lock 15min (OQ-17) | `/api/policy/client` + WebUI timer | OK |
| Gruppen-Member-UI | Admin-Form + bestehende APIs | OK |
| Login-Rate-Limit | 20/min pro IP | OK |
| Extension Autofill | content.js Fill/Copy mit Host-Gate | OK |

**Hinweis:** Secret-Rotation nach LDAP-Disable bleibt bewusst clientseitig (Prinzip 7) — Admin muss betroffene Shares rotieren.
