// "Turn it on": alive-model effects for the 3D viewer (web/viewer.js). A design's LEDs glow (solid, rainbow or pulse, with a
// soft halo, light spill on nearby parts and bloom on desktop), its displays show a readout, its fans spin, and the scene
// goes to night so the light reads. One power toggle in the viewer toolbar (and a round button on the phone model card)
// turns it all on and off; it is hidden when the design has nothing that lights up or moves.
//
// Data: a part's optional `fx` in the manifest (cadlib build.py passes it through; the design agent writes it):
//   fx: { glow:   { color: '#ff8800' | 'rainbow', mode: 'solid' | 'rainbow' | 'pulse' },
//         screen: { text: '21.4°C', bg: '#000000', fg: '#33ccff', face: '+y' },
//         spin:   { axis: [0, 0, 1], rpm: 600, center: [x, y, z] } }        (true for any of them = defaults)
// A part with an `fx` object uses only what it says ({} = no effects), except that a printed housing (head, shade, arm,
// base, case...) never glows itself even when its fx says so: only the light-emitting face does (owner 4 Nov: "why are
// they glowing?"). Parts without one get a heuristic from their name and library key, so existing designs light up
// without a rebuild: WS2812 / NeoPixel / LED -> glow, LCD / OLED / TFT / display -> screen, fan -> the rotor spins, and a
// clear panel next to a glowing part (edge-lit acrylic) picks up its light.
//
// Light (4 Nov): only real light sources glow and bloom. Bloom is selective: glow meshes sit on BLOOM_LAYER and a separate
// pass renders just them (everything else black, for occlusion), blurs that, and adds it over the normal frame, so lit
// white plastic never halos. Each light source also lights the scene: a warm point light plus a soft pool of light on the
// floor under it. The scene dims gently (NIGHT_LIGHT) so the light reads and the model still does.
//
// Movement reuses the motion system where it exists: a part motion.json already moves (viewer.motion / it.track) is left
// to it, and power on plays Move when the design has motion and a fan or motor. Fans without a track spin their rotor only
// (library fans: the blade sub-parts; other fans: the vertices inside the frame's bore) through a small vertex-shader
// rotation on the part's own material, so the frame stays put. Render mode keeps its own look; the glow still shows there.
//
// X-ray is the existing See-through (viewer ui.ghost), extended here: the shells drop to 0.15 opacity with stronger edges,
// so the electronics read through them and glow when power is on.
import * as THREE from 'three';

const phoneMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 640px), (pointer: coarse)') : null;
const PHONE = () => !!phoneMq?.matches;
// Owner (2 Nov): power on stays in daylight; the scene only dims gently so the light and its pool read (no night).
const NIGHT_LIGHT = [0.65, 0.55, 0.6, 0.8]; // hemi, key, fill, rim when powered (x their day intensity)
const BLOOM_LAYER = 11;                       // glow meshes: the only things the selective bloom sees
const DUSK_LIGHT = [1, 1, 1, 1];              // nothing lights up (it only moves): no change
const NAMED = { red: '#ff3b30', green: '#30e05a', blue: '#3a7bff', yellow: '#ffd23a', white: '#fff4e0', warm: '#ffc982', orange: '#ff8a1f', purple: '#b04dff', pink: '#ff5fb0', cyan: '#2fe6ff', uv: '#8a4dff', amber: '#ffb000' };
const re = {
  led: /ws28\d\d|neopixel|sk68\d\d|apa102|dotstar|\bleds?\b|\bled[ _-]?(strip|ring|matrix|bar|panel|module)|\bled_|\blight[ -]?bar|\blamp\b|\bbulb|\bbacklight/i,
  ledNot: /driver|resistor|controller|holder|clip|mount|bracket|channel|diffuser|cover|connector|cable|wire|plug|\bpsu\b|power supply|shade|head|housing|body|\barm\b|base|shell|\bcase\b|enclosure|frame|stand|socket/i,
  // printed housings never glow themselves, even with an explicit fx.glow; the emitter face (diffuser, lens, LED plate) does
  housing: /\b(head|housing|shade|arm|base|body|case|enclosure|shell|stand|pole|stem|frame|cover|lid|bracket|mount|hub|cap|knob|foot|feet|reflector)\b/i,
  emitter: /diffuser|\blens|\bleds?\b|\bled[ _-]|\bcob\b|emitter|light ?guide|light ?pipe|\bglobe|\bbulb|\bwindow\b|lightbox|\bsign\b/i,
  rgb: /ws28\d\d|neopixel|sk68\d\d|apa102|dotstar|\brgb|addressable|pixel/i,
  screen: /\b(lcd|oled|tft|display|screen|e-?ink|e-?paper|epd|st7789|ili9341|ssd1306|sh1106|12864|1602|2004)\b|oled_|lcd_|tft_/i,
  screenNot: /bracket|mount|holder|cover|bezel|frame|window|protector|cable|ribbon|stand|dock|\bcase\b/i,
  fan: /\bfans?\b|\bblower|\bfan_|\d{2,3} ?(mm)? ?fan\b/i,
  fanNot: /shroud|guard|grill|duct|mount|cover|bracket|filter|holder|screw|spacer|plate|ring|clip/i,
  rotor: /\brotor|\bimpeller|\bpropell?er|\bblades?\b/i,
  motor: /motor\b|\bstepper|\bnema ?\d|\bservo\b|gearmotor/i,
  lit: /acrylic|diffuser|\bpanel|\blens\b|light ?pipe|\bsign\b|\bwindow|\bglobe|\bdome|lightbox/i, // not "shade": lamp shades are opaque
};

