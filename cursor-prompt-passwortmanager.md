# Cursor-Prompt: Interner Multi-Tenant Passwortmanager

Zur Verwendung in Cursor: Teil A als Projekt-Kontext/Rules-Datei
(`.cursor/rules` bzw. am Anfang eines neuen Composer-Threads), Teil B/C als
eigene Prompts für die jeweilige Phase. Nicht alles in einem Rutsch
losschicken – nach jeder Phase Review durch euch, bevor die nächste startet.

---

## TEIL A – Projekt-Kontext (immer mitgeben)

```
# Projekt: Interner Team-Passwortmanager

## Einordnung
Selbst entwickeltes, self-hosted Pendant zu Passbolt/Vaultwarden für den
Betrieb in einem internen Firmennetz ohne Internetanbindung. Multi-Tenant-
fähig, Container-basiert, mit vollständiger Administration über eine
Web-UI statt über Environment-Variablen. Authentifizierung funktioniert
vollständig lokal (User+Passwort, in der App verwaltet); LDAP/AD ist eine
optionale Zusatzoption für Standorte, an denen ein Verzeichnisdienst
verfügbar ist.

## Nicht verhandelbare Sicherheitsprinzipien (gelten für JEDEN Codeabschnitt)
1. Zero-Knowledge: Der Server/die Datenbank sieht zu keinem Zeitpunkt
   Klartext-Secrets oder unverschlüsselte private Schlüssel.
2. Ver-/Entschlüsselung von Secrets passiert ausschließlich clientseitig
   im Browser (WebCrypto API / libsodium.js).
3. Ausschließlich etablierte, auditierte Kryptobibliotheken verwenden
   (libsodium/NaCl, WebCrypto). Niemals eigene kryptografische Primitive
   implementieren.
4. Master-Passwort-Ableitung: Argon2id. Niemals PBKDF2/bcrypt/MD5/SHA1
   allein für Key-Derivation.
5. Sharing-Modell: Für jedes geteilte Secret wird der Datenschlüssel pro
   berechtigtem User einzeln mit dessen Public Key verschlüsselt
   (asymmetrisch). Kein gemeinsam geteiltes Gruppenpasswort.
6. Authentifizierung ist hybrid und pro Tenant konfigurierbar:
   a) Lokale Authentifizierung (User+Passwort, in der App verwaltet) ist
      immer verfügbar und funktioniert vollständig ohne LDAP/AD.
   b) LDAP/AD ist optional zuschaltbar und dient AUSSCHLIESSLICH der
      Login-Authentifizierung (Bind-Request), niemals der Autorisierung.
   c) Beide Modi können parallel aktiv sein (hybrider Betrieb): manche
      User authentifizieren sich lokal, andere über LDAP/AD – das
      Auth-Backend eines Users wird pro User-Datensatz vermerkt.
   Autorisierung/Gruppenrechte laufen in JEDEM Fall vollständig lokal in
   der Anwendung, unabhängig davon ob/welche LDAP-Gruppen existieren.
7. Bei Rechteentzug: verpflichtende Rotation/Neuverschlüsselung des
   betroffenen Datenschlüssels, alte Version wird ungültig.
8. Speicherverschlüsselung ist unabhängig vom gewählten Storage-Backend
   (SQLite/PostgreSQL/JSON-Store) immer aktiv – das Backend sieht nur
   Ciphertext + notwendige Metadaten, nie mehr.
9. Login-Flow: Egal ob lokale Auth oder LDAP/AD – beides authentifiziert
   ausschließlich den WebUI-Zugang. Beim allerersten Login eines Users
   erzwingt die Anwendung die Erstellung eines user-eigenen
   Master-Passworts; erst daraus wird das Verschlüsselungs-Schlüsselpaar
   dieses Users abgeleitet (Argon2id). Ohne abgeschlossene
   Master-Passwort-Erstellung kein Zugriff auf Vault-Funktionen, nur auf
   den Onboarding-Screen. Gilt identisch für lokale wie LDAP-User.
10. Key-Recovery ist Pflichtbestandteil, nicht optional. Konfigurierbar
    pro Tenant über die Admin-UI zwischen zwei Modi:
    a) User-Ebene: Recovery-Codes/Recovery-Kit, die der User selbst bei
       Erstanmeldung generiert und sicher verwahrt (kein Admin-Zugriff)
    b) Admin-Ebene: Admin-Escrow-Schlüsselpaar, mit dem ein Admin im
       Notfall den privaten Schlüssel eines Users wiederherstellen kann
    Beide Modi müssen im Architekturdokument mit ihren jeweiligen
    Sicherheits-Trade-offs sauber gegenübergestellt werden (User-Ebene:
    kein Admin-Generalschlüssel, aber Datenverlust bei Verlust des
    Recovery-Kits; Admin-Ebene: Wiederherstellung möglich, aber der
    Admin-Escrow-Schlüssel ist selbst ein hochkritisches Asset und muss
    entsprechend geschützt/aufgeteilt werden, z. B. Secret Sharing).

## Konfigurationsphilosophie
- Genau EIN Bootstrap-Geheimnis darf/muss von außen kommen (Env-Var oder
  gemountete Datei), z. B. `MASTER_UNLOCK_KEY`. Dieses entschlüsselt beim
  Start die interne, verschlüsselte Konfigurationsdatenbank.
- Alles andere (LDAP-Server, Mail/SMTP, lokale Gruppen, Storage-Backend-
  Wahl, Tenants, Verschlüsselungsparameter) wird über den Setup-Wizard
  bzw. die Admin-UI konfiguriert und verschlüsselt in der internen Config-
  Datenbank abgelegt – NICHT über weitere Env-Variablen.
- Ausnahme, falls technisch nötig: Netzwerk-Port/Bind-Adresse dürfen
  weiterhin per Env/Flag laufen (rein infrastrukturell, keine Secrets).

## Tech-Stack (Vorschlag, im Planungsschritt verifizieren/anpassen)
- Backend: Rust (Actix-web/Axum) oder Go – Begründung: Memory-Safety,
  ausgereiftes Krypto-Ökosystem
- Frontend: TypeScript + modernes Framework (React/Svelte), WebCrypto API
  für alle Client-seitigen kryptografischen Operationen
- Storage-Abstraktion: eigenes Storage-Interface mit Implementierungen für
  SQLite, PostgreSQL, verschlüsseltes JSON-File-Backend – austauschbar zur
  Laufzeit über Admin-UI, kein Rebuild nötig
- Browser-/CLI-Integration: KEINE Bitwarden-Protokoll-Kompatibilität
  (großer, versionierter Protokollumfang: Sync, Ciphers, Folders, Orgs,
  Attachments, 2FA-Flows – hoher Implementierungs- und Pflegeaufwand).
  Stattdessen:
  a) Eigene, schlanke Browser-Extension (WebExtension), die direkt via
     HTTPS gegen die eigene REST-API spricht – kein fremdes Protokoll,
     kein lokaler Companion-Prozess nötig.
  b) Eigenes minimales CLI als dünner Wrapper über dieselbe REST-API
     (kein Nachbau der Bitwarden-CLI-Befehlsoberfläche).
  Beide nutzen ausschließlich das Crypto-Kernmodul aus Phase 2 (siehe Teil
  C), keine eigene Kryptologik in Extension/CLI duplizieren.
```

