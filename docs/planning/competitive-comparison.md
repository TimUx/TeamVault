# TeamVault – Vergleich mit bekannten Password Managern

**Status:** Produkt-/Marktvergleich (orientierend)  
**Canvas:** Cursor Canvas `competitive-comparison`  
**Verwandt:** [roadmap-phase9plus.md](roadmap-phase9plus.md)

---

## Kernaussage

TeamVault löst dasselbe Kernproblem wie **Bitwarden**, **Vaultwarden** und **Passbolt** (zentrale, geteilte Firmensecrets), ist aber **kein Klon**:

| Abgrenzung | Bedeutung |
|------------|-----------|
| **Kein Bitwarden-Protokoll** | Bewusst verboten (Sicherheitsregeln) — keine BW-/VW-Clients |
| **Eigenes ZK-Modell** | Argon2id + NaCl; Titel ciphertext; Envelope pro User |
| **Multi-Tenant + LDAP-Bind** | Instanz mit Tenants; LDAP nur Login, Rechte lokal |
| **Recovery** | User-Kit **oder** Admin-Escrow (Shamir) pro Tenant |

**Nächster Verwandter:** Passbolt (Team/Self-Host/Sharing).  
**Ökosystem-Alternative:** Vaultwarden (wenn BW-Clients Pflicht sind).

---

## Kurzprofile

| Produkt | Was es ist |
|---------|------------|
| **Bitwarden** | Vollprodukt (Cloud + Self-Host), sehr reife Clients (Browser, Mobile, CLI), Organizations/Collections, Send |
| **Vaultwarden** | Leichtgewichtiger **Bitwarden-kompatibler** Server — dieselben Clients, anderer Backend |
| **Passbolt** | Open-Source Team-Password-Manager, OpenPGP, stark bei Kollaboration/Sharing, Self-Host |
| **KeePassXC** | Lokale Datei-DB, kein Server-Multi-User-Modell |
| **1Password / Proton Pass** | Polierte SaaS; UX-Benchmark, andere Betriebsform |
| **TeamVault** | Interner Multi-Tenant-ZK-Manager, eigene API, Go, Web + CLI + Extension-MVP |

---

## Ähnlichkeit zu TeamVault

| Vergleich | Ähnlichkeit | Kommentar |
|-----------|-------------|-----------|
| Passbolt | **Mittel** | Team-Sharing, Self-Host, Admin — Crypto und API anders |
| Bitwarden | **Gering–mittel** | Gleiches Problem, anderes Protokoll & Ökosystem |
| Vaultwarden | **Gering** (als Drop-in) | Erwartet BW-Clients; TeamVault ist kein Ersatz |
| KeePassXC | **Gering** | Lokal vs. Server-Team |
| 1Password Biz | **Gering** (Architektur) / **hoch** als UX-Vorbild | Autofill, Org-Navigation |

---

## Feature-Matrix (vereinfacht)

| Feature | TeamVault | Bitwarden | Vaultwarden | Passbolt | KeePassXC |
|---------|:---------:|:---------:|:-----------:|:--------:|:---------:|
| Zero-Knowledge Vault | ✓ | ✓ | ✓ | ✓ (OpenPGP) | ✓ lokal |
| Self-hosted | ✓ | ✓ | ✓ Fokus | ✓ | — |
| Multi-Tenant Instanz | ✓ | Orgs/Provider | via BW | Teams | — |
| LDAP Login | Bind only | Directory Connector | via BW | LDAP/SSO | — |
| Browser Extension | MVP | Sehr reif | Sehr reif | Reif | begrenzt |
| Autofill | Basis | Hoch | Hoch | Mittel–Hoch | Plugin |
| Mobile Apps | — | ✓ | ✓ (BW) | ✓ | Ports |
| CLI | tvcli | bw | bw | API/CLI | keepassxc-cli |
| Collections/Ordner | — | ✓ | ✓ | Gruppen | Gruppen |
| Org-/Gruppen-Share | User-Envelopes | Collections | Collections | Stark | — |
| Send / Einmal-Links | — | ✓ | ✓ | — | — |
| Import/Export | — | ✓ | ✓ | ✓ | ✓ |
| Passkeys Login | ✓ (nur Login) | ✓ | ✓ | teilw. | — |
| TOTP Login | ✓ | ✓ | ✓ | ✓ | — |
| TOTP in Einträgen | — | ✓ | ✓ | begrenzt | Plugins |
| Admin Escrow / Recovery | Kit + Shamir | Account recovery | wie BW | Admin-Recovery | Keyfile |
| Bitwarden-Protokoll | **Nein** | Native | Native | Nein | Nein |