// ---------------------------------------------------------------------------------------------------------------- helpers
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function colorOf(c, fallback = '#fff4e0') {
  if (typeof c === 'string') { const k = c.toLowerCase().trim(); if (NAMED[k]) return NAMED[k]; if (/^#[0-9a-f]{6}$/i.test(k) || /^#[0-9a-f]{3}$/i.test(k)) return k; }
  return fallback;
}
function geoOf(it) { return it.cgeo || it.mesh.geometry; }
function bboxOf(geo) { if (!geo.boundingBox) geo.computeBoundingBox(); return geo.boundingBox; }
/** Bounding box of a set of vertex ranges [{start, count}] (all vertices when ranges is null). */
function rangeBox(geo, ranges) {
  if (!ranges) return bboxOf(geo).clone();
  const b = new THREE.Box3(), p = geo.attributes.position;
  for (const r of ranges) for (let i = r.start; i < r.start + r.count; i++) b.expandByPoint(_v.fromBufferAttribute(p, i));
  return b;
}
const dims = b => b.getSize(new THREE.Vector3()).toArray();
const thinAxis = d => d.indexOf(Math.min(...d));
const longAxis = d => d.indexOf(Math.max(...d));
function boxDist(a, b) {
  let s = 0;
  for (const k of ['x', 'y', 'z']) { const d = Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]); s += d * d; }
  return Math.sqrt(s);
}
let haloTex = null;
function halo() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}
let poolTex = null;
/** A soft pool of light: bright centre, long smooth falloff (a warm tint on the floor). */
function poolMap() {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(0.65, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c); poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}
let nightTex = null;
function nightBg() {
  if (nightTex) return nightTex;
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#171c27'); gr.addColorStop(1, '#06070a');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  nightTex = new THREE.CanvasTexture(c); nightTex.colorSpace = THREE.SRGBColorSpace;
  return nightTex;
}
/** Keep obj[key] at factor x its "day" value, even when other code (phone presentation look) sets it meanwhile. */
function hold(obj, key, factor, tag) {
  const u = obj.userData || (obj.userData = {}), set = u[tag + 'Set'];
  if (set === undefined || Math.abs(obj[key] - set) > 1e-6) u[tag + 'Day'] = obj[key];
  obj[key] = u[tag + 'Day'] * factor; u[tag + 'Set'] = obj[key];
}
function release(obj, key, tag) {
  const u = obj.userData; if (!u || u[tag + 'Set'] === undefined) return;
  if (Math.abs(obj[key] - u[tag + 'Set']) < 1e-6) obj[key] = u[tag + 'Day'];
  delete u[tag + 'Set']; delete u[tag + 'Day'];
}

