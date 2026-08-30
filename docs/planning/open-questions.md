# TeamVault – Offene Fragen (Product Owner)

**Status:** BEANTWORTET / freigegeben (2026-08-26)  
Alle OQ-01–OQ-20 sind entschieden. Entscheidungen sind in die übrigen Planungsdocs übernommen. Nächster Schritt: Teil C Phase 1.

### Entscheidungsübersicht

| ID | Entscheidung |
|----|--------------|
| OQ-01 | Stack: **Go** + **Vanilla JS** Web-UI (`web/static`) + libsodium/WebCrypto; React/TS bewusst nicht (2026-08-26) |
| OQ-02 | Multi-Tenancy: Row-Level `tenant_id` + harte Tests |
| OQ-03 | Recovery pro Tenant, kein User-Opt-out; Moduswechsel → Pflicht-Re-Onboarding |
| OQ-04 | Passkey nur Login; kein Unlock via Platform-Authenticator |
| OQ-05 | Wizard: atomarer Commit; Zwischenstand nur clientseitig |
| OQ-06 | Echte `platform_admin`-Rolle; Setup-User bekommt platform_admin + tenant_admin |
| OQ-07 | Escrow-Shares nicht im Wizard, sondern Admin-UI nach Login |
| OQ-08 | MVP-Rollen: member / tenant_admin / platform_admin; auditor später |
| OQ-09 | LDAP-Config pro Tenant |
| OQ-10 | LDAP-Gruppen MVP ignorieren (Datenmodell erweiterbar) |
| OQ-11 | Periodischer LDAP-Sync → auto-disable; Rotation nur bei alleinigem Owner, sonst Rechteentzug+Rotation |
| OQ-12 | Secret-Titel (+ sensible Metadaten) clientseitig verschlüsseln; Suche clientseitig |
| OQ-13 | Shamir k/n konfigurierbar, Default 3-of-5; MVP nur menschliche Share-Holder |
| OQ-14 | Prod: Keyfile/Secret-Mount bevorzugt; Env nur Dev/Test-Fallback |
| OQ-15 | Tenant kann `admin_escrow` deaktivieren (nur `user_kit`) |
| OQ-16 | Login-Hash Argon2id; Kostenfaktor per Admin-UI |
| OQ-17 | Session 8h (anpassbar); Vault-Unlock 15 min Idle + Sperrbildschirm |
| OQ-18 | MVP nur Light Theme; Dark später |
| OQ-19 | Keine Telemetrie/CDN; Air-Gap-Hardening bestätigt |
| OQ-20 | Passkeys nicht für ersten Prod-Release; TOTP Phase 4 Pflicht |

---

## Legende

| Status | Bedeutung |
|--------|-----------|
| Annahme | Ursprüngliche Planungsannahme |
| Antwort | PO-Entscheidung |

---

## OQ-01 – Tech-Stack

**Annahme:** Backend Rust + Axum; Frontend TypeScript + React; Crypto libsodium.js + WebCrypto.

**Frage:** Stack so freigeben oder Go / Svelte / anderes bevorzugen?

**Antwort (initial):** so freigeben (Rust/Axum)

**Nachtrag (2026-08-26):** Umstellung auf **Go** (Backend). Begründung: einfachere Toolchain/Wartung; Rust-Download im Firmennetz blockiert.

**Nachtrag Frontend (2026-08-26):** **Vanilla JS** bleibt die produktive Web-UI (`web/static`, eingebettet). React/TS-Rewrite wird **nicht** nachgezogen — weniger Build/CI-Komplexität (Air-Gap), Feature-Parität bereits erreicht; modularisieren bei Bedarf ohne Framework.

---

## OQ-02 – Multi-Tenancy-Isolation

**Annahme:** Shared Schema mit `tenant_id` auf jeder tenant-gebundenen Zeile (nicht Schema-/DB-pro-Tenant).

**Frage:** Reicht Row-Level + harte Tests, oder verlangt Compliance Schema-Trennung?

**Antwort:** Row-Level + harte Tests

---

## OQ-03 – Key-Recovery-Modus Granularität & Wechsel

**Annahme:** Modus **pro Tenant** umschaltbar (`user_kit` | `admin_escrow`).

**Fragen:**

1. Soll ein einzelner User vom Tenant-Default abweichen dürfen?
2. Was passiert mit bestehenden Usern beim Moduswechsel (Pflicht-Re-Onboarding, Dual-Hüllen-Übergangsphase)?

**Antwort:** Es sollen für alle gleich behandelt werden (kein User-Opt-out vom Tenant-Default), und es soll ein Pflicht-Re-Onboarding geben.

