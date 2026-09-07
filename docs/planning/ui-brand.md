# TeamVault – UI Brand Tokens

**Status:** Aktuell (Grid-Shell: farblich abgesetzte Sidebar + Main mit Topbar/Content/kompaktem Footer, 2026-09-07)  
**Design-Richtung:** Flache App-Shell mit linker Navigation; moderne, ruhige Farbflächen; Blau bleibt Standard, weitere feste Farbdesigns sind auswählbar. Footer nur in der Main-Spalte und maximal so hoch wie der Abmelden-Button.

---

## 1. Markenfarben

| Token | Light | Dark | Verwendung |
|-------|-------|------|------------|
| `--color-accent` | `#1F66D1` | `#6B9BD2` | Primäre CTAs, aktive Nav, Fokus |
| `--color-accent-dark` | `#174EA6` | `#4B7FC0` | Verlauf/kräftigere Akzentflächen |
| `--color-secondary` | `#5B6572` | `#9AA4B2` | Sekundärtext / dezente Akzente |
| `--color-primary` | `#A70240` | `#C43B66` | Destruktiv (Löschen, Revoke) |
| `--color-sidebar-bg` | `#123D8E` | `#0F2A5F` | Sidebar-Fläche |
| `--color-sidebar-bg-strong` | `#0B2D6B` | `#0A1F49` | Sidebar-Verlauf unten |
| `--color-sidebar-text` | `#F7FAFF` | `#F7FAFF` | Sidebar-Text |
| `--color-sidebar-muted` | `#BFD2F2` | `#B7C8E8` | Sidebar-Gruppen/Icons |

Topbar/Header nutzen eine ruhige Akzentfläche statt rein weißem Chrome. Die Sidebar hebt sich farblich deutlich vom Inhaltsbereich ab.

### Farbdesigns

| Preset | Verwendung |
|--------|------------|
| **Blau** | Standard; Business-/Enterprise-Look |
| **Indigo** | Alternative mit violettem Einschlag |
| **Teal** | Alternative mit grün-blauem Einschlag |
| **Graphit** | Zurückhaltende, neutrale Alternative |
| **Rose** | Wärmere Akzentvariante |
| **Amber** | Warmer Warn-/Goldton als Akzent |
| **Emerald** | Grüne Akzentvariante |

Die Presets gelten konsistent in Web-UI, Browser-Extension und Desktop-App.

---

## 2. Neutrals – Light

| Token | Hex |
|-------|-----|
| `--color-bg` | `#F4F6F8` |
| `--color-text` | `#1A1D21` |
| `--color-navbar-bg` / surface | `#FFFFFF` |
| `--color-border` | `#E2E6EB` |
| `--color-muted` | `#F4F6F8` |
| `--color-hover` | `#E8EEF3` |
| `--color-input-bg` | `#FFFFFF` |
| `--color-input-border` | `#D1D9E0` |
| `--color-lead` / hint | `#5B6572` |
| `--shadow` | `rgba(0, 0, 0, 0.08)` |

---

## 3. Neutrals – Dark

| Token | Hex |
|-------|-----|
| `--color-bg` | `#121417` |
| `--color-text` | `#E8EAED` |
| `--color-surface` / navbar | `#1A1D21` |
| `--color-border` | `#2A2F36` |
| `--color-muted` / input-bg | `#1E2228` |
| `--color-hover` | `#2A2F36` |
| `--color-input-border` | `#3A4048` |
| `--color-lead` / hint | `#A0A7B2` |
| `--shadow` | `rgba(0, 0, 0, 0.35)` |

---

## 4. Semantisches Mapping

| UI-Rolle | Token |
|----------|-------|
| Primary button | `--color-accent` |
| Danger | `--color-primary` |
| Success | `--color-ok` |
| Aktive Sidebar | `--color-sidebar-active-bg` + weißer Text |
| Focus / Links | `--color-accent` |

---

## 5. Layout

- Linke Sidebar (~240px), Sektionen Vault (Meine Secrets / Geteilte Secrets / Neu / Import / Sicherung) / Konto & Sicherheit / Administration mit Tenant- und Plattform-Administration
- Sticky Topbar mit Seitentitel, Theme-Toggle als Icon (Sonne/Mond) und akzentuierter Header-Fläche
- Flache Inline-SVG-Icons in Sidebar und Primäraktionen über alle Clients (kein Icon-CDN, Air-Gap)
- Secrets-Ansicht: Liste / Tabelle / Kacheln (`tv-secrets-view` in localStorage); Mehrfachauswahl für Export  
- Sidebar Vault: Meine Secrets / Geteilte Secrets / Neu / Import / Sicherung  
- Mobile: Drawer + Backdrop  
- Kompakter Footer (`--app-footer-height: 2.5rem`)  
- Radius `--radius: 6px`; Font `"IBM Plex Sans", "Segoe UI", system-ui` (kein CDN, Air-Gap)  
- Setup/Login bleiben zentrierte Panels ohne Sidebar  

Implementierung: [`web/static/styles.css`](../../web/static/styles.css), [`web/static/app.js`](../../web/static/app.js).

## 6. Icons

- Stroke-SVGs inline in `app.js` (`ICO` / `icon()`), `currentColor`, ~1–1.2 rem  
- Theme: Sonne (Hellmodus) / Mond (Dunkelmodus) als `btn-icon`  
- Sidebar: Key, Plus, Upload, User, Users/Group, Network, Mail, Shield, Lock, Building, Clipboard  
- Aktionen: Copy, Share, Trash, Download, Unlock, Logout, Open, Eye, Edit, Save; Web-UI, Desktop und Extension verwenden lokale Inline-SVGs mit Text-/ARIA-Labels für Secret-Aktionen.

Keine Kategorien neben Ordnern/Tags — Ordner = Struktur, Tags = Labels (bewusst schlank).