---

## TEIL B – Prompt für die Planungsphase

```
Du arbeitest im oben beschriebenen Projektkontext. Bevor Code entsteht,
brauche ich eine vollständige Architekturplanung. Erstelle KEINEN
Implementierungscode in diesem Schritt, sondern folgende Dokumente im
Repo unter /docs/planning/:

1. `architecture.md`
   - Komponentendiagramm (Backend, Frontend, Storage-Abstraktion, LDAP-
     Connector, Mail-Connector, Crypto-Modul)
   - Datenmodell: Tenants, User (inkl. Auth-Backend-Zuordnung: lokal vs.
     LDAP/AD), Gruppen, Secrets, Collections, Berechtigungen,
     Schlüssel-Ablage-Struktur
   - Multi-Tenancy-Modell: strikte Datentrennung pro Tenant im
     Datenmodell begründen (z. B. Tenant-ID auf jeder Tabelle vs.
     getrennte Schemas) – Trade-offs benennen

2. `crypto-design.md`
   - Vollständiger Ablauf: Login (lokal ODER LDAP, je nach User) →
     Erstanmeldung mit erzwungener Master-Passwort-Erstellung → Secret
     anlegen → Secret mit Gruppe/Tenant-intern teilen → Berechtigung
     entziehen → Passwort-Wechsel
   - Key-Recovery-Konzept für BEIDE Modi (User-Ebene und Admin-Ebene,
     siehe Sicherheitsprinzip 10), inkl. Entscheidung/Vorschlag, ob dies
     pro Tenant umschaltbar ist, und wie Secret Sharing (z. B. Shamir's
     Secret Sharing) beim Admin-Escrow-Modus den Single-Point-of-Failure
     "ein Admin-Schlüssel öffnet alles" entschärfen könnte
   - Explizite Tabelle: "Was verlässt niemals den Client unverschlüsselt"
   - 2FA-Konzept (TOTP) und Passkey/WebAuthn-Konzept, inkl. wie sich das
     zur Master-Passwort-Verschlüsselung verhält (Passkeys ersetzen i.d.R.
     nicht die Datenverschlüsselung, nur den Login – das muss sauber
     auseinandergehalten werden)

3. `storage-abstraction.md`
   - Interface-Design, das SQLite/PostgreSQL/JSON-Backend austauschbar
     macht, ohne dass Verschlüsselungslogik dem Backend bekannt ist
   - Migrationskonzept zwischen Backends über die Admin-UI

4. `setup-wizard-flow.md`
   - Kompletter First-Run-Ablauf: Bootstrap-Secret prüfen → Storage-
     Backend wählen → ersten Tenant + lokalen Admin-User anlegen (dieser
     erste Admin ist IMMER lokal authentifiziert, unabhängig von späterer
     LDAP-Konfiguration, um Aussperrung bei LDAP-Fehlkonfiguration
     auszuschließen) → optional LDAP/Mail konfigurieren →
     Verschlüsselungsparameter (Argon2id-Kostenfaktor etc.) festlegen

5. `admin-ui-scope.md`
   - Vollständige Liste aller über die Admin-UI verwaltbaren Bereiche:
     LDAP/AD-Verbindungen (optional, mehrere möglich), Mail/SMTP, lokale
     User- und Gruppenverwaltung (Anlegen/Bearbeiten/Deaktivieren lokaler
     User unabhängig von LDAP), LDAP/AD-User-Integration (Import bzw.
     Just-in-Time-Provisionierung beim ersten LDAP-Login, Zuordnung zu
     lokalen Gruppen), Tenants, Storage-Backend-Verwaltung/Migration,
     Verschlüsselungsparameter, Audit-Log-Einsicht, API-Key-Verwaltung
   - Explizit ausarbeiten: Wie werden lokale Gruppen und LDAP-User
     zusammengeführt? (Vorschlag: LDAP-User erscheinen nach erstem Login
     als normale User in der lokalen User-Verwaltung und werden dort wie
     lokale User beliebigen lokalen Gruppen zugeordnet – das Auth-Backend
     ist nur ein Attribut, keine strukturelle Trennung im Rechtemodell)

6. `open-questions.md`
   - Alle Punkte, bei denen du als KI eine Annahme getroffen hast, die
     ich als Product Owner bestätigen muss (z. B. konkrete Ausgestaltung
     des Admin-Escrow-Verfahrens, Passkey-Scope, ob Key-Recovery-Modus
     pro Tenant oder pro User wählbar sein soll, Verhalten bei
     LDAP-User der zwischenzeitlich aus dem Verzeichnis entfernt wurde)

Halte dich strikt an die "Nicht verhandelbaren Sicherheitsprinzipien" aus
dem Projekt-Kontext. Wo ein Anforderungspunkt (z. B. "nichts über Env
konfigurieren") mit einem Sicherheitsprinzip in Konflikt steht, mache den
Konflikt explizit sichtbar in `open-questions.md` statt ihn stillschweigend
aufzulösen.

Stoppe nach Erstellung dieser 6 Dokumente. Kein Implementierungscode.
```