---

## OQ-04 – Passkey-Scope (Phase 7)

**Annahme:** Passkeys nur für **Login**, nie Ersatz für Master-Passwort-Verschlüsselung. Kein serverseitiges Speichern des Master-Passworts hinter Passkey.

**Frage:** Reicht das, oder soll es eine (riskante) „Unlock with platform authenticator“-Option geben?

**Antwort:** Annahme bestätigt, keine „Unlock with platform authenticator"-Option. Eine solche Option würde faktisch bedeuten, das Master-Passwort (oder einen daraus abgeleiteten Schlüssel) serverseitig hinter dem Passkey vorzuhalten – das verletzt Prinzip 1 (Zero-Knowledge) direkt. Passkey bleibt reiner Login-Faktor, Vault-Entschlüsselung bleibt zwingend an das Master-Passwort gebunden.

---

## OQ-05 – Wizard-Persistenz

**Annahme:** Atomarer Commit erst am letzten Wizard-Schritt (kein halbfertiges System).

**Frage:** Stattdessen Schritt-für-Schritt speichern mit `setup_incomplete`?

Antwort: Annahme bestätigt – atomarer Commit. Ein halbfertig konfiguriertes, aber bereits erreichbares System ist ein unnötiges zusätzliches Risiko. Zwischenstände können clientseitig (Browser-Session) gehalten werden, damit ein Reload des Wizards nicht alles verwirft, ohne dass serverseitig ein inkonsistenter Zustand entsteht.

---

## OQ-06 – Erster Admin: Platform vs. Tenant

**Annahme:** Erster Admin ist lokaler User und gleichzeitig initialer Tenant-Admin; „Platform-Admin“ nur falls multi-Tenant-Erstellung durch dieselbe Person nötig.

**Frage:** Braucht ihr eine echte Instanz-Super-Admin-Rolle getrennt vom ersten Tenant?

Antwort: Ja, echte Platform-Admin-Rolle vorsehen, getrennt vom Tenant-Admin. Da Tenant-Verwaltung explizit als Admin-UI-Bereich vorgesehen ist (neue Tenants anlegen etc.), braucht es eine Rolle, die nicht an einen einzelnen Tenant gebunden ist – sonst wird die Verwaltung mehrerer Tenants unnötig umständlich. Der erste Setup-User bekommt beide Rollen gleichzeitig zugewiesen.

---

## OQ-07 – Escrow-Material im Wizard

**Annahme:** Recovery-Modus im Wizard wählen; Shamir-Shares / Escrow-Keygen eher direkt nach erstem Login in der Admin-UI (weniger fragile Wizard-Session).

**Frage:** Escrow-Shares zwingend schon im Setup-Wizard anzeigen?

Antwort: Annahme bestätigt – nicht im Wizard. Die Modus-Wahl (welches Verfahren) gehört in den Wizard, die tatsächliche Share-Generierung/-Verteilung ist ein sensibler, eigenständiger Vorgang, der in der stabileren Admin-UI-Umgebung nach erstem Login stattfinden sollte, nicht in der potenziell fragilen Erstinstallations-Session.

---

## OQ-08 – Rollenmodell

**Annahme:** `member` | `tenant_admin` (+ ggf. `platform_admin`).

**Frage:** Weitere Rollen (Auditor read-only, Helpdesk ohne Escrow, …)?

Antwort: Für den MVP reichen member / tenant_admin / platform_admin. Eine auditor-Rolle (read-only Zugriff auf Audit-Logs, keine Secret-/User-Verwaltung) ist sinnvoll und günstig zu ergänzen, kann aber auch in einer späteren Phase nachgezogen werden statt den MVP-Scope zu vergrößern. „Helpdesk ohne Escrow" zunächst zurückstellen.

---

## OQ-09 – LDAP-Verbindungen: Instanz oder Tenant?

**Annahme:** Mehrere LDAP-Quellen möglich; Zuordnung primär **pro Tenant** (gleiche Instanz kann unterschiedliche Verzeichnisse bedienen).

**Frage:** Stattdessen nur globale LDAP-Config?

Antwort: Annahme bestätigt – pro Tenant konfigurierbar, auch wenn in der Praxis am Anfang vermutlich nur eine LDAP-Quelle genutzt wird. Die Flexibilität kostet im Datenmodell wenig, verbaut euch aber nichts für den Fall, dass später ein Tenant ein anderes Verzeichnis nutzen soll.

---

## OQ-10 – LDAP-Gruppen anzeigen?

**Annahme:** LDAP-Gruppen beeinflussen Rechte nie; optional später nur Info-Anzeige.

