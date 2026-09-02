import fs from "fs";
import vm from "vm";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr");
const src = fs.readFileSync("web/static/qrcode.js", "utf8");
const sandbox = { globalThis: {} };
sandbox.window = sandbox.globalThis;
vm.runInNewContext(src, sandbox);
const TVQR = sandbox.globalThis.TVQR;

const url =
  "otpauth://totp/TeamVault:test?algorithm=SHA1&digits=6&issuer=TeamVault&period=30&secret=JBSWY3DPEHPK3PXP";

function decodeMatrix(m, size) {
  const quiet = 4;
  const dim = size + quiet * 2;
  const scale = 8;
  const w = dim * scale;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && m[my][mx] === 1;
      const i = (y * w + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return jsQR(data, w, w)?.data || null;
}

const { m, size } = TVQR._encode(url);
console.log("current", decodeMatrix(m, size) === url ? "OK" : "FAIL");

// brute: flip mask id in source by patching encode - instead test known-good tiny url
const short = "HELLO";
const s2 = TVQR._encode(short);
console.log("short url", decodeMatrix(s2.m, s2.size));
