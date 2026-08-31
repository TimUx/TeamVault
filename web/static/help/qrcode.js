/**
 * TeamVault local QR encoder (byte mode, ECC-M). No CDN.
 * API: TVQR.svg(text, { size }) → string; TVQR.mount(el, text, opts)
 */
(function (global) {
  "use strict";

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function mul(a, b) {
    return a && b ? EXP[LOG[a] + LOG[b]] : 0;
  }

  function rsPoly(n) {
    let p = [1];
    for (let i = 0; i < n; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) {
        q[j] ^= mul(p[j], EXP[i]);
        q[j + 1] ^= p[j];
      }
      p = q;
    }
    return p;
  }

  function rsEncode(data, nsym) {
    const gen = rsPoly(nsym);
    const rem = new Array(nsym).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      if (!factor) continue;
      for (let j = 0; j < nsym; j++) rem[j] ^= mul(gen[j + 1], factor);
    }
    return rem;
  }

  // size, dataCW, ecPerBlock, blocks, alignCenters (excl. 6)
  const SPEC = {
    1: [21, 16, 10, 1, []],
    2: [25, 28, 16, 1, [18]],
    3: [29, 44, 26, 1, [22]],
    4: [33, 64, 18, 2, [26]],
    5: [37, 86, 24, 2, [30]],
    6: [41, 108, 16, 4, [34]],
    7: [45, 124, 18, 4, [22, 38]],
    8: [49, 154, 22, 4, [24, 42]],
    9: [53, 182, 22, 5, [26, 46]],
    10: [57, 216, 26, 5, [28, 50]],
    11: [61, 254, 30, 5, [30, 54]],
    12: [65, 290, 22, 8, [32, 58]],
    13: [69, 334, 22, 9, [34, 62]],
    14: [73, 365, 24, 9, [26, 46, 66]],
    15: [77, 415, 24, 10, [26, 48, 70]],
    16: [81, 453, 28, 10, [26, 50, 74]],
  };

  function utf8Bytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function lenBitsFor(ver) {
    return ver >= 10 ? 16 : 8;
  }

  function byteCapacity(ver) {
    const dataCW = SPEC[ver][1];
    return Math.floor((dataCW * 8 - 4 - lenBitsFor(ver)) / 8);
  }

  function pickVersion(n) {
    for (let v = 1; v <= 16; v++) {
      if (byteCapacity(v) >= n) return v;
    }
    throw new Error("Text zu lang für lokalen QR");
  }

  function bitBuffer() {
    const bits = [];
    return {
      push(val, len) {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
      },
      bits,
      toBytes() {
        const bytes = [];
        for (let i = 0; i < bits.length; i += 8) {
          let v = 0;
          for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] || 0);
          bytes.push(v);
        }
        return bytes;
      },
    };
  }

  function buildData(text, ver) {
    const [, dataCW, ecPer, nBlocks] = SPEC[ver];
    const payload = utf8Bytes(text);
    const buf = bitBuffer();
    buf.push(0b0100, 4);
    buf.push(payload.length, lenBitsFor(ver));
    payload.forEach((b) => buf.push(b, 8));
    const capacity = dataCW * 8;
    const rem = capacity - buf.bits.length;
    buf.push(0, Math.min(4, Math.max(0, rem)));
    while (buf.bits.length % 8) buf.bits.push(0);
    const pads = [0xec, 0x11];
    let pi = 0;
    const bytes = buf.toBytes();
    while (bytes.length < dataCW) bytes.push(pads[pi++ % 2]);

    const shortBlocks = nBlocks - (dataCW % nBlocks);
    const shortLen = Math.floor(dataCW / nBlocks);
    const blocks = [];
    let off = 0;
    for (let i = 0; i < nBlocks; i++) {
      const len = shortLen + (i < shortBlocks ? 0 : 1);
      const d = bytes.slice(off, off + len);
      off += len;
      blocks.push({ d, e: rsEncode(d, ecPer) });
    }
    const out = [];
    const maxD = Math.max(...blocks.map((b) => b.d.length));
    for (let i = 0; i < maxD; i++) {
      for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    }
    for (let i = 0; i < ecPer; i++) {
      for (const b of blocks) out.push(b.e[i]);
    }
    return out;
  }

  function emptyMatrix(n) {
    return Array.from({ length: n }, () => new Array(n).fill(null));
  }

  function setFinder(m, ox, oy) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const xx = ox + x;
        const yy = oy + y;
        if (xx < 0 || yy < 0 || xx >= m.length || yy >= m.length) continue;
        const on =
          x >= 0 &&
          x <= 6 &&
          y >= 0 &&
          y <= 6 &&
          (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        if (x === -1 || x === 7 || y === -1 || y === 7) m[yy][xx] = 0;
        else m[yy][xx] = on ? 1 : 0;
      }
    }
  }

  function setAlign(m, cx, cy) {
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const d = Math.max(Math.abs(x), Math.abs(y));
        m[cy + y][cx + x] = d === 0 || d === 2 ? 1 : 0;
      }
    }
  }

  function isReserved(m, x, y) {
    return m[y][x] !== null;
  }

  function applyMask(id, x, y) {
    switch (id) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function formatBits(mask) {
    // ECC-M = 00
    const data = (0b00 << 3) | mask;
    let rem = data << 10;
    const gen = 0b10100110111;
    for (let i = 14; i >= 10; i--) {
      if (((rem >> i) & 1) !== 0) rem ^= gen << (i - 10);
    }
    return ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
  }

  function drawFormat(m, size, bits) {
    const positions = [
      [8, 0],
      [8, 1],
      [8, 2],
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 7],
      [8, 8],
      [7, 8],
      [5, 8],
      [4, 8],
      [3, 8],
      [2, 8],
      [1, 8],
      [0, 8],
    ];
    for (let i = 0; i < 15; i++) {
      const bit = (bits >> i) & 1;
      m[positions[i][1]][positions[i][0]] = bit;
    }
    // second copy: bits 0–7 along top row right, bits 8–14 along left column bottom
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = (bits >> i) & 1;
    for (let i = 0; i < 7; i++) m[size - 7 + i][8] = (bits >> (8 + i)) & 1;
  }

  function versionBits(ver) {
    let rem = ver << 12;
    const gen = 0x1f25;
    for (let i = 17; i >= 12; i--) {
      if (((rem >> i) & 1) !== 0) rem ^= gen << (i - 12);
    }
    return (ver << 12) | (rem & 0xfff);
  }

  function reserveVersion(m, size) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m[i][size - 11 + j] = 0;
        m[size - 11 + j][i] = 0;
      }
    }
  }

  function drawVersion(m, size, bits) {
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      m[a][size - 11 + b] = bit;
      m[size - 11 + b][a] = bit;
    }
  }

  function encode(text) {
    const payload = utf8Bytes(text);
    const ver = pickVersion(payload.length);
    const [size, , , , aligns] = SPEC[ver];
    const m = emptyMatrix(size);

    setFinder(m, 0, 0);
    setFinder(m, size - 7, 0);
    setFinder(m, 0, size - 7);

    for (let i = 8; i < size - 8; i++) {
      if (!isReserved(m, i, 6)) m[6][i] = i % 2 === 0 ? 1 : 0;
      if (!isReserved(m, 6, i)) m[i][6] = i % 2 === 0 ? 1 : 0;
    }

    const centers = [6].concat(aligns);
    for (const cy of centers) {
      for (const cx of centers) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        if ((cx < 9 && cy < 9) || (cx > size - 10 && cy < 9) || (cx < 9 && cy > size - 10)) continue;
        setAlign(m, cx, cy);
      }
    }

    // Reserve format areas
    for (let i = 0; i < 9; i++) {
      if (i < size) {
        if (m[8][i] === null) m[8][i] = 0;
        if (m[i][8] === null) m[i][8] = 0;
      }
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
    }
    m[size - 8][8] = 1;

    if (ver >= 7) reserveVersion(m, size);

    const code = buildData(text, ver);
    const codeBits = [];
    code.forEach((b) => {
      for (let i = 7; i >= 0; i--) codeBits.push((b >> i) & 1);
    });

    const path = [];
    let upward = true;
    for (let x = size - 1; x > 0; x -= 2) {
      if (x === 6) x--;
      for (let i = 0; i < size; i++) {
        const y = upward ? size - 1 - i : i;
        for (let dx = 0; dx < 2; dx++) {
          const xx = x - dx;
          if (!isReserved(m, xx, y)) path.push([xx, y]);
        }
      }
      upward = !upward;
    }
    for (let i = 0; i < path.length; i++) {
      const [x, y] = path[i];
      m[y][x] = codeBits[i] || 0;
    }

    const mask = 0;
    for (const [x, y] of path) {
      if (applyMask(mask, x, y)) m[y][x] ^= 1;
    }
    drawFormat(m, size, formatBits(mask));
    if (ver >= 7) drawVersion(m, size, versionBits(ver));
    return { m, size, ver };
  }

  function svg(text, opts) {
    const { m, size } = encode(String(text || ""));
    const px = (opts && opts.size) || 200;
    const quiet = 4;
    const dim = size + quiet * 2;
    const s = px / dim;
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (m[y][x]) d += `M${(x + quiet) * s},${(y + quiet) * s}h${s}v${s}h${-s}z`;
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" role="img" aria-label="QR-Code">` +
      `<rect width="100%" height="100%" fill="#ffffff"/>` +
      `<path fill="#111111" d="${d}"/></svg>`
    );
  }

  function mount(el, text, opts) {
    if (!el) return;
    try {
      el.innerHTML = svg(text, opts);
      el.hidden = false;
    } catch (e) {
      el.innerHTML = `<p class="hint">${String(e.message || e)}</p>`;
      el.hidden = false;
    }
  }

  global.TVQR = { svg, mount, _encode: encode };
})(typeof window !== "undefined" ? window : globalThis);
