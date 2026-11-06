// Assemble: a product-reveal animation. Parts fly in one by one along their explode directions and seat into place
// (structure first, then boards and electronics, then covers, fasteners last, screws spinning as they drive in), while
// the camera eases around; it ends on the assembled model. ~4-8 s. prefers-reduced-motion: a quick fade instead.
// Order: the server's build plan (server/buildplan.js via /build/<id>/data.json: base first, everything inside fitted and
// wired before the lid closes, fasteners with the part they fix, wiring steps from wiring.json, "Power on and test" last),
// else manifest "assembly_order" (design.py ASSEMBLY), else a heuristic. viewer.playAssembly() starts it (also for a
// launch-video recorder; it resolves when done). Wiring steps highlight both parts and draw the wires in their colours.
// UI: an Assemble button in the desktop toolbar (after Scene / Render). Phones: a "Build steps" pill on the model card
// (web/phonestudio.js) opens the step view as a bottom sheet (phone.css .m-cs-asm) and frames each step in the card.
import * as THREE from 'three';
import { WIRE_HEX, hexCss, partBox, okBox, faceEnds, bowCurve, wireMesh, disposeMesh } from './wires.js'; // wires: shared with the Wiring view (wireview.js)

const FAST = /\b(screws?|bolts?|nuts?|washers?|inserts?|rivets?|nails?|anchors?|shcs|bhcs|csk|grub)\b|\bm[2-8]\s*[x×]\s*\d/i;
const ELEC = /pcb|\bboard\b|module|esp32|arduino|pico|xiao|driver|tmc\d|a4988|sensor|motor|stepper|nema|battery|\bcell\b|\bleds?\b|switch|jack|buck|relay|oled|display|\bfan\b|speaker|usb|wire|cable|mp1584|lm2596|servo|sg90|button|tact/i;
const COVER = /\blid\b|cover|\bcap\b|\btop\b|bezel|door|panel|shroud|face ?plate|diffuser|window|lens|\bhood\b/i;
const YOURS = /\((yours|ref|reference)\)|\byours\b/i;
const MULTI = /\s[×x]\s?\d+(\s*\(\d+\))?$|\s*\(\d+\s*[x×]\)$/i; // "M3 screw ×4": several in one mesh, no spin
const ease = k => 1 - Math.pow(1 - k, 3);
const easeIO = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const vol = it => { const s = it.p.size || it.p.bbox || [1, 1, 1]; return s[0] * s[1] * s[2]; };

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
/** Put a flight track at u (0..1): opacity, offset along its direction, screw spin about the part's own centre. */
function pose(k, u, still, op) {
  const { it } = k, m = it.mesh.material;
  const a0 = still ? u : Math.min(1, u / 0.35);
  m.opacity = op * a0;
  if (it.edges) it.edges.material.opacity = 0.35 * a0;
  if (still) { it.mesh.position.set(0, 0, 0); it.mesh.quaternion.identity(); return; }
  let off = 0, ang = 0;
  if (k.fast && k.axis) { // approach to the hole (first half), then drive in while spinning
    const a = Math.min(1, u / 0.5), b = Math.max(0, (u - 0.5) / 0.5), entry = k.len * 1.05;
    off = u < 0.5 ? entry + (k.dist - entry) * (1 - ease(a)) : entry * (1 - easeIO(b));
    ang = -k.turns * Math.PI * 2 * easeIO(b);
  } else off = k.dist * (1 - ease(u));
  it.mesh.position.copy(k.dir).multiplyScalar(off);
  if (ang) { _q.setFromAxisAngle(k.axis, ang); it.mesh.quaternion.copy(_q); _v.copy(k.c).applyQuaternion(_q); it.mesh.position.add(k.c).sub(_v); }
  else it.mesh.quaternion.identity();
}

export class Assembly {
  constructor(v) {
    this.v = v;
    this.run = null;
    this.manifest = null;
    this.ui = null;
    this.steps = new StepView(v, this);
  }
  get playing() { return !!this.run; }

  onLoad(manifest) { this.stop(false); this.steps.close(); this.manifest = manifest || null; this.guide = null; this.steps._gp = null; this.syncUi(); if (manifest) this.steps.guide().catch(() => {}); }

  /** Steps of items, first to last. */
  order() {
    const items = this.v.items.filter(it => it.mesh.visible);
    const planned = this.guide ? this.steps.fromPlan(this.guide, items) : null; // the server's validated order (prefetched on load)
    if (planned) return planned.map(s => s.items).filter(g => g.length);
    const m = this.manifest, decl = m?.assembly_order || m?.steps;
    if (Array.isArray(decl) && decl.length) {
      const left = new Set(items), steps = [];
      for (const st of decl) {
        const names = (Array.isArray(st) ? st : Array.isArray(st?.parts) ? st.parts : [st]).map(String);
        const got = items.filter(it => left.has(it) && names.some(n => it.p.name === n || it.p.name.startsWith(n + ' (')));
        got.forEach(it => left.delete(it));
        if (got.length) steps.push(got);
      }
      if (left.size) steps.push(...this.heuristic([...left]));
      return steps;
    }
    return this.heuristic(items);
  }
  heuristic(items) {
    const made = items.filter(it => it.p.group !== 'component' && !YOURS.test(it.p.name)).sort((a, b) => vol(b) - vol(a));
    const big = made.length ? vol(made[0]) : 0;
    const yours = items.filter(it => YOURS.test(it.p.name));
    const baseYours = yours.filter(it => vol(it) > big).sort((a, b) => vol(b) - vol(a)); // e.g. a reference handlebar
    const comps = items.filter(it => it.p.group === 'component' && !YOURS.test(it.p.name));
    const fast = comps.filter(it => FAST.test(it.p.name)), elec = comps.filter(it => !FAST.test(it.p.name) && ELEC.test(it.p.name));
    const mech = comps.filter(it => !fast.includes(it) && !elec.includes(it));
    const covers = made.slice(1).filter(it => COVER.test(it.p.name)), structure = made.filter(it => !covers.includes(it));
    // fasteners: the biggest ones (frame bolts) before the small ones
    const seq = [...baseYours, ...structure, ...elec.sort((a, b) => vol(b) - vol(a)), ...mech, ...covers, ...fast.sort((a, b) => vol(b) - vol(a)),
      ...yours.filter(it => !baseYours.includes(it))];
    return seq.map(it => [it]);
  }