// ---------------------------------------------------------------------------------------------------------------- what a part does
/** The fx spec for a part: its own `fx` when it has one, else a guess from its name / library key. */
export function specFor(p) {
  const out = {};
  if (p.fx && typeof p.fx === 'object') {
    const f = p.fx;
    if (f.glow && !(p.group !== 'component' && re.housing.test(p.name || '') && !re.emitter.test(p.name || ''))) out.glow = typeof f.glow === 'object' ? { ...f.glow } : {};
    if (f.screen) out.screen = typeof f.screen === 'object' ? { ...f.screen } : {};
    if (f.spin) out.spin = typeof f.spin === 'object' ? { ...f.spin } : {};
    out.explicit = true;
  } else if (p.group === 'component') {
    const key = p.lib?.key || '', n = `${p.name} ${key}`;
    if (re.led.test(n) && !re.ledNot.test(p.name) && !re.screen.test(n)) {
      const named = Object.keys(NAMED).find(c => new RegExp(`\\b${c}\\b`, 'i').test(p.name));
      out.glow = re.rgb.test(n) ? { mode: 'rainbow' } : { mode: 'solid', color: named ? NAMED[named] : '#fff1d6' };
    } else if (re.screen.test(n) && !re.screenNot.test(p.name) && !/\(yours\)/i.test(p.name)) out.screen = {};
    else if (re.fan.test(n) && !re.fanNot.test(p.name)) out.spin = { fan: true };
    else if (re.rotor.test(p.name)) out.spin = {};
    if (re.motor.test(n) && !/driver|controller|bracket|mount|plate|cover|coupl|holder|clamp/i.test(p.name)) out.motor = true;
  }
  if (out.glow) {
    const g = out.glow;
    if (g.color === 'rainbow') g.mode = 'rainbow';
    g.mode = ['solid', 'rainbow', 'pulse'].includes(g.mode) ? g.mode : 'solid';
    g.color = colorOf(g.color, g.mode === 'pulse' ? '#33b6ff' : '#fff1d6');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the FX object
export function installFX(viewer) { viewer.fx = new FX(viewer); return viewer.fx; }

class FX {
  constructor(v) {
    this.v = v;
    this.on = false;      // power wanted
    this.k = 0;           // 0 off .. 1 fully on (fades)
    this.list = [];       // effect entries for the loaded design
    this.items = null;    // the viewer.items array the list was made for
    this.built = false;   // visuals created
    this.t0 = performance.now(); this.last = this.t0;
    this.startedMove = false;
  }

  /** Work out what the loaded design can do (cheap; visuals are made on first power on). Fires 'viewer:fx'. */
  scan() {
    const v = this.v;
    this.teardown();
    this.items = v.items;
    const list = [];
    const its = v.items.filter(it => it.mesh && it.mesh.geometry?.attributes?.position);
    for (const it of its) {
      const s = specFor(it.p);
      if (s.glow) list.push({ kind: 'glow', it, s: s.glow });
      if (s.screen) list.push({ kind: 'screen', it, s: s.screen });
      if (s.spin) list.push({ kind: 'spin', it, s: s.spin, tracked: !!it.track });
      if (s.motor) list.push({ kind: 'motor', it });
    }
    // edge-lit panels: a clear / light case part right next to a glowing part picks up its light
    const glows = list.filter(e => e.kind === 'glow');
    if (glows.length) {
      for (const it of its) {
        if (it.p.group === 'component' || it.p.fx) continue;
        const c = new THREE.Color(it.p.design_color || it.p.color), L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        if (!(re.lit.test(it.p.name) || (it.p.process === 'laser' && L > 0.45))) continue;
        const b = bboxOf(geoOf(it));
        const src = glows.find(g => boxDist(b, bboxOf(geoOf(g.it))) < 20);
        if (src) list.push({ kind: 'lit', it, src });
      }
    }
    this.list = list;
    const playsMove = !!v.motion; // the Move button is gone (owner): Turn on plays any motion the design has
    this.playsMove = playsMove;
    this.has = list.some(e => e.kind === 'glow' || e.kind === 'screen' || (e.kind === 'spin' && !e.tracked)) || playsMove;
    if (!this.has && this.on) this.setPower(false, true);
    if (this.on) { this.build(); if (this.playsMove && !v.moving) { v.setMoving(true); this.startedMove = true; } }
    this.emit();
  }

  emit() {
    this.v.container.dispatchEvent(new CustomEvent('viewer:fx', { bubbles: true, detail: { viewer: this.v, has: !!this.has, on: this.on } }));
  }

  setPower(on, quiet = false) {
    const v = this.v;
    on = !!on && !!this.has;
    if (on === this.on) return;
    this.on = on;
    if (on) {
      if (this.items !== v.items) this.scan();
      this.build();
      if (this.playsMove && !v.moving) { v.setMoving(true); this.startedMove = true; }
      if (!PHONE()) this.ensureBloom();
    } else if (this.startedMove) { this.startedMove = false; if (v.moving) v.setMoving(false); }
    if (!quiet) this.emit();
  }

  // ------------------------------------------------------------------------------------------------ visuals
  build() {
    if (this.built) return;
    this.built = true;
    let lights = 0;
    for (const e of this.list) {
      try {
        if (e.kind === 'glow') this.buildGlow(e, lights++ < 4);
        else if (e.kind === 'lit') this.buildLit(e);
        else if (e.kind === 'screen') this.buildScreen(e);
        else if (e.kind === 'spin' && !e.tracked) this.buildSpin(e);
      } catch (err) { console.warn('fx: skipped', e.kind, e.it.p.name, err); }
    }
    // one pool per light: a diffuser and the LED ring behind it make one pool, not two stacked
    const pooled = [];
    for (const e of this.list) {
      if (!e.pool) continue;
      const wb = e.box.clone().applyMatrix4(e.it.mesh.matrixWorld);
      if (pooled.some(b => boxDist(b, wb) < 40)) { e.pool.parent?.remove(e.pool); e.pool.geometry.dispose(); e.pool.material.dispose(); e.objs = e.objs.filter(o => o !== e.pool); e.pool = null; }
      else pooled.push(wb);
    }
  }
  teardown() {
    for (const e of this.list) {
      for (const o of e.objs || []) {
        o.parent?.remove(o);
        if (o.geometry && o.userData.ownGeo) o.geometry.dispose();
        if (o.material) { o.material.map?.dispose?.(); o.material.dispose(); }
      }
      e.objs = null;
      if (e.spinU) { e.spinU.rot.value.identity(); }
      if (e.whole) { e.it.mesh.quaternion.identity(); if (e.base) e.it.mesh.position.copy(e.base); }
      if (e.edgesWas !== undefined && e.it.edges) e.it.edges.visible = e.edgesWas;
    }
    this.list = []; this.built = false;
  }

  /** Vertex ranges of a library part's sub-parts that are the light (LED bodies + lenses), or null for the whole part. */
  glowRanges(it) {
    const rs = geoOf(it).userData?.ranges; if (!rs || !it.vc) return null;
    const key = it.p.lib?.key || '';
    let pick = [];
    if (/ws28|neopixel|strip|ring|matrix/.test(key)) pick = rs.filter((r, i) => i > 0 && (r.finish === 'glass' || /^#f[0-9a-f]f[0-9a-f]e[0-9a-f]$/i.test(r.color)) && r.finish !== 'gold');
    else pick = rs.filter(r => r.finish === 'glass');
    return pick.length ? pick : null;
  }

  /** LED glow: an unlit copy of the light's triangles drawn just in front (on BLOOM_LAYER, so desktop bloom sees only it),
   * a small halo sprite per few cm (phones only: no bloom there), a warm point light and a pool of light on the floor. */
  buildGlow(e, withLight) {
    const it = e.it, geo = geoOf(it), ranges = this.glowRanges(it);
    const box = rangeBox(geo, ranges), d = dims(box), ax = longAxis(d), len = Math.max(d[ax], 1e-3);
    let g, own = true;
    if (ranges) {
      let n = 0; for (const r of ranges) n += r.count;
      const pos = new Float32Array(n * 3), src = geo.attributes.position.array;
      let o = 0; for (const r of ranges) { pos.set(src.subarray(r.start * 3, (r.start + r.count) * 3), o * 3); o += r.count; }
      g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    } else { g = new THREE.BufferGeometry(); g.setAttribute('position', geo.attributes.position); own = true; }
    const cnt = g.attributes.position.count, u = new Float32Array(cnt), P = g.attributes.position;
    for (let i = 0; i < cnt; i++) u[i] = clamp((P.getComponent(i, ax) - box.min.getComponent(ax)) / len, 0, 1);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3), 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.Mesh(g, mat); mesh.userData.ownGeo = own; mesh.userData.powerFx = true; mesh.raycast = () => {}; mesh.renderOrder = 3;
    mesh.layers.enable(BLOOM_LAYER);
    it.mesh.add(mesh);
    e.objs = [mesh]; e.u = u; e.geo = g; e.mat = mat;
    // halos along the light
    const c = box.getCenter(new THREE.Vector3()), short = Math.max(Math.min(d[(ax + 1) % 3], d[(ax + 2) % 3]), 3);
    const n = len > 25 ? clamp(Math.round(len / 18), 2, 16) : 1;
    const size = clamp(short * 2, 8, 30);
    e.halos = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.85 }));
      s.position.copy(c); if (n > 1) s.position.setComponent(ax, box.min.getComponent(ax) + len * (i + 0.5) / n);
      s.scale.setScalar(size); s.raycast = () => {}; s.renderOrder = 4; s.userData.u = n > 1 ? (i + 0.5) / n : 0.5; s.userData.halo = true;
      it.mesh.add(s); e.objs.push(s); e.halos.push(s);
    }
    if (withLight) { // lights nearby surfaces (they get brighter; with selective bloom they never halo)
      const L = new THREE.PointLight(0xffffff, 0, Math.max(300, len * 5), 1);
      L.position.copy(c); it.mesh.add(L); e.objs.push(L); e.light = L; e.lightMax = clamp(len * 1.2, 30, 140);
      if (len >= 12) { // a real lamp / strip / ring: a soft pool of its light on the floor under it (when it is held up off the floor)
        // normal blending (not additive): the canvas is transparent over the CSS backdrop, and additive rgb there blows out white
        const pm = new THREE.MeshBasicMaterial({ map: poolMap(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pm);
        pool.rotation.x = -Math.PI / 2; pool.renderOrder = 1; pool.raycast = () => {}; pool.userData.ownGeo = true; pool.userData.powerFx = true;
        this.v.scene.add(pool); e.objs.push(pool); e.pool = pool;
      }
    }
    e.box = box; e.ax = ax;
  }

  /** Edge-lit panel: an additive wash over the panel, brightest at the lit edge, coloured like the light beside it. */
  buildLit(e) {
    const it = e.it, geo = geoOf(it), src = e.src;
    if (!src.box) return; // its light failed to build
    const g = new THREE.BufferGeometry(); g.setAttribute('position', geo.attributes.position);
    const P = geo.attributes.position, cnt = P.count, u = new Float32Array(cnt), f = new Float32Array(cnt);
    const sb = src.box, ax = src.ax, len = Math.max(sb.max.getComponent(ax) - sb.min.getComponent(ax), 1e-3);
    const pd = dims(bboxOf(geo)), reach = Math.max(...pd) * 0.7;
    for (let i = 0; i < cnt; i++) {
      _v.fromBufferAttribute(P, i);
      u[i] = clamp((_v.getComponent(ax) - sb.min.getComponent(ax)) / len, 0, 1);
      f[i] = 0.35 + 0.65 * clamp(1 - sb.distanceToPoint(_v) / reach, 0, 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3), 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat); mesh.userData.ownGeo = true; mesh.userData.powerFx = true; mesh.raycast = () => {}; mesh.renderOrder = 2;
    it.mesh.add(mesh);
    e.objs = [mesh]; e.u = u; e.f = f; e.geo = g; e.mat = mat;
  }

  /** Screen: a canvas readout on the display's face. */
  buildScreen(e) {
    const it = e.it, geo = geoOf(it), p = it.p, s = e.s;
    const all = bboxOf(geo);
    let face = null, rs = it.vc ? geo.userData?.ranges : null;
    if (rs) { // library display: its thinnest glass sub-part is the active area
      const glass = rs.filter(r => r.finish === 'glass').map(r => ({ r, b: rangeBox(geo, [r]) }));
      glass.sort((a, b) => Math.min(...dims(a.b)) - Math.min(...dims(b.b)));
      if (glass.length) face = glass[0].b;
    }
    const box = face || all, d = dims(box);
    let n = thinAxis(d), sign = 1;
    const m = /^([+-])([xyz])$/i.exec(s.face || '');
    if (m) { n = 'xyz'.indexOf(m[2].toLowerCase()); sign = m[1] === '-' ? -1 : 1; }
    else if (face) sign = face.getCenter(new THREE.Vector3()).getComponent(n) >= all.getCenter(new THREE.Vector3()).getComponent(n) ? 1 : -1;
    else sign = (p.explode?.[n] ?? 1) < 0 ? -1 : 1;
    const ia = [0, 1, 2].filter(i => i !== n);
    // text up: CAD +Z when the screen stands up, else the shorter in-plane side
    let upA = ia.includes(2) ? 2 : (d[ia[0]] <= d[ia[1]] ? ia[0] : ia[1]);
    const rightA = ia.find(i => i !== upA);
    const k = face ? 1 : 0.84;
    const w = d[rightA] * k, h = d[upA] * k;
    const N = new THREE.Vector3().setComponent(n, sign), Y = new THREE.Vector3().setComponent(upA, 1);
    const X = new THREE.Vector3().crossVectors(Y, N);
    const c = box.getCenter(new THREE.Vector3()); c.setComponent(n, sign > 0 ? box.max.getComponent(n) + 0.06 : box.min.getComponent(n) - 0.06);
    const cw = 512, ch = clamp(Math.round(512 * h / Math.max(w, 1e-3)), 64, 512);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.userData.ownGeo = true; mesh.raycast = () => {}; mesh.renderOrder = 3;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(X, Y, N).setPosition(c);
    it.mesh.add(mesh);
    const nm = `${p.name} ${p.lib?.key || ''}`;
    const style = /12864|1602|2004|\blcd\b|lcd_/i.test(nm) ? { bg: '#1d49c9', fg: '#eef3ff' } : /oled|ssd1306|sh1106/i.test(nm) ? { bg: '#000000', fg: '#8fe6ff' } : { bg: '#04070c', fg: '#62f0b8' };
    e.cv = cv; e.tex = tex; e.mat = mat; e.objs = [mesh];
    e.bg = colorOf(s.bg, style.bg); e.fg = colorOf(s.fg, style.fg); e.text = typeof s.text === 'string' && s.text.trim() ? s.text : null;
    e.drawn = '';
  }
  drawScreen(e) {
    const now = new Date(), hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
    const lines = e.text ? e.text.split('\n').slice(0, 4) : [`${hh}:${mm}`, '21.4°C   48%'];
    const key = lines.join('|'); if (key === e.drawn) return; e.drawn = key;
    const g = e.cv.getContext('2d'), W = e.cv.width, H = e.cv.height;
    g.fillStyle = e.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = e.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const big = lines.length === 1 ? 1 : 0.62, rows = lines.map((t, i) => ({ t, w: i === 0 ? big : (1 - big) / Math.max(1, lines.length - 1) }));
    let y = H * 0.08;
    for (const r of rows) {
      const rh = H * 0.84 * (lines.length === 1 ? 1 : r.w);
      let fs = rh * 0.8; g.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
      const tw = g.measureText(r.t).width; if (tw > W * 0.9) { fs *= W * 0.9 / tw; g.font = `600 ${fs}px ui-monospace, Menlo, monospace`; }
      g.fillText(r.t, W / 2, y + rh / 2); y += rh;
    }
    e.tex.needsUpdate = true;
  }

  /** Spin: a fan's rotor turns about its axis (shader on the part's own material); other spinners turn as a whole. */
  buildSpin(e) {
    const it = e.it, geo = geoOf(it), s = e.s, P = geo.attributes.position, cnt = P.count;
    const all = bboxOf(geo), rs = it.vc ? geo.userData?.ranges : null;
    let mask = null, axis = null, pivot = null;
    if (Array.isArray(s.axis) && s.axis.length === 3) axis = new THREE.Vector3(...s.axis.map(Number)).normalize();
    if (Array.isArray(s.center) && s.center.length === 3) pivot = new THREE.Vector3(...s.center.map(Number));
    const isFan = s.fan || /fan/i.test(it.p.lib?.key || '');
    if (isFan && rs && rs.length > 1) { // library fan: blades (and the hub label) are their own sub-parts
      const rotor = rs.filter(r => /^#(232428|ece6d4)$/i.test(r.color));
      if (rotor.length) {
        mask = new Float32Array(cnt); for (const r of rotor) mask.fill(1, r.start, r.start + r.count);
        const lab = rs.find(r => /^#ece6d4$/i.test(r.color)), lb = rangeBox(geo, lab ? [lab] : rotor), ld = dims(lb);
        axis ||= new THREE.Vector3().setComponent(thinAxis(ld), 1);
        pivot ||= lb.getCenter(new THREE.Vector3());
      }
    }
    if (!mask && isFan) { // any other fan mesh: what sits inside the frame's bore
      const d = dims(all), n = axis ? [0, 1, 2].reduce((a, i) => Math.abs(axis.getComponent(i)) > Math.abs(axis.getComponent(a)) ? i : a, 0) : thinAxis(d);
      axis ||= new THREE.Vector3().setComponent(n, 1);
      pivot ||= all.getCenter(new THREE.Vector3());
      const S = Math.min(...[0, 1, 2].filter(i => i !== n).map(i => d[i])), R = S * 0.44;
      mask = new Float32Array(cnt);
      for (let t = 0; t < cnt; t += 3) { // whole triangles only, so nothing stretches
        let ok = true;
        for (let j = 0; j < 3 && ok; j++) { _v.fromBufferAttribute(P, t + j).sub(pivot); _v.setComponent(n, 0); ok = _v.length() < R; }
        if (ok) mask.fill(1, t, t + 3);
      }
    }
    e.rpm = clamp(Number(s.rpm) || (isFan ? 210 : 40), 1, 600);
    e.angle = 0; e.speed = 0;
    if (mask && !mask.some(x => x > 0)) { e.objs = []; e.dead = true; return; } // a plain block: nothing to turn
    if (mask) {
      geo.setAttribute('fxSpin', new THREE.BufferAttribute(mask, 1));
      e.spinU = { rot: { value: new THREE.Matrix3() }, pivot: { value: pivot } };
      e.axis = axis;
      patchSpin(it.mat, e.spinU);
      if (it.edges && !it.vc) { e.edgesWas = it.edges.visible; it.edges.visible = false; }
    } else {
      e.whole = true; e.axis = axis || new THREE.Vector3().setComponent(thinAxis(dims(all)), 1);
      e.pivot = pivot || all.getCenter(new THREE.Vector3());
      e.base = it.mesh.position.clone();
    }
    e.objs = [];
  }

  // ------------------------------------------------------------------------------------------------ per frame
  /** viewer.apply hook: X-ray edges, and the built pose of whole-part spinners. */
  apply() {
    const v = this.v, g = !!v.ui.ghost;
    for (const it of v.items) {
      if (it.p.group === 'component' || !it.edges || it.anim) continue;
      if (g) { it.edges.material.opacity = 0.6; it.fxX = true; } else if (it.fxX) { it.edges.material.opacity = 0.35; it.fxX = false; }
    }
    for (const e of this.list) if (e.whole && !e.it.track) e.base = e.it.mesh.position.clone();
  }

  tick() {
    const v = this.v;
    if (v.items !== this.items && this.items !== null) this.scan();
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const target = this.on ? 1 : 0;
    if (this.k === target && !this.on) { this.idle(); return; }
    this.k = target > this.k ? Math.min(1, this.k + dt / 0.6) : Math.max(0, this.k - dt / 0.45);
    const k = this.k, t = (now - this.t0) / 1000, studio = !!v.studio?.on;
    // night
    if (!studio) {
      const NL = this.list.some(e => e.kind === 'glow' || e.kind === 'screen') ? NIGHT_LIGHT : DUSK_LIGHT;
      v.lights.forEach((l, i) => hold(l, 'intensity', 1 + (NL[i] - 1) * k, 'fxN'));
      if (k <= 0.02) this.dayScene();
    }
    const amp = (this.composer && !studio ? 1.3 : 1.1) * k; // daylight (2 Nov): was 2.4 for the night scene, it blew out to white
    for (const e of this.list) {
      if (e.kind === 'glow' && e.geo) this.paintGlow(e, t, amp);
      else if (e.kind === 'lit' && e.geo) this.paintLit(e, t, k);
      else if (e.kind === 'screen' && e.mat) { if (k > 0) this.drawScreen(e); e.mat.opacity = k; e.mat.color.setScalar(this.composer && !studio ? 1.35 : 1); e.objs[0].visible = k > 0.001; }
      else if (e.kind === 'spin' && !e.tracked && (e.spinU || e.whole)) this.stepSpin(e, dt);
    }
    if (!this.on && this.k === 0) this.dayScene(true);
  }
  /** Everything at rest: undo night, settle spinners. */
  idle() {
    if (this.dayDone) { for (const e of this.list) if (e.speed > 0) this.stepSpin(e, 1 / 60); return; }
    this.dayScene(true);
  }
  dayScene(final) {
    const v = this.v;
    if (v.scene.background === nightTex && !v.studio?.on) { v.scene.background = null; v.scene.environment = v.cadEnv; }
    if (final) {
      for (const l of v.lights) release(l, 'intensity', 'fxN');
      release(v.grid.material.uniforms.uAlpha, 'value', 'fxN');
      for (const e of this.list) { if (e.objs) for (const o of e.objs) if (!o.isLight) o.visible = false; if (e.light) e.light.intensity = 0; }
      if (this.list.some(e => e.glassy)) { for (const e of this.list) e.glassy = false; v.apply(); }
      this.dayDone = true;
    } else this.dayDone = false;
  }
  hue(e, u, t) {
    const g = e.s, m = g.mode;
    if (m === 'rainbow') return _c.setHSL(((u * 0.85 + t * 0.12) % 1 + 1) % 1, 1, 0.55);
    _c.set(g.color);
    if (m === 'pulse') _c.multiplyScalar(0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 2.4)));
    return _c;
  }
  paintGlow(e, t, amp) {
    this.dayDone = false;
    const on = amp > 0.001;
    for (const o of e.objs) if (!o.isLight) o.visible = on;
    const col = e.geo.attributes.color, a = col.array, u = e.u;
    if (e.s.mode === 'rainbow') {
      for (let i = 0; i < u.length; i++) { const c = this.hue(e, u[i], t); a[i * 3] = c.r * amp; a[i * 3 + 1] = c.g * amp; a[i * 3 + 2] = c.b * amp; }
    } else { const c = this.hue(e, 0, t); for (let i = 0; i < u.length; i++) { a[i * 3] = c.r * amp; a[i * 3 + 1] = c.g * amp; a[i * 3 + 2] = c.b * amp; } }
    col.needsUpdate = true;
    const k = this.k;
    const bloom = this.bloomActive();
    for (const s of e.halos) { s.visible = on && !bloom; s.material.color.copy(this.hue(e, s.userData.u, t)); s.material.opacity = 0.28 * k; } // phones: a small halo stands in for bloom
    if (e.light) { e.light.color.copy(this.hue(e, 0.5, t)); e.light.intensity = e.lightMax * k * (this.v.studio?.on ? 0.3 : 1); }
    if (e.pool) this.placePool(e, t, k);
  }
  /** The pool of light on the floor right under the source (follows it when the motion moves it). */
  placePool(e, t, k) {
    const v = this.v, pool = e.pool, floor = v.grid.position.y;
    e.it.mesh.updateWorldMatrix(true, false);
    const c = e.box.getCenter(_v).applyMatrix4(e.it.mesh.matrixWorld), h = c.y - floor;
    pool.visible = k > 0.001 && h > 40 && !v.studio?.on && v.grid.visible !== false;
    if (!pool.visible) return;
    const len = e.box.getSize(new THREE.Vector3()).length();
    const r = clamp(h * 0.9 + len, 50, 700);
    pool.position.set(c.x, floor + 0.3, c.z); pool.scale.set(r, r, 1);
    pool.material.color.copy(this.hue(e, 0.5, t)).lerp(_c.set('#ffb85c'), 0.35); // warm
    pool.material.opacity = 0.5 * k * clamp(250 / h, 0.5, 1);
  }
  paintLit(e, t, k) {
    const col = e.geo.attributes.color, a = col.array, u = e.u, f = e.f, amp = (this.composer && !PHONE() ? 0.25 : 0.3) * k; // daylight: a soft tint on the clear case, not a white-out
    e.objs[0].visible = k > 0.001;
    const it = e.it, m = it.mat; // the clear panel goes glassy so the light reads through it (viewer.apply() puts it back)
    if (!it.anim && !this.v.ui.ghost && !this.v.studio?.on) {
      if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
      m.opacity = 1 - 0.62 * k;
      m.depthWrite = false; e.glassy = true;
    }
    for (let i = 0; i < u.length; i++) { const c = this.hue(e.src, u[i], t), s = f[i] * amp; a[i * 3] = c.r * s; a[i * 3 + 1] = c.g * s; a[i * 3 + 2] = c.b * s; }
    col.needsUpdate = true;
  }
  stepSpin(e, dt) {
    const want = this.on ? e.rpm / 60 : 0;
    e.speed += (want - e.speed) * Math.min(1, dt * (this.on ? 1.6 : 0.9));
    if (!this.on && e.speed < 0.02) e.speed = 0;
    e.angle = (e.angle + e.speed * dt * Math.PI * 2) % (Math.PI * 2);
    _q.setFromAxisAngle(e.axis, e.angle);
    if (e.spinU) e.spinU.rot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(_q));
    else if (e.whole && !e.it.track) {
      const m = e.it.mesh; m.quaternion.copy(_q);
      m.position.copy(e.base || m.position).add(_v.copy(e.pivot).sub(e.pivot.clone().applyQuaternion(_q)));
    }
  }

  // ------------------------------------------------------------------------------------------------ bloom (desktop)
  // Selective: a bloom composer renders only the glow meshes (BLOOM_LAYER) over a black, depth-only copy of the scene (so a
  // housing in front still hides the light), blurs that, and the final composer adds the blur over the normal frame.
  // Ordinary surfaces, however brightly lit, are never in the bloom image, so they never halo.
  bloomActive() { return !!this.composer && !this.v.studio?.on && !PHONE(); }
  ensureBloom() {
    if (this.bloomP) return this.bloomP;
    this.bloomP = Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'), import('three/addons/postprocessing/Pass.js'),
    ]).then(([{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }, { Pass }]) => {
      const fx = this, r = this.v.renderer, sz = r.getSize(new THREE.Vector2());
      class GlowOnlyPass extends Pass { // black depth pass of the scene, then just the glow meshes on top
        constructor() { super(); this.needsSwap = false; this.black = new THREE.MeshBasicMaterial({ color: 0x000000 }); this.hid = []; this.cc = new THREE.Color(); }
        render(renderer, writeBuffer, readBuffer) {
          const v = fx.v, scene = v.scene, cam = v.camera;
          const bg = scene.background, ov = scene.overrideMaterial, mask = cam.layers.mask, ac = renderer.autoClear, ca = renderer.getClearAlpha();
          renderer.getClearColor(this.cc);
          // see-through shells, halos, sprites and additive washes must not block the light in the black pass
          scene.traverse(o => {
            if (!o.visible) return;
            const m = o.material;
            if (o.isSprite || o.isPoints || (m && !Array.isArray(m) && m.transparent && (m.opacity < 0.9 || m.blending === THREE.AdditiveBlending))) { o.visible = false; this.hid.push(o); }
          });
          scene.background = null; renderer.setClearColor(0x000000, 1); renderer.autoClear = false;
          renderer.setRenderTarget(readBuffer); renderer.clear();
          scene.overrideMaterial = this.black; renderer.render(scene, cam);
          for (const o of this.hid) o.visible = true; this.hid.length = 0;
          scene.overrideMaterial = null; cam.layers.set(BLOOM_LAYER); renderer.render(scene, cam);
          cam.layers.mask = mask; scene.overrideMaterial = ov; scene.background = bg;
          renderer.autoClear = ac; renderer.setClearColor(this.cc, ca);
        }
      }
      const bc = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
      bc.renderToScreen = false;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(sz.x, sz.y), 0.6, 0, 0);
      // tight: only the finest mips, so it reads as a glow on the emitter, not a white haze over the light backdrop
      this.bloom.compositeMaterial.uniforms.bloomFactors.value = [1, 0.55, 0.18, 0, 0];
      bc.addPass(new GlowOnlyPass()); bc.addPass(this.bloom);
      this.bloomComposer = bc;
      const comp = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      this.rp = new RenderPass(this.v.scene, this.v.camera);
      this.mix = new ShaderPass(new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tDiffuse; uniform sampler2D tBloom; varying vec2 vUv; void main() { vec4 b = texture2D(tDiffuse, vUv); vec3 g = texture2D(tBloom, vUv).rgb; gl_FragColor = vec4(b.rgb + g, clamp(b.a + max(g.r, max(g.g, g.b)), 0.0, 1.0)); }',
      }), 'tDiffuse');
      comp.addPass(this.rp); comp.addPass(this.mix); comp.addPass(new OutputPass());
      this.composer = comp; this.csz = '';
    }).catch(err => { console.warn('fx: bloom unavailable', err); });
    return this.bloomP;
  }
  /** viewer.renderNow hook: true when this drew the frame (power on with bloom). */
  render() {
    const v = this.v;
    if (!this.bloomActive() || this.k < 0.01) return false;
    const r = v.renderer, sz = r.getSize(new THREE.Vector2()), pr = Math.min(devicePixelRatio, 1.5), key = `${sz.x}x${sz.y}@${pr}`;
    if (key !== this.csz) { this.csz = key; for (const c of [this.composer, this.bloomComposer]) { c.setPixelRatio(pr); c.setSize(sz.x, sz.y); } }
    this.rp.camera = v.camera;
    this.bloom.strength = 0.6 * this.k; this.bloom.radius = 0; this.bloom.threshold = 0; // a tight glow on the emitter, not a cloud
    this.bloomComposer.render();
    this.mix.uniforms.tBloom.value = this.bloomComposer.readBuffer.texture;
    this.composer.render();
    return true;
  }
}

