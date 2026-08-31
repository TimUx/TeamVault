# TeamVault – UI Brand Tokens

**Status:** Aktuell (Sidebar-Shell + flache Inline-Icons, 2026-08-27)  
**Design-Richtung:** Flache App-Shell mit linker Navigation; kühle Slate-Blau-Palette (kein Regenbogen-Hero).

---

## 1. Markenfarben

| Token | Light | Dark | Verwendung |
|-------|-------|------|------------|
| `--color-accent` | `#2F5D8C` | `#6B9BD2` | Primäre CTAs, aktive Nav, Fokus |
| `--color-secondary` | `#5B6572` | `#9AA4B2` | Sekundärtext / dezente Akzente |
| `--color-primary` | `#A70240` | `#C43B66` | Destruktiv (Löschen, Revoke) |

Unterkante der Topbar: dezenter Accent-Streifen (2px), kein Multi-Color-Gradient.

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
| Aktive Sidebar | `--color-sidebar-active-bg` + Accent-Text |
| Focus / Links | `--color-accent` |

---

## 5. Layout

- Linke Sidebar (~240px), Sektionen Vault (Meine Secrets / Geteilte Secrets / Neu / Import / Sicherung) / Konto / Administration  
- Sticky Topbar mit Seitentitel, Theme-Toggle als Icon (Sonne/Mond)  
- Flache Inline-SVG-Icons in Sidebar und Primäraktionen (kein Icon-CDN, Air-Gap)  
- Secrets-Ansicht: Liste / Tabelle / Kacheln (`tv-secrets-view` in localStorage); Mehrfachauswahl für Export  
- Sidebar Vault: Meine Secrets / Geteilte Secrets / Neu / Import / Sicherung  
- Mobile: Drawer + Backdrop  
- Radius `--radius: 6px`; Font `"IBM Plex Sans", "Segoe UI", system-ui` (kein CDN, Air-Gap)  
- Setup/Login bleiben zentrierte Panels ohne Sidebar  

Implementierung: [`web/static/styles.css`](../../web/static/styles.css), [`web/static/app.js`](../../web/static/app.js).

## 6. Icons

- Stroke-SVGs inline in `app.js` (`ICO` / `icon()`), `currentColor`, ~1–1.2 rem  
- Theme: Sonne (Hellmodus) / Mond (Dunkelmodus) als `btn-icon`  
- Sidebar: Key, Plus, Upload, User, Users/Group, Network, Mail, Shield, Lock, Building, Clipboard  
- Aktionen: Copy, Share, Trash, Download, Unlock, Logout, Open, Eye, Save  

Keine Kategorien neben Ordnern/Tags — Ordner = Struktur, Tags = Labels (bewusst schlank).
