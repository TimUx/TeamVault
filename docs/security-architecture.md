# TeamVault – Technische Sicherheitsdokumentation

**Zielgruppe:** IT-Security, Informationssicherheitsbeauftragte, IT-Betrieb und technische Prüfer.
**Stand:** 5. November 2026; Implementierung im aktuellen Repository einschließlich der Web-FIDO2- und Offline-Funktionen.
**Geltungsbereich:** Server, WebUI/PWA, Desktop-Client, Browser-Extension und CLI.

Dieses Dokument beschreibt den **implementierten Ist-Zustand**, nicht nur das angestrebte Sicherheitsmodell. Eine installierte Release-Version kann davon abweichen; für eine Freigabe müssen deren Version, Build-Herkunft und konkrete Konfiguration separat erfasst werden. Die Beschreibung ist weder eine Zertifizierung noch ein unabhängiger Penetrationstest oder ein Nachweis vollständiger Fehlerfreiheit.

Die Begriffe **implementiert**, **Betriebsanforderung** und **Grenze** werden bewusst unterschieden. Empfehlungen sind keine automatisch erzwungenen Produkteigenschaften. Historische Planungsdokumente sind bei abweichenden Aussagen nicht als Sicherheitszusicherung zu verstehen.

## Inhaltsverzeichnis

