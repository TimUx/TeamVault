# TeamVault Browser Extension — Third-party (vendor) licenses

The extension bundles a small number of third-party cryptography/encoding
libraries locally under `clients/extension/vendor/` so it never needs to
load code from a CDN (see [security-architecture.md](./security-architecture.md#no-remote-code--no-external-cdn)).
No modifications are made to these libraries beyond using their official
minified/UMD builds.

| File | Library | Used for | License | Upstream |
|------|---------|----------|---------|----------|
| `vendor/argon2.umd.min.js` | [hash-wasm](https://github.com/Daninet/hash-wasm) by Dani Biró | Argon2 password-based key derivation (vault unlock) | MIT | https://github.com/Daninet/hash-wasm |
| `vendor/nacl-fast.min.js` | [tweetnacl-js](https://github.com/dchest/tweetnacl-js) | NaCl box/secretbox primitives (asymmetric envelope encryption, symmetric payload encryption) | Unlicense (public domain) | https://github.com/dchest/tweetnacl-js |
| `vendor/secrets.min.js` | [secrets.js-grempe](https://github.com/grempe/secrets.js) by Alexander Stetsyuk / Glenn Rempe | Shamir's Secret Sharing (used for recovery/escrow key splitting) | MIT | https://github.com/grempe/secrets.js |

Both MIT and Unlicense are permissive licenses that are compatible with
bundling inside the extension package and distributing it via the Chrome
Web Store and Firefox AMO; no attribution file is legally required beyond
this document, but it is kept here for transparency and to make store
review of "what third-party code ships in this extension" straightforward.

The shared zero-knowledge crypto glue code (`clients/extension/cryptocore.js`)
is TeamVault's own code (not a third-party library) and is kept in sync
byte-for-byte with `web/static/cryptocore.js` and `clients/js/cryptocore.js`
— CI verifies this with a checksum comparison
(`.github/workflows/security.yml`).