  /** Play it. Resolves when it ends (or is stopped). opts: { duration ms (total target), camera: false to hold the view } */
  play(opts = {}) {
    const v = this.v;
    this.stop(false);
    this.steps.close();
    if (!v.items.length) return Promise.resolve(false);
    // Explode and Move off (the explode slider's own handler keeps the toolbar in step)
    if (v.moving) v.setMoving(false);
    const range = v.container.closest('.model-pane')?.querySelector('.toolbar .tslider:not(.tmove-scrub) input');
    if (range && Number(range.value) > 0) { range.value = '0'; range.dispatchEvent(new Event('input', { bubbles: true })); }
    if (v.ui.explode) v.set('explode', 0);
    v.studio?.stopPt?.();
    v.hover?.hide?.();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const steps = this.order(), list = steps.flat();
    if (!list.length) return Promise.resolve(false);
    const R = v.radius || 100;
    const total = Math.max(3500, Math.min(opts.duration || 6500, 9000));
    const fly = still ? 450 : 800, drive = 1100;
    const n = steps.length;
    const lastLen = steps[n - 1].some(it => FAST.test(it.p.name)) ? drive : fly;
    const gap = still ? 0 : Math.max(110, Math.min(650, (total - lastLen - 400) / Math.max(1, n - 1)));
    const tracks = [];
    let t = 0;
    for (const st of steps) {
      st.forEach((it, j) => tracks.push(this.track(it, t + j * Math.min(120, gap / st.length), R, still)));
      t += gap;
    }
    const end = Math.max(...tracks.map(k => k.t0 + k.ms)) + 150;
    // materials: transparent while they fade in (render-mode materials too); restored at the end
    const mats = new Map();
    for (const k of tracks) {
      const m = k.it.mesh.material;
      if (!mats.has(m)) mats.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
      m.transparent = true; m.needsUpdate = true; m.opacity = 0;
      if (k.it.edges) k.it.edges.material.opacity = 0;
      k.op = mats.get(m).opacity || 1;
    }
    // camera: swing in from a wider angle and settle on the current view
    const c = v.controls, cam = {
      on: !still && opts.camera !== false,
      target: c.target.clone(), off: v.camera.position.clone().sub(c.target),
    };
    cam.sph = new THREE.Spherical().setFromVector3(cam.off);
    const userMove = () => { cam.on = false; };
    c.addEventListener('start', userMove);
    let done;
    const p = new Promise(r => { done = r; });
    this.run = { tracks, mats, t0: performance.now() + 60, end, cam, userMove, done, still };
    if (v.present) v.present.idleAt = Infinity;
    this.emit();
    this.tick();
    return p;
  }

  /** One part's flight: from dir * dist to its built place; screws spin about their axis while they drive in. */
  track(it, t0, R, still) {
    const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3()), s = g.boundingBox.getSize(new THREE.Vector3());
    let dir = new THREE.Vector3(...(it.p.explode || [0, 0, 1]));
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const fast = FAST.test(it.p.name);
    let axis = null;
    if (fast) { // a single screw / bolt: one dimension clearly longest -> its axis
      const d = [s.x, s.y, s.z], i = d.indexOf(Math.max(...d)), o = d.filter((_, k) => k !== i);
      const nut = /\bnuts?\b|washer|insert/i.test(it.p.name);
      if (!MULTI.test(it.p.name) && (d[i] > 1.6 * Math.max(...o) || nut)) {
        const ai = nut ? d.indexOf(Math.min(...d)) : i;
        axis = new THREE.Vector3(ai === 0 ? 1 : 0, ai === 1 ? 1 : 0, ai === 2 ? 1 : 0);
        let sg = Math.sign(axis.dot(dir)); if (Math.abs(axis.dot(dir)) < 0.3) sg = axis.z ? 1 : Math.sign(axis.dot(dir)) || 1;
        axis.multiplyScalar(sg || 1);
        dir = axis.clone();
      }
    }
    const len = Math.max(s.x, s.y, s.z);
    const dist = fast ? R * 0.55 + len : R * 0.9;
    return { it, t0, ms: still ? 450 : fast ? 1100 : 800, dir, dist, c, axis, len, fast, turns: axis && !/\bnuts?\b|washer|insert/i.test(it.p.name) ? 3 : axis ? 1.5 : 0 };
  }

  tick() {
    if (this.steps.open) this.steps.tick();
    const r = this.run; if (!r) return;
    const v = this.v, now = performance.now(), t = now - r.t0;
    if (v.ui.explode > 0 || v.moving) return this.stop(); // the user took over
    for (const k of r.tracks) {
      const u = Math.max(0, Math.min(1, (t - k.t0) / k.ms));
      pose(k, u, r.still, k.op);
    }
    if (r.cam.on) { // ease around: -38 deg azimuth and 25 % farther at the start -> the user's view at the end
      const k = easeIO(Math.min(1, Math.max(0, t) / r.end));
      const sp = r.cam.sph.clone(); sp.theta -= 0.66 * (1 - k); sp.radius *= 1 + 0.25 * (1 - k); sp.phi = Math.max(0.15, sp.phi - 0.12 * (1 - k));
      v.camera.position.setFromSpherical(sp).add(r.cam.target); v.controls.target.copy(r.cam.target);
    }
    if (v.studio?.on) { if (!(now - (this._sh || 0) < 120)) { this._sh = now; v.studio.dirtyShadow = true; } }
    if (t >= r.end) this.stop();
  }

  /** End now: everything back to its built pose and normal materials. */
  stop(emit = true) {
    const r = this.run; if (!r) return;
    this.run = null;
    const v = this.v;
    r.cam.on = false;
    v.controls.removeEventListener('start', r.userMove);
    for (const [m, s] of r.mats) { m.transparent = s.transparent; m.opacity = s.opacity; m.depthWrite = s.depthWrite; m.needsUpdate = true; }
    for (const k of r.tracks) { if (k.it.edges) k.it.edges.material.opacity = 0.35; k.it.mesh.quaternion.identity(); }
    for (const it of v.items) if (!it.anim && it.mesh.material === it.mat) v.setMat(it, v.matBase(it));
    v.apply();
    if (v.studio) v.studio.dirtyShadow = true;
    if (v.present) v.present.idleAt = performance.now() + 5000;
    r.done(true);
    if (emit) this.emit();
  }

  emit() {
    this.syncUi();
    this.v.container.dispatchEvent(new CustomEvent('viewer:assembly', { bubbles: true, detail: { viewer: this.v, playing: this.playing } }));
  }

  // ---------------------------------------------------------------- desktop toolbar button
  syncUi() {
    if (!this.ui) {
      const tb = this.v.container.closest('.model-pane')?.querySelector('.toolbar'); if (!tb) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tbtn asm-btn'; b.title = 'Assemble: watch the parts fly in and seat into place';
      b.setAttribute('aria-pressed', 'false');
      (tb.querySelector('.scn-btn') || tb.querySelector('.render-btn') || tb.lastElementChild).after(b);
      b.onclick = () => { if (this.playing) this.stop(); else if (this.steps.open) this.steps.close(); else this.steps.show(); };
      this.ui = b;
    }
    const b = this.ui, on = this.playing || this.steps.open;
    b.hidden = this.v.items.length < 2;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    b.innerHTML = (on
      ? '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Close steps</span>'
      : '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 9.5l3 3 3-3M5.5 12.5V5M9 2.5h4.5V7M13.5 2.5L9.5 6.5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Assemble</span>');
  }
}

