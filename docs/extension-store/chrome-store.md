# Chrome Web Store listing — TeamVault

This document contains ready-to-use text for the Chrome Web Store
developer dashboard submission of the TeamVault browser extension
(`clients/extension`).

## Basic info

- **Name:** TeamVault
- **Category:** Productivity (alternatively: Tools)
- **Language:** English (primary); a German-language build/description can
  be added as a secondary listing language if desired — the extension UI
  itself is currently German-language.
- **Version:** matches `clients/extension/manifest.json` (`version`)

## Single purpose

> Secure access to credentials stored in a self-hosted TeamVault instance,
> including credential retrieval, copy, TOTP and secure autofill.

Every permission and feature in the extension maps to this single
purpose; no unrelated functionality (ads, unrelated productivity tools,
etc.) is included.

## Short description (≤132 characters)

```
Zero-knowledge access to your self-hosted TeamVault vault: view, copy, and securely autofill credentials and TOTP codes.
```

## Detailed description

```
TeamVault is a self-hosted, zero-knowledge password and secret manager.
This extension is the official browser client for your own TeamVault
server — there is no central TeamVault cloud service. You choose where
your TeamVault server runs (your company's domain, an internal network
address, or your own machine) and the extension only ever talks to that
one server URL, which you configure yourself in the extension popup.

FEATURES
• Connect to any self-hosted TeamVault server (HTTPS recommended for
  servers reachable over the internet; HTTP is supported for local
  development and internal/private networks).
• Zero-knowledge design: your master password and the vault's private
  key never leave your device, and are only ever held in memory while
  the popup is open. Vault entries are decrypted locally, in the
  extension, not on the server.
• View, filter and search your vault entries (private and shared).
• Copy a password or generate the current TOTP code with one click.
• Secure autofill: fills the detected username/password (and TOTP, if
  present) field on the active tab, but only after confirming the tab's
  current origin exactly matches the entry's saved URL — protecting you
  from phishing pages and stale/navigated tabs.
• Lock/Logout instantly wipe key material and cached vault data from
  memory.

PERMISSIONS
This extension requests the minimum permissions needed for the features
above. It does not request "read and change all your data on all
websites" as a fixed permission — see the permission justification table
in the project repository (docs/extension-store/chrome-store.md) for a
full breakdown.

PRIVACY
No analytics, tracking or telemetry is used by this extension. It
communicates only with the TeamVault server URL you configure. See the
full privacy policy: docs/extension-store/privacy-policy.md in the
project repository, or the page linked from the extension's store
listing.

SELF-HOSTED — NOT A CLOUD SERVICE
TeamVault does not operate a central hosted service for this extension
to connect to. You (or your organization) must run your own TeamVault
server. Learn more and get the server software at:
https://github.com/TimUx/TeamVault
```

## Category

Productivity

## Privacy tab (Chrome Web Store "Privacy practices")

- **Single purpose description:** see above.
- **Permission justification:** see table below.
- **Data usage:**
  - Does the extension collect or transmit user data? **Yes, but only to
    the TeamVault server URL configured by the user** (login credentials
    to authenticate, ciphertext of vault entries to display them). No
    data is sent to the developer or any third party.
  - Is data sold to third parties? **No.**
  - Is data used for purposes unrelated to the extension's single
    purpose? **No.**
  - Is data used to determine creditworthiness or for lending purposes?
    **No.**
- **Privacy policy URL:** publish `docs/extension-store/privacy-policy.md`
  (e.g. via GitHub Pages or the TeamVault server's own docs) and link it
  here.

## Permission justification

| Permission | Why it is requested |
|---|---|
| `storage` | Store the configured TeamVault server URL and last-used tenant/username locally, so the user doesn't have to retype them every time. |
| `clipboardWrite` | Copy a decrypted password to the clipboard when the user clicks the Kopieren/Copy icon button. |
| `activeTab` | Grants temporary access to the currently active tab only when the user interacts with the extension (opens the popup / clicks Ausfüllen/Fill), used to read the tab's URL for origin matching and to inject the fill logic. |
| `scripting` | Programmatically inject `content.js` into the active tab only when the user explicitly clicks Ausfüllen/Fill — the extension does not run a content script on every page by default. |
| Host permission: `http://127.0.0.1/*`, `http://localhost/*` | Built-in local development / first-run default so the extension works out of the box against a TeamVault server on the same machine, without any permission prompt. |
| Optional host permission: `https://*/*`, `http://*/*` | Self-hosted TeamVault servers run under arbitrary customer-controlled domains, internal DNS names, private IPs, and ports. The extension requests access to exactly one such origin — the server URL the user enters — via `chrome.permissions.request()` at the moment it is configured. No blanket "all sites" permission is held permanently. |

No permission listed above is requested "just in case" — each is used by
exactly one user-triggered feature described above.

## Data usage table

See [privacy-policy.md](./privacy-policy.md#3-data-the-extension-processes)
for the full data mapping table.

## Screenshots / promo assets

See [screenshots.md](./screenshots.md) for the list of required
screenshots, sizes and demo-data guidance. Promotional tile images
(440×280, 920×680, 1400×560) are optional for Chrome Web Store and can be
derived from the extension icon (`clients/extension/icons/icon-128.png`)
plus the TeamVault color palette (`#A70240` primary, `#0098DB` accent).

## Icon

`clients/extension/icons/icon-128.png` (128×128 PNG, no transparency
issues, matches `manifest.json` → `icons.128`) is generated from the same
TeamVault app icon used by Web UI and Desktop.

## Support / homepage

- **Homepage URL:** https://github.com/TimUx/TeamVault
- **Support URL:** https://github.com/TimUx/TeamVault/issues
