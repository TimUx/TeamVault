# teamVault – UI Brand Tokens

**Status:** Planungsdokument (Erweiterung zu Teil B)  
**Quelle:** storage-dashboard Defaults (`primary_color`, `secondary_color`, `accent_color` + Light-Neutrals aus `base.html`)  
**Design-Richtung:** Modern und flach – **nur die Farben** vom Dashboard übernehmen, kein Layout-/Navbar-Klon.  
**MVP (OQ-18):** nur Light Theme; Dark-Tokens unten als spätere Erweiterung dokumentiert, nicht implementieren bis nach MVP.

---

## 1. Markenfarben

| Token | Hex | Verwendung in teamVault |
|-------|-----|-------------------------|
| `--color-primary` | `#A70240` | Destruktive Aktionen, kritische Alerts, starke Hervorhebung |
| `--color-secondary` | `#BED600` | Erfolg, positive Status, dezente Akzente |
| `--color-accent` | `#0098DB` | Primäre CTAs, Links, Fokus-Ringe, aktive Navigation |

Gradient-Bar aus dem Dashboard (Primary → Secondary → Accent) ist **optional** und nur sparsam (z. B. App-Shell-Unterkante), nicht als flächiger Hero-Hintergrund.

---

## 2. Neutrals – Light

| Token | Hex |
|-------|-----|
| `--color-bg` | `#f5f7fa` |
| `--color-text` | `#333333` |
| `--color-navbar-bg` | `#ffffff` |
| `--color-navbar-text` | `#333333` |
| `--color-surface` | `#ffffff` |
| `--color-border` | `#e1e8ed` |
| `--color-muted-surface` | `#f5f7fa` |
| `--color-hover` | `#e8eef3` |
| `--color-input-bg` | `#ffffff` |
| `--color-input-border` | `#d1d9e0` |
| `--color-table-header` | `#f5f7fa` |
| `--color-table-hover` | `#f0f4f8` |
| `--shadow` | `rgba(0, 0, 0, 0.1)` |

---

## 3. Neutrals – Dark (post-MVP)

Nicht Bestandteil des MVP-UIs; Werte reserviert für spätere Erweiterung:

| Token | Hex |
|-------|-----|
| `--color-bg` | `#1a1e2e` |
| `--color-text` | `#e2e8f0` |
| `--color-navbar-bg` | `#252a3a` |
| `--color-navbar-text` | `#e2e8f0` |
| `--color-surface` | `#252a3a` |
| `--color-border` | `#3a4060` |
| `--color-muted-surface` | `#2e3350` |
| `--color-hover` | `#3a4060` |
| `--color-input-bg` | `#2e3350` |
| `--color-input-border` | `#454b65` |
| `--color-table-header` | `#2e3350` |
| `--color-table-hover` | `#2e3350` |
| `--shadow` | `rgba(0, 0, 0, 0.3)` |

Primary / Secondary / Accent bleiben in beiden Themes gleich (wie im Dashboard).

---

## 4. Semantisches Mapping

| UI-Rolle | Token |
|----------|-------|
| Primary button | `--color-accent` |
| Danger button / revoke / delete | `--color-primary` |
| Success / healthy | `--color-secondary` (Text auf Secondary ggf. dunkel `#333` für Kontrast) |
| Focus ring | `--color-accent` |
| Links | `--color-accent` |

---

## 5. Flaches UI – Leitplanken (kein Dashboard-Klon)

- Wenig Schatten; bevorzugte Trennung über Border/`--color-border` und Flächenkontrast.
- Keine schweren Card-Stacks in der ersten Viewport-Hierarchie der Vault-Liste.
- Großzügiger Whitespace, klare Typo-Hierarchie.
- Keine Pflicht zu Emoji-Icons oder 4px-Gradient-Leiste überall.
- Self-hosted Fonts (Air-Gap); keine CDN-Abhängigkeit.

---

## 6. CSS-Skizze (Referenz für Phase 3+)

```css
:root {
  --color-primary: #A70240;
  --color-secondary: #BED600;
  --color-accent: #0098DB;

  --color-bg: #f5f7fa;
  --color-text: #333333;
  --color-surface: #ffffff;
  --color-border: #e1e8ed;
  --color-muted-surface: #f5f7fa;
  --color-hover: #e8eef3;
  --color-input-bg: #ffffff;
  --color-input-border: #d1d9e0;
  --shadow: rgba(0, 0, 0, 0.1);
}

[data-theme="dark"] {
  --color-bg: #1a1e2e;
  --color-text: #e2e8f0;
  --color-surface: #252a3a;
  --color-border: #3a4060;
  --color-muted-surface: #2e3350;
  --color-hover: #3a4060;
  --color-input-bg: #2e3350;
  --color-input-border: #454b65;
  --shadow: rgba(0, 0, 0, 0.3);
}
```

---

## 7. Verwandte Dokumente

- [`architecture.md`](architecture.md)
- [`admin-ui-scope.md`](admin-ui-scope.md)
- [`open-questions.md`](open-questions.md) (OQ-18 Dark Mode)