// ---------------------------------------------------------------- step-through view (IKEA / LEGO style, in 3D)
const clean = n => String(n).replace(MULTI, '').replace(/\s*\((yours|ref|reference|\d+)\)\s*$/i, '').trim();
/** "Shelf 2" / "Left side" -> "Shelf" / "Side": parts of one kind share a step. */
const family = n => { const f = clean(n).replace(/\s*#?\d+[a-z]?$/i, '').replace(/^(left|right)\s+/i, '').replace(/\s+(left|right)$/i, '').trim() || clean(n); return f[0].toUpperCase() + f.slice(1); };
const plural = w => /(s|x|ch|sh)$/i.test(w) ? w + 'es' : /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : /lf$/i.test(w) ? w.slice(0, -1) + 'ves' : w + 's';
/** [{label, n}] by family ("Shelf", 3). */
function families(items) { const m = new Map(); for (const it of items) { const f = family(it.p.name); m.set(f, (m.get(f) || 0) + 1); } return [...m].map(([label, n]) => ({ label, n })); }
const qty = n => { const t = String(n).replace(/\s*\(\d+\)\s*$/, ''), m = t.match(/\s[×x]\s?(\d+)$/i) || String(n).match(/\((\d+)\s*[x×]\)$/i); return m ? +m[1] : 1; };
const joinList = a => a.length <= 1 ? (a[0] || '') : a.length <= 3 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : `${a.slice(0, 2).join(', ')} and ${a.length - 2} more`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HL = 0xff7a1a;
/** A wiring step's list: "VCC → 3V3" with the wire's colour. */
const wireList = (st, cls) => (st.wires || []).length ? `<ul class="${cls}">${st.wires.map(w => `<li><i style="background:${hexCss(w.color)}"></i><span>${esc(w.text)}</span>${w.color && !w.guess ? `<em>${esc(w.color)}</em>` : ''}</li>`).join('')}</ul>` : '';
/** The line under a step's title: the guide's text, or (plan steps) only what the title doesn't already say. */
const subLine = st => { const t = String(st.text || '').trim(); if (!st.title || st.wires?.length) return st.wires?.length ? st.note || '' : ''; return t && t.replace(/\.$/, '') !== st.title ? t.replace(st.title + '. ', '') : ''; };

/** Group fasteners by name: [{label, n}] ("4 × M3×10 socket head screw"). */
function fastenerList(items) {
  const m = new Map();
  for (const it of items) { const l = clean(it.p.name); m.set(l, (m.get(l) || 0) + qty(it.p.name)); }
  return [...m].map(([label, n]) => ({ label, n }));
}
/** A one-line instruction from the parts a step adds. */
function stepLine(items, i) {
  const fast = items.filter(it => FAST.test(it.p.name)), main = items.filter(it => !fast.includes(it));
  const names = families(main).map(f => f.n < 2 ? f.label : /[a-z]$/i.test(f.label) ? `${f.n} ${plural(f.label)}` : `${f.label} (×${f.n})`);
  const fl = fastenerList(fast).map(f => f.n > 1 ? `${f.n} × ${f.label}` : f.label);
  const yours = main.length && main.every(it => YOURS.test(it.p.name));
  let line;
  if (!main.length) line = fl.length ? `Fasten it with ${joinList(fl)}` : 'Check everything sits right';
  else if (i === 0) line = `Start with the ${joinList(names)}`;
  else if (yours) line = `Put your ${joinList(names)} in place`;
  else if (main.every(it => it.p.group === 'component' && ELEC.test(it.p.name))) line = `Fit the ${joinList(names)}`;
  else if (main.every(it => COVER.test(it.p.name))) line = `Close it up with the ${joinList(names)}`;
  else line = `Add the ${joinList(names)}`;
  if (main.length && fl.length) line += ` and fix ${main.length > 1 ? 'them' : 'it'} with ${joinList(fl)}`;
  return line;
}

class StepView {
  constructor(v, asm) { this.v = v; this.asm = asm; this.open = false; this.list = []; this.i = 0; this.el = null; this.mats = new Map(); this.lines = []; }

  /** Steps: the server's build plan (or the written guide that follows it), else assembly_order, else the heuristic
   * with each fastener grouped into the step of the part it is closest to. A step: {title, text, items (added), hl
   * (already in, highlighted: the two ends of a wiring step), wires, kind, note}. */
  async plan() {
    const v = this.v, items = v.items.filter(it => it.mesh.visible || v.hidden.has(it.p.name));
    let steps = this.fromPlan(await this.guide(), items) || [];
    if (!steps.length) {
      const decl = this.asm.manifest?.assembly_order;
      let groups;
      if (Array.isArray(decl) && decl.length) groups = this.asm.order().map(st => st.filter(it => items.includes(it)));
      else groups = this.grouped(items);
      steps = groups.filter(g => g.length).map((g, i) => ({ items: g, hl: [], wires: [], kind: 'place', title: null, text: stepLine(g, i) }));
    }
    for (const st of steps) st.items.sort((a, b) => FAST.test(a.p.name) - FAST.test(b.p.name)); // fasteners fly in last
    return steps;
  }
  /** buildtime: best-case seconds to build it by hand, counted per action in the plan (someone who has the parts laid
   * out and done it once): printed/made part 8 s, bought part 12 s, each fastener 6 s, each wire 5 s, flash 60 s, test 15 s. */
  async estimate() {
    const steps = await this.plan();
    const qty = name => Number((String(name).match(/[×x]\s*(\d+)\s*(?:\(\d+\))?\s*$/) || [])[1]) || 1; // "M3 screw ×4"
    let s = 0;
    for (const st of steps) {
      if (st.kind === 'flash') s += 60; else if (st.kind === 'test') s += 15;
      s += 5 * (st.wires?.length || 0);
      for (const it of st.items) s += FAST.test(it.p.name) ? 6 * qty(it.p.name) : it.p.group === 'case' ? 8 : 12;
    }
    return s;
  }
  /** data.json -> steps on these items: the written guide when it is current (it follows the plan), else the plan. */
  fromPlan(d, items) {
    if (!d) return null;
    const src = d.state === 'ready' && d.steps?.length && d.steps.every(s => s.kind) ? d.steps : d.plan?.steps;
    if (!src?.length) return null;
    const byFile = new Map(items.map(it => [it.p.file, it]));
    const map = (files, names, pool) => {
      const got = (files || []).map(f => byFile.get(f)).filter(it => it && (!pool || pool.has(it)));
      if (got.length || !names?.length) return [...new Set(got)];
      return items.filter(it => (!pool || pool.has(it)) && names.some(n => it.p.name === n || clean(it.p.name) === clean(n)));
    };
    const left = new Set(items);
    const steps = [];
    for (const g of src) {
      const got = map(g.files, g.parts, left); got.forEach(it => left.delete(it));
      const st = { kind: g.kind || 'place', title: g.title, text: g.text, note: g.note || '', items: got, hl: g.kind === 'place' ? [] : map(g.hl_files, g.hl), wires: g.wires || [], missing: !!g.missing };
      if (st.items.length || st.kind !== 'place') steps.push(st);
    }
    if (steps.filter(s => s.items.length).length < 1) return null;
    if (left.size) { const last = [...steps].reverse().find(s => s.kind === 'place') || steps[steps.length - 1]; last.items.push(...left); }
    return steps;
  }
  async guide() {
    if (this.asm.guide !== null && this.asm.guide !== undefined) return this.asm.guide;
    if (this._gp) return this._gp;
    const id = this.v.sceneHint?.id || (location.pathname.match(/^\/build\/([^/?#]+)/) || [])[1] || (location.pathname.match(/^\/(?:designs|examples)\/([^/?#]+)/) || [])[1];
    const tok = this.asm.manifest;
    const gp = this._gp = (async () => {
      let d = false;
      if (id) {
        try {
          const r = await fetch(`/build/${encodeURIComponent(id)}/data.json`, { cache: 'no-store', credentials: 'same-origin' });
          if (r.ok) d = await r.json();
        } catch {}
      }
      if (this._gp === gp) this._gp = null;
      if (this.asm.manifest !== tok) return false; // another design loaded meanwhile
      return (this.asm.guide = d || false);
    })();
    return gp;
  }
  grouped(items) {
    const seq = this.asm.heuristic(items).flat();
    const fast = seq.filter(it => FAST.test(it.p.name)), rest = seq.filter(it => !fast.includes(it));
    const groups = [], fam = new Map();
    let elec = null, yours = null;
    rest.forEach((it, i) => { // one step per kind of part (the base alone); electronics share a step, your own things the last
      if (YOURS.test(it.p.name) && i > 0) { if (!yours) yours = []; yours.push(it); }
      else if (it.p.group === 'component' && ELEC.test(it.p.name)) { if (!elec) groups.push(elec = []); elec.push(it); }
      else if (i === 0) groups.push([it]);
      else { const k = it.p.group + ':' + family(it.p.name); if (!fam.has(k)) { const g = []; fam.set(k, g); groups.push(g); } fam.get(k).push(it); }
    });
    if (yours) groups.push(yours);
    const box = it => { const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox; };
    for (const f of fast) { // into the step of the nearest part (the later step when it touches several)
      const c = box(f).getCenter(new THREE.Vector3());
      let best = null, bd = Infinity;
      groups.forEach((g, gi) => g.forEach(it => { const d = box(it).intersectsBox(box(f)) ? 0 : box(it).distanceToPoint(c); if (d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && gi > best)) { bd = Math.min(bd, d); best = gi; } }));
      if (best == null) groups.push([f]); else groups[best].push(f);
    }
    return groups.length ? groups : [items];
  }

  async show(at = 0, opts = {}) { // opens playing (owner: "it should default to playing"); opts.play === false opens paused
    const v = this.v;
    if (!v.items.length) return;
    this.asm.stop(false);
    if (v.moving) v.setMoving(false);
    const range = v.container.closest('.model-pane')?.querySelector('.toolbar .tslider:not(.tmove-scrub) input');
    if (range && Number(range.value) > 0) { range.value = '0'; range.dispatchEvent(new Event('input', { bubbles: true })); }
    if (v.ui.explode) v.set('explode', 0);
    v.studio?.stopPt?.();
    this.list = await this.plan();
    if (!this.list.length) return;
    this.open = true;
    this.playing = opts.play !== false;
    if (v.present) v.present.idleAt = Infinity; // phone card: the turntable holds still while the steps show
    if (!this._camHook) { this._camHook = true; v.controls.addEventListener('start', () => { if (this.camAnim) { v.anims.delete(this.camAnim); this.camAnim = null; } }); } // the user rotates: drop the framing ease
    this.mount();
    this.go(Math.max(0, Math.min(at, this.list.length - 1)), true);
    this.asm.emit();
  }

  close() {
    if (!this.open) return;
    this.open = false; this.playing = false;
    const v = this.v;
    for (const [m, s] of this.mats) { m.transparent = s.transparent; m.opacity = s.opacity; m.depthWrite = s.depthWrite; if (m.emissive) { m.emissive.copy(s.emissive); m.emissiveIntensity = s.ei; } m.needsUpdate = true; }
    this.mats.clear();
    for (const l of this.lines) { l.parent?.remove(l); l.material.dispose(); }
    this.lines = [];
    this.clearWires();
    for (const it of v.items) { it.mesh.quaternion.identity(); if (it.edges) it.edges.material.opacity = 0.35; if (!it.anim && it.mesh.material === it.mat) v.setMat(it, v.matBase(it)); }
    v.apply();
    if (v.studio) v.studio.dirtyShadow = true;
    if (this.camAnim) { v.anims.delete(this.camAnim); this.camAnim = null; }
    if (this.el) { const el = this.el; el.classList.remove('on'); setTimeout(() => { if (!this.open) { el.hidden = true; el.style.transform = ''; } }, el.classList.contains('m-cs-asm') ? 400 : 260); }
    if (v.present) v.present.idleAt = performance.now() + 5000;
    this.asm.emit();
  }

  /** Go to step i: earlier parts stay (muted), this step's parts fly in highlighted, later ones are hidden. */
  go(i, first = false) {
    if (!this.open) return;
    const n = this.list.length;
    i = Math.max(0, Math.min(n - 1, i));
    const back = i < this.i && !first;
    this.i = i;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const R = this.v.radius || 100, st = this.list[i], cur = st.items;
    this.tracks = back ? [] : cur.map((it, j) => { const k = this.asm.track(it, j * 140, R, still); k.op = 1; return k; });
    if (back) this.tracks = cur.map(it => ({ it, t0: 0, ms: 1, dir: new THREE.Vector3(), dist: 0, op: 1 }));
    this.t0 = performance.now();
    this.holdUntil = this.t0 + Math.max(0, ...this.tracks.map(k => k.t0 + k.ms)) + (still ? 1600 : 1300) + Math.min(4000, 450 * (st.wires?.length || 0)); // time to read a wire list
    for (const l of this.lines) { l.parent?.remove(l); l.material.dispose(); }
    this.lines = [];
    this.drawWires(i);
    for (const it of [...cur, ...(st.hl || [])]) { // orange outline on the new parts (and both ends of a wiring step)
      if (!it.edges) continue;
      const l = new THREE.LineSegments(it.edges.geometry, new THREE.LineBasicMaterial({ color: HL, transparent: true, opacity: 0.9 }));
      l.raycast = () => {}; l.userData.fx = true; l.renderOrder = 3; it.mesh.add(l); this.lines.push(l);
    }
    const all = this.list.slice(0, i + 1).flatMap(s => s.items);
    this.frameOn(cur.length ? cur : st.hl?.length ? st.hl : all, !cur.length && !st.hl?.length);
    this.render();
  }

  // ---------------------------------------------------------------- wires (wiring steps): simple coloured tubes
  clearWires() { for (const w of this.wires || []) disposeMesh(w); this.wires = []; }
  /** Wires of every wiring step up to i: this step's bright and drawn on top, earlier ones faint. Each runs from the
   * nearest face of one part to the other, sagging up a little, fanned out so a bundle reads as separate wires. */
  drawWires(i) {
    this.clearWires();
    const v = this.v, R = v.radius || 100;
    const find = n => v.items.find(it => it.p.name === n) || v.items.find(it => clean(it.p.name) === clean(n));
    this.list.slice(0, i + 1).forEach((st, si) => (st.wires || []).forEach((w, j, arr) => {
      const a = find(w.from.part), b = find(w.to.part);
      if (!a || !b || a === b) return;
      const ba = partBox(a), bb = partBox(b); if (!okBox(ba) || !okBox(bb)) return;
      const [pa, pb] = faceEnds(ba, bb);
      if (pa.distanceTo(pb) < 0.5) return;
      const now = si === i;
      const m = wireMesh(bowCurve(pa, pb, j, arr.length, R), { color: WIRE_HEX[w.color] ?? 0xb8b2a7, radius: Math.max(0.45, R * (now ? 0.006 : 0.004)), opacity: now ? 1 : 0.4, onTop: now, order: now ? 5 : 2 });
      v.world.add(m); this.wires.push(m);
    }));
  }
  next() { if (this.i < this.list.length - 1) this.go(this.i + 1); else this.close(); }
  prev() { if (this.i > 0) this.go(this.i - 1); }
  togglePlay() {
    this.playing = !this.playing;
    if (this.playing && this.i >= this.list.length - 1) this.go(0);
    else if (this.playing) this.holdUntil = Math.min(this.holdUntil, performance.now() + 500);
    this.render();
  }

  /** Ease the camera to frame the new parts (with some of the model around them), keeping the viewing angle. */
  frameOn(items, wholeModel = false) {
    if (this.v.present) return this.frameCard(items, wholeModel); // phone card
    const v = this.v, b = new THREE.Box3();
    v.world.updateMatrixWorld(true);
    for (const it of items) { const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); b.union(g.boundingBox.clone().applyMatrix4(v.world.matrixWorld)); }
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const first = this.i === 0 || wholeModel, t1 = first ? v.center.clone() : v.center.clone().lerp(c, 0.8);
    // fit a sphere round the new parts (at least a third of the model, the whole model on step 1) in the narrower fov
    const whole = v.fitBox && !v.fitBox.isEmpty() ? v.fitBox.getSize(new THREE.Vector3()).length() / 2 : v.radius;
    const rad = first ? whole : Math.max(s.length() / 2 * 1.3, whole * 0.35);
    const vh = THREE.MathUtils.degToRad(v.camera.fov) / 2, half = Math.min(vh, Math.atan(Math.tan(vh) * v.camera.aspect));
    const dist = rad / Math.sin(half) * (v.present ? 1.1 : 1);
    t1.y -= rad * 0.12; // the bar covers the bottom of the view: the parts sit a little higher
    const dir = v.camera.position.clone().sub(v.controls.target).normalize();
    const p0 = v.camera.position.clone(), q0 = v.controls.target.clone(), p1 = t1.clone().addScaledVector(dir, dist);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.controls.target.copy(t1); v.camera.position.copy(p1); return; }
    v.animate(700, k => { v.controls.target.lerpVectors(q0, t1, k); v.camera.position.lerpVectors(p0, p1, k); });
  }

  /** Phone card: fit this step's parts, with some of the built model around them, into the card's visible area (below
   * the glass top bar: viewer.present.offsetY), using the card's real aspect ratio so a long rail fills the width. Step 1
   * turns a long, thin model side-on. The camera eases (target, direction and log-distance) so steps never jump-zoom. */
  frameCard(items, whole = false) {
    const v = this.v, W = v.world;
    W.updateMatrixWorld(true);
    const wbox = it => { const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox.clone().applyMatrix4(W.matrixWorld); };
    const ok = b => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite); // a library sub-mesh can have an empty (NaN) box
    const union = list => list.reduce((b, it) => { const x = wbox(it); return ok(x) ? b.union(x) : b; }, new THREE.Box3());
    const sb = union(items); if (sb.isEmpty()) return;
    const all = union(this.list.flatMap(s => s.items)), seen = union(this.list.slice(0, this.i + 1).flatMap(s => s.items));
    // context: the new parts stay centred, with a margin of a tenth of what is built so far round them; never smaller
    // than a third of the whole model
    const fb = (whole ? all.clone() : sb.clone()).expandByVector(seen.getSize(new THREE.Vector3()).multiplyScalar(this.i && !whole ? 0.1 : 0.04));
    const md = all.getSize(new THREE.Vector3()).length(), fd = fb.getSize(new THREE.Vector3()).length();
    if (fd < md * 0.33) { const c = fb.getCenter(new THREE.Vector3()), k = md * 0.33 / Math.max(fd, 1e-3); fb.min.sub(c).multiplyScalar(k).add(c); fb.max.sub(c).multiplyScalar(k).add(c); }
    const q0 = v.controls.target.clone(), off0 = v.camera.position.clone().sub(q0), d0 = off0.length(), dir0 = off0.clone().normalize();
    let dir1 = dir0.clone();
    if (this.i === 0) { // a long, thin model (a 600 mm rail): look at its long side, 35 deg round, 20-40 deg from above
      const s = all.getSize(new THREE.Vector3()), sp = new THREE.Spherical().setFromVector3(dir0);
      if (Math.max(s.x, s.z) > 2.2 * Math.min(s.x, s.z)) {
        const base = s.x >= s.z ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
        const cands = base.flatMap(b => [b - 0.6, b + 0.6]);
        const dth = a => Math.abs(Math.atan2(Math.sin(a - sp.theta), Math.cos(a - sp.theta)));
        sp.theta = cands.reduce((a, b) => dth(b) < dth(a) ? b : a);
      }
      sp.phi = Math.max(0.88, Math.min(1.22, sp.phi)); sp.radius = 1;
      dir1 = new THREE.Vector3().setFromSpherical(sp).normalize();
    }
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir1).normalize(), up = new THREE.Vector3().crossVectors(dir1, right);
    const h = v.container.clientHeight || 1, oy = v.present.offsetY || 0;
    const tv = Math.tan(THREE.MathUtils.degToRad(v.camera.fov) / 2), tvis = tv * Math.max(0.3, (h - 2 * oy) / h), th = tv * v.camera.aspect;
    const c = fb.getCenter(new THREE.Vector3()), P = [], p = new THREE.Vector3();
    for (const x of [fb.min.x, fb.max.x]) for (const y of [fb.min.y, fb.max.y]) for (const z of [fb.min.z, fb.max.z]) { p.set(x, y, z).sub(c); P.push([p.dot(right), p.dot(up), p.dot(dir1)]); }
    const cr = (Math.min(...P.map(q => q[0])) + Math.max(...P.map(q => q[0]))) / 2, cu = (Math.min(...P.map(q => q[1])) + Math.max(...P.map(q => q[1]))) / 2;
    let d1 = 1;
    for (const [r, u, f] of P) d1 = Math.max(d1, f + Math.abs(r - cr) / th, f + Math.abs(u - cu) / tvis);
    d1 *= 1.1; // padding round the parts
    const t1 = c.clone().addScaledVector(right, cr).addScaledVector(up, cu);
    if (d1 / 200 < v.camera.near) { v.camera.near = Math.max(0.1, d1 / 200); v.camera.updateProjectionMatrix(); }
    if (this.camAnim) { v.anims.delete(this.camAnim); this.camAnim = null; }
    const place = (t, dir, d) => { v.controls.target.copy(t); v.camera.position.copy(t).addScaledVector(dir, d); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return place(t1, dir1, d1);
    const tq = new THREE.Vector3(), dq = new THREE.Vector3();
    this.camAnim = v.animate(this.i === 0 ? 1100 : 950, k => { // v.animate eases out; undo that and ease in-out instead
      const e = easeIO(1 - Math.cbrt(1 - k));
      place(tq.lerpVectors(q0, t1, e), dq.copy(dir0).lerp(dir1, e).normalize(), d0 * Math.pow(d1 / d0, e));
    }, () => { this.camAnim = null; });
  }

  /** Every frame while open: hold each part in its state (apply() may have reset it) and run this step's flights. */
  tick() {
    const v = this.v, now = performance.now();
    if (v.ui.explode > 0 || v.moving) return this.close();
    if (v.present) v.present.idleAt = Infinity;
    const st = this.list[this.i], cur = new Set([...(st?.items || []), ...(st?.hl || [])]), past = new Set(this.list.slice(0, this.i).flatMap(s => s.items));
    const done = st?.kind === 'test' || st?.kind === 'flash'; // flash the firmware, power on and test: the finished product, nothing muted
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const save = m => { if (!this.mats.has(m)) this.mats.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, emissive: m.emissive?.clone(), ei: m.emissiveIntensity }); };
    const glow = 0.3 + 0.12 * Math.sin((now - this.t0) / 260);
    for (const it of v.items) {
      const m = it.mesh.material; save(m);
      const userOff = v.hidden.has(it.p.name) || (it.p.group === 'component' && !v.ui.showComp);
      if (past.has(it) && !cur.has(it)) {
        it.mesh.visible = !userOff; it.mesh.position.set(0, 0, 0); it.mesh.quaternion.identity();
        if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
        m.opacity = done ? 1 : 0.5; m.depthWrite = true;
        if (m.emissive) m.emissive.setHex(0);
        if (it.edges) it.edges.material.opacity = 0.2;
      } else if (cur.has(it)) {
        it.mesh.visible = !userOff;
        if (past.has(it)) { it.mesh.position.set(0, 0, 0); it.mesh.quaternion.identity(); m.opacity = 1; } // a wiring step's ends: in place, lit
        if (!m.transparent) { m.transparent = true; m.needsUpdate = true; }
        m.depthWrite = true;
        if (m.emissive) { m.emissive.setHex(HL); m.emissiveIntensity = glow; }
      } else it.mesh.visible = false;
    }
    for (const k of this.tracks || []) pose(k, Math.max(0, Math.min(1, (now - this.t0 - k.t0) / k.ms)), still, 1);
    if (v.studio?.on && !(now - (this._sh || 0) < 120)) { this._sh = now; v.studio.dirtyShadow = true; }
    if (this.playing && now > this.holdUntil) { if (this.i < this.list.length - 1) this.go(this.i + 1); else { this.playing = false; this.render(); } }
  }

  // ---------------------------------------------------------------- the bar (desktop: in the model pane; phones: a bottom bar)
  mount() {
    const phone = matchMedia('(max-width: 640px)').matches;
    if (!this.el) {
      stepCss();
      const el = this.el = document.createElement('div');
      el.className = 'asm-bar'; el.hidden = true; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Assembly steps');
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'prev') { this.playing = false; this.prev(); } else if (a === 'next') { this.playing = false; this.next(); }
        else if (a === 'play') this.togglePlay(); else if (a === 'close') this.close();
        else if (a === 'dot') { this.playing = false; this.go(+b.dataset.i); }
      });
      let sx = null, sy = 0; // swipe left / right to change step
      el.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; sx = e.clientX; sy = e.clientY; });
      el.addEventListener('pointerup', e => {
        if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          if (this.phone && dx < 0 && this.i >= this.list.length - 1) return; // phones: swiping past the last step does not close the sheet
          this.playing = false; dx < 0 ? this.next() : this.prev(); this.render();
        }
      });
      el.addEventListener('pointercancel', () => { sx = null; });
      document.addEventListener('keydown', e => {
        if (!this.open || e.target.closest?.('input, textarea, [contenteditable=true]')) return;
        if (e.key === 'ArrowRight') { this.playing = false; this.next(); } else if (e.key === 'ArrowLeft') { this.playing = false; this.prev(); }
        else if (e.key === 'Escape') this.close(); else return;
        e.preventDefault();
      });
    }
    const el = this.el, pane = this.v.container.closest('.model-pane') || this.v.container.parentElement;
    const host = phone ? document.body : pane;
    if (el.parentElement !== host) host.append(el);
    // phones: a native bottom sheet over the chat (phone.css .m-csheet, the Parts / Explode look), under the model card
    el.className = phone ? 'm-csheet m-cs-asm' + (el.classList.contains('on') ? ' on' : '') : 'asm-bar' + (el.classList.contains('on') ? ' on' : '');
    el.setAttribute('role', phone ? 'dialog' : 'region');
    this.phone = phone;
    if (phone) this.fit();
    el.hidden = false; void el.offsetHeight; el.classList.add('on');
  }
  /** Phones: the sheet never reaches up over the model card. */
  fit() {
    const el = this.el; if (!el) return;
    const top = this.v.container.closest('.model-pane')?.getBoundingClientRect().bottom || 0;
    el.style.maxHeight = Math.max(200, innerHeight - top - 8) + 'px';
  }
  render() {
    const el = this.el; if (!el || !this.open) return;
    const n = this.list.length, st = this.list[this.i], last = this.i === n - 1;
    const fl = fastenerList(st.items.filter(it => FAST.test(it.p.name)));
    const chips = families((st.items.length ? st.items : st.hl || []).filter(it => !FAST.test(it.p.name))).slice(0, 4).map(f => `<span class="asm-chip">${f.n > 1 ? `<b>×${f.n}</b> ` : ''}${esc(f.label)}</span>`)
      .concat(fl.map(f => `<span class="asm-chip asm-fast">${f.n > 1 ? `<b>×${f.n}</b> ` : ''}${esc(f.label)}</span>`)).join('');
    const ic = {
      prev: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      next: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      play: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>',
      pause: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="4" y="3.5" width="2.6" height="9" rx=".8" fill="currentColor"/><rect x="9.4" y="3.5" width="2.6" height="9" rx=".8" fill="currentColor"/></svg>',
      x: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      again: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.2 6.2A5.2 5.2 0 1 1 2.8 9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M2.6 2.8v3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };
    if (this.phone) {
      el.innerHTML = `
      <div class="m-cs-head"><div class="m-grab" aria-hidden="true"></div><b class="m-cs-title" aria-live="polite">Step ${this.i + 1} of ${n}</b>
        <button type="button" class="m-cs-x" data-a="close" aria-label="Close steps">${ic.x}</button></div>
      <div class="asm-pdots" aria-hidden="true">${this.list.map((_, i) => `<i class="${i === this.i ? 'on' : i < this.i ? 'done' : ''}"></i>`).join('')}</div>
      <div class="asm-ptxt">${st.title ? `<div class="asm-ptitle">${esc(st.title)}</div>${subLine(st) ? `<div class="asm-pline">${esc(subLine(st))}</div>` : ''}` : `<div class="asm-ptitle">${esc(st.text)}</div>`}
        ${wireList(st, 'asm-wires')}<div class="asm-chips">${chips}</div></div>
      <div class="asm-pctl">
        <button type="button" class="asm-pnav" data-a="prev" aria-label="Previous step" ${this.i ? '' : 'disabled'}>${ic.prev}</button>
        ${last && !this.playing ? `<button type="button" class="asm-pplay asm-again" data-a="play" aria-label="Play again">${ic.again}<span>Play again</span></button>` // phonekit: the end of the steps
          : `<button type="button" class="asm-pplay" data-a="play" aria-label="${this.playing ? 'Pause' : 'Play the steps'}">${this.playing ? ic.pause : ic.play}</button>`}
        <button type="button" class="asm-pnav asm-pnext" data-a="next" aria-label="${last ? 'Done' : 'Next step'}">${last ? '<span>Done</span>' : ic.next}</button>
      </div>`;
      return;
    }
    el.innerHTML = `
      <div class="asm-top"><span class="asm-count" aria-live="polite">Step ${this.i + 1} of ${n}</span>
        <div class="asm-dots" role="group" aria-label="Steps">${this.list.map((_, i) => `<button type="button" data-a="dot" data-i="${i}" class="${i === this.i ? 'on' : i < this.i ? 'done' : ''}" aria-label="Step ${i + 1}" ${i === this.i ? 'aria-current="step"' : ''}></button>`).join('')}</div>
        <button type="button" class="asm-x" data-a="close" aria-label="Close steps">${ic.x}</button></div>
      <div class="asm-main">
        <button type="button" class="asm-nav" data-a="prev" aria-label="Previous step" ${this.i ? '' : 'disabled'}>${ic.prev}</button>
        <div class="asm-txt">${st.title ? `<div class="asm-title">${esc(st.title)}</div>${subLine(st) ? `<div class="asm-line" title="${esc(st.text || '')}">${esc(subLine(st))}</div>` : ''}` : `<div class="asm-title">${esc(st.text)}</div>`}
          ${wireList(st, 'asm-wires')}<div class="asm-chips">${chips}</div></div>
        <button type="button" class="asm-play" data-a="play" aria-label="${this.playing ? 'Pause' : 'Play the steps'}">${this.playing ? ic.pause : ic.play}</button>
        <button type="button" class="asm-nav asm-next" data-a="next" aria-label="${last ? 'Done' : 'Next step'}">${last ? '<span>Done</span>' : ic.next}</button>
      </div>`;
  }
}

