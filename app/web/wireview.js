// wireview: the Wiring view of the main 3D viewer ("what's connected to what"). installWiring(viewer) -> viewer.wiring.
//  1. A "Wiring" toggle in the viewer toolbar right after See-through (studio and build page), shown only for designs
//     with wiring. Data: the build plan's wire list from /build/<id>/data.json (plan.wiring.list: wiring.json, else the
//     wiring.md table; the same payload the build steps prefetch on load, via assembly.steps.guide()). Turning Wiring on
//     turns See-through on too (and off again when Wiring turned it on).
//  2. Every wire as a coloured tube between the real parts (web/wires.js). Each end sits on the part's pins when the
//     model shows them: a lead of that colour ("SIG (orange)" on a servo), else the gold pin / pad sub-part, spread along
//     the header in pinout order for known boards (XIAO, ESP32 DevKitC, C3 SuperMini, 4-pin OLED) or in first-use
//     order, else the nearest face point (as the build steps do). Wires between the same two parts fan out; each leaves
//     its pin outwards and sags a little. Drawn twice: true colours with depth, plus a faint copy on top so wires behind
//     a part still read through the see-through shell.
//  3. Pin labels at each wire end (screen-space HTML, one per part pin, greedy placement so they don't pile up).
//     Hover (desktop) or tap (phone) a wire: it and both parts light up and a caption says "ESP32 GPIO13 → Servo SIG".
//  4. Connections list: a panel on the model (desktop) or a native bottom sheet (phone) with every wire grouped by the
//     two parts, colour swatch and kind; a row highlights that wire. Ends not in the model say "not in model".
// Phones: web/phonestudio.js mirrors the toolbar button as a round model-card button and opens the sheet.
import * as THREE from 'three';
import { WIRE_HEX, NO_COLOR, hexCss, partBox, okBox, wireMesh, disposeMesh } from './wires.js';

const phone = () => matchMedia('(max-width: 640px)').matches;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = n => String(n || '').replace(/\s[×x]\s?\d+(\s*\(\d+\))?$/i, '').replace(/\s*\((yours|ref|reference|\d+)\)\s*$/i, '').trim();
/** "Seeed XIAO ESP32S3" stays, '0.96" OLED display (SSD1306)' -> '0.96" OLED display', "ESP32, 38 pin" -> "ESP32". */
const short = n => clean(n).replace(/\s*\([^)]*\)\s*$/, '').replace(/,.*$/, '').trim() || clean(n);
const SIG = ['yellow', 'green', 'blue', 'orange', 'white', 'purple']; // no colour given: a suggestion (as the build steps)
const COLOR_WORD = new RegExp(`\\b(${Object.keys(WIRE_HEX).join('|')})\\b`, 'i');
export const WIRE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.2" cy="4" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12.8" cy="12" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.9 4c5 0 1.2 8 6.2 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

// ---------------------------------------------------------------- pinouts (index from the USB end, per header row)
// Pins are matched after normalising: upper case, the "(orange)" part dropped, "GPIO13" / "IO13" / "G13" -> "13".
const XIAO = { n: 7, pins: { D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, '5V': 0, VBUS: 0, VUSB: 0, VIN: 0, GND: 1, '3V3': 2, '3.3V': 2, D10: 3, D9: 4, D8: 5, D7: 6, A0: 0, A1: 1, A2: 2, A3: 3, SDA: 4, SCL: 5, TX: 6, RX: 6 } };
const DEVKIT38 = { n: 19, pins: { '5V': 0, VIN: 0, CMD: 1, SD3: 2, SD2: 3, 13: 4, GND: 5, 12: 6, 14: 7, 27: 8, 26: 9, 25: 10, 33: 11, 32: 12, 35: 13, 34: 14, 39: 15, VN: 15, 36: 16, VP: 16, EN: 17, '3V3': 18, '3.3V': 18,
  CLK: 0, SD0: 1, SD1: 2, 15: 3, 2: 4, 0: 5, 4: 6, 16: 7, 17: 8, 5: 9, 18: 10, 19: 11, 21: 13, RX: 14, RX0: 14, 3: 14, TX: 15, TX0: 15, 1: 15, 22: 16, 23: 17 } };
const DEVKIT30 = { n: 15, pins: { VIN: 0, '5V': 0, GND: 1, 13: 2, 12: 3, 14: 4, 27: 5, 26: 6, 25: 7, 33: 8, 32: 9, 35: 10, 34: 11, 39: 12, VN: 12, 36: 13, VP: 13, EN: 14,
  '3V3': 0, '3.3V': 0, 15: 2, 2: 3, 4: 4, 16: 5, RX2: 5, 17: 6, TX2: 6, 5: 7, 18: 8, 19: 9, 21: 10, RX0: 11, RX: 11, 3: 11, TX0: 12, TX: 12, 1: 12, 22: 13, 23: 14 } };