---

## TEIL C – Prompt für die Umsetzungsphase (nach Planungs-Review)

```
Die Architekturdokumente unter /docs/planning/ wurden reviewed und
freigegeben [ggf. mit euren Anmerkungen ergänzen]. Setze jetzt Phase für
Phase um, jede Phase als eigener Commit/eigene Cursor-Composer-Runde:

Phase 1 – Storage-Abstraktion & Bootstrap
- Storage-Interface + SQLite-Implementierung zuerst (einfachster Fall)
- Bootstrap-Flow: MASTER_UNLOCK_KEY prüfen, verschlüsselte Config-DB
  anlegen/öffnen
- Unit-Tests für Storage-Layer

Phase 2 – Crypto-Kernmodul
- Argon2id-Ableitung, Schlüsselpaar-Generierung, AES-256-GCM für
  Secret-Verschlüsselung – als isoliertes, gut getestetes Modul
- Unit-Tests explizit für Grenzfälle: falsches Passwort, korrupter
  Ciphertext, abgelaufene/rotierte Schlüssel

Phase 3 – Setup-Wizard (Backend + Frontend)
- Gemäß setup-wizard-flow.md
- Nach Abschluss: System ist nutzbar mit einem Tenant/Admin, SQLite,
  ohne LDAP

Phase 4 – Auth (lokal + optionale LDAP-Integration)
- Lokale Authentifizierung (User+Passwort-Hash serverseitig, getrennt vom
  Vault-Verschlüsselungs-Schlüsselpaar) zuerst implementieren – System
  muss ohne jede LDAP-Konfiguration voll funktionsfähig sein
- LDAP-Bind für WebUI-Login als zusätzliche, optionale Auth-Methode
  ergänzen; pro User wird vermerkt, über welches Backend er sich
  authentifiziert
- Erstanmeldungs-Flow (gilt identisch für lokale wie LDAP-User): nach
  erfolgreichem Login und noch fehlendem Master-Passwort wird der User
  zwingend auf den Onboarding-Screen geleitet (Master-Passwort erstellen,
  Schlüsselpaar clientseitig generieren, Recovery-Kit gemäß
  konfiguriertem Modus erzeugen und User zur sicheren Aufbewahrung
  anzeigen) – kein Zugriff auf Vault-Funktionen vor Abschluss
- Key-Recovery-Verfahren beider Modi (User-Recovery-Kit und
  Admin-Escrow) implementieren und über Admin-UI pro Tenant umschaltbar
  machen
- 2FA (TOTP) ergänzen

Phase 5 – Lokale User-/Gruppenverwaltung, LDAP-User-Integration, Secrets & Sharing
- Admin-UI-Bereich für lokale User- und Gruppenverwaltung (Anlegen,
  Bearbeiten, Deaktivieren – unabhängig davon ob LDAP aktiv ist)
- LDAP-User-Integration: Just-in-Time-Provisionierung beim ersten
  LDAP-Login (User erscheint danach als normaler Eintrag in derselben
  User-Verwaltung wie lokale User, Auth-Backend nur als Attribut) sowie
  optional manueller/geplanter LDAP-User-Import über die Admin-UI
- CRUD für Secrets, Collections
- Sharing-Flow mit Pro-User-Verschlüsselung gemäß crypto-design.md
- Berechtigungsentzug inkl. Pflicht-Rotation

Phase 6 – Admin-UI (verbleibende Bereiche)
- Gemäß admin-ui-scope.md die noch offenen Bereiche (LDAP/AD-Verbindungen
  konfigurieren, Mail/SMTP, Tenants, Verschlüsselungsparameter, Audit-Log)
- Storage-Backend-Wechsel/-Migration als eigener, besonders sorgfältig
  getesteter Teilbereich (Datenverlustrisiko)

Phase 7 – Passkey/WebAuthn (optional, falls in open-questions.md bestätigt)

Phase 8 – API-Client-Integrationen
- Öffentliche REST-API (falls nicht schon in Phase 3-6 entstanden) sauber
  dokumentieren (OpenAPI-Spec)
- Eigene, schlanke Browser-Extension (WebExtension) gegen diese API
- Eigenes minimales CLI gegen dieselbe API
- Beide verwenden ausschließlich das Crypto-Kernmodul aus Phase 2, keine
  eigene/duplizierte Kryptologik

Für jede Phase:
- Schreibe Tests VOR bzw. zusammen mit dem Code, nicht danach
- Kommentiere jede sicherheitsrelevante Design-Entscheidung inline mit
  Begründung
- Führe am Ende der Phase eine kurze Selbstprüfung gegen die "Nicht
  verhandelbaren Sicherheitsprinzipien" durch und liste Abweichungen
  explizit auf

Nach Phase 6 (Kernsystem funktionsfähig): Erstelle eine
`SECURITY-REVIEW-CHECKLIST.md` mit allen Punkten, die vor einem
Produktivbetrieb mit echten Zugangsdaten durch ein externes
Sicherheitsaudit geprüft werden sollten.
```

---

## Praktischer Hinweis zur Nutzung in Cursor

- Teil A als `.cursor/rules/security-principles.mdc` (oder vergleichbare
  Cursor-Rules-Datei) ablegen, damit es in jedem Composer-Kontext aktiv ist,
  statt es jedes Mal neu einzufügen.
- Teil B als ersten Composer-Prompt in einem frischen Chat/Branch starten,
  Ergebnis committen, dann erst Teil C beginnen.
- Bei jeder Phase aus Teil C: neuer Composer-Turn, vorherige Phase als
  Kontext/Referenz mitgeben, nicht alles in einem Mega-Prompt bündeln –
  das erhöht die Wahrscheinlichkeit, dass Cursor Sicherheitsdetails
  "vergisst" oder vereinfacht.
