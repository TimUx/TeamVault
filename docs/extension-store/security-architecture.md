# TeamVault Browser Extension — Security Architecture

This document describes the security-relevant design of the browser
extension (`clients/extension`) as implemented in this repository. It
makes no unverifiable claims (no "100% secure", no "unhackable") — it
describes the mechanisms actually present in the code, with file
references, and their known limitations.

## Zero-knowledge design

- The extension never sends the master password or the derived private
  key to the TeamVault server.
- The private key is derived locally from the master password via
  `TVCrypto.unlockPrivateKey()` (`clients/extension/cryptocore.js`,
  identical — checksum-verified in CI, see
  `.github/workflows/security.yml` "cryptocore.js checksum sync" — to
  `web/static/cryptocore.js` and `clients/js/cryptocore.js`).
- Vault entries are fetched from the server as ciphertext
  (`ciphertext_b64`, `nonce_b64`, per-entry key envelope) and decrypted
  only inside the popup's JavaScript context
  (`clients/extension/popup.js`, `decryptPayloadFor()`).

## Key handling / vault unlock / lock

- The private key (`state.sk`, `clients/extension/popup.js`) exists only
  in the popup's in-memory JS state. The popup is a short-lived
  extension page: it is destroyed (and its memory freed) whenever the
  popup closes, which browsers do automatically when it loses focus.
- **Lock** (`#lock` handler) explicitly zeroes the key
  (`state.sk.fill(0)`) and clears the decrypted-entry cache
  (`state.cache = []`) before hiding the vault view — this is a defense
  in depth in addition to relying on popup teardown.
- **Logout** (`#logout` handler) performs the same zeroing/clearing and
  additionally calls `/api/auth/logout` on the configured server to end
  the server-side session.
- Per-entry data keys (`dk`) opened via `openDK()` are zeroed
  (`dk.fill(0)`) immediately after use in `decryptPayloadFor()` and
  `refresh()`.

## Background service worker

`background.js` intentionally holds no vault keys or vault data — its
only job is a no-op `onInstalled` listener. This keeps the
longer-lived (across popup opens) service worker/background page free of
sensitive state, so there is nothing there to leak or forcibly persist.

## Origin matching (autofill / copy gating)

Autofill and copy are gated by an **exact origin match** (scheme + host +
port), not a fuzzy hostname match:

- `originsMatch()` (`clients/extension/lib/tv-url-match.js`) does a
  case-insensitive string comparison of full origins
  (`protocol + "//" + host`), which by construction distinguishes:
  - `https://example.com` vs `http://example.com` (different scheme),
  - `https://example.com` vs `https://example.com:8443` (different,
    explicit port),
  - `https://example.com` vs `https://evil-example.com` or
    `https://sub.example.com` (different host).
  - Per the `URL` spec, the *default* port for the scheme (443 for
    `https:`, 80 for `http:`) is normalized away, so
    `https://example.com` and `https://example.com:443` are correctly
    treated as the same origin (this matches how browsers themselves
    define "same origin").
- `hostsMatch()` is intentionally looser (subdomain-aware) but is used
  **only** for list sorting / the "matches this site" checkbox hint in
  the popup UI — never to authorize a fill or copy action.
- Unit tests for both functions, including the exact adversarial cases
  above, live in `clients/extension/tests/url-match.test.mjs`.

## Navigation protection (fill-time re-check)

Because there is a gap between "user clicks Fill" and "content script
actually runs", the extension re-validates the tab's origin twice:

1. `clients/extension/popup.js` `fillTab()` re-reads the active tab's
   current URL immediately before sending the fill message, and refuses
   to fill if it no longer matches the origin the user saw when they
   clicked Fill (`expectedOrigin`).
2. `clients/extension/content.js` `fillLogin()` independently re-checks
   `location.origin === msg.expectedOrigin` inside the page itself
   before touching any form field, and returns `{ blocked: true }`
   otherwise.

This double check means even a same-tab navigation that happens between
the popup's own check and the content script executing is still caught.
Automated coverage:
`clients/extension/tests/navigation-protection.test.mjs` loads the real
`content.js` in a `vm` sandbox (not a reimplementation) and asserts fills
are blocked for scheme, host and port mismatches, and proceed only on an
exact match.

## TOTP

TOTP codes (RFC 6238, SHA-1, 6 digits, 30s step) are computed locally in
`clients/extension/lib/tv-totp.js` from the vault entry's decrypted TOTP
seed, using the Web Crypto API (`crypto.subtle`). The seed is never sent
anywhere; only the resulting 6-digit code is placed into the page's TOTP
field (Fill) or copied via the popup UI. Verified against the official
RFC 6238 Appendix B test vectors in
`clients/extension/tests/totp.test.mjs`.

## No remote code / no external CDN

- `content_security_policy.extension_pages` in `manifest.json` is
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` — scripts may
  only load from the extension package itself.
- All cryptography vendor libraries (`vendor/nacl-fast.min.js`,
  `vendor/argon2.umd.min.js`, `vendor/secrets.min.js`) are bundled locally
  in the extension package; none are fetched from a CDN. See
  [licenses.md](./licenses.md) for their licenses.
- CI (`.github/workflows/extension.yml`) fails the build if any
  `<script src="https://…">`, `import … from "https://…"` or
  `importScripts("https://…")` reference is found under
  `clients/extension`.

## No telemetry / analytics / tracking

No analytics, tracking or telemetry is used by the browser extension (see
[privacy-policy.md](./privacy-policy.md)). The only network calls the
extension makes are `fetch()` calls to the TeamVault server URL the user
configures.

## Known limitations (documented, not overclaimed)

- The extension relies on the browser's own process/memory isolation for
  the popup; it does not implement additional in-memory hardening (e.g.
  guarding against a compromised browser process or a malicious
  extension with broader permissions).
- Autofill's login-field heuristics (`content.js` `scoreUsername()`,
  `findLoginFields()`) are best-effort DOM heuristics, not a guarantee of
  correctness on every possible page layout.
- Origin matching protects against cross-origin autofill/copy; it does
  not protect against a compromised or malicious page at the *correct*
  origin (e.g. if the legitimate site itself is compromised).