const C3MINI = { n: 8, pins: { '5V': 0, VBUS: 0, GND: 1, '3V3': 2, '3.3V': 2, 4: 3, 3: 4, 2: 5, 1: 6, 0: 7, 5: 0, 6: 1, 7: 2, 8: 3, 9: 4, 10: 5, 20: 6, RX: 6, 21: 7, TX: 7 } };
const OLED4 = { n: 4, pins: { GND: 0, VCC: 1, VDD: 1, '3V3': 1, '5V': 1, SCL: 2, SCK: 2, SDA: 3 } };
function pinoutOf(p) {
  const k = `${p.lib?.key || ''} ${p.lib?.name || ''} ${p.name}`.toLowerCase();
  if (/xiao/.test(k)) return XIAO;
  if (/c3.?super.?mini/.test(k)) return C3MINI;
  if (/esp32.?devkit|esp32_devkitc|wroom-?32|esp32 dev/.test(k)) return /\b30\b|v1\b|doit/.test(k) ? DEVKIT30 : DEVKIT38;
  if (/oled|ssd1306/.test(k) && !/spi|7.?pin/.test(k)) return OLED4;
  return null;
}
const pinKey = pin => String(pin || '').replace(/\([^)]*\)/g, '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/^(GPIO|IO|G)\s?(\d{1,2})$/, '$2').replace(/^(\d)\.(\d)V$/, '$1.$2V').replace(/^\+?(\d+V\d?)$/, '$1').replace(/^V\+$/, 'VCC');

export function installWiring(v) {
  if (v.wiring) return v.wiring;
  const api = new WireView(v);
  v.wiring = api;
  return api;
}

class WireView {
  constructor(v) {
    this.v = v; this.on = false; this.list = []; this.meshes = []; this.ends = []; this.sel = -1; this.hov = -1;
    this.autoGhost = false; this.loop = null; this.camSig = ''; this.ui = null; this.panel = null; this.sheet = null;
    this.layer = null; this.cap = null; this.token = 0;
    this.bindPointer();
  }

  // ---------------------------------------------------------------- data
  /** viewer.load(): fetch (or reuse) the wire list, show the button, redraw if on. */
  async onLoad(manifest) {
    const tok = ++this.token;
    this.list = []; this.sel = this.hov = -1;
    this.syncUi();
    if (!manifest) { this.set(false); return; }
    let d = null;
    try { d = await this.v.assembly?.steps?.guide?.(); } catch {}
    if (tok !== this.token) return;
    const raw = d?.plan?.wiring?.list || [];
    let g = 0;
    this.list = raw.map(w => {
      const color = WIRE_HEX[w.color] != null ? w.color : '';
      return { ...w, color: color || SIG[g++ % SIG.length], guess: !color };
    });
    this.syncUi();
    if (!this.list.length) { this.set(false); return; }
    if (this.on) this.build();
    this.renderList();
  }
  get has() { return this.list.length > 0; }
  item(end) {
    const items = this.v.items;
    if (end.file) { const it = items.find(x => x.p.file === end.file); if (it) return it; }
    const n = end.model || end.part;
    return items.find(x => x.p.name === n) || items.find(x => clean(x.p.name) === clean(n)) || null;
  }

  // ---------------------------------------------------------------- on / off
  set(on) {
    on = !!on && this.has;
    if (on === this.on) { this.syncUi(); return; }
    this.on = on;
    const gb = this.ghostBtn(), ghostOn = !!gb && (gb.classList.contains('on') || gb.getAttribute('aria-pressed') === 'true');
    if (on) {
      if (gb && !ghostOn) { gb.click(); this.autoGhost = true; }
      else if (!gb && !this.v.ui.ghost) { this.v.set('ghost', true); this.autoGhost = true; }
      this.build(); this.startLoop();
      if (phone()) this.openSheet(); else this.showPanel(true);
    } else {
      this.clear(); this.stopLoop(); this.sel = this.hov = -1;
      this.showPanel(false); this.sheet?.close();
      if (this.autoGhost) { if (gb && ghostOn) gb.click(); else if (!gb && this.v.ui.ghost) this.v.set('ghost', false); }
      this.autoGhost = false;
      this.v.editGlow?.focus(null);
      this.caption(null);
    }
    this.syncUi();
    this.v.container.dispatchEvent(new CustomEvent('viewer:wiring', { bubbles: true, detail: { viewer: this.v, on: this.on } }));
  }
  toggle() { this.set(!this.on); }
  ghostBtn() { return this.toolbar()?.querySelector('#ghostBtn, #bpGhost, [title="See-through case"]') || null; }
  toolbar() { return this.v.container.closest('.model-pane')?.querySelector('.toolbar') || null; }
  pane() { return this.v.container.closest('.model-pane') || this.v.container; }