**Frage:** Komplett ignorieren oder als nicht-autorisierende Metadaten spiegeln?

Antwort: Für den MVP komplett ignorieren. Die Info-Anzeige als Hilfestellung beim manuellen Gruppen-Mapping ist ein nettes Extra, aber kein Kernbestandteil – Datenmodell so anlegen, dass es sich später ergänzen lässt, ohne es jetzt zu bauen.

---

## OQ-11 – LDAP-User aus Verzeichnis entfernt

**Annahme:** Nächster Login schlägt fehl (Bind). Lokaler User-Datensatz bleibt; Envelopes/Secrets unverändert, bis Admin User deaktiviert und Shares rotiert.

**Fragen:**

1. Periodischer Sync „Account gone → auto-disable“?
2. Pflicht-Rotation aller Secrets dieses Users bei Auto-Disable?

Antwort: 1. Ja, periodischer Sync (z. B. täglich) einbauen, der geprüfte LDAP-User automatisch deaktiviert (nicht löscht), statt nur auf den nächsten fehlgeschlagenen Login-Versuch zu warten – ein entfernter AD-Account bedeutet in der Praxis meist Offboarding, das sollte zeitnah wirken. 2. Pflicht-Rotation nur für Secrets, bei denen der User alleiniger Owner war; für geteilte Secrets reicht der reguläre Rechteentzug samt Schlüssel-Rotation aus Prinzip 7.

---

## OQ-12 – Secret-Titel Klartext

**Annahme:** Titel/Collection-Namen als Klartext-Metadaten für Suche (Server sieht Titel).

**Frage:** Sollen Titel ebenfalls clientseitig verschlüsselt werden (keine serverseitige Suche)?

Antwort: Ja, Titel ebenfalls clientseitig verschlüsseln. Ein Secret-Titel wie „AWS Root Account Prod" ist selbst schon sensible Information, und „vergleichbar Passbolt/Vaultwarden" (euer eigener Vergleichsmaßstab) verschlüsseln beide Titel/Metadaten clientseitig. Suche muss dann clientseitig nach dem Entschlüsseln laufen (oder über einen client-seitig aufgebauten, verschlüsselten Suchindex) – konsistent mit Prinzip 1.

---

## OQ-13 – Shamir-Parameter Admin-Escrow

**Annahme:** z. B. 3-of-5, konfigurierbar pro Tenant.

**Frage:** Feste Policy oder Admin wählt k/n? Wer darf Shares halten (nur Menschen, auch HSM)?

Antwort: Konfigurierbar mit sinnvollem Default (3-of-5), Tenant-Admin darf k/n anpassen. Für den MVP nur menschliche Share-Holder (weitere Admins/benannte Personen); HSM-Unterstützung architektonisch nicht verbauen, aber nicht in der ersten Umsetzung bauen – das ist ein Ausbau, kein Blocker.

---

## OQ-14 – Konflikt: „alles über UI“ vs. Bootstrap

**Sachverhalt:** Sicherheits- und Betriebsmodell erfordern `MASTER_UNLOCK_KEY` von außen. Das widerspricht oberflächlich „keine Env-Vars“, ist aber als **einzige** Ausnahme spezifiziert.

**Status:** Kein stiller Widerspruch – dokumentiert als gewollte Ausnahme. Weitere Secrets dürfen nicht „aus Bequemlichkeit“ in Env wandern.

**Frage:** Datei-Mount statt Env als bevorzugter Prod-Weg?

Antwort: Ja, Datei-Mount (z. B. gemountetes Keyfile oder Docker/Podman Secret) als bevorzugter Produktivweg, da Env-Variablen über Prozessliste/Logs//proc leichter versehentlich exponiert werden. Env-Var als Fallback nur für lokale Entwicklung/Tests.

---

## OQ-15 – Konflikt: Admin-Escrow vs. Zero-Knowledge

**Sachverhalt:** Prinzip 1 (Zero-Knowledge) gilt streng im User-Kit-Modus. Admin-Escrow erlaubt bewusste Wiederherstellung und schwächt ZK gegenüber Escrow-Inhabern.

**Status:** Kein Bug, sondern Tenant-Policy-Trade-off (Prinzip 10). UI muss den Trade-off klar labeln.

**Frage:** Escrow-Modus in manchen Tenants verbieten (Compliance-Profile)?

Antwort: Ja, ein Tenant sollte admin_escrow als Option komplett deaktivieren können (nur user_kit erzwingen), falls dort strengere Anforderungen gelten. Da der Modus ohnehin pro Tenant konfigurierbar ist, ist das Deaktivieren einer Option ein kleiner Zusatzaufwand mit klarem Nutzen.

