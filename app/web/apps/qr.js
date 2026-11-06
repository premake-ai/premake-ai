// apps: a small QR code encoder for the pairing sheet (the sensor key, shown once). Byte mode, versions 1-10, error
// correction L or M, automatic mask choice; follows ISO/IEC 18004 the same way Nayuki's reference encoder does.
// No dependencies. Classic script: window.BuilderyQR in the browser, module.exports under Node (tests).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuilderyQR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // [L, M] per version (index 0 unused)
  const ECC_PER_BLOCK = [[-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]];
  const BLOCKS = [[-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]];
  const FORMAT_BITS = [1, 0]; // L = 01, M = 00
  const MAX_VERSION = 10;

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  const dataCodewords = (ver, ecl) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * BLOCKS[ecl][ver];

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z & 0xff;
  }
  function rsDivisor(degree) {
    const r = new Array(degree - 1).fill(0); r.push(1);
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift(); r.push(0);
      div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
    }
    return r;
  }

  /** UTF-8 bytes of a string. */
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(Buffer.from(String(s), 'utf8')); // eslint-disable-line no-undef
  }

  /** Encode text. Returns { size, version, ecl: 'L'|'M', mask, modules: boolean[][] (true = dark), [y][x] }. */
  function encode(text, opts = {}) {
    const bytes = utf8(String(text));
    let ecl = opts.ecl === 'L' ? 0 : 1;
    let ver = 0;
    for (let v = 1; v <= MAX_VERSION; v++) {
      const cc = v <= 9 ? 8 : 16;
      if (4 + cc + bytes.length * 8 <= dataCodewords(v, ecl) * 8) { ver = v; break; }
    }
    if (!ver && ecl === 1) return encode(text, { ...opts, ecl: 'L' });
    if (!ver) throw new Error('Text too long for a QR code here');
    // bit stream: byte mode, length, data, terminator, padding
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const cap = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    // error correction + interleaving
    const nBlocks = BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks), div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });

    // the grid
    const size = ver * 4 + 17;
    const mods = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mods[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    const drawFormat = (mask) => {
      const d = (FORMAT_BITS[ecl] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412;
      const bit = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((b >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3);
        setFn(a, c, dark); setFn(c, a, dark);
      }
    }
    // codewords in the zigzag
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < all.length * 8) { mods[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mods[y][x] = !mods[y][x]; };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const s = penalty(mods, size);
      if (s < bestScore) { best = m; bestScore = s; }
      applyMask(m); // undo (XOR)
    }
    applyMask(best); drawFormat(best);
    return { size, version: ver, ecl: ecl ? 'M' : 'L', mask: best, modules: mods };
  }

  /** The standard mask penalty (rules 1-4). Only steers the mask choice; any mask gives a valid code. */
  function penalty(m, size) {
    let s = 0;
    const line = (get) => {
      let run = 1, score = 0;
      for (let i = 1; i < size; i++) {
        if (get(i) === get(i - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
      }
      // finder-like 1:1:3:1:1 with four light modules on either side
      for (let i = 0; i + 10 < size; i++) {
        const p = [1, 0, 1, 1, 1, 0, 1].every((v, k) => get(i + k) === !!v);
        if (p && [7, 8, 9, 10].every((k) => !get(i + k))) score += 40;
        const q = [1, 0, 1, 1, 1, 0, 1].every((v, k) => get(i + 4 + k) === !!v);
        if (q && [0, 1, 2, 3].every((k) => !get(i + k))) score += 40;
      }
      return score;
    };
    for (let y = 0; y < size; y++) s += line((x) => m[y][x]);
    for (let x = 0; x < size; x++) s += line((y) => m[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) s += 3;
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    s += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return s;
  }

  /** Draw onto a canvas 2D context: dark modules in `color` on white, with a 4-module quiet zone. */
  function draw(ctx, qr, px, color = '#1c1917') {
    const n = qr.size + 8;
    ctx.canvas.width = ctx.canvas.height = n * px;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n * px, n * px);
    ctx.fillStyle = color;
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect((x + 4) * px, (y + 4) * px, px, px);
  }
  return { encode, draw };
});
