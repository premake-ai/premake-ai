'use strict';
// Build plan: a physically valid assembly order with wiring steps, derived from the model's geometry.
//
//   plan = buildPlan(dir, manifest)   -> { v, steps: [{ kind, title, text, parts, hl, wires, note }], wiring, errors }
//   validate(steps, model)            -> [error strings]   (empty = physically valid)
//
// Geometry: every part's real (assembled) bounding box, read from its STL. The case is found from the boxes: the base is
// the biggest made part, a cover is a made part that sits on one face of the base and spans most of it (a lid on top, a
// front cover, a back panel). Everything mostly inside base + covers is "inside" and must be placed, fixed and wired
// before any cover closes. A part whose box holds a smaller one goes first (battery holder before the cell). Fasteners go
// in the step of the part they fix (best box overlap; heat-set inserts into the first printed part they sit in). Wiring
// comes from wiring.json (else the table in wiring.md), grouped per peripheral, after both ends are in and before the
// lid; a loose battery cell goes in after the wiring; covers close last, then outside parts, then "Power on and test".
// The design's own ASSEMBLY order only breaks ties. validate() rejects any order that fits a part through a closed case.

const fs = require('node:fs');
const path = require('node:path');

const PLAN_V = 2;
const FAST = /\b(screws?|bolts?|nuts?|washers?|inserts?|rivets?|nails?|anchors?|shcs|bhcs|csk|grub|dowels?|hinge pins?)\b|\bm[2-8]\s*[x×]\s*\d/i;
const CAPTIVE = /\b(heat-?set|threaded)\s+inserts?\b|\binserts?\b/i; // pressed into the printed part before anything else
const YOURS = /\((yours|ref|reference)\)|\byours\b/i;
const COVER = /\blid\b|cover|\bcap\b|\btop\b|bezel|door|\bpanel\b|shroud|face ?plate|diffuser|\blens\b|\bhood\b/i;
const CELL = /\b(18650|21700|14500|li-?ion cell|lipo|li-?po|aaa?\b|aaa? batter(y|ies)|cr2032|coin cell)\b/i;
const HOLDER = /holder|contacts?|clip|bay|box|sled|case/i;
const ELEC = /pcb|\bboard\b|module|esp32|esp8266|arduino|pico|xiao|driver|tmc\d|a4988|uln2003|sensor|motor|stepper|nema|battery|\bcell\b|18650|lipo|\bleds?\b|ws2812|neopixel|switch|jack|buck|boost|relay|oled|lcd|display|\bfan\b|speaker|buzzer|piezo|usb|tp4056|charger|mp1584|lm2596|servo|sg90|button|tact|encoder|potentiometer|matrixportal|matrix/i;
const PASSIVE = /\b(resistor|capacitor|diode|ferrite|transistor|mosfet|[12]n\d{4}\w*|pn2222\w*|2n7000|irlz\w*|\d+(\.\d+)?\s?k(ohm|Ω)?\b|\d+\s?[nuµp]f\b|ohm)/i;
const POWER_PIN = /^(gnd|ground|0v|vcc|vdd|vbus|vin|v\+|v-|\+|-|−|b\+|b-|out\+|out-|in\+|in-|3v3|3\.3 ?v|5 ?v|12 ?v|bat\+?|bat-)$/i;
const COLORS = ['red', 'black', 'white', 'yellow', 'green', 'blue', 'orange', 'purple', 'brown', 'grey', 'gray', 'pink'];

// ---------------------------------------------------------------- geometry
const boxCache = new Map(); // abs file -> { k, box }
/** Axis-aligned bounds of an STL (binary or ASCII), or null. */
function stlBox(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size > 150e6) return null;
  const k = `${st.mtimeMs}:${st.size}`, hit = boxCache.get(file);
  if (hit && hit.k === k) return hit.box;
  let buf; try { buf = fs.readFileSync(file); } catch { return null; }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const add = (x, y, z) => { if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return; const v = [x, y, z]; for (let i = 0; i < 3; i++) { if (v[i] < min[i]) min[i] = v[i]; if (v[i] > max[i]) max[i] = v[i]; } };
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
  if (n >= 0 && 84 + 50 * n === buf.length) {
    for (let t = 0; t < n; t++) { const o = 84 + 50 * t + 12; for (let j = 0; j < 3; j++) add(buf.readFloatLE(o + 12 * j), buf.readFloatLE(o + 12 * j + 4), buf.readFloatLE(o + 12 * j + 8)); }
  } else {
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, s = buf.toString('latin1'); let m;
    while ((m = re.exec(s))) add(+m[1], +m[2], +m[3]);
  }
  const box = Number.isFinite(min[0]) ? { min, max } : null;
  boxCache.set(file, { k, box });
  if (boxCache.size > 4000) boxCache.delete(boxCache.keys().next().value);
  return box;
}
/** A part file inside the design folder only (manifest paths are agent-written). */
function partFile(dir, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  try {
    const root = fs.realpathSync(dir), real = fs.realpathSync(path.join(dir, rel));
    return real.startsWith(root + path.sep) ? real : null;
  } catch { return null; }
}
const size = b => [0, 1, 2].map(i => b.max[i] - b.min[i]);
const center = b => [0, 1, 2].map(i => (b.max[i] + b.min[i]) / 2);
const vol = b => size(b).reduce((a, x) => a * Math.max(x, 0.5), 1);
const ov1 = (b, c, i) => Math.max(0, Math.min(b.max[i], c.max[i]) - Math.max(b.min[i], c.min[i]));
const interVol = (b, c) => ov1(b, c, 0) * ov1(b, c, 1) * ov1(b, c, 2);
const frac = (b, c) => interVol(b, c) / Math.max(1e-6, size(b).reduce((a, x) => a * x, 1)); // share of b inside c
const inBox = (p, b, pad = 0) => [0, 1, 2].every(i => p[i] >= b.min[i] - pad && p[i] <= b.max[i] + pad);
const grow = (b, d) => ({ min: b.min.map(v => v - d), max: b.max.map(v => v + d) });
const union = (a, b) => ({ min: a.min.map((v, i) => Math.min(v, b.min[i])), max: a.max.map((v, i) => Math.max(v, b.max[i])) });
const touch = (b, c, d = 0.6) => [0, 1, 2].every(i => b.min[i] <= c.max[i] + d && c.min[i] <= b.max[i] + d);