---

## Was TeamVault bereits „ähnlich gut“ hat

- Clientseitige Ver-/Entschlüsselung (ZK-Anspruch)
- Teilen mit Rotation bei Entzug (vergleichbar mit „Zugriff weg = re-encrypt“)
- Self-Host + Admin-Oberfläche
- 2FA (TOTP) und Passkeys für Login
- CLI für Automation
- Explizites Tenant-/Rollenmodell

## Wo andere klar voraus sind

1. **Extension + Autofill** (Bitwarden/Vaultwarden)  
2. **Informationsarchitektur** (Collections, Suche, Generator, strukturierte Felder)  
3. **Migration** (Import aus BW/KeePass/CSV)  
4. **Mobile**  
5. **Send / zeitlich begrenzte Shares** (Bitwarden)  
6. **Kollaborations-UX** (Passbolt)

---

## Empfehlung: Features übernehmen

### Sinnvoll (hohe Priorität)

| Feature | Vorbild | Warum | Roadmap |
|---------|---------|-------|---------|
| Reife Extension + Autofill (Chrome/Edge/Firefox) | Bitwarden | Ohne das schwer gegen VW/BW zu gewinnen | Phase 10 |
| Clientseitige Suche + Feld-UI + Copy | alle | Erwartungshaltung; OQ-12 | Phase 10 |
| Passwort-Generator | alle | Geringer Aufwand | Phase 10 |
| Ordner / Collections (ohne Gruppen-Passwort) | BW / Passbolt | Orientierung | **umgesetzt** |
| Import (BW JSON/CSV/KeePass + weitere Formate, clientseitig) | BW / KeePass | Migrations-Blocker | **umgesetzt** (v1.1+) |
| Gruppen → Envelopes für Member | Passbolt / BW | Passt zu Prinzip 5 | **umgesetzt** |
| TOTP im Vault-Eintrag (ciphertext) | Bitwarden | Sehr häufig genutzt | **umgesetzt** |
| Export / verschlüsselte Sicherung (`.tvbak`) | BW | Migration & Backup | **umgesetzt** (v1.1+) |

### Optional / später (weiter deferred)

| Feature | Vorbild | Hinweis |
|---------|---------|---------|
| Bitwarden Send-ähnlich | Bitwarden | Eigenes Threat Model; nicht trivial — **deferred** |
| Native Mobile Apps / PWA | BW / Passbolt | Nach Web/Extension — **deferred** |
| SCIM / IdP-Provisioning | BW Enterprise | Nur wenn Org es fordert — **deferred** |
| Emergency Access / Family | Bitwarden | Teilweise durch Escrow/Kit abgedeckt |
| Dark Theme (Vanilla-UI) | 1Password UX | Phase 13 (React abgesagt) |

### Nicht übernehmen

| Feature / Ansatz | Grund |
|------------------|-------|
| Bitwarden-Protokoll-Kompatibilität | Explizit verboten |
| Serverseitig suchbare Klartext-Titel | Verletzt ZK |
| Gemeinsames Gruppen-Master-Passwort | Verletzt Prinzip 5 |
| Vault-Unlock nur per Passkey (Server hält Material) | Verletzt ZK (OQ-04) |

---

## Strategische Einordnung

```text
                 Team-Kollaboration
                        ▲
              Passbolt  │
                        │    ★ TeamVault (Zielbild)
                        │
   Lokal ◄──────────────┼──────────────► Cloud-Ökosystem
            KeePassXC   │         Bitwarden / 1Password
                        │
                   Vaultwarden
                   (BW-Server)
                        ▼
                 Client-Ökosystem-Tiefe
```

- **Vaultwarden wählen**, wenn: bestehende BW-Apps, schnelle Einführung, Community-Server reicht.  
- **TeamVault wählen**, wenn: eigene API, striktes ZK inkl. Titel, Multi-Tenant, LDAP-Bind-Trennung, Shamir-Escrow, Air-Gap ohne BW-Protokoll.

---

## Ableitung für die Roadmap

Die Vergleichslücken decken sich mit [roadmap-phase9plus.md](roadmap-phase9plus.md):

1. Phase 10–12 Kern: Extension/Autofill, Suche, Felder, Generator, Ordner, Import, Gruppen-Share, TOTP-in-Entry — **weitgehend umgesetzt**  
2. Ops: Install-One-Liner, GHCR-Compose, Instanz-Backup — **umgesetzt** (v1.1+)  
3. Nicht: BW-Protokoll (Differenzierung behalten)