let stepCssDone = false;
function stepCss() {
  if (stepCssDone) return; stepCssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.asm-bar { position: absolute; z-index: 6; left: 50%; bottom: 14px; width: min(640px, calc(100% - 24px)); transform: translate(-50%, 12px); opacity: 0;
  transition: transform .26s cubic-bezier(.2,.8,.2,1), opacity .2s; padding: 10px 12px 12px; border-radius: 16px;
  background: rgba(255,255,255,.92); -webkit-backdrop-filter: blur(18px) saturate(1.6); backdrop-filter: blur(18px) saturate(1.6);
  box-shadow: 0 0 0 .5px rgba(28,25,23,.12), 0 12px 32px rgba(28,25,23,.16); color: #1c1917; font: 400 14px/1.35 var(--ui, system-ui); touch-action: pan-y; user-select: none; }
.asm-bar.on { transform: translate(-50%, 0); opacity: 1; }
.asm-bar[hidden] { display: none; }
.asm-top { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.asm-count { font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.asm-dots { flex: 1; display: flex; gap: 3px; align-items: center; min-width: 0; }
.asm-dots button { flex: 1; max-width: 28px; height: 16px; padding: 0; border: 0; background: none; cursor: pointer; position: relative; }
.asm-dots button::after { content: ''; position: absolute; left: 0; right: 0; top: 6px; height: 4px; border-radius: 2px; background: rgba(28,25,23,.14); transition: background .2s; }
.asm-dots button.done::after { background: rgba(232,89,12,.4); }
.asm-dots button.on::after { background: #e8590c; }
.asm-x { width: 28px; height: 28px; border-radius: 50%; border: 0; display: grid; place-items: center; background: rgba(118,118,128,.12); color: #55524b; cursor: pointer; flex: none; }
.asm-main { display: flex; align-items: center; gap: 8px; }
.asm-txt { flex: 1; min-width: 0; }
.asm-title { font-weight: 600; font-size: 15px; line-height: 1.3; }
.asm-line { color: #6b665e; font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.asm-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.asm-chip { padding: 2px 8px; border-radius: 10px; background: rgba(232,89,12,.1); color: #b4430a; font-size: 12px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.asm-chip b { font-weight: 700; }
.asm-wires { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 3px 14px; font: 500 13px/1.3 var(--ui, system-ui); }
.asm-wires li { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.asm-wires i { flex: none; width: 16px; height: 5px; border-radius: 3px; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.35); }
.asm-wires em { font-style: normal; color: #8a857c; font-weight: 400; font-size: 12px; }
.m-cs-asm .asm-wires { display: grid; gap: 7px; margin-top: 10px; font: 500 15px/1.3 var(--ui, system-ui); }
.m-cs-asm .asm-wires li { gap: 10px; }
.m-cs-asm .asm-wires i { width: 22px; height: 6px; }
.m-cs-asm .asm-wires em { margin-left: auto; font-size: 14px; }
.asm-nav, .asm-play { flex: none; height: 44px; min-width: 44px; border-radius: 22px; border: 0; display: grid; place-items: center; cursor: pointer;
  background: rgba(118,118,128,.12); color: #1c1917; font: 600 14px/1 var(--ui, system-ui); }
.asm-nav:disabled { opacity: .35; cursor: default; }
.asm-play { background: #1c1917; color: #fff; }
.asm-next { background: #e8590c; color: #fff; padding: 0 2px; }
.asm-next span { padding: 0 14px; }
`;
  document.head.append(s);
}
