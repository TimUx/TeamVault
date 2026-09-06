# TeamVault Extension — Required store screenshots

Guidance for producing store screenshots for the Chrome Web Store and
Firefox AMO listings. **Use only demo/synthetic data — no real
credentials, tenants, usernames, or personal data.** A good approach is a
throwaway local TeamVault instance (`http://127.0.0.1:8080`) seeded with
fake entries such as "Demo Email", "Demo GitLab", "Demo VPN".

Recommended capture size: 1280×800 or 640×400 (Chrome Web Store accepts
both; AMO accepts arbitrary sizes but 1280×800 renders well). Capture the
popup at its natural width (360px) centered on a neutral background if a
full-browser screenshot is not required by the store.

| # | Screenshot | Purpose | Suggested content | Size | Demo data |
|---|------------|---------|--------------------|------|-----------|
| 1 | Popup / Login | Show the first-run / login screen | Server-URL field filled with `http://127.0.0.1:8080`, Tenant `demo`, User `demo-user`, empty password field | 1280×800 (browser chrome) or 360×~400 (popup only) | Tenant "demo", user "demo-user" |
| 2 | Vault / Secret list | Show the unlocked vault with several entries | 4–6 demo entries with generic titles ("Demo Email", "Demo GitLab", "Demo VPN", "Demo Wi-Fi"), mixed private/shared badges | 1280×800 or popup-only | Fake titles only, no real domains/usernames |
| 3 | Credential details / actions | Show the Fill/Copy buttons for one entry | One row expanded/highlighted with Fill and Copy buttons visible | 1280×800 or popup-only | Same demo entry as #2 |
| 4 | Autofill in action | Show a login form being filled | A generic demo login page (e.g. a local test HTML page, NOT a real company/site) with username/password fields populated | 1280×800 (full page + popup) | `demo-user` / `••••••••` (masked) |
| 5 | TOTP | Show a generated 6-digit TOTP code | Popup entry with a visible 6-digit code (generated from a demo TOTP seed, never a real one) | 360×~400 or 1280×800 | Demo TOTP seed only |
| 6 | Server configuration | Show the "Server-URL" settings field and the optional host-permission flow | Popup with the Server-URL field being edited, e.g. `https://vault.example.com` | 360×~400 or 1280×800 | Example domain `vault.example.com` |
| 7 | Lock / Security | Show the Lock/Logout controls | Unlocked vault view with the "Sperren" (Lock) and "Logout" buttons visible | 360×~400 or 1280×800 | Same demo entries as #2 |

## Notes

- Do not include real tenant names, usernames, internal domains, IP
  addresses of production systems, or any personally identifiable
  information in any screenshot.
- Prefer capturing against a neutral browser theme (light) for
  consistency with the extension's own light UI.
- If store guidelines require a minimum number of screenshots (Chrome
  Web Store: at least 1, up to 5; AMO: optional but recommended), submit
  screenshots 1, 2, 4 and 5 as the minimum set — they demonstrate the
  core "view vault → autofill → TOTP" flow most reviewers look for.