  /** viewer.apply(): parts moved (explode) -> wires follow. */
  apply() {
    if (!this.on) return;
    const sig = this.v.items.map(it => it.mesh.position.toArray().map(x => x.toFixed(2)).join(',')).join(';') + '|' + this.v.backdrop;
    if (sig !== this.posSig) { this.posSig = sig; this.build(); }
  }

  // ---------------------------------------------------------------- 3D
  clear() {
    for (const m of this.meshes) disposeMesh(m);
    this.meshes = []; this.ends = [];
    this.wires = [];
    if (this.layer) this.layer.innerHTML = '';
    this.labels = [];
  }
  build() {
    this.clear();
    const v = this.v, R = v.radius || 100;
    const rad = Math.max(0.45, Math.min(1.6, R * 0.0065));
    const offs = it => it.mesh.position; // explode offset (model units)
    const pinSlots = new Map(); // item -> [pinKey] in first-use order (spread for parts without a pinout)
    const slotOf = (it, pin) => { let a = pinSlots.get(it); if (!a) pinSlots.set(it, a = []); const k = pinKey(pin); if (!a.includes(k)) a.push(k); return a; };
    this.list.forEach(w => { const a = this.item(w.from), b = this.item(w.to); if (a) slotOf(a, w.from.pin); if (b) slotOf(b, w.to.pin); });
    const pairN = new Map(), pairJ = new Map();
    const pairK = (a, b) => [a.p.file, b.p.file].sort().join('|');
    this.list.forEach(w => { const a = this.item(w.from), b = this.item(w.to); if (a && b && a !== b) pairN.set(pairK(a, b), (pairN.get(pairK(a, b)) || 0) + 1); });
    const groups = new Map(); // label key -> { pos sum, n, text, color, ws }
    this.wires = this.list.map((w, i) => {
      const a = this.item(w.from), b = this.item(w.to);
      if (!a || !b) return null;
      const ba = partBox(a), bb = partBox(b); if (!okBox(ba) || !okBox(bb)) return null;
      const ca = ba.getCenter(new THREE.Vector3()).add(offs(a)), cb = bb.getCenter(new THREE.Vector3()).add(offs(b));
      const pa = this.anchor(a, w.from.pin, cb, pinSlots.get(a)).add(offs(a));
      const pb = a === b ? this.anchor(b, w.to.pin, pa, pinSlots.get(b), true).add(offs(b)) : this.anchor(b, w.to.pin, ca, pinSlots.get(b)).add(offs(b));
      const d = pa.distanceTo(pb);
      if (d < 0.3) return null;
      const k = pairK(a, b), n = pairN.get(k) || 1, j = pairJ.get(k) || 0; pairJ.set(k, j + 1);
      const curve = this.route(pa, pb, ca, cb, j, n, R, a === b);
      const hex = WIRE_HEX[w.color] ?? NO_COLOR;
      const main = wireMesh(curve, { color: hex, radius: rad, order: 6, toneMapped: false, segments: 40, radial: 8 });
      main.material.depthWrite = true; main.material.transparent = false;
      const ghost = wireMesh(curve, { color: hex, radius: rad, opacity: 0.38, onTop: true, order: 7, toneMapped: false, segments: 40 });
      const halo = wireMesh(curve, { color: v.backdrop === 'dark' ? 0xffffff : 0x111111, radius: rad * 1.7, opacity: v.backdrop === 'dark' ? 0.22 : 0.16, order: 5, segments: 40, side: THREE.BackSide });
      for (const m of [halo, main, ghost]) v.world.add(m);
      const dots = [pa, pb].map(p => { const s = new THREE.Mesh(DOT, new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, depthTest: false, transparent: true })); s.position.copy(p); s.scale.setScalar(rad * 1.2); s.renderOrder = 8; s.raycast = () => {}; s.userData.fx = true; v.world.add(s); return s; });
      this.meshes.push(halo, main, ghost, ...dots);
      const rec = { i, w, a, b, main, ghost, halo, dots, pts: curve.getPoints(32), hex };
      for (const [it, end, p] of [[a, w.from, pa], [b, w.to, pb]]) {
        const key = it.p.file + '|' + pinKey(end.pin);
        let g = groups.get(key); if (!g) groups.set(key, g = { sum: new THREE.Vector3(), n: 0, text: end.pin || '?', color: w.color, ws: [], it });
        g.sum.add(p); g.n++; g.ws.push(i);
      }
      return rec;
    });
    this.posSig = this.v.items.map(it => it.mesh.position.toArray().map(x => x.toFixed(2)).join(',')).join(';') + '|' + this.v.backdrop;
    this.ends = [...groups.values()].map(g => ({ pos: g.sum.multiplyScalar(1 / g.n), text: g.text, color: g.color, ws: g.ws, it: g.it }));
    this.makeLabels();
    this.restyle();
    this.camSig = '';
  }
  /** The wire's path: out of each pin (away from the part, towards the other end), a small sag, fanned when bundled. */
  route(pa, pb, ca, cb, j, n, R, same) {
    const d = pa.distanceTo(pb), L = Math.max(2.5, Math.min(d * 0.32, R * 0.16));
    const out = (p, c, to) => {
      const o = p.clone().sub(c); o.z *= 1.4; if (o.lengthSq() < 1e-6) o.set(0, 0, 1);
      return o.normalize().multiplyScalar(0.55).add(to.clone().sub(p).normalize()).normalize();
    };
    const c1 = pa.clone().add(out(pa, ca, pb).multiplyScalar(L)), c2 = pb.clone().add(out(pb, cb, pa).multiplyScalar(L));
    if (same) { c1.z += L; c2.z += L; }
    const dir = pb.clone().sub(pa).normalize(), side = new THREE.Vector3(0, 0, 1).cross(dir); if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().multiplyScalar((j - (n - 1) / 2) * Math.max(0.8, R * 0.01));
    const sag = Math.min(d * 0.1, R * 0.05);
    c1.add(side).z -= sag; c2.add(side).z -= sag;
    const lo = Math.min(pa.z, pb.z) - Math.max(2, R * 0.02); c1.z = Math.max(c1.z, lo); c2.z = Math.max(c2.z, lo);
    return new THREE.CubicBezierCurve3(pa.clone(), c1, c2, pb.clone());
  }
  /** Where a wire meets this part, in model coordinates (no explode offset): a lead of the pin's colour, else a gold pin
   * (pinout order when known), else the nearest face point towards `toward`. */
  anchor(it, pin, toward, slots = [], second = false) {
    const geo = it.cgeo || it.mesh.geometry, P = geo.attributes.position, ranges = geo.userData?.ranges || [];
    const bb = partBox(it), c = bb.getCenter(new THREE.Vector3());
    const v3 = new THREE.Vector3();
    const nearest = (rs, filt) => {
      let best = null, bd = Infinity;
      for (const r of rs) {
        const step = Math.max(1, Math.floor(r.count / 4000));
        for (let k = r.start; k < r.start + r.count; k += step) {
          v3.fromBufferAttribute(P, k); if (filt && !filt(v3)) continue;
          const dd = v3.distanceToSquared(toward); if (dd < bd) { bd = dd; best = v3.clone(); }
        }
      }
      return best;
    };
    // 1. a coloured lead ("SIG (orange)", "V+ (red)", "brown") on a part with leads of that colour
    const cw = (String(pin).match(/\(([^)]*)\)/)?.[1] || String(pin)).match(COLOR_WORD)?.[1]?.toLowerCase();
    if (cw && ranges.length > 1) {
      const want = new THREE.Color(WIRE_HEX[cw]), tot = P.count;
      const lead = ranges.filter(r => r.count < tot * 0.4 && r.finish !== 'gold' && r.finish !== 'metal' && colorDist(new THREE.Color(r.color), want) < 0.32)
        .sort((x, y) => colorDist(new THREE.Color(x.color), want) - colorDist(new THREE.Color(y.color), want));
      if (lead.length) { const p = nearest([lead[0]]); if (p) return p; }
    }
    // 2. gold pins / pads
    const gold = ranges.filter(r => r.finish === 'gold');
    if (gold.length) {
      const g = new THREE.Box3(); for (const r of gold) for (let k = r.start; k < r.start + r.count; k++) g.expandByPoint(v3.fromBufferAttribute(P, k));
      const sz = g.getSize(new THREE.Vector3()), ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
      const lo = g.min[ax], span = Math.max(0.1, g.max[ax] - lo);
      const po = pinoutOf(it.p), key = pinKey(pin);
      let f, n;
      if (po && po.pins[key] != null) {
        n = po.n; f = (po.pins[key] + 0.5) / n;
        if (this.usbHigh(it, ranges, P, ax, lo, span)) f = 1 - f;
      } else { n = Math.max(1, slots.length); f = (Math.max(0, slots.indexOf(key)) + 0.5) / n; }
      const t = lo + f * span, band = Math.max(0.7, span / (2 * Math.max(n, 2)));
      const p = nearest(gold, q => Math.abs(q[ax] - t) <= band) || nearest(gold);
      if (p) return p;
    }
    // 3. nearest face point (the build steps' anchor)
    const p = bb.clampPoint(toward, new THREE.Vector3()).lerp(c, 0.18);
    if (second) p.lerp(bb.max, 0.3);
    return p;
  }
  /** Is the USB end of this board at the high end of axis ax? The board's cable (manifest) or its farthest-out metal part. */
  usbHigh(it, ranges, P, ax, lo, span) {
    const mid = lo + span / 2, at = it.p.port?.at || it.p.cable?.at;
    if (Array.isArray(at) && at.length === 3) return { x: at[0], y: at[1], z: at[2] }[ax] > mid;
    let best = 0;
    for (const r of ranges.filter(r => r.finish === 'metal')) {
      let s = 0; const v3 = new THREE.Vector3(); const step = Math.max(1, Math.floor(r.count / 500)); let n = 0;
      for (let k = r.start; k < r.start + r.count; k += step) { s += v3.fromBufferAttribute(P, k)[ax]; n++; }
      const m = s / Math.max(1, n) - mid; if (Math.abs(m) > Math.abs(best)) best = m;
    }
    return best > 0;
  }

  // ---------------------------------------------------------------- highlight
  /** i: a wire index (list order) or -1. */
  select(i, opts = {}) {
    this.sel = this.sel === i && !opts.keep ? -1 : i;
    this.restyle();
    this.renderList();
    const w = this.list[this.sel];
    if (w) this.caption(w); else this.caption(null);
    if (opts.scroll !== false) this.panel?.querySelector(`[data-wi="${this.sel}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }
  hover(i) { if (i === this.hov) return; this.hov = i; this.restyle(); this.caption(this.list[i >= 0 ? i : this.sel] || null); }
  restyle() {
    const f = this.hov >= 0 ? this.hov : this.sel;
    for (const r of this.wires || []) {
      if (!r) continue;
      const lit = f < 0 || r.i === f;
      r.main.material.color.setHex(lit ? r.hex : dim(r.hex, this.v.backdrop));
      r.main.scale.setScalar(1);
      r.ghost.material.opacity = f < 0 ? 0.38 : lit ? 0.9 : 0.06;
      r.halo.material.opacity = lit && f >= 0 ? 0.5 : f < 0 ? (this.v.backdrop === 'dark' ? 0.22 : 0.16) : 0.04;
      r.halo.material.color.setHex(lit && f >= 0 ? 0xff7a1a : this.v.backdrop === 'dark' ? 0xffffff : 0x111111);
      r.dots.forEach(d => { d.material.opacity = lit ? 1 : 0.15; });
    }
    const w = this.list[f];
    const names = w ? [this.item(w.from), this.item(w.to)].filter(Boolean).map(it => it.p.name) : null;
    this.v.editGlow?.focus(names?.length ? names : null, 10 * 60000);
    this.camSig = ''; // labels again
  }
  caption(w) {
    if (!this.cap) {
      this.cap = document.createElement('div'); this.cap.className = 'wv-cap'; this.cap.hidden = true;
      this.cap.setAttribute('role', 'status'); this.cap.setAttribute('aria-live', 'polite');
      this.v.container.append(this.cap);
    }
    if (!w || !this.on) { this.cap.hidden = true; return; }
    this.cap.innerHTML = `<i style="background:${hexCss(w.color)}"></i><span>${esc(endText(w.from))} <b>→</b> ${esc(endText(w.to))}</span>`;
    this.cap.hidden = false;
  }

  // ---------------------------------------------------------------- labels (screen space)
  makeLabels() {
    if (!this.layer) { this.layer = document.createElement('div'); this.layer.className = 'wv-labels'; this.v.container.append(this.layer); }
    this.layer.innerHTML = '';
    this.labels = this.ends.map(e => {
      const el = document.createElement('span'); el.className = 'wv-lab';
      el.innerHTML = `<i style="background:${hexCss(e.color)}"></i>${esc(e.text)}`;
      this.layer.append(el);
      return { e, el, w: 0, h: 0 };
    });
    for (const l of this.labels) { l.w = l.el.offsetWidth || 40; l.h = l.el.offsetHeight || 16; }
  }
  placeLabels() {
    const v = this.v, cam = v.camera, W = v.container.clientWidth, H = v.container.clientHeight;
    const sig = cam.matrixWorld.elements.map(x => x.toFixed(3)).join(',') + `|${W}x${H}|${this.sel}|${this.hov}|${this.cap?.hidden}`;
    if (sig === this.camSig) return;
    this.camSig = sig;
    v.world.updateMatrixWorld();
    const m = v.world.matrixWorld, p = new THREE.Vector3();
    const f = this.hov >= 0 ? this.hov : this.sel;
    const cr = this.cap && !this.cap.hidden ? this.cap.getBoundingClientRect() : null, vr = cr ? v.container.getBoundingClientRect() : null;
    const placed = cr ? [{ x: cr.left - vr.left, y: cr.top - vr.top, w: cr.width, h: cr.height }] : [], top = phone() ? 58 : 2, bot = H - (phone() ? 66 : 2); // phones: clear of the card's round buttons
    const ls = (this.labels || []).map(l => {
      p.copy(l.e.pos).applyMatrix4(m).project(cam);
      return { l, x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, z: p.z, hot: f >= 0 && l.e.ws.includes(f) };
    });
    ls.sort((a, b) => (b.hot - a.hot) || (a.y - b.y));
    const hit = (r) => placed.some(q => r.x < q.x + q.w + 2 && q.x < r.x + r.w + 2 && r.y < q.y + q.h + 1 && q.y < r.y + r.h + 1);
    for (const s of ls) {
      const { l } = s;
      const off = s.z > 1 || s.x < -40 || s.x > W + 40 || s.y < -20 || s.y > H + 20;
      let spot = null;
      if (!off && (f < 0 || s.hot || !phone())) {
        for (const dy of [-1, 1, -2, 2, -3]) {
          const r = { x: s.x + 7, y: s.y - l.h / 2 + dy * (l.h * 0.55) - (dy < 0 ? 2 : -2), w: l.w, h: l.h };
          if (dy === -1) r.y = s.y - l.h - 3;
          if (!hit(r) && r.x + r.w < W - 4 && r.y > top && r.y + r.h < bot) { spot = r; break; }
          const rl = { ...r, x: s.x - 7 - l.w };
          if (!hit(rl) && rl.x > 4 && rl.y > top && rl.y + rl.h < bot) { spot = rl; break; }
        }
        if (!spot && s.hot) spot = { x: s.x + 7, y: s.y - l.h - 3, w: l.w, h: l.h };
      }
      if (!spot) { l.el.style.visibility = 'hidden'; continue; }
      placed.push(spot);
      l.el.style.visibility = '';
      l.el.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px)`;
      l.el.classList.toggle('hot', s.hot);
      l.el.classList.toggle('dim', f >= 0 && !s.hot);
    }
  }
  startLoop() { if (!this.loop) this.loop = this.v.animate(1e12, () => { if (this.on) this.placeLabels(); }); }
  stopLoop() { if (this.loop) { this.v.anims.delete(this.loop); this.loop = null; } }

  // ---------------------------------------------------------------- pointer: hover (desktop), click / tap a wire
  pick(x, y, tol) {
    if (!this.on || !this.wires?.length) return -1;
    const v = this.v, r = v.renderer.domElement.getBoundingClientRect(), cam = v.camera, m = v.world.matrixWorld, p = new THREE.Vector3();
    let best = -1, bd = tol * tol;
    for (const w of this.wires) {
      if (!w) continue;
      let prev = null;
      for (const q of w.pts) {
        p.copy(q).applyMatrix4(m).project(cam);
        if (p.z > 1) { prev = null; continue; }
        const sx = r.left + (p.x * 0.5 + 0.5) * r.width, sy = r.top + (-p.y * 0.5 + 0.5) * r.height;
        if (prev) { const d2 = segD2(x, y, prev[0], prev[1], sx, sy); if (d2 < bd) { bd = d2; best = w.i; } }
        prev = [sx, sy];
      }
    }
    return best;
  }
  bindPointer() {
    const el = this.v.container;
    let down = null, raf = 0, last = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, touch: e.pointerType !== 'mouse' }; }, true);
    el.addEventListener('pointerup', e => {
      const d = down; down = null;
      if (!this.on || !d || d.id !== e.pointerId || e.button > 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 450) return;
      if (e.target.closest?.('button, a, input, .wv-panel')) return;
      const i = this.pick(e.clientX, e.clientY, d.touch ? 16 : 7);
      if (i >= 0) { e.stopPropagation(); this.select(i, { keep: true }); }
      else if (this.sel >= 0) this.select(-1);
    }, true);
    el.addEventListener('pointermove', e => {
      if (!this.on || e.pointerType !== 'mouse' || e.buttons) return;
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = this.pick(last.clientX, last.clientY, 7);
        this.hover(i);
        this.v.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : '';
      });
    });
    el.addEventListener('pointerleave', () => { if (this.on) this.hover(-1); });
  }

  // ---------------------------------------------------------------- toolbar button
  syncUi() {
    const tb = this.toolbar(); if (!tb) return;
    let b = tb.querySelector('.twire-btn');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'tbtn twire-btn'; b.hidden = true;
      b.title = 'Wiring: every wire, pin to pin, inside the case';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = WIRE_ICON + '<span>Wiring</span>';
      const g = this.ghostBtn();
      if (g) g.after(b); else tb.append(b);
      b.addEventListener('click', () => this.toggle());
      this.ui = b;
    }
    b.hidden = !this.has;
    b.classList.toggle('on', this.on); b.setAttribute('aria-pressed', String(this.on));
  }

  // ---------------------------------------------------------------- Connections list
  groups() {
    const out = new Map();
    this.list.forEach((w, i) => {
      const k = [w.from.model || w.from.part, w.to.model || w.to.part].join('→');
      if (!out.has(k)) out.set(k, { from: w.from, to: w.to, ws: [] });
      out.get(k).ws.push([w, i]);
    });
    return [...out.values()];
  }
  rowsHtml(phoneRows) {
    const miss = e => !e.model;
    return this.groups().map(g => {
      const note = [g.from, g.to].filter(miss).map(e => `${short(e.part)} is not in the model`);
      const head = `${esc(short(g.from.model || g.from.part))} <b>→</b> ${esc(short(g.to.model || g.to.part))}`;
      const rows = g.ws.map(([w, i]) => {
        const kind = [w.kind, w.guess ? 'colour suggested' : ''].filter(Boolean).join(' · ');
        const off = miss(w.from) || miss(w.to);
        return phoneRows
          ? `<button type="button" class="ms-row wv-row${this.sel === i ? ' ms-on' : ''}${off ? ' wv-off' : ''}" data-wi="${i}"><span class="ms-ic"><i class="wv-sw" style="background:${hexCss(w.color)}"></i></span><span class="ms-l">${esc(w.from.pin || '?')} <b class="wv-arr">→</b> ${esc(w.to.pin || '?')}${kind ? `<small>${esc(kind)}</small>` : ''}</span></button>`
          : `<button type="button" class="wv-row${this.sel === i ? ' on' : ''}${off ? ' wv-off' : ''}" data-wi="${i}"><i class="wv-sw" style="background:${hexCss(w.color)}"></i><span class="wv-pins">${esc(w.from.pin || '?')} <b>→</b> ${esc(w.to.pin || '?')}</span>${kind ? `<em>${esc(kind)}</em>` : ''}</button>`;
      }).join('');
      return phoneRows
        ? `<div class="wv-gh">${head}${note.length ? `<small class="wv-miss">${esc(note.join(', '))}</small>` : ''}</div><div class="ms-list">${rows}</div>`
        : `<div class="wv-g"><div class="wv-gh">${head}</div>${note.length ? `<div class="wv-miss">${esc(note.join(', '))}</div>` : ''}${rows}</div>`;
    }).join('');
  }
  showPanel(on) {
    if (!on) { if (this.panel) this.panel.hidden = true; return; }
    if (!this.panel) {
      const el = document.createElement('div'); el.className = 'wv-panel'; el.hidden = true;
      el.innerHTML = `<button type="button" class="wv-head" aria-expanded="true"><span>Connections</span><span class="wv-n"></span><svg class="chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></button><div class="wv-body"></div>`;
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('click', e => {
        if (e.target.closest('.wv-head')) { el.classList.toggle('collapsed'); el.querySelector('.wv-head').setAttribute('aria-expanded', String(!el.classList.contains('collapsed'))); return; }
        const r = e.target.closest('[data-wi]'); if (r) this.select(+r.dataset.wi, { scroll: false });
      });
      el.addEventListener('pointerover', e => { const r = e.target.closest('[data-wi]'); this.hover(r ? +r.dataset.wi : -1); });
      el.addEventListener('pointerleave', () => this.hover(-1));
      this.pane().append(el);
      this.panel = el;
      if (this.pane().clientWidth < 600) { el.classList.add('collapsed'); el.querySelector('.wv-head').setAttribute('aria-expanded', 'false'); } // small model: the list starts folded
    }
    this.panel.hidden = false;
    this.renderList();
  }
  renderList() {
    const n = this.list.length;
    if (this.panel && !this.panel.hidden) {
      this.panel.querySelector('.wv-n').textContent = `${n} wire${n === 1 ? '' : 's'}`;
      this.panel.querySelector('.wv-body').innerHTML = this.rowsHtml(false);
    }
    if (this.sheet) { this.sheet.setTitle('Connections', `${n} wire${n === 1 ? '' : 's'}`); this.sheet.body.innerHTML = `<div class="wv-sheet">${this.rowsHtml(true)}</div>`; }
  }
  async openSheet() {
    if (!this.sheet) {
      const { sheet } = await import('./msheet.js');
      this.sheet = sheet({ cls: 'm-cs-wires', title: 'Connections', dim: 'card', fit: 'card' });
      this.sheet.body.addEventListener('click', e => { const r = e.target.closest('[data-wi]'); if (r) this.select(+r.dataset.wi, { scroll: false }); });
    }
    if (!this.on) return;
    this.renderList();
    this.sheet.open();
  }
}