1. [Sicherheitsmodell und Vertrauensgrenzen](#1-sicherheitsmodell-und-vertrauensgrenzen)
2. [Daten- und Schlüsselhierarchie](#2-daten--und-schlüsselhierarchie)
3. [Kryptografische Verfahren und Parameter](#3-kryptografische-verfahren-und-parameter)
4. [Passwörter, Anmeldung und Mehrfaktor-Authentifizierung](#4-passwörter-anmeldung-und-mehrfaktor-authentifizierung)
5. [Sitzungen und API-Schlüssel](#5-sitzungen-und-api-schlüssel)
6. [Berechtigungen, Teilen und Rechteentzug](#6-berechtigungen-teilen-und-rechteentzug)
7. [Recovery und Schlüsselwechsel](#7-recovery-und-schlüsselwechsel)
8. [Serverseitige Speicherung](#8-serverseitige-speicherung)
9. [Transportverschlüsselung und Zertifikate](#9-transportverschlüsselung-und-zertifikate)
10. [WebUI und Browser-Schutzmaßnahmen](#10-webui-und-browser-schutzmaßnahmen)
11. [Offline-Vault und lokale Speicherung](#11-offline-vault-und-lokale-speicherung)
12. [Besonderheiten der Clients](#12-besonderheiten-der-clients)
13. [Exporte, Backups und Wiederherstellung](#13-exporte-backups-und-wiederherstellung)
14. [Audit, Protokollierung und Nachvollziehbarkeit](#14-audit-protokollierung-und-nachvollziehbarkeit)
15. [Builds, Updates und Lieferkette](#15-builds-updates-und-lieferkette)
16. [Betriebsanforderungen und Freigabe-Checkliste](#16-betriebsanforderungen-und-freigabe-checkliste)
17. [Vorgehen bei Verlust oder Kompromittierung](#17-vorgehen-bei-verlust-oder-kompromittierung)
18. [Implementierungsnachweise](#18-implementierungsnachweise)

## 1. Sicherheitsmodell und Vertrauensgrenzen

### 1.1 Was „Zero-Knowledge“ hier bedeutet

TeamVault trennt **Authentifizierung am Server** von **Entschlüsselung des Vaults**:

- Die Anmeldung erlaubt API-Zugriffe entsprechend Konto, Tenant, Rolle und Freigaben.
- Das Master-Passwort entsperrt den privaten Benutzerschlüssel ausschließlich im jeweiligen Client.
- Titel und Secret-Inhalte werden clientseitig verschlüsselt. Der Server erhält diese Inhalte nur als Ciphertext sowie verschlüsselte Datenschlüssel.
- Ein gültiges Login, ein API-Schlüssel, das Server-Unlock-Keyfile oder eine administrative Rolle allein liefern keinen unverschlüsselten privaten Vault-Schlüssel.

Der Schutz bezieht sich insbesondere auf gespeicherte Vault-Inhalte und Datenbankkopien. Er bedeutet **nicht**, dass der Server keinerlei vertrauliche Informationen verarbeitet: Login-Passwörter werden zur Prüfung übertragen; LDAP-/SMTP-Zugangsdaten, Login-TOTP-Seeds und Sitzungstoken gehören zur serverseitigen Vertrauensdomäne.

### 1.2 Welche Systeme vertrauenswürdig sein müssen

1. **Endgerät und Client-Laufzeit:** Browser, WebView, Betriebssystem und ausführbare Client-Dateien dürfen nicht kompromittiert sein.
2. **Auslieferung des Web-Clients:** Ein kompromittierter Server oder ein manipuliertes Release kann JavaScript ausliefern, das beim Entsperren Passwörter oder Schlüssel ausliest. Die reine Datenbankverschlüsselung verhindert das nicht.
3. **TLS-Endpunkt und Zertifikatsprüfung:** Ohne vertrauenswürdigen Transport können Anmeldedaten und Client-Code verändert oder mitgelesen werden.
4. **Schlüsselverzeichnis:** Für Freigaben werden öffentliche Empfängerschlüssel vom Server bezogen. Die aktuelle Client-Prüfung ersetzt keine unabhängige Identitätsprüfung; siehe [Abschnitt 6.3](#63-vertrauen-in-öffentliche-empfängerschlüssel).
5. **Recovery-Verantwortliche:** Bei Admin-Escrow ermöglichen ausreichend viele Shares die Rekonstruktion des Escrow-Private-Keys. Gegen diese berechtigte Rekonstruktion besteht keine Zero-Knowledge-Garantie.

**Nicht abgedeckt:** Schutz vor einem bereits entsperrten kompromittierten Endgerät, Kameras, vollständigen Speicherabbildern, vom Empfänger angefertigten Klartextkopien oder einem Angreifer mit Kontrolle über die aktive Client-Ausführung. Verfügbarkeit, Integrität des gesamten Servers und Datenschutz der Metadaten benötigen zusätzliche Betriebsmaßnahmen.

### 1.3 Welche Informationen nicht geheim verschlüsselt sind

Die Vault-Verschlüsselung verbirgt nicht die vollständige Organisationsstruktur. Serverseitig liegen unter anderem Tenant-/Benutzernamen, Anzeigenamen, E-Mail-Adressen, Rollen, Gruppen, Mitgliedschaften, Freigabebeziehungen, Secret-IDs, Ersteller, Zeitstempel, Sichtbarkeit, Schlüsselversionen und gegebenenfalls `collection_id` als Metadaten vor. Ciphertext-Längen bleiben ebenfalls sichtbar.

Titel, Passwörter, Benutzernamen **innerhalb eines Secrets**, URLs, Notizen, Secret-TOTP-Seeds und Extra-Felder gehören dagegen zum verschlüsselten Titel beziehungsweise Payload. Tags und das im Payload geführte Favoritenmerkmal werden clientseitig verarbeitet. Zusätzliche UI-Indizes, etwa favorisierte Secret-IDs im Browser, sind hiervon zu unterscheiden.

## 2. Daten- und Schlüsselhierarchie

### 2.1 Online-Ablauf

```text
Anmeldung:
  Login-Passwort / LDAP-Bind oder Login-Passkey
      + Login-TOTP, sofern eingerichtet bzw. vorgeschrieben
      -> Server-Sitzung -> autorisierte API-Zugriffe

Lokale Entschlüsselung:
  Master-Passwort + Benutzer-Salt + Argon2id-Parameter
      -> Master-Key (MK)
      -> NaCl-secretbox öffnen -> privater Benutzerschlüssel (SK)
      -> eigenen NaCl-box-Envelope öffnen -> Datenschlüssel (DK)
      -> AES-256-GCM -> Secret-Titel und Secret-Payload
```

Diese beiden Pfade sind unabhängig: Der Server kann eine Sitzung ausstellen, ohne das Master-Passwort zu kennen. Umgekehrt ist eine vorhandene Offline-Kopie ohne aktuelle Server-Anmeldung nutzbar, wenn ihre lokalen Entschlüsselungsfaktoren vorliegen.

### 2.2 Wichtige Schlüssel und Geheimnisse

| Material | Erzeugung und Zweck | Aufbewahrung |
|---|---|---|
| Login-Passwort | Vom Benutzer beziehungsweise Administrator festgelegt; nur Server-Anmeldung | Lokal: Argon2id-Hash im User-Store. LDAP: Prüfung am Verzeichnisdienst |
| Master-Passwort | Vom Benutzer festgelegt; Ableitung des MK | Bei bestimmungsgemäßer Nutzung nur im Client; kein Upload als Vault-Master-Passwort |
| MK | Argon2id aus Master-Passwort und Salt | Temporär im Client; öffnet den verschlüsselten SK |
| Benutzer-Schlüsselpaar | Zufälliges X25519/NaCl-box-Schlüsselpaar, je 32 Byte | Public Key auf dem Server; SK nur verschlüsselt persistent, nach Unlock im Client-RAM |
| DK je Secret/Schlüsselversion | Zufällige 32 Byte | Nur verschlüsselt in Empfänger-Envelopes; geöffnet temporär im Client |
| User-Recovery-Kit | Zufälliges 32-Byte-Geheimnis | Anzeige/Export beim Benutzer; serverseitig nur die damit geschützte SK-Hülle |
| Escrow-Schlüsselpaar | Clientseitig erzeugtes X25519-Schlüsselpaar | Public Key auf dem Server; privater Schlüssel als getrennt verwahrte Shamir-Shares |
| Server-Unlock-Key | Extern bereitgestelltes hochentropisches Keyfile, mindestens 32 Byte nach Einlesen | Secret-Mount/Keyfile; im laufenden Server zur Config-Verarbeitung verfügbar |
| API-Schlüssel | 32 Zufallsbytes, als `tvk_` plus Hex ausgegeben | Klartext einmal an den Ersteller; SHA-256-Hash in der verschlüsselten Config |
| Software-Key für Offline | Unabhängig erzeugte 32 Zufallsbytes | Externe Key-Datei/manuelle Bereitstellung; nicht automatisch neben dem Cache speichern |
| FIDO2-PRF-Ergebnis | 32 Byte aus dem registrierten Authentikator und Slot-PRF-Salt | Nur temporär im Web-Client, nicht im Cache oder auf dem Server |
| Offline-Root-Key | Zufällige 32 Byte bei HARDWARE/COMBINED | Je Hardware-Keyslot verschlüsselt; geöffnet im Client-RAM |
| Offline-Snapshot-DEK | Zufällige 32 Byte | Verschlüsselt unter Software-Key-KEK oder Offline-Root-Key; verschlüsselt den gesamten Snapshot |

**Begriffe:** Ein Salt ist nicht geheim; er verhindert identische Ableitungen und trennt Kontexte. Eine Nonce muss für den jeweiligen Schlüssel eindeutig sein und wird hier zufällig erzeugt. Base64 und Hex sind ausschließlich Kodierungen, **keine Verschlüsselung**.

## 3. Kryptografische Verfahren und Parameter

### 3.1 Verwendete Primitive

| Einsatz | Verfahren und wesentliche Parameter | Implementierung |
|---|---|---|
| Lokaler Login-Passwort-Hash | Argon2id; Default `t=3`, `m=65536 KiB` (64 MiB), `p=1`, Ergebnis 32 Byte; Salt 16 Byte | Go `golang.org/x/crypto/argon2` |
| Vault-Master-Passwort → MK | Argon2id; Default ebenfalls `t=3`, 64 MiB, `p=1`, 32 Byte; Salt 16 Byte | Web: `hash-wasm`; Go-Clients: `x/crypto/argon2` |
| SK unter MK bzw. Recovery-Key | NaCl `secretbox`: XSalsa20-Poly1305; Schlüssel 32 Byte, Nonce 24 Byte, MAC 16 Byte | Web: TweetNaCl; Go: `x/crypto/nacl/secretbox` |
| Secret-Titel und Payload | AES-256-GCM; DK 32 Byte, Nonce 12 Byte, Authentifizierungstag 128 Bit | WebCrypto bzw. Go `crypto/aes`/`crypto/cipher` |
| Datenschlüssel an Empfänger | NaCl `box`: X25519, XSalsa20-Poly1305; ephemeres Schlüsselpaar pro Envelope, Nonce 24 Byte | TweetNaCl bzw. `x/crypto/nacl/box` |
| Server-Config und kleine serverseitige Geheimnisse | AES-256-GCM; Schlüssel aus HKDF-SHA-256 über dem Server-Unlock-Key; Nonce 12 Byte | Go-Standardbibliothek, HKDF nach RFC 5869 |
| STANDARD-Offline-Keyslot | HKDF-SHA-256 über 32-Byte-Software-Key; Salt 32 Byte; AES-256-GCM zum Wrappen des DEK | WebCrypto bzw. Go `x/crypto/hkdf` |
| FIDO2-Offline-Keyslot | HKDF-SHA-256 über PRF beziehungsweise PRF + Software-Key; Wrap-Salt 32 Byte; AES-256-GCM für Root-Key | WebCrypto und WebAuthn-PRF |
| Offline-Snapshot | AES-256-GCM; zufälliger 32-Byte-DEK, Nonce 12 Byte, Tag 128 Bit | WebCrypto beziehungsweise Go |
| Benutzer-Backup `.tvbak` | Argon2id → 32-Byte-Key; AES-256-GCM; Salt 16 Byte, Nonce 12 Byte | `vault-io.js` und `cryptocore.js` |
| Login-TOTP | RFC-6238-Verfahren, HMAC-SHA-1, sechs Ziffern, 30 Sekunden | Go `pquerna/otp` |
| Fingerprints, API-Key-Hash, Snapshot-Prüfsummen | SHA-256 | WebCrypto bzw. Go |

HMAC-SHA-1 kommt hier für das interoperable TOTP-Verfahren zum Einsatz, **nicht** als Passwort-Hash oder Vault-KDF. Die Algorithmen sind keine Aussage über FIPS-Validierung oder eine Produktzertifizierung.

### 3.2 Zufall und Integrität

- Kryptografische Schlüssel und Nonces werden über `crypto/rand`, WebCrypto `crypto.getRandomValues()` oder die entsprechende NaCl-Zufallsfunktion erzeugt.
- Der Web-Passwortgenerator verwendet `crypto.getRandomValues()` und berücksichtigt die angebotenen Zeichenklassen; seine erzeugten Passwörter sind keine separat gespeicherten Anwendungsschlüssel.
- AES-GCM und NaCl authentifizieren ihre jeweiligen Ciphertexte. Falsche Schlüssel oder veränderte authentifizierte Daten führen zur fehlgeschlagenen Entschlüsselung.
- Beim normalen Secret-AES-GCM ist `key_version` als vier Byte im Big-Endian-Format die Additional Authenticated Data (**AAD**). Hier wird **nicht** pauschal behauptet, dass jedes API-Metadatenfeld Teil dieses kryptografischen Kontexts ist.
- Offline-Formate binden wesentlich mehr Kontext als AAD ein; siehe [Abschnitt 11](#11-offline-vault-und-lokale-speicherung).
- Eine SHA-256-Prüfsumme ohne geheimen Schlüssel oder Signatur erkennt Beschädigungen, beweist aber keine Herkunft gegenüber absichtlicher Manipulation.

### 3.3 Argon2-Parameter und Änderungen

Die administrierbaren Vault-Argon2-Parameter sind von den festen Defaults des **serverseitigen Login-Passwort-Hashings** zu unterscheiden. Die zum privaten Benutzerschlüssel gehörenden KDF-Parameter werden accountbezogen gespeichert und beim Unlock verwendet. Bei älteren Datensätzen bestehen Fallback-Pfade für bekannte Parameterquellen.

Eine administrative Parameteränderung verschlüsselt nicht automatisch alle bestehenden privaten Schlüssel neu. Maßgeblich sind die tatsächlich am Key-Blob gespeicherten beziehungsweise für dessen Erzeugung verwendeten Werte. Für eine Betriebsfreigabe sind reale Konten und Backups zu prüfen, nicht nur der aktuelle Wert der globalen Einstellungsseite. Reduzierte Testparameter sind keine Produktionsempfehlung.

## 4. Passwörter, Anmeldung und Mehrfaktor-Authentifizierung

### 4.1 Lokale Anmeldung

1. Der Client überträgt Tenant/Benutzer und Login-Passwort an `/api/auth/login`.
2. Der Server prüft das Passwort gegen den accountbezogenen Argon2id-Hash.
3. Der Hash enthält Algorithmus, Parameter, Salt und Ergebnis im kodierten Argon2id-Format; der Ergebnisvergleich erfolgt konstantzeitlich.
4. Bei eingerichtetem TOTP folgt dessen Prüfung; danach wird die Sitzung ausgestellt.
5. Ein noch nicht onboardeter Benutzer muss anschließend im Web ein Master-Passwort und die Vault-Identität einrichten.

Das Login-Passwort liegt während der Prüfung im Serverprozess vor. „Zero-Knowledge“ macht HTTP für diesen Pfad nicht sicher. **HTTPS ist für produktive Anmeldungen zwingende Betriebsanforderung.**

Für lokale Login-Passwörter erzwingt der Server mindestens 16 Zeichen, Groß- und Kleinbuchstaben, Ziffer und Sonderzeichen; zugelassen sind druckbare ASCII-Zeichen ohne Leerzeichen. Umlaute und `ß` sind ausgeschlossen. Dies gilt auch für lokale Neuanlage, Passwortänderung und administrative Passwortzurücksetzung.

### 4.2 LDAP/Active Directory

LDAP/AD dient der **Authentifizierung**, nicht der Freigabe von Vault-Secrets:

- TeamVault verwendet je nach Konfiguration einen Service-Bind zur Suche des Benutzer-DN und danach einen Bind mit dem Benutzerpasswort.
- Das Benutzerpasswort wird nicht als lokaler TeamVault-Passwort-Hash gespeichert. Der TeamVault-Server verarbeitet es für den Bind trotzdem transient.
- Service-Bind-DN und Service-Bind-Passwort liegen in der verschlüsselten Server-Config.
- Rechte, Rollen, Gruppen und Secret-Freigaben werden im lokalen TeamVault-Store verwaltet.
- JIT-Anlage oder Vorab-Import legen einen lokalen Kontodatensatz an. Verzeichnis-Sync kann nicht mehr vorhandene LDAP-Konten deaktivieren; dies ersetzt keine kryptografische Rotation geteilter Secrets.
- LDAP-Passwortregeln sind Sache des Verzeichnisdienstes.

**Transportgrenze:** `UseTLS=true` verwendet LDAPS. Bei `UseTLS=false` wird unverschlüsseltes LDAP verwendet; dieser Pfad führt nicht automatisch ein StartTLS-Upgrade durch. Für den Produktivbetrieb LDAPS und vollständige Zertifikatsprüfung verlangen.

### 4.3 Master-Passwort

Das Master-Passwort wird lokal mit Argon2id in den MK überführt. Der MK öffnet den privaten Benutzerschlüssel; er ist weder Login-Passwort-Hash noch API-Token.

Die aktuelle WebUI verlangt bei Onboarding beziehungsweise Neusetzen mindestens 16 Unicode-Zeichen, Groß-/Kleinbuchstaben, eine Zahl und ein nicht alphanumerisches Zeichen. Umlaute und Leerzeichen sind im Unterschied zum lokalen Login-Passwort erlaubt. Diese Prüfung ist **clientseitig**: Der Server kennt das Master-Passwort nicht und kann dessen tatsächliche Stärke bei einem fremden oder manipulierten Client nicht beurteilen.

**Betriebsanforderung:** Login- und Master-Passwort müssen unterschiedlich sein. Bei Wiederverwendung desselben Geheimnisses kennt der Login-Server auch einen möglichen Entschlüsselungswert; die beabsichtigte Trennung verliert damit ihre Wirkung.

### 4.4 Login-TOTP und Secret-TOTP sind verschiedene Dinge

**Login-TOTP:**

- Sechs Ziffern, 30-Sekunden-Zeitschritt, HMAC-SHA-1.
- Akzeptiertes Zeitfenster: aktueller Schritt sowie je zwei Schritte davor/danach. Verlässliche Zeitsynchronisation bleibt erforderlich.
- Ein bereits akzeptierter oder älterer Zeitschritt wird über den gespeicherten letzten Counter pro Benutzer abgewiesen.
- Die Persistierung dieses Counters ist nicht in allen Fehlerpfaden strikt erzwungen. Schreibfehler, Neustart oder Restore können den dauerhaften Replay-Schutz beeinträchtigen; die Counter-Datei ist keine unveränderliche Sicherheits-Historie.
- Der Web-Login verwendet bei Bedarf ein kurzlebiges, einmal verbrauchtes `login_token` mit fünf Minuten Laufzeit für den zweiten Schritt.
- Der TOTP-Seed wird mit dem Config-Unlock-abgeleiteten AES-GCM-Schlüssel serverseitig verschlüsselt, nicht mit dem Vault-Master-Key. Der Server muss ihn vor dem Vault-Unlock lesen können.
- Kompatibilitätscode kann alte, lediglich Base64-kodierte TOTP-Seeds lesen. Bei Altbeständen ist der tatsächliche Migrationsstand zu prüfen; Base64-Altdaten dürfen nicht als verschlüsselt bewertet werden.
- Eine globale oder Tenant-TOTP-Pflicht kann die Einrichtung verlangen; bis dahin sind reguläre API-Zugriffe für eine entsprechend markierte Sitzung eingeschränkt.

**TOTP in einem gespeicherten Secret:** Der Seed gehört zum verschlüsselten Secret-Payload. Ein entsperrter Client berechnet daraus Codes für den jeweiligen fremden Dienst. Dieser Seed ist nicht der serverseitige Login-TOTP-Seed.

**Grenze:** Login-TOTP ist kein kryptografischer Faktor des Offline-Vaults. Ein Offline-Unlock führt keine Server-TOTP-Prüfung durch. Offline-TOTP als zusätzlicher lokaler Faktor ist nicht implementiert.

### 4.5 Login-Passkeys

Die Online-Anmeldung unterstützt WebAuthn über `go-webauthn`. Registrierung und Anmeldung verwenden Challenges mit fünf Minuten Lebensdauer und einmaligem Verbrauch; die Bibliothek prüft die WebAuthn-Antwort im jeweiligen RP-/Origin-Kontext. Gespeichert werden unter anderem Credential-ID, öffentlicher Schlüssel, AAGUID, Transportinformationen und Signaturzähler.

Ein Login-Passkey ersetzt das Login-Passwort im entsprechenden Anmeldepfad. Eingerichtetes Login-TOTP wird danach weiterhin berücksichtigt. **Der Passkey ersetzt nicht das Vault-Master-Passwort.**

Davon getrennt sind die ausschließlich lokal verwendeten **Offline-FIDO2-PRF-Credentials** aus Abschnitt 11. Die Registrierung eines Login-Passkeys richtet nicht automatisch einen Offline-Keyslot ein. Eine gerätegebundene Hardware- oder Hersteller-Attestation ist nicht pauschal für den Login zugesichert.

## 5. Sitzungen und API-Schlüssel

### 5.1 Cookie-Sitzungen

- Sitzungs-IDs werden aus 32 Zufallsbytes erzeugt und als Hex kodiert.
- Cookie-Name: `tv_session`.
- Attribute: `HttpOnly`, `SameSite=Lax`, passende `Path`-Beschränkung und Ablaufdatum.
- `Secure` wird gesetzt, wenn die Anfrage direkt oder über vertrauenswürdig konfigurierte Forwarded-Header als HTTPS erkannt wird. Bei reinem HTTP ist das Cookie **nicht** Secure.
- Standardlaufzeit: acht Stunden. Die konfigurierbare Policy steuert neue Sitzungen; eine allgemeine harte Obergrenze beträgt 90 Tage.
- „Angemeldet bleiben“ verwendet 90 Tage und überspringt die serverseitige Idle-Ablaufprüfung. Dies ist eine Sicherheits-/Komfortentscheidung, kein Fortbestehen des entschlüsselten Vaults.
- Nicht gemerkte Sitzungen unterliegen zusätzlich dem konfigurierten Idle-Timeout; Default 15 Minuten.
- Parallele Sitzungen auf mehreren Geräten sind erlaubt.
- Logout entfernt die betreffende Sitzung. Login-Passwort- oder Rollenänderungen widerrufen Benutzersitzungen in den dafür vorgesehenen Pfaden. Bei API-Zugriffen wird außerdem auf deaktivierte Benutzer/Tenants geprüft.

Der Server hält Sitzungen im RAM und zusätzlich in `<data-dir>/sessions.json`. **Diese Datei ist JSON mit verwendbaren Sitzungstoken und nicht mit dem Vault- oder Config-Schlüssel verschlüsselt.** Der Code legt sie mit Unix-Dateimodus `0600` an. Wer sie lesen kann, erhält potenziell gültige Bearer-Geheimnisse.

Sitzungsverwaltung, WebAuthn-Challenges und Login-Zwischenzustände besitzen keinen verteilten Cluster-Koordinationsmechanismus. Mehrere Replicas sind nicht automatisch gleichwertig zu einer einzelnen konsistenten Authentifizierungsinstanz.

### 5.2 API-Schlüssel

API-Schlüssel werden über `Authorization: Bearer tvk_…` verwendet. Ihre Geheimnisse werden nur einmal ausgegeben; persistent wird der SHA-256-Hash im verschlüsselten Config-Bundle gespeichert. Für zufällige 256-Bit-Tokens ist dieser Hashzweck von einer langsamen Passwort-KDF zu unterscheiden.

Scopes beschränken den API-Zugriff zusätzlich zu Benutzerrollen und Secret-Berechtigungen:

- `read`: eingeschränkte GET-Allowlist; keine allgemeinen Schreibrechte.
- `vault`: Vault-/Secret-Operationen im vorgesehenen Allowlist-Modell.
- `admin`: administrative Endpunkte zusätzlich zum übrigen Scope-Modell, aber nur soweit die Rolle des hinterlegten Benutzers berechtigt.
- Konto-Authentifizierungsoperationen wie Login-Passwort-, TOTP- und WebAuthn-Verwaltung sind für API-Schlüssel gesperrt.
- Legacy-Keys ohne Scopes werden auf die Read-Allowlist beschränkt.

Die Datensatzstruktur kann ein Ablaufdatum prüfen. Der aktuelle Erstellungsendpunkt setzt jedoch kein Ablaufdatum; neu erzeugte Schlüssel sind daher nicht automatisch kurzlebig. Expliziter Widerruf, Inventarisierung und regelmäßiger Austausch sind Betriebsaufgaben.

Ein API-Schlüssel allein öffnet keine Vault-Ciphertexte. Ein gestohlener Schlüssel kann dennoch Metadatenzugriffe oder je nach Scope weitreichende Änderungen ermöglichen und ist entsprechend hoch zu schützen. Er erfordert bei jeder Nutzung keine interaktive Login-TOTP-Eingabe.

### 5.3 Begrenzung von Online-Anmeldeversuchen

Der aktuelle Server begrenzt im Prozessspeicher:

| Pfad | Grenze |
|---|---|
| Passwort-Login | 20 Requests pro Minute und Remote-IP |
| Passwort-Login, Benutzerkontext | 10 Requests pro Minute und normalisierter Kombination Tenant/Benutzer |
| Zweiter TOTP-Login-Schritt | 30 Requests pro Minute und Remote-IP |
| WebAuthn-Login-Beginn | 20 Requests pro Minute und Remote-IP |

Diese Grenzen sind pfadbezogen, nicht als universeller Schutz aller API-Endpunkte zu verstehen. Sie sind nicht zwischen Replicas synchronisiert und gehen bei Neustart verloren. Hinter einem Proxy kann `RemoteAddr` dessen Adresse sein; dann teilen sich Benutzer ein IP-Limit. Ergänzende Edge-Rate-Limits, Monitoring und eine passende Proxy-Topologie sind erforderlich. Gegen Offline-Passwortversuche an gestohlenen Key-Blobs wirken diese Limits nicht; dort ist Argon2id maßgeblich.

## 6. Berechtigungen, Teilen und Rechteentzug

### 6.1 Zwei Schutzebenen

**Server-Autorisierung:** Tenant-Isolation, Kontostatus, Rollen und Secret-Capabilities begrenzen die verfügbaren API-Operationen.

**Kryptografische Autorisierung:** Für jeden berechtigten Benutzer wird derselbe DK der aktuellen Secret-Version separat an dessen Public Key verschlüsselt. Ein Secret hat also nicht einen anderen Payload-DK pro Empfänger, sondern **einen DK pro Version und je Empfänger eine eigene Hülle**.

Die Rollen `member`, `tenant_admin`, `platform_admin` und `auditor` sind von den Secret-Rechtestufen `read`, `write`, `share`, `admin` zu unterscheiden. Höhere Secret-Capabilities umfassen die niedrigeren; der Owner hat Admin-Capability. Eine Plattform-Admin-Rolle ist kein Vault-Private-Key. Admins können abhängig von der Metadaten-Policy zusätzliche Inventareinträge sehen, ohne sie entschlüsseln zu können.

Gruppen organisieren die Empfänger: Jedes freigeschaltete Mitglied benötigt seinen eigenen Envelope. Es existiert kein gemeinsames Gruppenpasswort.

### 6.2 Teilen und Entziehen

Beim Teilen öffnet der berechtigte Client den DK und erzeugt neue NaCl-box-Envelopes für die Zielbenutzer. Der Server speichert die Hüllen und Freigabebeziehungen.

Ein kryptografischer Entzug erfordert:

1. neuen zufälligen DK und höhere `key_version`;
2. neue Verschlüsselung von Titel und Payload;
3. neue Envelopes nur für verbleibende Empfänger;
4. serverseitige Ungültigkeit der alten Envelopes beziehungsweise Version.

Der Rotationsendpunkt verlangt erhöhte Secret-Berechtigung, eine höhere Version und weiterhin einen Owner-Envelope. Ein reines Disable des Benutzers, Entfernen einer Gruppenmitgliedschaft oder Löschen einer Freigabemarkierung kann die erforderliche Neuverschlüsselung **nicht selbst durchführen**, weil der Server keinen DK im Klartext hat. Entsprechende Änderungen und angezeigte Rotationsbedarfe müssen vollständig abgearbeitet werden.

**Wichtige Grenze:** Rotation widerruft keine bereits gelesenen oder exportierten Inhalte. Wurde ein Zugangspasswort bereits bekannt, muss es zusätzlich **im Zielsystem** geändert werden. Eine Vault-DK-Rotation allein ändert dieses Passwort nicht.

### 6.3 Vertrauen in öffentliche Empfängerschlüssel

Die WebUI führt SHA-256-Fingerprints öffentlicher Schlüssel in einem lokalen Verzeichnis `tv_keydir_<tenant>` in `localStorage`. Die aktuelle Funktion `confirmRecipientKey()` ist jedoch **kein garantierter menschlicher Bestätigungsdialog**:

- Erste Schlüssel werden automatisch eingetragen.
- Ein geänderter bereits bekannter Schlüssel wird ohne `allowRefresh` zurückgewiesen.
- Mehrere explizite Sharing-/Rotationspfade verwenden `allowRefresh: true` und können den gespeicherten Fingerprint ersetzen.
- Die WebUI kann fehlende Envelopes bestehender Gruppenfreigaben nach dem Unlock und bei Gruppenänderungen automatisch nachpflegen.

Deshalb sind eine verbindliche Out-of-Band-Schlüsselprüfung und eine ausdrückliche Bestätigung jedes Gruppen-Catch-ups **nicht als implementierte Sicherheitsgarantie anzunehmen**. Der lokale Fingerprintspeicher ist weder eine unternehmensweite PKI noch ein signiertes Key-Transparency-Verzeichnis. Desktop und CLI besitzen ebenfalls keine allgemeine, clientübergreifend erzwungene Zertifizierung der Empfängerschlüssel.

## 7. Recovery und Schlüsselwechsel

### 7.1 User-Recovery-Kit

Im Modus `user_kit` wird clientseitig ein zufälliges 32-Byte-Kit-Geheimnis erzeugt. Aus diesem und einem eigenen Salt wird mit Argon2id ein Recovery-Key abgeleitet; NaCl-secretbox schützt damit eine zusätzliche Kopie desselben Benutzer-SK. Der Server erhält nur Salt, Nonce und Recovery-Ciphertext.

Die Wiederherstellung im Web:

1. online anmelden und die Recovery-Hülle des eigenen Kontos abrufen;
2. Recovery-Kit lokal einlesen und SK öffnen;
3. SK mit dem neuen Master-Passwort neu versiegeln;
4. neue Key-Blobs an den Server übertragen.

Ein Recovery-Kit ersetzt weder ein benötigtes Server-Login noch fehlende Secret-Envelopes. Offline-Recovery ist nicht implementiert. Der normale Web-Master-Passwort-Wechsel erzeugt im User-Kit-Modus ein **neues** Kit; der Recovery-Pfad mit vorhandenem Kit kann dieses dagegen weiterverwenden und neu versiegeln.

**Aufbewahrung:** Ein Kit ist ein eigenständiges, hochkritisches Entschlüsselungsgeheimnis. Nicht zusammen mit Vault-Backups oder frei zugänglichen Geräte-Downloads lagern. Ohne Master-Passwort und ohne nutzbaren Recovery-Pfad kann der Betreiber die Vault-Inhalte nicht aus dem Login-Passwort rekonstruieren.

### 7.2 Admin-Escrow und Shamir

Im Modus `admin_escrow` wird der Benutzer-SK zusätzlich per NaCl-box an den Tenant-Escrow-Public-Key verschlüsselt. Nicht jeder Secret-DK benötigt hierzu einen eigenen Escrow-Empfänger: Der rekonstruierte Benutzer-SK ermöglicht den Zugriff auf dessen vorhandene DK-Envelopes.

Der Escrow-Private-Key wird clientseitig erzeugt und in `k` aus `n` Shamir-Shares aufgeteilt. Die Defaults sind 3 aus 5. Die WebUI verwendet das mitgelieferte `secrets.js`; CLI-Werkzeuge verwenden `internal/shamir`. Die jeweiligen Share-Serialisierungen sind nicht ohne Weiteres als austauschbar vorauszusetzen.

Zum Ersetzen eines bereits gesetzten Escrow-Public-Keys muss der Client eine an den bisherigen Escrow-Key verschlüsselte Challenge öffnen. Der Server prüft das Ergebnis einer zeitlich begrenzten Zeremonie (15 Minuten), nicht die Zahl physisch unabhängiger Personen. Die organisatorische Mehrpersonenfreigabe muss der Betreiber gewährleisten.

**Grenzen und Betrieb:**

- Ausreichend viele Shares sind kryptografisch gleichwertig zum Escrow-Private-Key. Alle Shares in einer heruntergeladenen Datei an einem Ort zu belassen, hebt die organisatorische Trennung auf.
- Die vorhandenen Escrow-Hüllen sowie Split-/Combine- und Austauschfunktionen sind keine Zusage eines vollständig automatisierten Helpdesk-Recovery-Prozesses für sämtliche Clients.
- Ein Public-Key-Austausch verpackt bestehende Benutzer-Escrow-Hüllen nicht automatisch um. Alte Shares bleiben für alte Hüllen und Backups relevant, bis die betroffenen Hüllen sicher erneuert sind.
- Ein Wechsel des Tenant-Recovery-Modus ist im aktuellen Server bei vorhandenen Secrets gesperrt. Beim erlaubten Wechsel ist Re-Onboarding erforderlich.
- Kein automatischer HSM-/TPM-Schutz der Escrow-Shares und kein Hardware-Nachweis unabhängiger Share-Holder.

### 7.3 Welche Änderung welchen Schlüssel ersetzt

| Aktion | Wirkung | Was nicht automatisch passiert |
|---|---|---|
| Login-Passwort ändern/zurücksetzen | Neuer Login-Hash; Widerruf entsprechender Sitzungen | Keine neue Vault-Identität, kein neues Master-Passwort |
| Master-Passwort ändern | Neue Salt/Nonce und neue SK-Versiegelung; Recovery-Material je Modus erneuert | Benutzer-Schlüsselpaar und Secret-DKs bleiben grundsätzlich gleich |
| Secret-Berechtigung kryptografisch entziehen | DK, Ciphertexte und Envelopes der Secret-Version ersetzen | Keine Löschung fremder Kopien und keine Passwortänderung im Zielsystem |
| FIDO2-Offline-Key entfernen | Offline-Root-Key/Keyset und Snapshot-Versiegelung erneuern | Keine serverseitige Benutzer-Key-Rotation und kein Widerruf alter Cachekopien |
| API-Key widerrufen | Weitere Nutzung dieses Tokens verweigern | Keine Rotation von Vault-DKs |
| Server-Unlock-Key verlieren/kompromittieren | Betrifft Config und damit geschützte Server-Geheimnisse | Keine automatische Neuverschlüsselung aller bestehenden Dateien durch bloßen Austausch des Keyfiles |

Der aktuelle Server bietet keinen dokumentierten automatischen Re-Key-Lauf für das komplette Config-/TOTP-Material beim einfachen Austausch des Unlock-Keyfiles. Ein anderes Keyfile kann den vorhandenen Config-Store nicht öffnen; Austausch und Migration müssen kontrolliert geplant werden.

## 8. Serverseitige Speicherung

### 8.1 Vault-Store

Unterstützt sind SQLite und JSON-Datei. PostgreSQL ist noch kein angeschlossener produktiver Backend-Pfad.

- SQLite verwendet unter anderem WAL und speichert Vault-Ciphertexte, Hüllen und Metadaten. Es ist **keine SQLCipher-/Voll-Datenbankverschlüsselung** eingebaut.
- Der JSON-Store schreibt ebenfalls Ciphertexte und Metadaten, nicht eine zusätzlich komplett verschlüsselte Datenbankdatei.
- Login-Passwort-Hashes und öffentliche Schlüssel bleiben auslesbare Kontodaten. Login-TOTP-Seeds sind separat serverseitig verschlüsselt, soweit nicht ein Legacy-Format vorliegt.
- Datenbank, WAL/SHM-Dateien, JSON-Snapshots und Sicherungen gehören in ein zugriffsbeschränktes, möglichst zusätzlich datenträgerverschlüsseltes Dateisystem.

### 8.2 Config-Store und Bootstrap-Key

`<data-dir>/config/config.sealed` enthält die verschlüsselte Instanzkonfiguration, beispielsweise Storage-Einstellungen, LDAP-/SMTP-Passwörter, CA-Bundle, API-Key-Hashes und Policies.

Aus dem externen Server-Unlock-Key wird mit HKDF-SHA-256 ein 32-Byte-AES-Key abgeleitet; Domain-Separation: `teamvault-config-v1`. Die Datei enthält eine 12-Byte-Nonce und AES-GCM-Ciphertext inklusive Tag. Kleine weitere Geheimnisse, insbesondere Login-TOTP-Seeds, verwenden eine versionierte Blob-Hülle mit AAD `teamvault-blob-v1`.

Das Keyfile wird bevorzugt über `TEAMVAULT_MASTER_UNLOCK_KEY_FILE` eingelesen. Ein Env-Fallback existiert für Entwicklung/Test. Die Mindestlänge beträgt 32 Byte nach dem Einlesen; geprüft wird die Länge, **nicht die tatsächliche Entropie**. Ein langes menschengewähltes Passwort ist deshalb kein gleichwertiger Ersatz für Zufallsmaterial.

**Wirkungsgrenze:** Dieser Schlüssel schützt Server-Config-Geheimnisse at rest, nicht gegen einen kompromittierten laufenden Server. Nach dem Start muss der Prozess Config und TOTP-Seeds für seine Aufgaben lesen können. Das Keyfile ist kein Generalschlüssel für Vault-Payloads.

### 8.3 Weitere Dateien

| Ablage | Inhalt und Schutz |
|---|---|
| `config/config.sealed` | AES-GCM-verschlüsselte Config; getrenntes Unlock-Keyfile erforderlich |
| SQLite-/JSON-Vault-Dateien | Anwendungsverschlüsselte Vault-Inhalte plus auslesbare Metadaten, Login-Hashes und separat geschützte Server-TOTP-Seeds |
| `sessions.json` | Verwendbare Sitzungstoken und Sitzungsmetadaten, unverschlüsseltes JSON; Unix-Erstellung mit `0600` |
| `totp-counters.json` | Letzte akzeptierte Login-TOTP-Zeitschritte, keine Seeds; Unix-Erstellung mit `0600` |
| `setup.token` | Einmaliges Bootstrap-Token; `0600`; nach erfolgreichem Setup entfernt |
| Downloads/Release-Artefakte | Ausführbarer Client-Code; Integrität und Herkunft separat prüfen |

Das Setup-Token wird aus 32 Zufallsbytes erzeugt, nach `setup.token` geschrieben und bei Erzeugung auf stderr ausgegeben. `POST /api/setup/commit` verlangt es beispielsweise über `X-TeamVault-Setup-Token`. Bis zum Setup sind deshalb auch Container-/Dienstlogs vertraulich zu behandeln.

Unix-Modi sind keine vollständige Windows-ACL- oder Administrator-Isolationsgarantie. Zugriff auf Datenverzeichnis, Docker-Socket, Host-Backups und Secret-Mounts muss über die Betriebsumgebung begrenzt werden.

## 9. Transportverschlüsselung und Zertifikate

### 9.1 Übersicht der Verbindungen

| Verbindung | Tatsächlicher Mechanismus | Betriebsanforderung/Grenze |
|---|---|---|
| Web/Desktop/Extension/CLI → öffentlicher Endpunkt | HTTP oder HTTPS je konfigurierter URL | Für Produktion HTTPS mit vertrauenswürdigem Serverzertifikat erzwingen |
| Reverse Proxy → TeamVault | Server startet mit `ListenAndServe()` ohne eigenes TLS | Nur geschützt lokal/intern führen oder durch gesicherten Tunnel/Sidecar abdecken; nicht automatisch verschlüsselt |
| TeamVault → LDAP | LDAPS bei `UseTLS=true`, sonst LDAP ohne StartTLS-Upgrade | Zertifikatsprüfung aktiv lassen; LDAP-Klartextpfad nicht freigeben |
| TeamVault → SMTP | SMTP mit STARTTLS, wenn angeboten; Konfigurationsdetails siehe unten | STARTTLS-/Relay-Konfiguration tatsächlich prüfen; Checkbox allein ist kein garantierter TLS-Zwang |
| Client → FIDO2-Authenticator | WebAuthn/Browser- und Authenticator-Schnittstelle | Kein HTTPS-Zertifikat als Ersatz für PRF, Benutzerpräsenz oder Verifikation |

Der ausgelieferte Go-Server betreibt **keine eigene HTTPS-Zertifikatsverwaltung**, keine ACME-Ausstellung und keinen direkt konfigurierten mTLS-Listener. TLS-Terminierung, private Serverzertifikatschlüssel und deren Erneuerung liegen beim Reverse Proxy beziehungsweise der vorgeschalteten Infrastruktur.

### 9.2 Öffentlicher HTTPS-Endpunkt

Für den produktiven Zugriff:

1. DNS-Name und Serverzertifikat mit passendem Subject Alternative Name verwenden.
2. Zertifikatskette bis zu einer vom Client vertrauten CA bereitstellen; Ablauf und Erneuerung überwachen.
3. Am Proxy mindestens TLS 1.2, vorzugsweise TLS 1.3, mit einer aktuellen sicheren Konfiguration zulassen. Dies ist eine Proxy-Vorgabe, kein vom HTTP-Backend erzwungener Wert.
4. Den HTTP-Backend-Port nicht direkt öffentlich erreichbar machen. Die Compose-Portfreigabe allein ist keine Einschränkung auf den Reverse Proxy.
5. Öffentliche URL, Pfadpräfix und Forwarded-Header konsistent konfigurieren.

`TrustForwarded` beziehungsweise `TEAMVAULT_TRUST_FORWARDED` darf nur aktiviert werden, wenn ein vertrauenswürdiger Proxy die betreffenden Header kontrolliert und direkten Clientzugriff auf das Backend verhindert. Die Einstellung schafft nicht automatisch eine vertrauenswürdige Netzwerkgrenze.

Die Anwendung setzt bei als HTTPS erkannten Requests HSTS mit `max-age=31536000; includeSubDomains`. Der Betreiber muss die Auswirkung von `includeSubDomains` auf andere Dienste der betreffenden Domain berücksichtigen.

### 9.3 Firmen-CA ist kein Serverzertifikat

Die in der Administration hinterlegte PEM-CA wird dem System-Truststore für **ausgehende LDAP-/SMTP-TLS-Verbindungen des Servers** hinzugefügt. Die TLS-Hilfsfunktion setzt mindestens TLS 1.2 und den erwarteten Servernamen.

Dieses Bundle:

- ist ein Satz öffentlicher Vertrauenszertifikate, kein Vault-DK und kein privater CA-Schlüssel;
- stellt kein HTTPS-Serverzertifikat für TeamVault aus;
- installiert kein Vertrauen auf Benutzer-PCs, Browsern oder Desktop-Clients;
- ersetzt keine separate Unternehmens-PKI-Verteilung an die Endgeräte.

Browser/Extension verwenden die Zertifikatsprüfung ihres Browsers; die Go-Clients den Go-/System-TLS-Trust der jeweiligen Umgebung. Ein allgemeines TeamVault-spezifisches Zertifikat-Pinning ist nicht implementiert.

Für LDAPS existiert die Option `InsecureSkipVerify`. Sie deaktiviert die reguläre Hostnamen-/Zertifikatskettenprüfung und ist **keine geeignete Produktionslösung**. Eine fehlende Firmen-CA muss durch korrekte Vertrauensverteilung behoben werden.

### 9.4 SMTP: wichtige Einschränkung

Der Versand kann bei konfiguriertem TLS oder CA-Bundle STARTTLS verwenden und dann die Serverzertifikate prüfen. Die Versandfunktion verlangt aber nicht in jedem Fall, dass der Server STARTTLS anbietet: Ein fehlendes STARTTLS-Angebot beendet den Ablauf nicht grundsätzlich. Der sonstige `smtp.SendMail`-Pfad ist ebenfalls kein allgemeiner TLS-Zwang.

`PLAIN`-Authentifizierung und das Verhalten der SMTP-Bibliothek dürfen nicht mit einer garantiert verschlüsselten Nachrichtenübertragung verwechselt werden. Der SMTP-Testendpunkt bestätigt im Wesentlichen TCP-Erreichbarkeit; ein positives Testergebnis ist kein vollständiger Nachweis für erfolgreiches TLS und Authentifizierung.

**Betriebsanforderung:** SMTP nur über kontrollierte Relays verwenden, die Verschlüsselung nachweislich erzwingen; anderenfalls Versand deaktivieren oder die Transportanforderung vor Produktivfreigabe technisch ergänzen. Keine Vault-Passwörter, Recovery-Kits oder Master-Passwörter in E-Mail-Vorlagen aufnehmen.

### 9.5 Unterschiedliche Bedeutungen von „Zertifikat“

- **HTTPS-Zertifikat:** Authentifiziert den öffentlichen TLS-Endpunkt.
- **Firmen-CA-Bundle:** Öffentlicher Vertrauensanker für ausgehende Serververbindungen.
- **Release-Cosign-Zertifikat:** Belegt im Signaturprüfprozess die Build-/Workflow-Identität; siehe Abschnitt 15.
- **Im Vault gespeichertes Zertifikat/SSH-Key-Feld:** Secret-Inhalt und damit clientseitig verschlüsselter Payload; nicht automatisch eine aktive TLS- oder mTLS-Konfiguration.
- **FIDO2-Credential:** Authenticator-Schlüsselmaterial und Credential-Metadaten; die Offline-Funktion verlangt keine Hersteller-Attestation und liefert keine Herstellerzertifizierung eines Keys.

## 10. WebUI und Browser-Schutzmaßnahmen

### 10.1 HTTP-Header und CSRF

Der API-Wrapper setzt:

- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `X-Frame-Options: DENY` und CSP `frame-ancestors 'none'`;
- CSP mit `default-src 'self'`, Skripten von `'self'`, `wasm-unsafe-eval` für die Krypto-Laufzeit, `connect-src 'self'`, `worker-src 'self'`, `manifest-src 'self'`, `base-uri 'self'`, `form-action 'self'`;
- `style-src 'self' 'unsafe-inline'` und Bilder von `'self'` beziehungsweise `data:`.

Diese CSP begrenzt externe Ressourcen und Einbettung, beseitigt aber nicht jedes XSS-Risiko. `unsafe-inline` gilt hier für Styles; `wasm-unsafe-eval` ist für WebAssembly vorgesehen.

Mutierende `/api/`-Requests werden über `Origin` beziehungsweise ersatzweise `Referer` geprüft. Der Vergleich verwendet den Host einschließlich Port der konfigurierten öffentlichen URL oder des Requests; es ist keine allgemeine Aussage über einen exakten Schema-/Host-/Port-Originvergleich. `X-Forwarded-Host` wird für diesen CSRF-Vergleich nicht blind vertraut. Bearer-Authentifizierung wird separat behandelt und ist von dieser Cookie-CSRF-Prüfung ausgenommen.

### 10.2 Auslieferung, Integrität und Caches

Die Web-Assets werden vom eigenen Server ausgeliefert; Krypto-Bibliotheken sind mitgeliefert, nicht zur Laufzeit von einem CDN geladen. Für ausgewählte Skripte erzeugt der Server SHA-384-Subresource-Integrity-Attribute. Da derselbe Server HTML und SRI-Werte ausliefert, verhindert SRI **keine böswillige gemeinsame Änderung beider Dateien**.

Web-Antworten erhalten `no-store`-/`no-cache`-Header. Der Service Worker besitzt trotzdem einen eigenen versionierten Cache für die bewusst offline bereitgestellte **App-Shell**. `/api/` und `/downloads/` werden nicht durch ihn gecacht. Das ist von der verschlüsselten Vault-Ablage in IndexedDB zu trennen.

### 10.3 RAM, Sperren und Zwischenablage

Nach dem Unlock liegt der Benutzer-SK im Client-RAM. Der Web-Idle-Timer sperrt standardmäßig nach 15 Minuten Inaktivität; die Server-Policy kann den Wert vorgeben. Beim Sperren werden Schlüsselarrays soweit vorgesehen überschrieben, Referenzen verworfen und Software-Key-/Hardware-Root-Zustände entfernt. Die nächste Offline-Entsperrung benötigt erneut die Profilfaktoren.

Dies ist **Best-Effort-Speicherhygiene**, keine garantierte Löschung sämtlicher Kopien in JavaScript-/Go-Strings, Runtime, DOM, WebView, Swap oder Crash-Dumps. Ein bereits kompromittierter Client kann auf geladene Werte zugreifen.

Kopieren eines Secrets legt Klartext in die Betriebssystem-Zwischenablage. Eine verbindliche automatische Löschung der Zwischenablage oder ihrer Historie ist nicht implementiert; optisches Feedback „Kopiert“ ist kein Clipboard-Wipe. Zwischenablage-Synchronisation, Bildschirmaufnahmen und Crash-Dumps sind organisatorisch beziehungsweise über Endgeräte-Policies zu behandeln.

## 11. Offline-Vault und lokale Speicherung

### 11.1 Zweck und unterstützte Profile

Der Offline-Vault ist ein lokal geschützter, **nur lesbarer Snapshot**, kein zweiter Login-Server und keine Schreibwarteschlange. Einrichtung und Synchronisierung erfordern Online-Zugriff sowie ausdrückliches Geräte-Opt-in.

| Profil | Erforderlich zum Offline-Lesen | Web/PWA | Desktop |
|---|---|---|---|
| STANDARD | Master-Passwort + unabhängiger Software-Key | Implementiert | Implementiert |
| HARDWARE | Master-Passwort + registrierter FIDO2-Key mit PRF | Implementiert | Nicht implementiert |
| COMBINED | Master-Passwort + Software-Key + registrierter FIDO2-Key mit PRF | Implementiert | Nicht implementiert |

Browser-Extension und CLI besitzen in diesem Stand keinen entsprechenden persistenten Offline-Vault. TPM, Windows-Hello-basierte Offline-Keyslots und zusätzliches Offline-TOTP sind nicht implementiert.

### 11.2 Was der Snapshot enthält

Die innere Snapshot-Struktur enthält accountbezogene versiegelte Vault-Schlüssel, KDF-Parameter, Secret-Ciphertexte und die eigenen Envelopes zugänglicher Einträge. **Zusätzlich** wird die vollständige Struktur unter einem zufälligen Snapshot-DEK mit AES-256-GCM verschlüsselt.

Die äußere Hülle enthält lesbare Metadaten wie Tenant-/Benutzeridentität, Origin, Profil, Faktoren, Erstell-/Ablaufzeit, Secret-Anzahl und je nach Format Keyslot-Informationen. Sie enthält keine Klartext-Secret-Payloads. Login-Passwort, Login-TOTP-Seed und Sitzungscookie werden nicht als Teil dieses Vault-Snapshots gespeichert; separat bestehende Browser-/Client-Sitzungen bleiben davon unberührt.

Nach dem Öffnen der äußeren Hülle ist weiterhin das Master-Passwort nötig, um den enthaltenen Benutzer-SK zu öffnen. Die Extra-Faktoren ersetzen diesen Schutz nicht.

### 11.3 STANDARD im Detail

1. Client erzeugt beziehungsweise lädt einen unabhängigen 256-Bit-Software-Key.
2. Für den Snapshot werden ein zufälliger 256-Bit-DEK, ein 32-Byte-HKDF-Salt und getrennte 12-Byte-GCM-Nonces erzeugt.
3. HKDF-SHA-256 leitet aus Software-Key, Salt und account-/origin-/keyslotbezogenem Kontext einen 256-Bit-Key-Encryption-Key (**KEK**) ab.
4. Der KEK verschlüsselt den Snapshot-DEK; der DEK verschlüsselt den Snapshot.
5. Beide GCM-Operationen authentifizieren den vorgesehenen Metadatenkontext.
6. Beim Offline-Öffnen wird zuerst der DEK mit dem Software-Key freigegeben, dann der Snapshot geöffnet und anschließend der Benutzer-SK mit dem Master-Passwort entsperrt.

Der Software-Key wird als `teamvault-offline-key.json` oder Base64-Wert bereitgestellt. **Die Key-Datei ist selbst nicht passwortverschlüsselt.** Wer diese Datei besitzt, besitzt den Faktor. Die Anwendung speichert ihn nicht automatisch in IndexedDB, Desktop-Einstellungen oder zusammen mit der Cache-Datei; ein Benutzer kann ihn durch die Wahl seines Downloadorts dennoch auf demselben Gerät ablegen.

### 11.4 HARDWARE und COMBINED im Detail

Die Web-Funktion verwendet WebAuthn-PRF mit einem externen `cross-platform`-Authenticator:

- Secure Context, gleicher Origin und DNS-Hostname beziehungsweise `localhost` sind erforderlich; reine IP-Adressen werden im Offline-FIDO2-Pfad abgelehnt.
- Registrierung bietet ES256, RS256 und EdDSA als WebAuthn-Credential-Algorithmen an; dies ist von der symmetrischen Snapshot-Verschlüsselung zu unterscheiden.
- `userVerification: required`, Benutzerpräsenz und Benutzerverifikation werden verlangt. PIN/Biometrie verarbeitet der Authenticator beziehungsweise Browser, nicht TeamVault als gespeichertes Passwort.
- Ein fehlendes oder nicht 32 Byte langes PRF-Ergebnis wird abgewiesen.
- Als synchronisierbar markierte Credentials werden abgelehnt.
- `attestation: none`: Es wird **kein Hersteller-/Hardware-Echtheitsnachweis** eingeholt. Virtuelle Authenticatoren sind deshalb kein Beweis für physische Gerätebindung.

Jeder Keyslot besitzt unter anderem Credential-ID, Label, PRF-Salt, Wrap-Salt und Wrap-Nonce. Ein zufälliger 256-Bit-Root-Key wird pro Slot verschlüsselt:

```text
HARDWARE:
  FIDO2-PRF (32 Byte) -> HKDF-SHA-256 -> Slot-Key -> Root-Key

COMBINED:
  FIDO2-PRF (32 Byte) || Software-Key (32 Byte)
      -> HKDF-SHA-256 -> Slot-Key -> Root-Key

Beide:
  Root-Key -> Snapshot-DEK -> verschlüsselter Snapshot
  Master-Passwort -> Benutzer-SK -> DK-Envelopes -> Secret-Inhalte
```

COMBINED verlangt also kryptografisch beide Extra-Faktoren; es sind nicht zwei alternative Hüllen, von denen eine genügt. Mehrere registrierte FIDO2-Keys sind dagegen **Alternativen innerhalb des Hardware-Faktors**, kein Mehr-Key-Quorum. Maximal 32 Slots sind vorgesehen.

Die Offline-Credentials und ihre PRF-Verwendung sind lokal; dafür ist keine laufende Server-WebAuthn-Challenge notwendig. Der Code vertraut der Browser-/Authenticator-Schnittstelle und der erfolgreichen AEAD-Entschlüsselung, nicht einem separaten serverseitigen Hardwarezertifikat.

Beim Entfernen eines Keys werden Root-Key und Keyset-ID erneuert. Alle verbleibenden Keys müssen bestätigt und ihre neuen Slots erzeugt werden, bevor der aktualisierte Snapshot gespeichert wird. Der letzte verbleibende Hardware-Key kann nicht über die Slot-Entfernung gelöscht werden. Das Entfernen eines Cache-Slots ist kein garantierter Löschbefehl für das Credential auf dem physischen Key.

### 11.5 Integrität, Scope und konkurrierende Änderungen

Die Formate prüfen und authentifizieren ihren Kontext, unter anderem Identität, Origin, Profil, erforderliche Faktoren, Policy-Version, Schlüsselableitung und Nonces. Neue Kopien binden zusätzlich die effektive Server-Schlüsselanforderung; aktuelle Hardware-Snapshots authentifizieren die vollständige Slot-Liste.

Web-Speicherupdates verwenden eine IndexedDB-Transaktion mit Revisionsvergleich. Eine veraltete konkurrierende Änderung soll keine neuere Keyrotation oder Snapshotänderung überschreiben. Diese Revisionsprüfung verhindert **keinen vollständigen Dateisystem-/Browserprofil-Rollback durch einen Angreifer**.

Alte master-only-Caches gelten nicht als ausreichend geschützte Offline-Kopien. Bereits zusätzlich geschützte ältere Formate können kompatibel lesbar bleiben und beim nächsten Sync aktualisiert werden. Daher haben nicht alle jemals erzeugten Caches automatisch dieselben neuen Policy-Metadaten.

### 11.6 Speicherorte und Lebensdauer

- **Web/PWA:** IndexedDB-Datenbank `teamvault-offline`, Object Store `snapshots`, getrennt nach Tenant-/User-ID. `localStorage` hält unter anderem das Geräte-Opt-in `tv-offline-optin`, keine automatisch persistierten Entschlüsselungsschlüssel.
- **Desktop:** Datei `offline-<tenant>-<username>.json` im Konfigurationsverzeichnis `teamvault-desktop`; Unix-Erstellung mit `0600`. Unter Linux üblicherweise `$XDG_CONFIG_HOME/teamvault-desktop` beziehungsweise `~/.config/teamvault-desktop`, unter Windows im benutzerbezogenen Config-Verzeichnis (`%APPDATA%`).
- **Lebensdauer:** fest 30 Tage seit Erstellung/Synchronisierung. Die vorliegende Implementierung bietet keine frei konfigurierbare Maximal-TTL.
- **Aktualisierung:** expliziter Online-Sync, keine Annahme eines dauerhaft aktuellen Hintergrundspiegels.
- **Logout/Sperren:** entfernt nicht automatisch die gespeicherte verschlüsselte Offline-Kopie. Ein expliziter Löschvorgang ist separat vorhanden.

Löschen ist kein nachgewiesenes physisches Secure-Erase auf SSD, Browserprofil-Backup oder Dateisystem-Snapshot.

### 11.7 Plattform-/Tenant-Policy

Die wirksame Anforderung kombiniert die von Plattform und Tenant verlangten Faktoren; keine Ebene kann einen von der anderen verlangten Faktor entfernen.

| Effektive Anforderung | Zulässige Profile |
|---|---|
| ANY | STANDARD, HARDWARE, COMBINED |
| SOFTWARE | STANDARD, COMBINED |
| HARDWARE | HARDWARE, COMBINED |
| COMBINED | COMBINED |

Beispiel: Plattform SOFTWARE plus Tenant HARDWARE ergibt COMBINED. Das Master-Passwort bleibt in allen Profilen erforderlich. Ohne abweichende Vorgaben ist Offline-Cache erlaubt und die Schlüsselanforderung ANY.

Aktuelle Clients laden die Policy vor dem Erstellen und nochmals unmittelbar vor dem Speichern. Fehlende/unbekannte Vorgaben oder ein zwischenzeitlicher relevanter Policywechsel brechen den Sync ab, statt still einen schwächeren Cache zu speichern. Desktop kann bei HARDWARE/COMBINED keinen neuen Offline-Cache anlegen.

### 11.8 Was Offline-Schutz nicht leisten kann

1. **Kein garantierter Fernwiderruf:** Disable, Rechteentzug oder eine neue Policy können vorhandene fremde Cachekopien nicht zuverlässig löschen.
2. **Keine manipulationssichere Uhr:** Die 30 Tage werden durch Client und lokale Zeit geprüft. Manipulierte Clients oder vollständige Rollbacks sind dadurch nicht zuverlässig gesperrt.
3. **Keine Server-Signatur als Offline-Lease:** Die gebundenen Policy-Metadaten sind Client-AEAD-Kontext, keine universell erzwingbare signierte Gerätefreigabe.
4. **Keine Unabhängigkeit bei gemeinsamer Aufbewahrung:** Software-Key-Datei und Cache auf demselben kompromittierten Datenträger können gemeinsam gestohlen werden. Das Master-Passwort bleibt dann die verbleibende Inhaltsbarriere.
5. **Keine laufende Login-2FA:** Offline entfallen LDAP-, Passwort-Login- und Server-TOTP-Prüfung. Es gelten die lokalen kryptografischen Faktoren.
6. **Kein Schutz vor aktiv kompromittiertem Client:** Ein geladenes PRF-Ergebnis, ein Software-Key oder Klartext kann während der Nutzung abgegriffen werden.

## 12. Besonderheiten der Clients

### 12.1 Web/PWA

Benötigt vertrauenswürdig ausgelieferte Assets und für PWA/FIDO2 einen sicheren Browser-Kontext. Der Service Worker hält den Programmcode offline bereit, nicht eine authentifizierte Serververbindung. Browserprofil-Backups können verschlüsselte Snapshots, lesbare Metadaten und gespeicherte Sitzungen enthalten.

### 12.2 Desktop

Der Wails-Client führt Netzwerkzugriffe und Vault-Kryptografie im Go-Backend aus. Entschlüsselte Secret-Felder werden für die Anzeige an die lokale WebView übertragen; die UI ist deshalb ebenfalls Teil der vertraulichen Laufzeit.

- Kein automatisches Speichern von Master-/Login-Passwort oder Benutzer-SK in den normalen Einstellungen.
- STANDARD-Offline-Cache mit Software-Key; keine native FIDO2-/TPM-/Windows-Hello-Offline-Implementierung.
- `remembered-login.json` speichert bei „Angemeldet bleiben“ eine **unverschlüsselte Session-ID** im benutzerbezogenen Config-Verzeichnis, mit `0600` auf Unix. Dies ist keine OS-Keychain-/DPAPI-Versiegelung.
- `settings.json` enthält Server-/Tenant-/Benutzer- und UI-Einstellungen, keine Vault-Schlüssel.
- Manuelles Sperren sowie Tray-Sperren sind vorhanden. Ein eigener lokaler Inaktivitätstimer wie in der WebUI ist im betrachteten Desktop-Code nicht implementiert; die Server-Session-Idle-Prüfung ersetzt ihn für bereits entschlüsselte lokale Daten nicht.
- Unter Windows ist optional `SetWindowDisplayAffinity` für Capture-Ausschluss beziehungsweise einen Fallback vorhanden. Unter Linux wird damit kein entsprechender Schutz hergestellt. Dies ist kein Schutz vor Kameras, privilegierter Malware oder sämtlichen Capture-Verfahren.
- Fenster schließen kann in den Tray minimieren und beendet den Prozess daher nicht zwangsläufig.

### 12.3 Browser-Extension

Die Krypto läuft im Popup; der Hintergrund-Service-Worker hält keine Vault-Schlüssel. Der Benutzer-SK und entschlüsselte Cache liegen im Popup-RAM; Lock/Logout verwerfen sie, Popup-Schließen beendet den kurzlebigen Kontext. Persistent sind insbesondere Verbindungs-/UI-Einstellungen sowie separat vom Browser verwaltete Anmeldecookies möglich.

Autofill und freigaberelevante Kopieraktionen prüfen den exakten Ziel-Origin einschließlich Schema, Host und Port. Vor dem Ausfüllen wird die Navigation nochmals im Popup und im Content-Script geprüft. Das schützt nicht vor einer kompromittierten Webseite am **richtigen** Origin: Ein ausgefülltes Passwort ist für diese Zielseite bestimmt.

Das Manifest fordert unter anderem `storage`, `clipboardWrite`, `activeTab` und `scripting`. Für nichtlokale TeamVault-Server wird eine passende optionale Hostberechtigung angefragt. Die Extension hat keinen persistenten Offline-Vault und übernimmt nicht automatisch den Web-IndexedDB-Cache.

Weitere Details: [Extension-Sicherheitsarchitektur](extension-store/security-architecture.md).

### 12.4 CLI

Die CLI verwendet dieselben Vault-Kryptoprimitive im Go-Client. Authentifizierung erfolgt über Login-Cookie oder API-Key. Die gewählte State-Datei speichert Cookies als **unverschlüsseltes JSON**, mit Dateimodus `0600` auf Unix. Bei API-Key-Nutzung wird dieser nicht über die Cookie-Datei gespeichert; der Betreiber muss dessen Bereitstellung trotzdem vor Shell-History, Umgebungslecks und Logs schützen.

Passwortabfragen verwenden einen verdeckten Terminal-Eingabepfad. Ausgaben geöffneter Secrets und rekonstruierter Escrow-Geheimnisse sind dennoch Klartext und dürfen nicht in Build-Logs, Terminalaufzeichnungen oder ungeschützte Dateien umgeleitet werden. Ein Offline-Snapshot-Sync der CLI ist nicht implementiert.

## 13. Exporte, Backups und Wiederherstellung

### 13.1 Vier unterschiedliche Sicherungsarten

| Art | Schutz und Inhalt | Wesentliche Grenze |
|---|---|---|
| Klartext-JSON/CSV/kompatibler Export | Client entschlüsselt Inhalte und schreibt sie lesbar in eine Datei | Enthält Passwörter/TOTP-Seeds; keine Verschlüsselung |
| Benutzer-Backup `.tvbak` | Exportinhalt lokal unter eigenem Backup-Passwort verschlüsselt | Nach Entschlüsselung Klartext-Export; unabhängig vom normalen Vault-/Offline-Schlüsselschutz |
| Admin-Instanz-Snapshot | Vault-Ciphertexte, Kontodatensätze, Metadaten, Gruppen, Freigaben und Login-Passkey-Daten | Kein zusätzlich passwortverschlüsselter Gesamtcontainer |
| Vollständiges Host-/Volume-Backup | Alle tatsächlich kopierten Daten-/Config-/Sitzungsdateien | Kann zusätzlich gültige Sitzungstoken und Betriebsgeheimnisse enthalten |

### 13.2 `.tvbak`

Der Client sammelt entschlüsselbare Secrets und verschlüsselt den resultierenden Export mit Argon2id und AES-256-GCM. Backup-Passwort: mindestens zwölf Zeichen; Salt, Nonce und KDF-Parameter werden im Format gespeichert. Der aktuelle Export verwendet die verfügbaren Vault-Parameter beziehungsweise Defaults.

Das Backup-Passwort sollte stark, unabhängig vom Master-Passwort und separat verwahrt sein. `.tvbak` besitzt keinen FIDO2-/Software-Key-Zwang aus dem Offline-Profil. Der Zugriff auf eine solche Datei hängt von ihrem **Backup-Passwort**, nicht nachträglich von aktuellen Tenant-Offlinerichtlinien ab.

Beim Import werden die Inhalte im Client geöffnet und als neue Secrets verschlüsselt angelegt; dies ist keine Wiederherstellung derselben serverseitigen IDs, Benutzerkonten und Freigabehistorie.

### 13.3 Admin-Snapshot und Disaster Recovery

`GET /api/admin/backup` steht dem Plattform-Admin zur Verfügung und exportiert einen backendneutralen Snapshot über den Vault-Store. Er enthält auch Login-Passwort-Hashes und geschützte Authentifizierungsdaten, nicht nur Secret-Ciphertexte.

Eine SHA-256-Prüfsumme der Records erkennt Beschädigung, ist aber keine kryptografische Herkunftssignatur. Restore verlangt die Bestätigung `RESTORE` und ersetzt den Vault-Store; dies ist eine destruktive administrative Operation.

**Nicht Bestandteil dieses Snapshot-Formats:** das Config-Bundle, Server-Unlock-Keyfile, `sessions.json`, TOTP-Counter-Datei und die vollständige Audit-Historie. Ein reiner Admin-Snapshot plus Unlock-Keyfile ist deshalb **kein vollständiges Backup der Instanzkonfiguration**.

Ein vollständiger Wiederanlauf benötigt je nach Verfahren:

1. konsistenten Vault-Store beziehungsweise Admin-Snapshot;
2. separat gesicherte `config/config.sealed` und passendes Server-Unlock-Keyfile;
3. passende Recovery-Kits/Escrow-Shares für die betroffenen Key-Versionen;
4. notwendige Proxy-/TLS-/PKI-Konfiguration und ein geprüftes Software-Release;
5. eine bewusste Entscheidung, wie Sitzungen und TOTP-Replay-Zustand nach Restore behandelt werden.

Für SQLite sind WAL-/Konsistenzanforderungen zu beachten. Ein laufendes Kopieren nur der Haupt-DB-Datei ist kein zugesicherter konsistenter Snapshot. Restore regelmäßig isoliert proben, Konten und Entschlüsselung mit synthetischen Testdaten prüfen und wiederhergestellte Sitzungen nicht ungeprüft weiterverwenden.

## 14. Audit, Protokollierung und Nachvollziehbarkeit

Der Server protokolliert ausgewählte administrative Vorgänge sowie Secret-Mutationen, beispielsweise Sharing und Rotation, mit Akteur, Tenant, Aktion, Ressourcentyp/-ID und Zeitstempel. Zugriff auf Auditdaten ist rollenbeschränkt.

Bei ausgewählten Vault-Mutationen werden Auditereignis und Datenänderung gemeinsam in einer Transaktion beziehungsweise entsprechender Store-Operation verarbeitet. Andere Pfade schreiben Audit nachgelagert oder behandeln Auditfehler anders. Eine pauschale Garantie „jede Änderung und jedes Lesen ist vollständig und atomar auditiert“ wäre falsch.

Insbesondere:

- Offline-Lesezugriffe werden nicht nachträglich vollständig als Server-Auditereignisse erfasst.
- Der normale Secret-GET-Pfad stellt keine lückenlose Anzeige-/Kopierprotokollierung bereit.
- Die Auditablage hat keine durchgängige kryptografische Hashkette, externe Signierung oder WORM-Garantie.
- Ein privilegierter Betreiber mit Zugriff auf Store/Backups liegt außerhalb einer unveränderlichen Audit-Vertrauensgrenze.

**Betriebsanforderung:** Logs/Audit getrennt schützen, externe Sammlung und Aufbewahrung nach Bedarf ergänzen. Reverse-Proxy-/APM-Logging darf keine Request-Bodies, Authorization-Header, Cookies, Passwörter, Kit-Inhalte oder entschlüsselten Secret-Felder aufzeichnen. Das bei Ersteinrichtung ausgegebene Setup-Token ist eine ausdrücklich zu berücksichtigende Ausnahme sensibler Startlogs.

## 15. Builds, Updates und Lieferkette

### 15.1 Vorhandene Maßnahmen

- Krypto-Bibliotheken werden mit dem Client ausgeliefert. Die CI prüft die Übereinstimmung der geteilten `cryptocore.js`-Kopien für Web/JS/Extension per SHA-256.
- Security-Workflows führen unter anderem Auth-/Krypto-/Autorisierungsregressionen, Offline-Tests, Desktop-Modultests, `govulncheck`, Secret-Pattern-Scans und weitere konfigurierte Scanner aus.
- Der Release-Workflow erzeugt SHA-256-Prüfsummen, detached Cosign-Signaturen mit Zertifikatdateien, SPDX-SBOM und GitHub-Build-Provenance für die Prüfsummendatei.
- Das reguläre Docker-Runtime-Image basiert auf Distroless und läuft als Nonroot. Das Unlock-Keyfile wird separat gemountet, nicht ins Image eingebaut.
- Selbst gehostete Chrome-CRX-Pakete werden mit einem separaten Extension-Signierschlüssel gepackt; offizielle Builds verlangen den erwarteten Schlüssel. Store-Pakete und deren Signierung durch den jeweiligen Browser-Store sind davon zu unterscheiden.

### 15.2 Keine automatische Vollgarantie

Ein grüner CI-Lauf ersetzt keine unabhängige Prüfung. Virtuelle WebAuthn-Tests belegen Funktionen der simulierten Schnittstelle, nicht die Qualität realer Hardware.

SHA-256-Prüfsummen müssen aus einer vertrauenswürdigen Quelle stammen. Cosign-Prüfungen müssen zusätzlich zulässige Workflow-Identität und OIDC-Issuer prüfen; nur das Vorhandensein einer `.pem`-/`.sig`-Datei reicht nicht. Anleitung: [Release verification](release-verification.md).

Nicht jeder lokale, selbst gebaute oder vom Server angebotene Download ist damit automatisch signiert oder geprüft. Der Desktop-Updatecheck vergleicht Versionsinformationen und ermittelt einen Download-Link; er stellt keine automatische kryptografische Freigabe des heruntergeladenen Programms dar. Eine allgemeine Windows-Authenticode-Signierung oder Signierung jedes Container-Images wird hier nicht zugesichert.

Nonroot und ein kleines Runtime-Image ersetzen keine Container-Sicherheitskonfiguration. Ein read-only-Dateisystem, Capability-Drop, `no-new-privileges`, Netzwerkgrenzen und zusätzliche Host-Härtung müssen entsprechend der gewählten Bereitstellung eingerichtet werden; sie sind nicht sämtlich bereits durch die Standard-Compose-Datei erzwungen.

## 16. Betriebsanforderungen und Freigabe-Checkliste

Diese Checkliste ist eine **Betriebsempfehlung**, kein bereits erteilter Freigabenachweis.

### Identität und Rechte

- [ ] Login- und Master-Passwort getrennt, ausreichend stark und ohne bekannte Wiederverwendung.
- [ ] Adminrollen minimal vergeben; Plattformverwaltung von alltäglichem Vault-Zugriff organisatorisch trennen.
- [ ] TOTP-Pflicht und Ausnahmen bewusst festlegen; gemerkte 90-Tage-Sitzungen beurteilen.
- [ ] API-Schlüssel inventarisieren, Scopes minimieren und Widerrufs-/Rotationsprozess festlegen.
- [ ] Automatische Gruppen-Nachschlüsselung und Grenzen der Fingerprintprüfung in der Risikoentscheidung berücksichtigen.

### Transport, Zertifikate und Host

- [ ] Öffentlicher Zugriff nur über vertrauenswürdiges HTTPS; Zertifikatskette, Hostname und Erneuerung geprüft.
- [ ] Backend-Port nicht direkt aus unkontrollierten Netzen erreichbar; Forwarded-Header nur vom festgelegten Proxy.
- [ ] Proxy→Backend-Strecke angemessen geschützt; kein unbeabsichtigter Klartext über fremde Netzsegmente.
- [ ] LDAPS und Zertifikatsprüfung aktiv; `InsecureSkipVerify` aus.
- [ ] SMTP-Verschlüsselung und Relay-Zwang unabhängig vom „TCP erreichbar“-Test nachgewiesen.
- [ ] Server-Unlock-Key separat und hochentropisch; Host-, Container-, Volume- und Backupzugriffe begrenzt.
- [ ] Zeitabgleich, OS-Patches, EDR, Datenträgerverschlüsselung und Schutz vor unkontrollierten Crash-Dumps vorhanden.

### Endgeräte und Offline

- [ ] Offline-Zulässigkeit und Mindestfaktoren pro Plattform/Tenant freigegeben; Default „erlaubt/ANY“ bewusst beurteilt.
- [ ] Kein Offline-Opt-in auf gemeinsam genutzten/unverwalteten Endgeräten.
- [ ] Software-Key-Datei unabhängig vom Cache geschützt; Downloadverzeichnis und Cloud-Synchronisation berücksichtigt.
- [ ] Für Hardwareprofile reale Browser-/Key-Kombination einschließlich PRF, PIN/Verifikation und Backup-Key geprüft.
- [ ] Fehlende Hardware-Attestation und fehlende native Desktop-FIDO2-/TPM-Unterstützung akzeptiert oder vor Rollout adressiert.
- [ ] Offline-Widerruf, lokale Uhr/TTL, Clipboard-Historie und fehlender Desktop-Idle-Timer bewertet.

### Sicherung und Lieferkette

- [ ] Release-Herkunft/Signaturen geprüft, Artefakte inventarisiert und Updates geplant.
- [ ] Wiederherstellung von Vault **und** Config samt separat verwahrtem Unlock-Key geprobt.
- [ ] Recovery-Kits/Escrow-Shares getrennt, vollständig und auf alte Backup-Key-Versionen abgestimmt.
- [ ] Kein ungeschützter Klartext-Export als reguläres Backup.
- [ ] Audit-/Log-Aufbewahrung, externe Integritätssicherung und Behandlung von Sitzungsdateien beim Restore festgelegt.

## 17. Vorgehen bei Verlust oder Kompromittierung

| Ereignis | Erforderliche Bewertung und Maßnahmen |
|---|---|
| Endgerät/Offline-Cache verloren | Sitzungen/API-Tokens widerrufen; mögliche gleichzeitige Software-Key-Exposition prüfen; betroffene Secrets und Zielsystem-Passwörter risikobasiert rotieren. Kein garantierter Remote-Wipe |
| FIDO2-Key verloren | Mit verbleibendem Key den Slot entfernen und die Root-Rotation abschließen; alte Cachekopien als weiter potenziell zugänglich betrachten |
| Software-Key offengelegt | Neue Offline-Kopie mit neuem Software-Key erstellen; alte Cachekopien bleiben mit altem Key und Master-Passwort entschlüsselbar |
| Master-Passwort offengelegt | Neu versiegeln reicht bei bereits entwendetem SK nicht aus. Benutzeridentität, Envelopes und betroffene Zielsystem-Zugänge in die Incident-Behandlung einbeziehen |
| Recovery-Kit/Escrow-Shares offengelegt | Als mögliche SK-Kompromittierung behandeln; nicht nur Login-Passwort wechseln. Alte Backups und Escrow-Hüllen berücksichtigen |
| Server-Unlock-Key/Host kompromittiert | LDAP-/SMTP-Zugangsdaten, Login-TOTP-Seeds, Sitzungen und API-Schlüssel als potenziell betroffen behandeln; Config-Re-Key/Neuaufbau kontrolliert planen |
| Datenbankkopie entwendet | Metadaten/Hashes und mögliche Offline-Angriffe auf versiegelte Benutzerschlüssel bewerten; bei TOTP-Legacy-Daten zusätzliche Offenlegung berücksichtigen |
| Web-Auslieferung/Release manipuliert | Alle während des betroffenen Zeitraums entsperrten Vaults und eingegebenen Faktoren als potenziell kompromittiert bewerten; vertrauenswürdigen Client wiederherstellen und Incident-Prozess auslösen |

Ein neuer Ciphertext macht bereits entwendeten Klartext nicht wieder geheim. Incident-Reaktion muss bei Bedarf die **eigentlichen Zugangsdaten der Zielsysteme** ändern, nicht ausschließlich die TeamVault-Verschlüsselung.

## 18. Implementierungsnachweise

Die folgenden Pfade sind die maßgeblichen Einstiegspunkte zur technischen Nachprüfung. Symbolnamen sind angegeben, damit Verweise auch bei verschobenen Zeilennummern nutzbar bleiben.

| Thema | Quellcode / zentrale Symbole |
|---|---|
| Client-Vault-Krypto | [`web/static/cryptocore.js`](../web/static/cryptocore.js): `createIdentity`, `unlockPrivateKey`, `encryptPayload`, `sealDataKeyForRecipient`; [`internal/cryptocore/cryptocore.go`](../internal/cryptocore/cryptocore.go) |
| Login-Hash und Regeln | [`internal/auth/password/password.go`](../internal/auth/password/password.go): `Hash`, `Verify`; [`policy.go`](../internal/auth/password/policy.go): `ValidateLocal` |
| Master-Passwort, Web-Unlock, Fingerprints, Gruppen-Catch-up | [`web/static/app.js`](../web/static/app.js): `masterPasswordError`, `clearVaultKey`, `touchIdle`, `confirmRecipientKey`, `sealGroupShareGaps`, `afterUnlock`, `recoverVaultWithKit` |
| Login, TOTP, API-Key-Prüfung | [`internal/server/server.go`](../internal/server/server.go): `handleLogin`, `validateTOTP`, `writeLoginSuccess`, `apiKeyScopesOK`, `sessionFromAPIKey`; [`login_pending.go`](../internal/server/login_pending.go) |
| Sitzungen | [`internal/auth/session/session.go`](../internal/auth/session/session.go): `CreateWithTTLState`, `Get`, `persist`; [`internal/server/hardening.go`](../internal/server/hardening.go): `setSessionCookie` |
| TOTP-Verfahren und Legacy | [`internal/auth/totp/totp.go`](../internal/auth/totp/totp.go): `GenerateSecret`, `ValidateCounter`, `SealWith`, `OpenWith` |
| Login-WebAuthn | [`internal/auth/passkey/passkey.go`](../internal/auth/passkey/passkey.go); [`internal/server/phase7.go`](../internal/server/phase7.go): `rpFromRequest`, Login-/Registrierungs-Handler |
| Config und Unlock-Key | [`internal/configstore/configstore.go`](../internal/configstore/configstore.go): `deriveKey`, `Save`, `SealBlob`; [`internal/unlock/unlock.go`](../internal/unlock/unlock.go); [`internal/bootstrap/bootstrap.go`](../internal/bootstrap/bootstrap.go) |
| Setup-Token | [`internal/bootstrap/setup_token.go`](../internal/bootstrap/setup_token.go): `EnsureSetupToken`, `SetupTokenValid` |
| Policies/API-Key-Erzeugung | [`internal/instcfg/instcfg.go`](../internal/instcfg/instcfg.go): `Policy`, `NewAPIKey`; [`internal/server/phase6.go`](../internal/server/phase6.go): `handleCreateAPIKey`; [`internal/server/mvp_gaps.go`](../internal/server/mvp_gaps.go): `handleClientPolicy` |
| Store, Metadaten, Capabilities | [`internal/store/store.go`](../internal/store/store.go); [`internal/store/sqlite/sqlite.go`](../internal/store/sqlite/sqlite.go); [`internal/store/jsonfile/jsonfile.go`](../internal/store/jsonfile/jsonfile.go) |
| Teilen/Rotation und Audit-Transaktionen | [`internal/server/phase5.go`](../internal/server/phase5.go): `callerEffectiveCapability`, `handleShareSecret`, `handleRotateSecret`; [`phase12.go`](../internal/server/phase12.go); [`internal/store/sqlite/audit_mutate.go`](../internal/store/sqlite/audit_mutate.go) |
| Escrow und Shares | [`internal/server/escrow_replace.go`](../internal/server/escrow_replace.go); [`internal/shamir/shamir.go`](../internal/shamir/shamir.go); [`cmd/tvcli/main.go`](../cmd/tvcli/main.go): `escrowSplit`, `escrowCombine`; Web: `showEscrowShares` |
| TLS/CA, LDAP und SMTP | [`internal/tlsutil/tlsutil.go`](../internal/tlsutil/tlsutil.go): `ClientConfig`; [`internal/auth/ldapauth/ldapauth.go`](../internal/auth/ldapauth/ldapauth.go): `dial`; [`internal/mailer/mailer.go`](../internal/mailer/mailer.go): `Send`, `sendSTARTTLS`; [`phase6.go`](../internal/server/phase6.go): `handleTestMail` |
| HTTP-Listener und Header | [`cmd/teamvault/main.go`](../cmd/teamvault/main.go); [`internal/server/hardening.go`](../internal/server/hardening.go): `withSecurity`, `originOK`, `sameHost` |
| Web-Auslieferung/SRI/SW | [`web/embed.go`](../web/embed.go): `setNoCacheHeaders`, `buildScriptSRI`; [`web/static/sw.js`](../web/static/sw.js) |
| STANDARD-Offline | [`web/static/offline-store.js`](../web/static/offline-store.js): `sealSnapshot`, `offlineCacheAAD`, `putSnapshot`; [`clients/desktop/backend/offline_crypto.go`](../clients/desktop/backend/offline_crypto.go) |
| Hardware-Offline | [`web/static/offline-hardware.js`](../web/static/offline-hardware.js): `slotKey`, `checkAuthenticatorData`, `registerKey`, `rotateKeyset`, `snapshotAAD` |
| Offline-Policy-Kombination | [`internal/offlinepolicy/policy.go`](../internal/offlinepolicy/policy.go): `Combine`, `Allows`; Desktop: [`vaultops.go`](../clients/desktop/backend/vaultops.go): `checkOfflinePolicy`, `SyncOfflineSnapshot` |
| Desktop-Persistenz/Lock/Privacy | [`clients/desktop/app.go`](../clients/desktop/app.go); [`backend/offline.go`](../clients/desktop/backend/offline.go); [`backend/remembered_login.go`](../clients/desktop/backend/remembered_login.go); [`backend/privacy_windows.go`](../clients/desktop/backend/privacy_windows.go); [`frontend/app.js`](../clients/desktop/frontend/app.js) |
| Extension-Origin-Prüfung | [`clients/extension/popup.js`](../clients/extension/popup.js); [`content.js`](../clients/extension/content.js); [`lib/tv-url-match.js`](../clients/extension/lib/tv-url-match.js); [`manifest.json`](../clients/extension/manifest.json) |
| Export/Backup | [`web/static/vault-io.js`](../web/static/vault-io.js): `wrapBackup`, `unwrapBackup`; [`internal/server/backup.go`](../internal/server/backup.go); [`internal/store/snapshot.go`](../internal/store/snapshot.go) |
| Audit | [`internal/server/audit.go`](../internal/server/audit.go); ausgewählte Handler in `phase5.go`, `phase6.go`, `phase7.go` und `server.go` |
| Build und Release | [`Dockerfile`](../Dockerfile); [`docker-compose.yml`](../docker-compose.yml); [Security-Workflow](../.github/workflows/security.yml); [Release-Workflow](../.github/workflows/release.yml); [Extension-Packer](../cmd/pack-extension/main.go) |

Weiterführend: [Admin Guide](admin-guide.md), [Installationsanleitung](install-guide.md), [User Guide](user-guide.md), [Desktop Guide](desktop-guide.md), [Offline-Implementierung](planning/offline-vault.md), [Release-Verifikation](release-verification.md).
