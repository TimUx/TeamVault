# Firefox Add-ons (AMO) listing — TeamVault

Ready-to-use text for submitting the TeamVault browser extension
(`clients/extension`) to addons.mozilla.org.

## Basic info

- **Name:** TeamVault
- **Add-on ID:** `teamvault@local` (see
  `manifest.json` → `browser_specific_settings.gecko.id`). This ID is
  already in use for existing enterprise/self-hosted deployments (policy
  installs, temporary add-on testing); it is kept unchanged for the AMO
  submission so existing enterprise policy configurations that pin this
  ID keep working. Changing it would break those deployments and is not
  required for AMO acceptance.
- **Summary (≤250 characters):**

```
Zero-knowledge access to your self-hosted TeamVault vault. View, copy, and securely autofill credentials and TOTP codes from your own TeamVault server — no central cloud service required.
```

- **Description:** reuse the "Detailed description" from
  [chrome-store.md](./chrome-store.md#detailed-description) verbatim —
  the extension behaves identically across Chromium and Firefox builds.

## Category / tags

- **Category:** Privacy & Security (alternatively: Productivity)
- **Tags:** `password-manager`, `security`, `self-hosted`, `totp`,
  `autofill`, `privacy`

## Firefox-specific manifest notes

- `manifest_version: 3` with a dual `background.service_worker` +
  `background.scripts` declaration, so Chrome/Edge use the MV3 service
  worker while Firefox falls back to its supported `scripts` background
  page. This is a documented cross-browser MV3 compatibility pattern
  (declaring both keys side by side): Chrome's manifest parser ignores
  the `scripts` key it doesn't use for MV3 background pages (verified:
  the extension loads and the service worker registers correctly under
  Chromium with this manifest), while `web-ext lint` confirms Firefox
  correctly falls back to `scripts` and only emits an informational
  `BACKGROUND_SERVICE_WORKER_IGNORED` notice (not an error) about the
  unused `service_worker` key.
- `browser_specific_settings.gecko.strict_min_version` is set to `140.0`.
  This is required because the extension relies on
  `optional_host_permissions` (Firefox 128+) and declares
  `data_collection_permissions` (required by Firefox 140+ for new/updated
  AMO submissions). Verified with `web-ext lint` (0 errors).
- `browser_specific_settings.gecko.data_collection_permissions.required`
  is set to `["none"]` — the extension collects no user data on behalf of
  Mozilla/AMO; see the privacy policy for what it does with data.

## Privacy

- **No analytics, tracking or telemetry is used by the browser
  extension.**
- Full privacy policy: [privacy-policy.md](./privacy-policy.md).
- The extension only communicates with the TeamVault server URL
  configured by the user.

## Source code

TeamVault is open source. AMO reviewers can be pointed at the public
repository for the exact source matching the submitted build:
https://github.com/TimUx/TeamVault (path: `clients/extension`). If AMO
requests a source archive because the submitted `.xpi` differs from a
plain readable source (it does not — no bundlers/minifiers are used for
`popup.js`/`content.js`/`background.js`; only the vendor crypto libraries
under `clients/extension/vendor/` are pre-built, third-party, MIT/public
domain-licensed libraries, see [licenses.md](./licenses.md)), provide the
`clients/extension` directory as the source archive plus a note that
`vendor/*.min.js` are unmodified upstream builds.

## web-ext lint

Run before every AMO submission:

```bash
npx web-ext lint --source-dir clients/extension --no-config-discovery
```

CI (`.github/workflows/extension.yml`) runs this on every change to
`clients/extension/**` and fails the build on any lint error.

## Icon

`clients/extension/icons/icon-128.png` (AMO uses up to 128×128).

## Screenshots

See [screenshots.md](./screenshots.md).

## Support / homepage / repository URLs

- **Support URL:** https://github.com/TimUx/TeamVault/issues
- **Homepage URL:** https://github.com/TimUx/TeamVault
- **Repository URL:** https://github.com/TimUx/TeamVault

## Distribution note: AMO vs. enterprise/self-signed

This AMO listing is for the **public, store-distributed** build. The
existing enterprise/self-hosted distribution path (unsigned `.xpi` +
Firefox `policies.json` pointing at a customer's own TeamVault server
downloads, see `docs/extension-guide.md` and
`scripts/pack-extension.mjs`) is unaffected and continues to work for
organizations that prefer to distribute the extension themselves instead
of through AMO — see
[STORE-READINESS.md](./STORE-READINESS.md#self-hosted--enterprise-distribution-vs-store-distribution).