const DOT = new THREE.SphereGeometry(1, 12, 8);
const colorDist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const dim = (hex, bd) => new THREE.Color(hex).lerp(new THREE.Color(bd === 'dark' ? 0x2a2c30 : 0xd9d6cf), 0.7).getHex();
function segD2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}
const endText = e => `${short(e.model || e.part)} ${e.pin || ''}`.trim();

// ---------------------------------------------------------------- styles (desktop panel, labels, caption; phone rows)
if (typeof document !== 'undefined' && !window.__wireViewCss) {
  window.__wireViewCss = true;
  const st = document.createElement('style');
  st.textContent = `
.tbtn.twire-btn.on { color: #c2470a; }
.wv-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1; }
.wv-lab { position: absolute; left: 0; top: 0; display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px 1px 4px; border-radius: 6px;
  font: 500 10.5px/1.45 var(--ui, Inter, system-ui, sans-serif); color: #24221e; background: rgba(255,255,255,.88); white-space: nowrap;
  box-shadow: 0 0 0 .5px rgba(0,0,0,.14), 0 1px 3px rgba(0,0,0,.12); transition: opacity .15s; will-change: transform; }
.wv-lab i, .wv-cap i, .wv-sw { flex: none; width: 7px; height: 7px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.35); }
.wv-lab.hot { background: #fff; font-weight: 600; box-shadow: 0 0 0 1px #ff7a1a, 0 2px 6px rgba(0,0,0,.18); z-index: 1; }
.wv-lab.dim { opacity: .28; }
.wv-cap { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 3; display: inline-flex; align-items: center; gap: 8px; max-width: calc(100% - 24px);
  padding: 7px 12px; border-radius: 10px; background: rgba(255,255,255,.95); color: #24221e; font: 500 12.5px/1.3 var(--ui, Inter, system-ui, sans-serif);
  box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 4px 14px rgba(0,0,0,.14); pointer-events: none; }
.wv-cap span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wv-cap b { color: #c2470a; font-weight: 600; }
.wv-cap i { width: 14px; height: 5px; border-radius: 3px; }
.wv-panel { position: absolute; top: 88px; right: 10px; z-index: 2; width: 252px; max-height: min(calc(100% - 140px), 340px); display: flex; flex-direction: column;
  background: var(--glass, rgba(255,255,255,.9)); border: 1px solid var(--line-2, #e3e0da); border-radius: 8px; backdrop-filter: blur(8px); overflow: hidden; box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,.08)); }
.wv-panel[hidden] { display: none; }
.wv-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; font-weight: 600; font-size: 12px; text-align: left; background: none; border: 0; color: var(--text, #24221e); cursor: pointer; }
.wv-head .wv-n { color: var(--muted, #8a857c); font-weight: 400; }
.wv-head .chev { margin-left: auto; color: var(--muted, #8a857c); transition: transform .15s; }
.wv-panel.collapsed .wv-body { display: none; }
.wv-panel.collapsed .chev { transform: rotate(-90deg); }
.wv-body { overflow: auto; padding: 0 4px 6px; border-top: 1px solid var(--line, #ece9e3); }
.wv-g + .wv-g { border-top: 1px solid var(--line, #ece9e3); }
.wv-gh { padding: 7px 6px 3px; font-size: 11.5px; font-weight: 600; color: var(--text-2, #4a4740); }
.wv-gh b, .wv-row b { color: var(--muted, #8a857c); font-weight: 400; }
.wv-miss { padding: 0 6px 3px; font-size: 11px; color: #b0560e; }
.wv-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px; border: 0; border-radius: 5px; background: none; text-align: left;
  font: 400 12px/1.35 var(--ui, Inter, system-ui, sans-serif); color: var(--text-2, #4a4740); cursor: pointer; }
.wv-row:hover { background: var(--panel-3, rgba(0,0,0,.04)); }
.wv-row.on { background: rgba(232, 89, 12, .1); color: var(--text, #24221e); }
.wv-row .wv-sw { width: 14px; height: 5px; border-radius: 3px; }
.wv-row .wv-pins { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wv-row em { font-style: normal; font-size: 10.5px; color: var(--muted, #8a857c); white-space: nowrap; }
.wv-row.wv-off .wv-pins { color: var(--muted, #8a857c); }
.wv-sheet .wv-gh { padding: 14px 4px 6px; font-size: 13px; font-weight: 600; color: var(--muted, #8a857c); }
.wv-sheet .wv-gh:first-child { padding-top: 2px; }
.wv-sheet .wv-gh small { display: block; margin-top: 2px; font-weight: 400; color: #b0560e; }
.wv-sheet .wv-sw { width: 20px; height: 6px; border-radius: 3px; }
.wv-sheet .wv-arr { color: var(--muted, #8a857c); font-weight: 400; }
.wv-sheet .ms-row.wv-off .ms-l { color: var(--muted, #8a857c); }
@media (max-width: 640px) {
  .wv-panel { display: none; }
  .wv-cap { bottom: 70px; font-size: 13px; }
  .wv-lab { font-size: 10px; }
}`;
  document.head.append(st);
}
