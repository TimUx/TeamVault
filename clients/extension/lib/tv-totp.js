/**
 * Minimal TOTP (RFC 6238, SHA-1, 6 digits, 30s step) — accepts a base32
 * secret or an otpauth:// URL. Used only client-side for autofill; the
 * TOTP seed itself comes from the decrypted vault payload (never sent to
 * any third party).
 *
 * Loaded as a classic script (see tv-url-match.js for the same pattern),
 * usable from popup.js in the extension and from plain Node.js tests.
 * Requires a WebCrypto-compatible `crypto.subtle` (available in every
 * supported browser and in Node.js via globalThis.crypto).
 */
(function (root) {
  "use strict";

  const globalScope = typeof self !== "undefined" ? self : globalThis;

  function base32Decode(secret) {
    const cleaned = secret.replace(/\s+/g, "").toUpperCase().replace(/=+$/, "");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of cleaned) {
      const v = alphabet.indexOf(c);
      if (v < 0) continue;
      bits += v.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return new Uint8Array(bytes);
  }

  async function totpAt(seed, unixSeconds, step) {
    if (!seed) return "";
    let secret = seed.trim();
    if (secret.startsWith("otpauth://")) {
      try {
        secret = new URL(secret).searchParams.get("secret") || "";
      } catch {
        return "";
      }
    }
    const bytes = base32Decode(secret);
    const key = await globalScope.crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const counter = Math.floor(unixSeconds / (step || 30));
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    // Counter fits in 32 bits for any realistic date; high 32 bits stay 0.
    view.setUint32(4, counter >>> 0);
    view.setUint32(0, Math.floor(counter / 2 ** 32));
    const sig = new Uint8Array(await globalScope.crypto.subtle.sign("HMAC", key, buf));
    const off = sig[sig.length - 1] & 0xf;
    const code = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
    return String(code % 1e6).padStart(6, "0");
  }

  async function totpNow(seed) {
    return totpAt(seed, Date.now() / 1000, 30);
  }

  const TVTotp = { totpNow, totpAt, base32Decode };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TVTotp;
  } else {
    root.TVTotp = TVTotp;
  }
})(typeof self !== "undefined" ? self : this);