---

## OQ-16 – Server-Hash für Login-Passwort

**Annahme:** Argon2id auch serverseitig für lokale Login-Passwörter (getrennt von Vault-MK).

**Frage:** Akzeptabel, oder bevorzugte Server-Hash-Lib/Policy?

Antwort: Akzeptabel, konsistent mit Prinzip 4 (Argon2id als durchgängiger Standard). Kostenfaktor pro Instanz/Tenant über Admin-UI einstellbar machen, mit sicherem Default.

---

## OQ-17 – Session- und Unlock-Lebensdauer

**Annahme:** HTTP-Session (Login) und In-Memory-Vault-Unlock (MK/SK) entkoppelt; Unlock-Timeout kürzer (z. B. 15–30 min Idle).

**Frage:** Konkrete Timeouts / „Sperrbildschirm“-UX?

Antwort: HTTP-Session z. B. 8 Stunden (Arbeitstag) mit Refresh, Vault-Unlock-Timeout 15 Minuten Idle als Default – beides über Admin-UI pro Tenant anpassbar. Bei Ablauf des Unlock-Timeouts erscheint ein Sperrbildschirm, der nur das Master-Passwort erneut verlangt (kein kompletter Re-Login nötig), solange die HTTP-Session noch gültig ist.

---

## OQ-18 – Branding / Dark Mode

**Annahme:** Farben exakt storage-dashboard (`#A70240`, `#BED600`, `#0098DB` + Neutrals); UI flacher/moderner; Light+Dark.

**Frage:** Dark Mode Pflicht ab MVP oder nur Light zuerst?

Antwort: Nur Light zuerst für den MVP, Dark Mode als spätere, nicht-blockierende Erweiterung. Das reduziert den initialen UI-Scope, ohne die sicherheitskritischen Phasen zu verzögern.

---

## OQ-19 – Air-Gap / kein Internet

**Annahme:** Keine Telemetrie, keine CDN-Fonts/Scripts in Prod-Builds (Alles self-hosted).

**Frage:** Bestätigen für Hardening-Checkliste?

Antwort: Bestätigt – für die Hardening-Checkliste festhalten. Konsistent mit dem beschriebenen air-gapped Betrieb.

---

## OQ-20 – Phase-7 Passkeys verbindlich?

**Annahme:** Passkeys optional nach Review; TOTP in Phase 4 Pflichtbestandteil der Auth-Phase.

**Frage:** Passkeys für ersten Prod-Release nötig?

Antwort: Nein, nicht für den ersten Prod-Release nötig – ihr hattet 2FA/Passkey selbst schon als „optional" eingestuft. TOTP als Pflicht-Baseline in Phase 4 reicht für den ersten Produktivbetrieb, Passkeys können als spätere Erweiterung folgen.

---

## OQ-21 – Multi-Tenant-Membership & Tenant-Wechsel

**Anfrage (2026-08):** User sollen mehreren Tenants zugeordnet werden können; nach Login alle Secrets sehen oder zwischen Tenants wechseln; Login ohne Tenant-Slug.

**Ist-Zustand:** Ein User-Record gehört genau einem Tenant (`users.tenant_id`). Login erfordert `tenant_slug`. Session ist single-tenant. Crypto-Keys sind pro Tenant/User getrennt — aggregierte Vault-Ansicht über Tenants ist nicht trivial.

**Optionen:**
- (a) Membership-Tabelle + Tenant-Switcher (Session wechselt `tenant_id`, Vault pro Tenant separat entsperren)
- (b) Plattform-weite Identität + Federation (größerer Eingriff)
- (c) Status quo: Tenant-Slug pro Login, gleicher Username in mehreren Tenants = getrennte Konten

**Vorläufig:** (c) mit UX-Verbesserungen (Organisation-Dropdown am Login, Tenant-Name in UI/Footer, zuletzt gewählte Organisation im Browser). (a) für Phase 10+ planen.

---

## Review-Checkliste für euch

- [X] OQ-01 Stack
- [X] OQ-02 Tenancy
- [X] OQ-03 Recovery-Granularität
- [X] OQ-04 / OQ-20 Passkeys
- [X] OQ-11 LDAP-Lifecycle
- [X] OQ-12 Titel-Verschlüsselung
- [X] OQ-15 Escrow-Policy
- [X] OQ-18 Dark Mode

Nach Beantwortung: Teil C Phase 1 (Storage & Bootstrap) in neuem Composer-Turn starten.

**PO-Review abgeschlossen** – Entscheidungen oben; Docs aktualisiert.
