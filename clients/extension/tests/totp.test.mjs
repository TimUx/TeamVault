// TOTP (RFC 6238) unit tests using the official RFC test vectors.
// Run with: node --test clients/extension/tests
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

before(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = require("node:crypto").webcrypto;
  }
});

function base32Encode(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  let out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890" for the
// SHA-1 test vectors (repeated/truncated for SHA-256/512, not used here).
const RFC6238_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));

// RFC 6238 defines 8-digit codes; this extension truncates to 6 digits
// (like most consumer TOTP apps), so vectors below use the last 6 digits
// of the published 8-digit RFC values.
const VECTORS = [
  { t: 59, code8: "94287082" },
  { t: 1111111109, code8: "07081804" },
  { t: 1111111111, code8: "14050471" },
  { t: 1234567890, code8: "89005924" },
  { t: 2000000000, code8: "69279037" },
];

test("totpAt matches RFC 6238 SHA-1 test vectors (last 6 digits)", async () => {
  const TVTotp = require("../lib/tv-totp.js");
  for (const v of VECTORS) {
    const code = await TVTotp.totpAt(RFC6238_SECRET_B32, v.t, 30);
    assert.equal(code, v.code8.slice(-6), `t=${v.t}`);
  }
});

test("totpNow accepts an otpauth:// URL and extracts the secret", async () => {
  const TVTotp = require("../lib/tv-totp.js");
  const otpauth = `otpauth://totp/Example:alice@example.com?secret=${RFC6238_SECRET_B32}&issuer=Example`;
  const fixedSeconds = 59;
  const expected = await TVTotp.totpAt(RFC6238_SECRET_B32, fixedSeconds, 30);

  // Exercise the real totpNow() otpauth-parsing branch (inside totpAt) by
  // freezing Date.now() to the same fixed instant used above.
  const realDateNow = Date.now;
  Date.now = () => fixedSeconds * 1000;
  try {
    const viaUrl = await TVTotp.totpNow(otpauth);
    assert.equal(viaUrl, expected);
  } finally {
    Date.now = realDateNow;
  }
});

test("totpAt returns empty string for empty seed", async () => {
  const TVTotp = require("../lib/tv-totp.js");
  assert.equal(await TVTotp.totpAt("", 59, 30), "");
});
