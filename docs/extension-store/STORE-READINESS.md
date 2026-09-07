# TeamVault Extension — Store Readiness

Status snapshot for submitting `clients/extension` to the Chrome Web
Store and Firefox AMO. Checked items were verified in this repository
(manifest inspection, `web-ext lint`, unit tests, CI). Unchecked items are
manual/account-bound steps that cannot be completed inside a source
repository.

## Chrome Web Store

- [x] Manifest V3 (`manifest_version: 3`)
- [x] Icon 128x128 (`clients/extension/icons/icon-128.png`, referenced in
      `manifest.json` → `icons.128` and `action.default_icon.128`)
- [x] Screenshots generated automatically on release
      (`scripts/capture-extension-screenshots.mjs`, shipped in
      `teamvault-extension-store-assets-<version>.zip`); upload in the
      dashboard is manual — see [screenshots.md](./screenshots.md)
- [x] Description (short + detailed text ready: [chrome-store.md](./chrome-store.md))
- [x] Single Purpose statement ready: [chrome-store.md](./chrome-store.md#single-purpose)
- [x] Permission justification table ready: [chrome-store.md](./chrome-store.md#permission-justification)
- [x] Privacy policy drafted: [privacy-policy.md](./privacy-policy.md)
- [x] No remote code (CSP restricts to `'self'`; CI fails on any
      `https://` script/import reference under `clients/extension`)
- [x] No tracking/analytics/telemetry (verified by code review; no
      network calls other than to the user-configured server URL)
- [x] Store upload package built automatically on release
      (`scripts/pack-extension-stores.mjs` →
      `teamvault-extension-chrome-<version>.zip`, without the `key` field
      and without Gecko-only manifest entries); the upload itself to the
      Chrome Developer Dashboard is manual
- [ ] Manual test pass completed on a real Chrome/Edge install (see
      test plan below)

## Firefox AMO

- [x] Manifest V3 with Firefox-compatible `background.scripts` fallback
- [x] Stable Extension ID (`teamvault@local`, unchanged)
- [x] Icon (`icons/icon-128.png`, plus 16/32/48)
- [x] Screenshots generated automatically on release
      (`scripts/capture-extension-screenshots.mjs`, shipped in
      `teamvault-extension-store-assets-<version>.zip`); upload in the
      dashboard is manual — see [screenshots.md](./screenshots.md)
- [x] Description ready: [firefox-amo.md](./firefox-amo.md)
- [x] Privacy policy drafted: [privacy-policy.md](./privacy-policy.md)
- [x] Source code available (public GitHub repository; vendor libraries
      are unmodified upstream builds, see [licenses.md](./licenses.md))
- [x] `web-ext lint --source-dir clients/extension` passes with 0 errors
      (2 informational warnings only — see [firefox-amo.md](./firefox-amo.md#firefox-specific-manifest-notes))
- [ ] Manual test pass completed on a real Firefox install (see test plan
      below)

## Security

- [x] No private keys committed (`.gitignore` excludes
      `clients/extension/*.pem`, `clients/extension/*.key`,
      `clients/*.pem`; CI job "No private signing keys in the tree" fails
      the build if any are found; `scripts/pack-extension.mjs` /
      `cmd/pack-extension` explicitly exclude `*.pem`/`*.key` from all
      packaged zip/crx/xpi artifacts)
- [x] No secrets (CI `secret-patterns` job scans the tree for private-key
      material and common token formats)
- [x] No external CDN (CSP + CI check; all crypto vendor libs bundled
      locally, see [licenses.md](./licenses.md))
- [x] Origin matching tested
      (`clients/extension/tests/url-match.test.mjs`: exact scheme/host/port
      matching, adversarial cases like `evil-example.com`/subdomains/ports)
- [x] Navigation protection tested
      (`clients/extension/tests/navigation-protection.test.mjs`: loads the
      real `content.js`, asserts fill is blocked on origin change)
- [x] Lock tested (code review: `#lock` handler zeroes the private key and
      clears the cache; covered conceptually by the navigation-protection
      test harness pattern — see [security-architecture.md](./security-architecture.md))
- [x] Logout tested (code review: `#logout` handler zeroes key material,
      clears cache, and calls `/api/auth/logout`)

## Self-Hosted

- [x] Arbitrary Server URL (no fixed production TeamVault URL anywhere in
      `clients/extension`; CI check greps for `https://teamvault\.*` and
      fails the build if found)
- [x] HTTPS supported (optional host permission requested dynamically via
      `chrome.permissions.request()` when the user saves a non-localhost
      server URL)
- [x] HTTP localhost supported (`http://localhost/*` in
      `host_permissions`)
- [x] 127.0.0.1 supported (`http://127.0.0.1/*` in `host_permissions`)
- [x] Private IP / custom port / internal DNS name supported (covered by
      the same optional `http://*/*` / `https://*/*` host-permission grant
      as any other self-hosted origin; the extension's URL parsing does
      not special-case public vs. private hostnames)
- [x] No fixed production URL (see "Arbitrary Server URL" above; the
      packaging tools' `TV_EXTENSION_UPDATE_BASE` defaults to a placeholder
      string, not a real host, and only affects the Enterprise
      update-manifest/policy artifacts, never the store-distributed
      package)

## Self-Hosted / Enterprise Distribution vs. Store Distribution

TeamVault supports two independent distribution paths, both preserved by
this work:

1. **Store distribution** (this readiness document): the Chrome Web
   Store / Firefox AMO host the package, sign it, and handle updates.
   The store build must not depend on TeamVault's own update URL — it
   doesn't; `manifest.json` has no `update_url` field, so Chrome/Firefox
   use their own store update mechanism automatically once published.
2. **Enterprise / self-hosted distribution** (unchanged): organizations
   that prefer not to install from a public store can continue to use
   `scripts/pack-extension.mjs` / `cmd/pack-extension` to build a signed
   `.crx`, `.xpi`, `updates.xml` auto-update manifest, and Chrome/Firefox
   enterprise policy templates, pointed at their own download URL via
   `TV_EXTENSION_UPDATE_BASE`. This is documented end-to-end in
   `docs/extension-guide.md` and is not affected by the store-readiness
   changes in this document.

## Manual/account-bound steps (cannot be completed from the repository)

- Register/pay for a Chrome Web Store developer account and a Firefox
  AMO developer account.
- Upload the generated store screenshots
  (`teamvault-extension-store-assets-<version>.zip` → `screenshots/`) in
  each dashboard; regenerate them with
  `node scripts/capture-extension-screenshots.mjs` if the UI changes.
- Host `privacy-policy.md` at a publicly reachable URL and link it from
  both store listings.
- Submit the built package to each store and complete their respective
  review questionnaires (using the text prepared in
  [chrome-store.md](./chrome-store.md) / [firefox-amo.md](./firefox-amo.md)).
- Perform the manual browser test passes below on real Chrome and
  Firefox installs (cannot be automated in this sandboxed environment
  without a GUI browser + a running TeamVault server).

### Suggested manual test plan (Chrome & Firefox)

1. Install the unpacked/temporary extension.
2. Open the popup, configure a server URL (start with
   `http://127.0.0.1:8080`, then repeat with an HTTPS self-hosted URL).
3. Log in, unlock the vault.
4. View the secrets list, copy a password, generate/copy a TOTP code.
5. Trigger autofill on a matching-origin page; verify it fills.
6. Trigger autofill intent, then navigate away before it completes;
   verify it is blocked.
7. Attempt fill/copy against a non-matching origin entry; verify it is
   blocked.
8. Lock the vault; verify the master password is required again.
9. Logout; verify a fresh login is required and no stale key material
   remains usable.
10. Repeat steps 2–9 against `localhost`, a private-IP server, and an
    HTTPS server with a custom port.