// ---------------------------------------------------------------- names
const clean = n => String(n).replace(/\s[×x]\s?\d+(\s*\(\d+\))?$/i, '').replace(/\s*\((yours|ref|reference|\d+)\)\s*$/i, '').trim();
const short = n => clean(n).replace(/\s*\([^)]*\)\s*$/, '').replace(/,.*$/, '').replace(/\s*->\s*/g, ' → ').trim() || clean(n);
const family = n => { const f = clean(n).replace(/\s+#?\d+[a-z]?$/i, '').replace(/^(left|right|front|rear|top|bottom)\s+/i, '').replace(/\s+(left|right)$/i, '').trim() || clean(n); return f; };
const qty = n => { const m = String(n).match(/\s[×x]\s?(\d+)$/i) || String(n).match(/\((\d+)\s*[x×]\)$/i); return m ? +m[1] : 1; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const joinList = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
const the = n => (/^(your|the|a|an)\b/i.test(n) ? n : `the ${n}`);
const GENERIC = new Set(['board', 'module', 'pin', 'pins', 'with', 'and', 'the', 'for', 'of', 'v', 'mm', 'x', 'kit', 'cable', 'wire', 'breakout', 'mini']);
/** A wiring name ("ESP32", "Push button", "OLED") -> the model part it means, or null. */
function matchPart(name, parts) {
  const n = String(name || '').trim(); if (!n) return null;
  const k = norm(clean(n));
  const exact = parts.find(p => p.name === n) || parts.find(p => norm(clean(p.name)) === k) || parts.find(p => norm(short(p.name)) === norm(short(n)));
  if (exact) return exact;
  const toks = k.split(' ').filter(t => t.length >= 2 && !GENERIC.has(t));
  if (!toks.length) return null;
  let best = null, bs = 0;
  for (const p of parts) {
    if (FAST.test(p.name)) continue;
    const pt = new Set(norm(p.name).split(' ')), joined = norm(p.name).replace(/ /g, '');
    let hit = 0, strong = false;
    for (const t of toks) { if (pt.has(t) || (t.length >= 4 && joined.includes(t))) { hit++; if (/\d/.test(t) || t.length >= 4) strong = true; } }
    const s = hit / toks.length;
    if (strong && s >= 0.5 && s > bs) { bs = s; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- wiring
/** wiring.json, else the markdown table in wiring.md -> { wires, source } (wires may be []). */
function readWiring(dir) {
  const j = readJSON(path.join(dir, 'wiring.json'));
  if (j && Array.isArray(j.wires)) {
    const wires = j.wires.filter(w => w && w.from && w.to && w.from.part && w.to.part).slice(0, 400).map(w => ({
      from: { part: String(w.from.part), pin: String(w.from.pin ?? '') }, to: { part: String(w.to.part), pin: String(w.to.pin ?? '') },
      color: COLORS.includes(String(w.color || '').toLowerCase()) ? String(w.color).toLowerCase() : guessColor(w.from.pin, w.to.pin),
      kind: String(w.kind || '').slice(0, 30), note: typeof w.note === 'string' ? w.note.slice(0, 120) : '' }));
    return { wires, source: 'wiring.json' };
  }
  let md = null; try { md = fs.readFileSync(path.join(dir, 'wiring.md'), 'utf8'); } catch {}
  if (md) return { wires: parseWiringMd(md), source: 'wiring.md' };
  return { wires: [], source: null };
}
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function guessColor(a, b) {
  const s = `${a} ${b}`;
  if (/\b(gnd|ground|0v)\b|(^|\s)(-|−)(\s|$)|\bb-|\bout-|\bin-|\bv-|\bbat-/i.test(s)) return 'black';
  if (/\b(vcc|vdd|vin|vbus|3v3|3\.3 ?v|5 ?v|12 ?v)\b|\+/i.test(s)) return 'red';
  return '';
}
/** | From | Pin | To | Pin | Wire | rows -> wires. "GPIO21 / GPIO22 | OLED | SDA / SCL" splits into two. */
function parseWiringMd(md) {
  const out = [];
  let cols = null;
  for (const line of String(md).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) { cols = null; continue; }
    const cells = t.replace(/^\||\|$/g, '').split('|').map(c => c.replace(/\*\*/g, '').trim());
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || !c)) continue;
    const low = cells.map(c => c.toLowerCase());
    if (low.includes('from') && low.includes('to')) {
      const f = low.indexOf('from'), to = low.indexOf('to');
      cols = { f, fp: low[f + 1] === 'pin' ? f + 1 : -1, t: to, tp: low[to + 1] === 'pin' ? to + 1 : -1, w: low.findIndex((c, i) => i > to && /wire|cable|colou?r|type|connector/.test(c)) };
      continue;
    }
    if (!cols) continue;
    const g = i => (i >= 0 ? cells[i] || '' : '');
    const fa = g(cols.f), ta = g(cols.t);
    if (!fa || !ta) continue;
    const wire = g(cols.w);
    const fps = g(cols.fp).split(/\s+\/\s+/), tps = g(cols.tp).split(/\s+\/\s+/);
    const pairs = fps.length > 1 && fps.length === tps.length ? fps.map((p, i) => [p, tps[i]]) : [[g(cols.fp), g(cols.tp)]];
    const col = (wire.toLowerCase().match(new RegExp(`\\b(${COLORS.join('|')})\\b`)) || [])[1] || '';
    const kind = (wire.match(/dupont|jst[\w -]*?(?=\s|$)|qwiic|stemma|screw terminal|wago|solder|\d+\s?awg|plug|supplied cable|direct plug-in|crimp/i) || [''])[0];
    for (const [fp, tp] of pairs) {
      const net = !tp.trim() && POWER_PIN.test(ta); // "| BH1750 | ADDR | GND | |": tie a pin to a rail on the same board
      out.push({ from: { part: fa, pin: fp.replace(/[–—]/g, '-').trim() }, to: net ? { part: fa, pin: ta } : { part: ta, pin: tp.replace(/[–—]/g, '-').trim() },
        color: pairs.length > 1 && /\//.test(wire) ? guessColor(fp, tp) : col || guessColor(fp, tp), kind: kind.trim(), note: '' });
    }
    if (out.length >= 400) break;
  }
  return out;
}

// ---------------------------------------------------------------- the model
/** manifest parts + real boxes -> roles. Exported for tests (pass parts with .box already set). */
function analyse(parts, opts = {}) {
  const P = parts.map((p, i) => ({ ...p, i, fast: FAST.test(p.name), yours: YOURS.test(p.name), made: p.group !== 'component' && !YOURS.test(p.name) }));
  const withBox = P.filter(p => p.box);
  const made = withBox.filter(p => p.made && !p.fast).sort((a, b) => vol(b.box) - vol(a.box));
  const base = made[0] || null;
  const covers = [];
  if (base) {
    const B = base.box, sb = size(B), cb = center(B);
    for (const m of made) {
      if (m === base) continue;
      const M = m.box, sm = size(M);
      let best = null;
      for (let a = 0; a < 3; a++) {
        const [b1, b2] = [0, 1, 2].filter(i => i !== a);
        const ov = ov1(M, B, b1) * ov1(M, B, b2), aB = sb[b1] * sb[b2], aM = sm[b1] * sm[b2];
        if (!(ov / Math.max(1e-6, Math.min(aB, aM)) >= 0.6 && ov / Math.max(1e-6, aB) >= 0.35)) continue;
        const sign = center(M)[a] >= cb[a] ? 1 : -1;
        const outer = sign > 0 ? M.max[a] >= B.max[a] - 1.5 && M.min[a] <= B.max[a] + 3 : M.min[a] <= B.min[a] + 1.5 && M.max[a] >= B.min[a] - 3;
        if (!outer || sm[a] > 0.8 * sb[a] || Math.abs(center(M)[a] - cb[a]) < 0.2 * sb[a] || frac(M, B) >= 0.95) continue; // fully inside: a window dropped in from the open side
        const score = ov / aB;
        if (!best || score > best.score) best = { a, sign, score };
      }
      if (!best && COVER.test(m.name) && touch(m.box, B)) { // named a lid / cover and on the base: its explode says which way it lifts off
        const e = (m.explode || [0, 0, 1]).map(Number), a = [0, 1, 2].reduce((x, y) => Math.abs(e[y]) > Math.abs(e[x]) ? y : x, 0);
        best = { a, sign: Math.sign(e[a]) || 1, score: 0 };
      }
      if (best) covers.push(Object.assign(m, { cover: best }));
    }
  }
  /** Mounted in the cover (a button through the lid, a display behind its window): overlaps the cover and reaches the
   * opening (or, for a lid that sits down inside the base's box, sticks out past the base). */
  function onCover(b, c, B) {
    if (frac(b, c.box) < 0.2) return false;
    const { a, sign } = c.cover, inset = frac(c.box, B) >= 0.6 && ov1(c.box, B, a) >= 0.3 * size(B)[a];
    if (sign > 0) return inset ? b.max[a] > B.max[a] + 0.3 : b.max[a] >= B.max[a] - 1;
    return inset ? b.min[a] < B.min[a] - 0.3 : b.min[a] <= B.min[a] + 1;
  }
  let region = covers.length ? covers.reduce((r, c) => union(r, c.box), base.box) : null;
  // a case only when something bought sits inside it (a frame of rails and a top is not a case)
  if (region && !withBox.some(p => p !== base && !p.cover && !p.made && !p.fast && !p.yours && frac(p.box, region) >= 0.5)) {
    for (const c of covers) delete c.cover;
    covers.length = 0; region = null;
  }
  for (const p of P) {
    if (p === base || p.cover || !p.box) continue;
    p.inside = !!region && !p.yours && frac(p.box, region) >= 0.5;
    p.onCover = p.inside ? covers.find(c => onCover(p.box, c, base.box)) || null : null;
  }
  return { P, base, covers, region };
}

// ---------------------------------------------------------------- the plan
function buildPlan(dir, man, opts = {}) {
  const parts = (man?.parts || []).filter(p => p && p.name).map(p => {
    const f = partFile(dir, p.file);
    return { name: String(p.name), group: p.group, process: p.process, explode: p.explode, file: p.file, box: f ? stlBox(f) : null };
  });
  const wiring = opts.wiring || readWiring(dir);
  return plan(parts, wiring, { declared: man?.assembly_order || man?.steps, firmware: opts.firmware ?? fs.existsSync(path.join(dir, 'firmware')) });
}

/** parts: [{name, group, box:{min,max}|null, explode}], wiring: {wires, source}. Pure (tests call this). */
function plan(parts, wiring = { wires: [] }, opts = {}) {
  const A = analyse(parts);
  const { P, base, covers } = A;
  const declIdx = new Map();
  (Array.isArray(opts.declared) ? opts.declared : []).forEach((st, i) => (Array.isArray(st) ? st : Array.isArray(st?.parts) ? st.parts : [st]).forEach(n => {
    const p = P.find(q => q.name === String(n) || q.name.startsWith(String(n) + ' (') || clean(q.name) === clean(n)); if (p && !declIdx.has(p)) declIdx.set(p, i);
  }));
  const fasteners = P.filter(p => p.fast && !p.yours);
  const body = P.filter(p => !fasteners.includes(p));
  const electronics = body.some(p => p.group === 'component' && ELEC.test(p.name)) || (wiring.wires || []).length > 0;

  // wires -> groups per peripheral, endpoints mapped onto model parts
  const wires = (wiring.wires || []).map(w => ({ ...w, a: matchPart(w.from.part, body), b: matchPart(w.to.part, body) }));
  const wireGroups = groupWires(wires);
  const wiredParts = new Set(wires.flatMap(w => [w.a, w.b]).filter(Boolean));

  // a loose cell that sits in a holder (not wired itself) goes in after the wiring
  const holderOf = c => body.find(h => h !== c && h.box && c.box && HOLDER.test(h.name) && !/case|box/i.test(h.name) && (frac(c.box, grow(h.box, 2)) >= 0.5 || touch(c.box, h.box, 2)));
  const cells = body.filter(p => CELL.test(p.name) && !/holder|contacts?|clip|charger|tp4056|bay|sled/i.test(p.name) && !wiredParts.has(p) && holderOf(p));

  // rank: 0 base, 1 made inside, 2 inside components, 3 wiring, 4 cells, 5 covers, 6 outside, 7 yours, 8 test
  const rank = p => p === base ? 0 : p.cover ? 5 : p.yours ? 7 : cells.includes(p) ? 4 : p.inside ? (p.made ? 1 : 2) : base && covers.length ? 6 : p.made ? 1 : 2;
  // precedence edges (a before b) from geometry
  const before = new Map(body.map(p => [p, new Set()])); // b -> set of parts that must come first
  for (const a of body) for (const b of body) {
    if (a === b || !a.box || !b.box || a.yours || b.yours || a.cover || b === base) continue;
    if (vol(a.box) > 1.15 * vol(b.box) && inBox(center(b.box), a.box) && frac(b.box, a.box) >= 0.6 && rank(a) <= rank(b)) before.get(b).add(a); // container first
    else if (!a.made && !a.cover && b.made && !b.cover && vol(b.box) < vol(a.box) && interVol(a.box, b.box) > 0.15 * vol(b.box)) { before.get(b).add(a); if (!b.mountOn || vol(a.box) < vol(b.mountOn.box)) b.mountOn = a; } // a sprocket on a motor shaft, a knob on a pot
  }
  for (const c of covers) for (const p of body) if (p.inside && rank(p) < 5) before.get(c).add(p);
  // wired parts outside the case (a probe through the wall) still go in before the cover that hides their other end
  for (const p of wiredParts) if (!p.inside && p !== base && !p.cover && covers.length && rank(p) === 6) {
    const other = wires.filter(w => w.a === p || w.b === p).map(w => (w.a === p ? w.b : w.a)).filter(Boolean);
    if (other.some(o => o.inside || o === base)) p.wiredIn = true;
  }
  const lift = p => { for (const q of before.get(p) || []) if (!q.cover && q !== base && !q.wiredIn && rank(q) > 2.5) { q.wiredIn = true; lift(q); } };
  for (const p of body) if (p.wiredIn) lift(p); // and whatever they sit in (a speaker in the lower shell)
  const rk = p => (p.wiredIn ? 2.5 : rank(p));
  // order: topological sort by (rank, declared step, depth from the opening, bigger first)
  const depth = p => { // inside parts: furthest from the cover opening first, cover-mounted parts last
    if (!p.inside || !covers.length || !p.box) return 0;
    const c = p.onCover?.cover || covers[0].cover, cb = center(p.box)[c.a];
    return (p.onCover ? 1e5 : 0) + c.sign * cb;
  };
  const key = p => [rk(p), declIdx.has(p) ? declIdx.get(p) : 99, Math.round(depth(p)), -(p.box ? vol(p.box) : 0), p.i];
  const cmp = (x, y) => { const a = key(x), b = key(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const order = [], done = new Set(), left = [...body];
  while (left.length) {
    const ready = left.filter(p => [...before.get(p)].every(q => done.has(q) || !left.includes(q)));
    const pick = (ready.length ? ready : left).sort(cmp)[0]; // a cycle (odd geometry): fall back to the ranking
    order.push(pick); done.add(pick); left.splice(left.indexOf(pick), 1);
  }

  // steps: one per part, same-family neighbours of one rank merged ("Shelf 1", "Shelf 2"), cover-mounted ones together
  const steps = [];
  for (const p of order) {
    const prev = steps[steps.length - 1];
    const sameKind = prev && prev.kind === 'place' && prev.rank === rk(p) && !p.cover && !prev.items.some(q => q.cover) && p !== base && !prev.items.includes(base)
      && (family(prev.items[0].name) === family(p.name) || (p.onCover && prev.items.every(q => q.onCover === p.onCover)) || (rk(p) === 4));
    if (sameKind) prev.items.push(p); else steps.push({ kind: 'place', rank: rk(p), items: [p] });
  }
  // fasteners: inserts into the first printed part they sit in; screws into the part they overlap most (later on a tie)
  const posOf = p => steps.findIndex(s => s.items.includes(p));
  for (const f of fasteners) {
    let target = null;
    const cands = f.box ? body.filter(p => p.box && !p.yours && touch(f.box, p.box, 0.5)) : [];
    if (CAPTIVE.test(f.name) && !/\bnuts?\b/i.test(f.name)) { // heat-set inserts: pressed into their printed part first thing (prep, with the base)
      const host = cands.filter(p => p.made).sort((a, b) => interVol(f.box, b.box) - interVol(f.box, a.box) || posOf(a) - posOf(b))[0] || base;
      const s0 = host ? steps[posOf(base || host)] : null;
      if (s0) { (s0.prep = s0.prep || []).push({ f, host }); continue; }
    }
    if (!target && f.box) { // a screw pattern that spans most of a cover's face: the cover's screws
      target = covers.find(c => { const [b1, b2] = [0, 1, 2].filter(i => i !== c.cover.a), sc = size(c.box); return frac(f.box, grow(c.box, 1)) >= 0.25 && ov1(f.box, c.box, b1) >= 0.7 * sc[b1] && ov1(f.box, c.box, b2) >= 0.7 * sc[b2]; }) || null;
    }
    if (!target && cands.length) { // screws fix the smallest part they mostly sit in to the bigger one (lid screws: the lid)
      const sc = cands.map(p => ({ p, s: frac(f.box, p.box) }));
      const most = sc.filter(x => x.s >= 0.4).sort((a, b) => vol(a.p.box) - vol(b.p.box));
      target = (most[0] || sc.sort((a, b) => b.s - a.s)[0]).p;
    }
    if (!target && f.box) target = body.filter(p => p.box).sort((a, b) => dist(f.box, a.box) - dist(f.box, b.box))[0] || null;
    const s = target ? steps[posOf(target)] : null;
    f.target = target;
    if (s) (s.fast = s.fast || []).push(f); else steps.push({ kind: 'place', rank: 6, items: [], fast: [f] });
  }

  // each wire group goes after both of its ends are in (and no earlier than the wiring slot: everything inside fitted)
  const wireAt = (i => (i < 0 ? steps.length : i))(steps.findIndex(s => s.rank >= 3));
  const slots = new Map();
  for (const g of wireGroups) {
    const at = Math.max(wireAt, ...g.parts.map(p => posOf(p) + 1));
    if (!slots.has(at)) slots.set(at, []); slots.get(at).push({ kind: 'wire', group: g });
  }
  if (electronics && !wires.length) { if (!slots.has(wireAt)) slots.set(wireAt, []); slots.get(wireAt).push({ kind: 'wire', missing: true }); }
  const out = [];
  for (let i = 0; i <= steps.length; i++) { out.push(...(slots.get(i) || [])); if (i < steps.length) out.push(steps[i]); }
  if (electronics && opts.firmware) out.push({ kind: 'flash' }); // firmware: "Flash to my ESP32" from the studio (server/firmware.js)
  if (electronics) out.push({ kind: 'test' });

  const steps2 = out.map((s, i) => describe(s, i, { base, covers, wiring, firmware: opts.firmware, P }));
  const model = { base: base ? id(base) : null, covers: covers.map(id), inside: P.filter(p => p.inside && !p.fast).map(id), before: [...before].flatMap(([b, s]) => [...s].map(a => [id(a), id(b)])) };
  const errors = validate(steps2, model);
  return { v: PLAN_V, steps: steps2, model, errors, wiring: { source: wiring.source || null, wires: wires.length, missing: electronics && !wires.length, list: wireList(wires) } };
}
/** Every wire for the 3D wiring view: both ends with the model part they map to (null: not in the model). */
function wireList(wires) {
  const end = (e, p) => ({ part: e.part, pin: e.pin, model: p ? p.name : null, file: p?.file || null });
  return wires.map(w => ({ from: end(w.from, w.a), to: end(w.to, w.b), color: w.color || '', kind: w.kind || '', note: w.note || '' }));
}

const id = p => p.file || p.name;
const dist = (b, c) => Math.hypot(...[0, 1, 2].map(i => Math.max(0, b.min[i] - c.max[i], c.min[i] - b.max[i])));

/** Wires -> [{ parts: [model parts], wires }]: one group per peripheral (the end with fewer connections). Small parts
 * (resistors, capacitors, transistors) join each other when they share a pin or a part, then the peripheral group that
 * shares their signal pin (a probe's divider goes with the probe jack), else they get a step of their own. */
function groupWires(wires) {
  if (!wires.length) return [];
  const deg = new Map();
  for (const w of wires) for (const e of [w.from.part, w.to.part]) deg.set(norm(e), (deg.get(norm(e)) || 0) + 1);
  const passive = n => PASSIVE.test(n);
  const desig = pin => (String(pin).match(/^([A-Z]{1,2}\d{1,3})\s+\S+$/) || [])[1] || ''; // "C1 a" -> C1 (two caps under one name)
  const shown = new Map(); // wiring name -> model part name (when it maps)
  for (const w of wires) { if (w.a) shown.set(w.from.part, w.a.name); if (w.b) shown.set(w.to.part, w.b.name); }
  const groups = new Map();
  for (const w of wires) {
    const f = w.from.part, t = w.to.part;
    let periph;
    if (passive(f) !== passive(t)) periph = passive(f) ? f : t;
    else periph = (deg.get(norm(f)) || 0) <= (deg.get(norm(t)) || 0) ? f : t;
    const hub = periph === f ? t : f, pp = periph === f ? w.from.pin : w.to.pin;
    const k = passive(periph) ? `p:${norm(periph)}:${desig(pp)}` : norm(periph) + '|' + norm(hub);
    if (!groups.has(k)) groups.set(k, { periph, hub, passive: passive(periph), wires: [], extra: [] });
    groups.get(k).wires.push(w);
  }
  const list = [...groups.values()];
  const ends = g => g.wires.flatMap(w => [[w.from.part, w.from.pin], [w.to.part, w.to.pin]]);
  const sig = g => new Set(ends(g).filter(([p, pin]) => !passive(p) && !POWER_PIN.test(String(pin).trim())).map(([p, pin]) => norm(p) + ':' + norm(pin)));
  const sigAll = g => new Set([...sig(g), ...ends(g).filter(([p]) => passive(p)).map(([p, pin]) => `${norm(p)}:${desig(pin) || '*'}`)]);
  const meets = (x, y) => { for (const v of x) if (y.has(v)) return true; return false; };
  let changed = true;
  while (changed) { // small parts into clusters
    changed = false;
    const ps = list.filter(x => x.passive && !x.dead);
    for (const g of ps) for (const h of ps) {
      if (g === h || g.dead || h.dead || list.indexOf(h) > list.indexOf(g) || !meets(sigAll(g), sigAll(h))) continue;
      h.wires.push(...g.wires); h.extra.push(g.periph, ...g.extra); g.dead = true; changed = true;
    }
  }
  for (const g of list.filter(x => x.passive && !x.dead)) { // a cluster joins the peripheral that shares its signal
    const host = list.find(h => !h.passive && !h.dead && meets(sig(h), sig(g)));
    if (host) { host.wires.push(...g.wires); host.extra.push(g.periph, ...g.extra); g.dead = true; }
  }
  const live = list.filter(g => !g.dead);
  // power first (battery, charger, regulator), then the rest in wiring order
  const isPower = g => /batter|18650|\bcell\b|lipo|charger|tp4056|buck|boost|mp1584|lm2596|fuse|dc jack|barrel|supply|psu|wago/i.test(g.periph + ' ' + g.hub) && g.wires.some(w => POWER_PIN.test(w.from.pin) || POWER_PIN.test(w.to.pin));
  const name = n => shown.get(n) || n;
  return live.map((g, i) => ({ ...g, i, power: isPower(g) })).sort((a, b) => (b.power - a.power) || a.i - b.i)
    .map(g => ({ periph: name(g.periph), hub: name(g.hub), passive: g.passive, extra: [...new Set(g.extra.map(short))].filter(x => x !== short(g.periph)),
      wires: g.wires.map(w => ({ ...w, from: { ...w.from, part: name(w.from.part) }, to: { ...w.to, part: name(w.to.part) } })),
      parts: [...new Set(g.wires.flatMap(w => [w.a, w.b]).filter(Boolean))] }));
}

const pinStr = p => String(p || '').trim() || 'its pin';
function wireLine(w, g) {
  const fp = norm(w.from.part), tp = norm(w.to.part), per = norm(g.periph), hub = norm(g.hub);
  const pair = !g.passive && !(g.extra || []).length && ((fp === per && tp === hub) || (fp === hub && tp === per));
  const [a, b] = fp === hub && tp === per ? [w.to, w.from] : [w.from, w.to];
  const txt = pair ? `${pinStr(a.pin)} → ${pinStr(b.pin)}` : `${short(a.part)} ${pinStr(a.pin)} → ${short(b.part)} ${pinStr(b.pin)}`;
  return { from: { part: a.part, pin: a.pin }, to: { part: b.part, pin: b.pin }, color: w.color || '', kind: w.kind || '', text: txt };
}
function kindNote(ws) {
  const k = [...new Set(ws.map(w => String(w.kind || '').toLowerCase()).filter(Boolean))];
  if (!k.length) return '';
  const say = { solder: 'solder each joint', dupont: 'Dupont jumper leads', jst: 'JST plugs', qwiic: 'Qwiic cable', 'screw terminal': 'screw terminals', wago: 'Wago connectors' };
  const t = k.map(x => say[x] || (/awg/.test(x) ? `${x} wire` : x)).slice(0, 2).join(', ');
  return t[0].toUpperCase() + t.slice(1);
}

/** A step -> { kind, title, text, parts (added), hl (shown highlighted), wires, note }. */
// ---------------------------------------------------------------- "Power on and test"
/** What to check, per kind of part this design actually has: [name regex, check (n = that part's short name, all =
 * every part name), skip-if regex]. Most specific first; one check per row; a part feeds the first row it matches. */
const CHECKS = [
  [/thermal printer|receipt printer|\bprinter\b/i, n => `the ${n} feeds paper and prints a test page`],
  [/\bmic(rophone)?\b|inmp441|max9814|ics-?43434|sph0645/i, () => 'the microphone hears you (speak and watch it react)'],
  [/camera|ov2640|ov5640|esp32-?cam/i, () => 'the camera picture comes through'],
  [/oled|lcd|e-?ink|e-?paper|tft|\bdisplay\b|\bscreen\b|led matrix|matrixportal|hub75/i, n => `the ${n} shows its start screen`],
  [/magsafe|charger puck|charging puck|qi\b|wireless charg/i, n => `your phone starts charging on the ${n}`],
  [/peltier|\btec\b|tec1/i, () => 'the Peltier plate turns cold on one side within a minute'],
  [/\bpump\b/i, n => `the ${n} moves water (fill the tank first, never run it dry)`],
  [/solenoid|\block\b|latch/i, n => `the ${n} opens and closes`],
  [/\brelay\b/i, n => `the ${n} clicks on and off`],
  [/\bheater|heating (pad|element)|nichrome/i, n => `the ${n} warms up (touch it briefly)`],
  [/\bfan\b/i, n => `the ${n} spins and blows the right way`],
  [/stepper|nema|28byj/i, (n, all) => `the ${n} moves ${/belt|carriage|slider|axis/i.test(all) ? 'the carriage the full length' : /blind|chain/i.test(all) ? 'the blind up and down' : 'smoothly'} with no skipped steps`],
  [/\bservo\b|sg90|mg90|mg996/i, (n, all) => /head|tilt|nod/i.test(all) ? 'the head tilts and nods smoothly without hitting anything' : `the ${n} sweeps its full range without hitting anything`],
  [/vibration|vibe motor|haptic/i, () => 'it buzzes when it should'],
  [/n20|gear ?motor|dc motor|\bmotor\b/i, (n, all) => /track/i.test(all) ? 'it drives forward, back and turns both ways on its tracks' : /wheel/i.test(all) ? 'the wheels drive it forward, back and round' : /auger|hopper|feeder|dispens/i.test(all) ? `the ${n} turns the auger and a portion drops out` : `the ${n} runs both ways`],
  [/cliff|tcrt5000|edge sensor/i, () => 'it stops when you hold it over the edge of the desk (cliff sensors)'],
  [/\bpir\b|motion sensor|hc-?sr501|radar/i, () => 'it reacts when you wave a hand in front of it'],
  [/ultrasonic|hc-?sr04|tof\b|vl53/i, () => 'the distance reading changes as you move your hand closer'],
  [/soil|moisture/i, () => 'the moisture reading jumps when the probe goes into wet soil'],
  [/probe|thermistor|ds18b20|thermocouple|max31855|max6675|ntc/i, n => `the ${n} reads room temperature (about 20 °C), then rises in your hand`],
  [/bme|bmp|dht|sht\d|aht\d|hdc\d/i, () => 'the temperature and humidity readings look like the room'],
  [/bh1750|light sensor|ldr|photoresistor|tsl25/i, () => 'the light reading drops when you cover the sensor'],
  [/load cell|hx711/i, () => 'the weight reads zero empty and changes when you press on it'],
  [/\bleds?\b|ws2812|neopixel|led strip|light strip|cob\b/i, n => (/strip|ws2812|neopixel|ring/i.test(n) ? `the ${n} lights up` : 'the LEDs light up'), /matrix|hub75|panel|display/i],
  [/buzzer|piezo/i, n => `the ${n} beeps`],
  [/speaker|max98357|amp(lifier)?\b/i, () => 'sound comes out of the speaker'],
  [/encoder|potentiometer|\bknob\b/i, n => `turning the ${n} changes the setting`, /motor/i],
  [/push ?button|tact|\bbutton\b/i, n => `pressing the ${n} does its job`, /button head/i],
];
/** The design's own "Power on and test": how it is powered and what its parts should do. Neutral only when nothing is known. */
function testText(ctx) {
  const parts = ctx.P.filter(p => !p.yours && !p.fast).map(p => p.name);
  const wired = (ctx.wiring?.wires || []).flatMap(w => [w.from?.part, w.to?.part]).filter(Boolean).map(String);
  const all = [...parts, ...wired].join(' | ') + ' | ' + ctx.P.filter(p => p.yours).map(p => p.name).join(' | ');
  const used = new Set(), checks = [];
  for (const [re, say, skip] of CHECKS) {
    const n = [...parts, ...wired].find(x => re.test(x) && !(skip && skip.test(x)) && !used.has(x));
    if (!n) continue;
    used.add(n);
    const c = say(short(n).replace(/\s*×\s*\d+$/, ''), all);
    if (!checks.includes(c)) checks.push(c);
  }
  const has = re => re.test(all);
  const swOk = n => !/limit|micro ?switch|reed|module|mosfet|charger/i.test(n);
  const sw = parts.find(n => /rocker|slide switch|toggle|power switch/i.test(n) && swOk(n)) || parts.find(n => /\bswitch\b/i.test(n) && swOk(n));
  const usbc = has(/usb-?c/i);
  let power;
  if (has(/18650|21700|lipo|li-?po|li-?ion|\bcell\b|battery/i)) power = `Charge it${usbc ? ' over USB-C' : ''}, then switch it on${sw ? ` with the ${short(sw)}` : ''}`;
  else if (has(/\bpd\b|pd trigger|power delivery/i)) power = 'Plug in a USB-C PD charger';
  else if (has(/barrel|dc jack|\bpsu\b|power supply|12 ?v|24 ?v|adapter/i)) power = 'Plug in the power supply';
  else power = usbc ? 'Plug in a USB-C cable' : 'Plug in the power';
  if (sw && !/switch it on/.test(power)) power += ` and switch it on with the ${short(sw)}`;
  const flash = ''; // firmware: its own step now ("Flash the firmware", just before this one)
  if (!checks.length) return `${flash}${power}. Check that it starts up and nothing gets hot. If it doesn't, check the wiring before anything else.`;
  return `${flash}${power}. Check that ${joinList(checks.slice(0, 5))}. If anything is dead, open it up and check the wiring before anything else.`;
}

function describe(s, i, ctx) {
  const { base } = ctx;
  if (s.kind === 'wire') {
    if (s.missing) return { kind: 'wire', title: 'Wire the electronics', text: 'Wiring missing: this design has no pin-to-pin list (wiring.json) yet. Ask the agent to add it, then rewrite these steps. Wire everything before closing the case.', parts: [], hl: [], wires: [], missing: true };
    const g = s.group, ws = g.wires.map(w => wireLine(w, g));
    const SIG = ['yellow', 'green', 'blue', 'orange', 'white', 'purple'];
    ws.filter(w => !w.color).forEach((w, k) => { w.color = SIG[k % SIG.length]; w.guess = true; }); // the list gave no colour: a suggestion, drawn but not named
    const extra = g.extra.length ? ` with the ${joinList(g.extra)}` : '';
    const title = g.passive ? `Add the ${short(g.periph)}${extra}` : norm(g.periph) === norm(g.hub) ? `Wire up the ${short(g.periph)}` : `Connect ${the(short(g.periph))}${extra} to ${the(short(g.hub))}`;
    const note = kindNote(g.wires);
    const list = ws.map(w => `${w.text}${w.color && !w.guess ? ` ${w.color}` : ''}`).join(', ');
    return { kind: 'wire', title: g.passive ? title : title.replace(extra, ''), text: `${title}: ${list}.${note ? ` ${note}.` : ''}`, note, parts: [], ids: [], hl: g.parts.map(p => p.name), hlIds: g.parts.map(id), wires: ws };
  }
  if (s.kind === 'flash') return { kind: 'flash', title: 'Flash the firmware', text: 'Plug the board into a computer with a USB data cable. Open this design in Premake in Chrome or Edge, go to Assemble and click Flash to my ESP32, then pick the board\'s port; if it asks, type your Wi-Fi name and password. No Chrome? Download the firmware and upload it with the Arduino IDE.', parts: [], hl: [], wires: [] };
  if (s.kind === 'test') return { kind: 'test', title: 'Power on and test', text: testText(ctx), parts: [], hl: [], wires: [] };
  const items = s.items, fast = s.fast || [];
  const fl = [...fast.reduce((m, f) => m.set(clean(f.name), (m.get(clean(f.name)) || 0) + qty(f.name)), new Map())].map(([l, n]) => (n > 1 ? `${n} × ${l}` : l));
  const fams = [...items.reduce((m, p) => m.set(family(p.name), [...(m.get(family(p.name)) || []), p]), new Map())].map(([l, ps]) => (ps.length > 1 ? `${ps.length} × ${l}` : short(ps[0].name)));
  const cover = items.find(p => p.cover), on = items.every(p => p.onCover) && items[0]?.onCover;
  let title;
  if (!items.length) title = fl.length ? `Fasten it with ${joinList(fl)}` : 'Check everything sits right';
  else if (items.includes(base)) title = `Start with the ${joinList(fams)}`;
  else if (cover) title = `Close it up with the ${joinList(fams)}`;
  else if (items.every(p => p.yours)) title = `Put your ${joinList(fams.map(f => f.replace(/^your\s+/i, '')))} in place`;
  else if (s.rank === 4) title = `Insert the ${joinList(fams)}`;
  else if (items.length === 1 && items[0].mountOn) title = `Fit the ${fams[0]} onto the ${short(items[0].mountOn.name)}`;
  else if (on) title = `Fit the ${joinList(fams)} into the ${short(on.name)}`;
  else if (items.every(p => p.inside && base)) title = `Fit the ${joinList(fams)} in the ${short(base.name)}`;
  else if (items.every(p => p.group === 'component' && /probe|plug|antenna|cable|lead\b/i.test(p.name))) title = `Plug in the ${joinList(fams)}`;
  else if (items.every(p => p.group === 'component' && ELEC.test(p.name))) title = `Fit the ${joinList(fams)}`;
  else title = `Add the ${joinList(fams)}`;
  const flOf = list => [...list.reduce((m, f) => m.set(clean(f.name), (m.get(clean(f.name)) || 0) + qty(f.name)), new Map())].map(([l, n]) => (n > 1 ? `${n} × ${l}` : l));
  let text = title;
  const prep = s.prep || [];
  if (prep.length) { // heat-set inserts, per printed part
    const hosts = [...new Set(prep.map(x => x.host))];
    text += `. First press ${joinList(hosts.map(h => `${joinList(flOf(prep.filter(x => x.host === h).map(x => x.f)))} into the ${short(h.name)}`))} with a soldering iron`;
  }
  if (items.length && fast.length) {
    const tg = [...new Set(fast.map(f => f.target))];
    text += tg.length === 1 && (items.length === 1 || !tg[0]) ? `. ${prep.length ? 'Then fix' : 'Fix'} ${items.length > 1 ? 'them' : 'it'} with ${joinList(flOf(fast))}`
      : `. Fix ${joinList(tg.map(t => `the ${t ? short(t.name) : 'parts'} with ${joinList(flOf(fast.filter(f => f.target === t)))}`))}`;
  }
  if (s.rank === 4 && items.some(p => CELL.test(p.name))) text += '. Match the + end to the + mark on the holder';
  if (cover) text += '. Check nothing is pinched and no wire sits under the rim before you close it';
  text += '.';
  const all = [...items, ...prep.map(x => x.f), ...fast];
  return { kind: 'place', title, text, parts: [...new Set(all.map(p => p.name))], ids: all.map(id), hl: [], hlIds: [], wires: [], ...(cover ? { closes: true } : {}) };
}

// ---------------------------------------------------------------- validation
/** steps: [{kind, ids|parts, hlIds|hl, wires, title}] (ids: part files, else names), model: { base, covers, inside,
 * before: [[a, b]] } in the same ids -> errors (strings). Rejects: a part added twice or before the base, an inside part
 * fitted after a cover has closed the case, a broken geometric precedence (holder before cell), a wire step before
 * either end is fitted or after the case is closed, and a test step that is not last. */
function validate(steps, model) {
  const errs = [], at = new Map();
  const ids = s => s.ids || s.parts || [], hls = s => s.hlIds || s.hl || [];
  steps.forEach((s, i) => ids(s).forEach(n => { if (at.has(n)) errs.push(`"${n}" is added twice (steps ${at.get(n) + 1} and ${i + 1})`); else at.set(n, i); }));
  const closeAt = c => at.has(c) ? at.get(c) : Infinity;
  if (model.base && at.has(model.base) && [...at.values()].some(i => i < at.get(model.base))) errs.push(`parts are added before the ${model.base}`);
  for (const c of model.covers || []) for (const n of model.inside || []) {
    if (at.has(n) && at.get(n) > closeAt(c)) errs.push(`"${n}" goes in after "${c}" has closed the case (step ${at.get(n) + 1} after step ${closeAt(c) + 1})`);
  }
  for (const [a, b] of model.before || []) if (at.has(a) && at.has(b) && at.get(a) > at.get(b)) errs.push(`"${a}" must go in before "${b}"`);
  const firstClose = Math.min(...(model.covers || []).map(closeAt), Infinity);
  steps.forEach((s, i) => {
    if (s.kind !== 'wire') return;
    for (const n of hls(s)) {
      if (!at.has(n)) errs.push(`step ${i + 1} wires "${n}" but it is never fitted`);
      else if (at.get(n) > i) errs.push(`step ${i + 1} wires "${n}" before it is fitted (step ${at.get(n) + 1})`);
    }
    if (i > firstClose && hls(s).some(n => (model.inside || []).includes(n))) errs.push(`step ${i + 1} wires parts inside the case after it is closed`);
  });
  const testAt = steps.findIndex(s => s.kind === 'test');
  if (testAt >= 0 && testAt !== steps.length - 1) errs.push('"Power on and test" must be the last step');
  return errs;
}

module.exports = { buildPlan, plan, validate, analyse, readWiring, parseWiringMd, groupWires, matchPart, stlBox, PLAN_V };