/** Rotate the vertices flagged in the `fxSpin` attribute about a pivot (uniforms u.rot, u.pivot) on top of whatever the
 * material's shader already does (finish.js chains the same way). */
function patchSpin(mat, u) {
  if (mat.userData.fxSpin) { mat.userData.fxSpin.rot = u.rot; mat.userData.fxSpin.pivot = u.pivot; return; }
  mat.userData.fxSpin = u;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.fxRot = mat.userData.fxSpin.rot; sh.uniforms.fxPivot = mat.userData.fxSpin.pivot;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float fxSpin;\nuniform mat3 fxRot;\nuniform vec3 fxPivot;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nif (fxSpin > 0.5) objectNormal = fxRot * objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (fxSpin > 0.5) transformed = fxRot * (transformed - fxPivot) + fxPivot;');
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|fx-spin-v1';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------------------------- toolbar UI
// Desktop: a "Turn on" button right after Fit. Phones mirror it as a round model-card button (web/phonestudio.js).
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.8v5.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.6 4a5.2 5.2 0 106.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
export const POWER_ICON = ICON;
function toolbarOf(el) { return el?.closest?.('.model-pane')?.querySelector('.toolbar') || null; }
function ensureBtn(tb) {
  let b = tb.querySelector('.tpower-btn');
  if (b) return b;
  b = document.createElement('button');
  b.type = 'button'; b.className = 'tbtn tpower-btn'; b.hidden = true;
  b.title = 'Turn it on: LEDs glow, screens light up, fans spin';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = ICON + '<span>Turn on</span>';
  const fit = tb.querySelector('#fitBtn, [title="Fit to view"]');
  if (fit) fit.after(b); else tb.append(b);
  return b;
}
function syncBtn(tb) {
  const fx = tb._fxViewer?.fx, b = ensureBtn(tb), on = !!fx?.on;
  b.hidden = !fx?.has;
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  b.querySelector('span').textContent = on ? 'On' : 'Turn on';
}
if (typeof document !== 'undefined' && !window.__builderyFxUi) {
  window.__builderyFxUi = true;
  const st = document.createElement('style');
  st.textContent = '.tbtn.tpower-btn.on{background:#1b2130;color:#ffd27a;box-shadow:0 0 0 1px rgba(255,210,122,.35),0 0 12px rgba(255,190,90,.35)}'
    + '.m-vb[data-v=power].on{color:#ffcf6e;background:linear-gradient(180deg,rgba(30,36,50,.92),rgba(14,17,24,.86));box-shadow:0 0 14px rgba(255,190,90,.45)}';
  document.head.append(st);
  document.addEventListener('viewer:fx', (e) => {
    const tb = toolbarOf(e.target); if (!tb) return;
    tb._fxViewer = e.detail.viewer; syncBtn(tb);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.tpower-btn'); if (!b) return;
    const fx = b.closest('.toolbar')?._fxViewer?.fx; if (!fx) return;
    fx.setPower(!fx.on);
  });
}
