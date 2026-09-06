# TeamVault Browser Extension — Privacy Policy

This document describes the data practices of the **TeamVault browser
extension** (Chrome, Edge, Firefox). It does not describe the TeamVault
server, which is self-hosted software operated independently by each
customer/user under their own domain, hosting provider and privacy policy.

Last updated: see repository history of this file.

## 1. What TeamVault is

TeamVault is self-hosted, zero-knowledge password/secret management
software. **There is no central, TeamVault-operated cloud service.** Each
installation runs on infrastructure chosen and controlled by the user or
their organization (e.g. `https://vault.example.com`,
`https://passwords.company.example`, an internal DNS name, a private IP
address, or `http://127.0.0.1:8080` for local development). The extension
only ever talks to the single server URL that **you** configure in the
extension popup.

## 2. No analytics, tracking or telemetry

> No analytics, tracking or telemetry is used by the browser extension.

The extension contains no third-party analytics SDKs, no crash reporters,
no advertising identifiers, and makes no network requests other than to
the TeamVault server URL you configure and, if used, the extension
update mechanism of the browser vendor (Chrome Web Store / Mozilla AMO).
No usage data is transmitted to the extension developer or to any third
party.

## 3. Data the extension processes

| Data | Purpose | Where it is stored | Where it is transmitted |
|------|---------|--------------------|--------------------------|
| Server URL | Know which TeamVault server to talk to | `chrome.storage.local` / `browser.storage.local` (local browser profile) | Not transmitted anywhere; only used as the fetch() target |
| Tenant / username | Login form convenience (pre-filled next time) | `chrome.storage.local` | Sent to the configured TeamVault server on login only |
| Login password / master password | Authenticate and unlock the vault | Never persisted; kept only in page memory while the popup is open | Login password is sent once to the configured TeamVault server over the connection you configured (HTTPS recommended for remote servers); the master password is never sent anywhere — it is used locally to derive the vault's private key |
| Private key (derived from master password) | Decrypt vault entries locally (zero-knowledge) | Held only in the popup's in-memory JavaScript state while unlocked; zeroed out (`.fill(0)`) on Lock/Logout/popup close | Never transmitted |
| Vault entries (titles, usernames, passwords, URLs, TOTP seeds, notes) | Display, copy, and autofill your credentials | Ciphertext is fetched into popup memory and decrypted locally; nothing is persisted to disk by the extension | Ciphertext is fetched from the TeamVault server you configured; decrypted plaintext is never sent anywhere |
| Autofill data (username/password/current TOTP code) | One-time fill of a login form you explicitly triggered via the "Fill" button | Held only for the duration of the fill message to the active tab | Sent only to the current browser tab's page (via the extension's own content script), never to a network endpoint |
| Active tab URL/origin | Match vault entries to the site you're on and prevent cross-site autofill (phishing protection) | Read transiently when the popup opens / Fill is clicked | Never transmitted; used only for local origin comparison |

## 4. Local storage

The extension uses the browser's `storage.local` API (sandboxed to the
extension, not a regular website) to remember:

- the configured TeamVault server URL,
- the last-used tenant slug and username (for form convenience).

No password, master password, private key or vault content is ever
written to `storage.local` or any other persistent browser storage.

## 5. What happens on Lock

Clicking **Lock** zeroes the in-memory private key and clears the popup's
decrypted-entry cache. The vault becomes inaccessible until the master
password is entered again. No network request is made; your TeamVault
server session (login) remains active.

## 6. What happens on Logout

Clicking **Logout**:

1. Zeroes the in-memory private key (same as Lock).
2. Clears the decrypted-entry cache.
3. Calls the configured TeamVault server's logout endpoint to end the
   server-side session.
4. Returns the popup to the login screen.

Server URL, tenant and username remembered for form convenience in
`storage.local` are **not** cleared on logout (so you don't have to
retype them), but no secret or key material persists.

## 7. Third parties

The extension does not share, sell, or transmit any data to third
parties. Its only network peer is the TeamVault server URL you configure.
If that server is operated by your employer or another organization, that
organization's own privacy policy governs data processed by the server
itself (this document only covers the browser extension's own behavior).

## 8. Permissions and why they are requested

See [chrome-store.md](./chrome-store.md#permission-justification) and
[firefox-amo.md](./firefox-amo.md) for the full permission-by-permission
justification table.

## 9. Changes to this policy

Material changes to how the extension processes data will be reflected in
this file and in the corresponding store listing update.

## 10. Contact

Questions about this extension's data handling can be raised via the
project's issue tracker: <https://github.com/TimUx/TeamVault/issues>.
