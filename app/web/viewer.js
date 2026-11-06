// 3D viewer: loads a design-dir manifest + STLs. CAD is Z-up, three.js is Y-up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeSubparts, recolor, usePbrAttribute } from './finish.js';
import { cableTick, dressItem, dressScene, lookApply } from './materials.js'; // materials: real materials, engravings, cables
import { changeFX, editGlow } from './changefx.js'; // changefx: glow / pop / smoke on live model updates; editglow: parts being edited
import { installFX } from './effects.js'; // power: "Turn it on" (LED glow, screens, fans, night, X-ray edges)
import { Props } from './scene.js'; import { Assembly } from './assembly.js'; // scene: product in context; assembly: Assemble animation + steps
import { refSwap } from './refmodels.js'; // refmodels: real-looking stand-ins for bought parts (display only)
import { installWiring } from './wireview.js'; // wireview: the Wiring toggle (every wire, pin to pin, Connections list)
import { installAskPreview } from './askpreview.js'; // askmock: question-card option mock-ups over the model
import { Photoreal, photorealWanted } from './photoreal.js'; // photoreal: HDR studio light, PBR materials, AO, contact shadow, photo mode

// look: CAD-mode viewport backdrops. The canvas is transparent; the gradient is CSS on the container (no tone mapping on it).
const BACKDROPS = {
  dark: { top: '#2c2c2c', bottom: '#2c2c2c', minor: [0.235, 0.235, 0.235], major: [0.30, 0.30, 0.30] }, // flat charcoal, no gradient (Josh)
  light: { top: '#f7f7f6', bottom: '#dfdedb', minor: [0.80, 0.79, 0.78], major: [0.66, 0.65, 0.63] },
};
// look: light is the default for everyone; dark only if picked with the toggle. The key was bumped (was 'forma.viewportBg')
// so earlier saved 'dark' choices reset to light once.
export const BG_KEY = 'buildery.viewportBg.v2';
export function savedBackdrop() { try { return localStorage.getItem(BG_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } }
const ENV_CAD = 0.3; // environment reflections on CAD materials (subtle; the lights do the shaping)

/** Display colour for a part in CAD mode: very dark colours (relative luminance < 0.18) are lifted so they keep their
 * shading (less on the light backdrop, where dark parts already read). On the light backdrop, very light colours
 * (L > 0.5) are pulled down a little so white parts don't vanish into it. Continuous at both knees. The stored manifest
 * colour is never changed. */
function displayColor(hex, mode = 'light') {
  const c = new THREE.Color(hex); // linear working space
  const L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (mode === 'light' && L > 0.5) return c.multiplyScalar((0.5 + (L - 0.5) * 0.45) / L); // white shows as about #dedede
  if (L >= 0.18) return c;
  const want = mode === 'light' ? 0.035 + L * (0.145 / 0.18) : 0.06 + L * (0.12 / 0.18);
  if (L < 1e-4) return c.setRGB(want, want, want);
  const k = want / L, out = c.clone().multiplyScalar(k);
  const mx = Math.max(out.r, out.g, out.b);
  if (mx > 1) { out.multiplyScalar(1 / mx); out.lerp(new THREE.Color(want, want, want), 0.5); } // saturated darks: keep in gamut
  return out;
}

/** A floor grid with even lines all the way out (Josh chose no fade-out, 4 Nov). */
function makeGrid(size = 1000, div = 40) {
  const half = size / 2, step = size / div, pos = [], major = [];
  for (let i = 0; i <= div; i++) {
    const x = -half + i * step, m = i % 5 === 0 ? 1 : 0;
    pos.push(x, 0, -half, x, 0, half, -half, 0, x, half, 0, x);
    major.push(m, m, m, m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('major', new THREE.Float32BufferAttribute(major, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { cMinor: { value: new THREE.Vector3(...BACKDROPS.light.minor) }, cMajor: { value: new THREE.Vector3(...BACKDROPS.light.major) }, uHalf: { value: half }, uAlpha: { value: 1 } },
    vertexShader: 'attribute float major; varying vec2 vP; varying float vM; void main(){ vP = position.xz; vM = major; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 cMinor; uniform vec3 cMajor; uniform float uHalf; uniform float uAlpha; varying vec2 vP; varying float vM; void main(){ float a = 1.0; /* no fade-out (Josh, 4 Nov) */ gl_FragColor = vec4(mix(cMinor, cMajor, vM), a * mix(0.75, 0.95, vM) * uAlpha); }',
  });
  return new THREE.LineSegments(g, mat);
}

const CASE_COLORS = ['#c9ccd2', '#5aa9ff', '#6fbf73', '#b48cf2', '#f2c14e', '#4fd1c5', '#ef8a8a'];
const COMP_COLORS = ['#ff9f43', '#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#a29bfe', '#fd79a8'];
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
/** Catmull-Rom between b and c (a and d are the neighbours), k in 0..1: smooth motion through the sampled frames. */
const cr = (a, b, c, d, k) => b + 0.5 * k * (c - a + k * (2 * a - 5 * b + 4 * c - d + k * (3 * (b - c) + d - a)));
const VIEWS = { iso: [-1, 0.75, 1], front: [0, 0.05, 1.6], side: [1.6, 0.05, 0], back: [0, 0.05, -1.6], top: [0, 1.7, 0.01] };

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    // look: ACES in CAD mode too (render.js saves and restores these around render mode)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.95;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.background = null; // transparent over the CSS gradient (setBackdrop)
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Scroll zoom: toward the cursor, and faster than the default (it felt sluggish on trackpads)
    this.controls.zoomToCursor = true; this.controls.zoomSpeed = 2.4; this.controls.dampingFactor = 0.12;
    // Mac trackpad pinch arrives as ctrl+wheel with tiny deltas: 5x the zoom speed for those (set before OrbitControls'
    // own wheel listener on the canvas runs, since this one captures on the container)
    container.addEventListener('wheel', e => { this.controls.zoomSpeed = e.ctrlKey ? 12 : 2.4; }, { capture: true, passive: true });

    // look: hemisphere + key + fill + rim (back) light, and a soft room environment for subtle reflections
    const hemi = new THREE.HemisphereLight(0xf4f6ff, 0x30333a, 0.7); this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(-300, 500, 400); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(400, 200, 300); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xe4ecff, 1.5); rim.position.set(150, 320, -600); this.scene.add(rim);
    this.lights = [hemi, key, fill, rim];
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.cadEnv = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
      pmrem.dispose();
      this.scene.environment = this.cadEnv;
    } catch { this.cadEnv = null; }
    this.grid = makeGrid(); this.scene.add(this.grid);
    this.setBackdrop(savedBackdrop(), false);

    this.world = new THREE.Group(); this.world.rotation.x = -Math.PI / 2; this.scene.add(this.world);
    this.loader = new STLLoader();
    this.ui = { showComp: true, ghost: false, explode: 0 };
    this.hidden = new Set();
    this.items = [];
    this.center = new THREE.Vector3(0, 80, 0);
    this.radius = 200;
    this.loadId = 0;

    this.studio = null; // render mode (render.js), created on first use

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.anims = new Set(); // build animations: fades, pulses, sketch pop-in
    this.sketch = null;     // the instant blockout shown before the first real model
    this.motion = null;     // motion.json of the loaded design (Move button), null when it has none
    editGlow(this);         // editglow: this.editGlow.set(names) shimmers the parts the agent is editing
    this.moving = null;     // playing: { phase 0..1, speed, scrub, last }
    installFX(this);        // power: this.fx (web/effects.js)
    this.props = new Props(this); this.assembly = new Assembly(this); // scene.js / assembly.js
    installWiring(this);    // wireview: this.wiring
    installAskPreview(this); // askmock: this.askMock.show(sketch) / clear()
    this.photo = photorealWanted() ? new Photoreal(this) : null; // photoreal: the default look (?look=cad for the old one)
    this.renderer.setAnimationLoop(() => {
      if (!this.container.offsetParent) return; // hidden: skip rendering
      this.tick(); this.sketchTick(); this.askMock.tick(); if (this.moving) this.stepMotion(); this.fx?.tick(); if (this.present) this.presentTick(); this.props.tick(); this.assembly.tick(); cableTick(this); this.controls.update(); this.renderNow();
    });
  }

  /** Run fn(k) for k 0 -> 1 over ms (ease-out), then done(). */
  animate(ms, fn, done, delay = 0) {
    const a = { t0: performance.now() + delay, ms, fn, done };
    this.anims.add(a);
    return a;
  }
  tick() {
    if (!this.anims.size) return;
    const t = performance.now();
    for (const a of [...this.anims]) {
      if (t < a.t0) continue;
      const k = Math.min(1, (t - a.t0) / a.ms);
      a.fn(1 - Math.pow(1 - k, 3));
      if (k >= 1) { this.anims.delete(a); a.done?.(); }
    }
  }
  /** Opacity and depth state a part's material has when no animation runs (ghost mode, components). */
  matBase(it) {
    const pm = this.partmenu?.base(it); if (pm) return pm; // partmenu: hidden (see-through) parts rest at low opacity
    const lb = it.look?.base(this.ui.ghost); if (lb) return lb; // materials: clear acrylic / glass rest see-through
    const comp = it.p.group === 'component';
    if (it.vc) return { transparent: false, opacity: 1, depthWrite: true }; // library part: real materials, solid
    if (!comp && this.ui.ghost) return { transparent: true, opacity: 0.15, depthWrite: false }; // X-ray (web/effects.js)
    if (comp && it.photo) return { transparent: false, opacity: 1, depthWrite: true }; // photoreal: bought parts are solid
    return comp ? { transparent: true, opacity: 0.9, depthWrite: true } : { transparent: false, opacity: 1, depthWrite: true };
  }
  setMat(it, s) { it.mat.transparent = s.transparent; it.mat.opacity = s.opacity; it.mat.depthWrite = s.depthWrite; it.mat.needsUpdate = true; }

  /** New or changed parts fade in (changed ones also pulse); parts that went away fade out. */
  fadeIn(it, pulse, delay = 0) {
    const base = this.matBase(it);
    it.anim = true;
    it.mat.transparent = true; it.mat.opacity = 0; it.mat.needsUpdate = true;
    it.edges.material.opacity = 0;
    const s0 = pulse ? 1 : 0.94;
    it.mesh.scale.setScalar(s0);
    this.animate(pulse ? 420 : 650, (k) => {
      it.mat.opacity = base.opacity * k; it.edges.material.opacity = 0.35 * k;
      it.mesh.scale.setScalar(s0 + (1 - s0) * k);
    }, () => { it.anim = false; it.mesh.scale.setScalar(1); this.setMat(it, this.matBase(it)); }, delay);
    if (pulse) {
      it.mat.emissive = new THREE.Color(0xff7a1a); it.mat.emissiveIntensity = 0.55;
      this.animate(1100, (k) => { it.mat.emissiveIntensity = 0.55 * (1 - k); }, () => { it.mat.emissive.setHex(0); it.mat.emissiveIntensity = 1; }, delay + 120);
    }
  }
  fadeOut(mesh, mat, edges, dispose, ms = 380) {
    mat.transparent = true; mat.depthWrite = false; mat.needsUpdate = true;
    const o0 = mat.opacity, e0 = edges ? edges.material.opacity : 0;
    this.animate(ms, (k) => { mat.opacity = o0 * (1 - k); if (edges) edges.material.opacity = e0 * (1 - k); }, () => { this.world.remove(mesh); dispose(); });
  }

  /** Instant sketch: translucent primitives (box / cylinder / sphere, CAD mm, Z up) that pop in one by one. */
  showSketch(sk) {
    this.clearSketch(false);
    if (!sk?.parts?.length) return;
    const g = new THREE.Group(), list = [], all = new THREE.Box3();
    sk.parts.forEach((p, i) => {
      let geo;
      if (p.shape === 'box') geo = new THREE.BoxGeometry(...p.size);
      else if (p.shape === 'sphere') geo = new THREE.SphereGeometry(p.r, 28, 18);
      else {
        geo = new THREE.CylinderGeometry(p.r, p.r, p.h, 36); // three's cylinder runs along local Y = CAD Y
        if (p.axis === 'z') geo.rotateX(Math.PI / 2); else if (p.axis === 'x') geo.rotateZ(Math.PI / 2);
      }
      const mat = new THREE.MeshStandardMaterial({ color: p.color || '#9aa4b2', roughness: 0.7, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: this.backdrop === 'dark' ? 0xffffff : 0x57534e, transparent: true, opacity: 0 }));
      mesh.add(edges);
      mesh.position.set(...p.at); mesh.scale.setScalar(0.001);
      g.add(mesh);
      geo.computeBoundingBox();
      all.union(geo.boundingBox.clone().translate(new THREE.Vector3(...p.at)));
      const item = { mesh, mat, edges, ph: i * 1.7 };
      list.push(item);
      // drawn in slowly, bottom-up, one primitive at a time: the outline sketches in first, then the fill (Josh: slower is more fun)
      const order = sk.parts.map((q, j) => [q.at[2] - (q.shape === 'box' ? q.size[2] / 2 : q.r || 0), j]).sort((a, b) => a[0] - b[0]).findIndex((x) => x[1] === i);
      const ease = (t) => t * t * (3 - 2 * t);
      this.animate(1400, (k) => {
        const line = ease(Math.min(1, k / 0.55)), fill = ease(Math.max(0, (k - 0.35) / 0.65));
        edges.material.opacity = 0.6 * line; mat.opacity = 0.38 * fill;
        mesh.scale.setScalar(0.001 + 0.999 * (line + Math.sin(line * Math.PI) * 0.06));
      }, () => { item.t0 = performance.now(); }, order * 700);
    });
    this.world.add(g);
    this.sketch = { g, list };
    // the placeholder (or previous) model steps aside for the sketch
    for (const it of this.items) this.fadeOut(it.mesh, it.mat, it.edges, () => { (it.cgeo || it.mesh.geometry).dispose(); it.rgeo?.dispose(); it.mat.dispose(); it.rmat?.dispose(); it.edges?.geometry.dispose(); it.edges?.material.dispose(); }, 300);
    this.items = [];
    this.studio?.stopPt(); this.studio?.syncItems?.();
    if (!all.isEmpty()) {
      const c = new THREE.Vector3(); all.getCenter(c);
      this.center.set(c.x, c.z, -c.y);
      const s = new THREE.Vector3(); all.getSize(s); this.radius = Math.max(s.x, s.y, s.z, 10); this.fitBox = all.clone(); // mqa: phone card framing (setView)
      this.grid.position.y = Math.min(0, all.min.z) - 2;
      this.showEmpty(false); this.setView('iso');
    }
  }
  /** The sketch keeps morphing once drawn: each block grows and shrinks on its own axes, so it reads as a rough
   * placeholder, never as the real model (Josh). Amplitude eases in over 1 s so the pop-in hands over smoothly. */
  sketchTick() {
    const sk = this.sketch; if (!sk) return;
    const t = performance.now();
    for (const x of sk.list) {
      if (x.t0 == null) continue;
      const a = 0.14 * Math.min(1, (t - x.t0) / 1000), s = t / 1000;
      x.mesh.scale.set(1 + a * Math.sin(s * 1.9 + x.ph), 1 + a * Math.sin(s * 1.5 + x.ph + 2.1), 1 + a * Math.sin(s * 1.7 + x.ph + 4.2));
    }
  }
  clearSketch(fade = true, ms = 700) {
    const sk = this.sketch; if (!sk) return;
    this.sketch = null;
    const dispose = () => { this.world.remove(sk.g); for (const x of sk.list) { x.mesh.geometry.dispose(); x.mat.dispose(); x.edges.geometry.dispose(); x.edges.material.dispose(); } };
    if (!fade) return dispose();
    for (const x of sk.list) { const o = x.mat.opacity, e = x.edges.material.opacity; this.animate(ms, (k) => { x.mat.opacity = o * (1 - k); x.edges.material.opacity = e * (1 - k); x.mesh.scale.setScalar(1 + 0.04 * k); }); }
    this.animate(ms + 20, () => {}, dispose);
  }

  // ---------------------------------------------------------------- livepreview: the workbench
  /** A part of the design.py still being written ({ url, name, lo, hi, color, bought }, CAD mm): it drops onto a
   * "workbench" row in front of the sketch, slightly faded, until the real model lands (load() snaps it into place). */
  addPreview(d) {
    const P = this.previews || (this.previews = { g: new THREE.Group(), list: [], urls: new Set() });
    if (P.urls.has(d.url) || P.list.length >= 24) return;
    P.urls.add(d.url);
    if (!P.g.parent) this.world.add(P.g);
    this.loader.load(d.url, (geo) => {
      if (this.previews !== P) { geo.dispose(); return; }
      geo.computeVertexNormals(); geo.computeBoundingBox();
      if (geo.boundingBox.isEmpty()) { geo.dispose(); return; }
      const color = d.color || (d.bought ? '#8a8f98' : CASE_COLORS[(P.list.length + 1) % CASE_COLORS.length]);
      const shown = displayColor(color, this.backdrop);
      const mat = new THREE.MeshStandardMaterial({ color: shown, roughness: 0.55, metalness: d.bought ? 0.25 : 0.04, side: THREE.DoubleSide, envMapIntensity: ENV_CAD, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: shown.clone().multiplyScalar(this.backdrop === 'light' ? 0.3 : 0.45), transparent: true, opacity: 0 }));
      mesh.add(edges);
      const holder = new THREE.Group(); holder.add(mesh); P.g.add(holder);
      const it = { d, geo, mesh, mat, edges, holder, bb: geo.boundingBox.clone(), born: performance.now() };
      P.list.push(it);
      this.layoutPreviews(it);
    }, undefined, () => {});
  }
  /** Lay the workbench out: one row in front of the sketch (CAD -Y), centred on X, parts standing on the floor. */
  layoutPreviews(fresh) {
    const P = this.previews; if (!P?.list.length) return;
    const ref = new THREE.Box3();
    if (this.sketch) for (const x of this.sketch.list) { x.mesh.geometry.computeBoundingBox(); ref.union(x.mesh.geometry.boundingBox.clone().translate(x.mesh.position)); }
    for (const it of this.items) if (it.mesh.geometry.boundingBox) ref.union(it.mesh.geometry.boundingBox); // beside a quick blockout model
    const sizes = P.list.map(it => it.bb.getSize(new THREE.Vector3()));
    const span = sizes.reduce((a, v) => a + v.x, 0), gap = Math.max(8, span * 0.08);
    const total = span + gap * (P.list.length - 1), depth = Math.max(...sizes.map(v => v.y));
    const rowY = ref.isEmpty() ? 0 : ref.min.y - gap * 1.5 - depth / 2;
    let x = -total / 2;
    const all = ref.clone();
    P.list.forEach((it, i) => {
      const c = it.bb.getCenter(new THREE.Vector3()), sz = sizes[i];
      const to = new THREE.Vector3(x + sz.x / 2 - c.x, rowY - c.y, -it.bb.min.z);
      x += sz.x + gap;
      all.union(it.bb.clone().translate(to));
      if (it === fresh) { // drop in from a little above, fading up to "not final yet"
        const lift = Math.max(20, sz.z * 0.8);
        it.holder.position.copy(to).add(new THREE.Vector3(0, 0, lift));
        this.animate(520, (k) => { it.holder.position.z = to.z + lift * (1 - k); it.mat.opacity = 0.72 * k; it.edges.material.opacity = 0.4 * k; });
      } else { const from = it.holder.position.clone(); this.animate(420, (k) => it.holder.position.lerpVectors(from, to, k)); }
      it.bench = to;
    });
    this.glideTo(all);
  }
  /** Ease the camera so box (CAD mm) is in view, keeping the viewing direction. Only grows the view, never jumps. */
  glideTo(box, force = false) {
    if (box.isEmpty()) return;
    const c = new THREE.Vector3(); box.getCenter(c);
    const s = new THREE.Vector3(); box.getSize(s);
    const r = Math.max(s.x, s.y, s.z, 10);
    if (!force && r <= this.radius * 1.05 && Math.abs(c.x - this.center.x) + Math.abs(-c.y - this.center.z) < this.radius * 0.25) return;
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone(), dir = p0.clone().sub(t0).normalize();
    const t1 = new THREE.Vector3(c.x, c.z, -c.y), p1 = new THREE.Vector3();
    this.center.copy(t1); this.radius = r; this.fitBox = box.clone(); this.grid.position.y = Math.min(this.grid.position.y, box.min.z - 2);
    if (!this.container.offsetParent) { this.setView('iso'); return; } // hidden: nothing to watch, just frame it
    this.animate(700, (k) => {
      const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1; // the same distance setView uses (narrow panes back off)
      p1.copy(t1).addScaledVector(dir, r * 1.9 * (w / h < 0.8 ? 1.6 : 1));
      this.controls.target.lerpVectors(t0, t1, k); this.camera.position.lerpVectors(p0, p1, k);
      this.camera.near = Math.max(0.5, p1.distanceTo(t1) / 200); this.camera.far = Math.max(this.camera.far, p1.distanceTo(t1) * 50); this.camera.updateProjectionMatrix();
    });
  }
  /** The real model landed: each workbench part flies to where the matching real part sits (same size) and waits there,
   * faded, until that part is built in (when: Map(real item -> ms)); parts with no match just fade. */
  landPreviews(items, when = new Map()) {
    const P = this.previews; this.previews = null;
    const arrive = new Map();
    if (!P) return arrive;
    const used = new Set(), close = (a, b) => Math.abs(a.x - b.x) < 1.5 && Math.abs(a.y - b.y) < 1.5 && Math.abs(a.z - b.z) < 1.5;
    let n = 0, last = 0;
    for (const it of P.list) {
      const sz = it.bb.getSize(new THREE.Vector3());
      const real = items.find(r => !used.has(r) && close(r.mesh.geometry.boundingBox.getSize(new THREE.Vector3()), sz));
      const fade = (delay) => { const o = it.mat.opacity, e = it.edges.material.opacity; this.animate(380, (k) => { it.mat.opacity = o * (1 - k); it.edges.material.opacity = e * (1 - k); }, null, delay); };
      if (real) {
        used.add(real);
        const to = real.mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).sub(it.bb.getCenter(new THREE.Vector3()));
        const from = it.holder.position.clone(), delay = Math.min(n++, 10) * 70, t = when.get(real) ?? delay + 420;
        this.animate(560, (k) => { it.holder.position.lerpVectors(from, to, k); it.holder.position.z += Math.sin(k * Math.PI) * Math.max(15, sz.z * 0.5); }, null, delay);
        const o = it.mat.opacity; this.animate(500, (k) => { it.mat.opacity = o * (1 - 0.55 * k); }, null, delay); // waits, faint, in its place
        fade(Math.max(delay + 560, t + 250)); arrive.set(real, t); last = Math.max(last, t + 700);
      } else fade(0);
    }
    this.animate(Math.max(1400, last), () => {}, () => {
      this.world.remove(P.g);
      for (const it of P.list) { it.geo.dispose(); it.mat.dispose(); it.edges.geometry.dispose(); it.edges.material.dispose(); }
    });
    return arrive;
  }
  clearPreviews() {
    const P = this.previews; if (!P) return;
    this.previews = null;
    for (const it of P.list) { const o = it.mat.opacity; this.animate(350, (k) => { it.mat.opacity = o * (1 - k); it.edges.material.opacity *= (1 - k); }); }
    this.animate(380, () => {}, () => { this.world.remove(P.g); for (const it of P.list) { it.geo.dispose(); it.mat.dispose(); it.edges.geometry.dispose(); it.edges.material.dispose(); } });
  }
  /** landing: the first model of a new design builds itself up one part at a time, in design.py's own order (ASSEMBLY
   * when it declares one), bought parts last: each part's outline draws in, then it fills, like the sketch. ~700 ms a
   * part, 8 s at most. The camera stays put. 'buildery:reveal' { name, i, n } names each part as it lands ({ done } at the end). */
  reveal(manifest) {
    const items = this.items, idx = new Map(items.map((it, i) => [it, i]));
    const decl = manifest?.assembly_order || manifest?.steps;
    const rank = (it) => {
      if (!Array.isArray(decl)) return 0;
      const k = decl.findIndex(st => (Array.isArray(st) ? st : Array.isArray(st?.parts) ? st.parts : [st]).map(String).some(n => it.p.name === n || it.p.name.startsWith(n + ' (')));
      return k < 0 ? decl.length : k;
    };
    const order = [...items].sort((a, b) => ((a.p.group === 'component') - (b.p.group === 'component')) || (rank(a) - rank(b)) || (idx.get(a) - idx.get(b)));
    const n = order.length, step = Math.max(140, Math.min(700, 8000 / n)), dur = Math.min(1000, Math.max(420, step * 1.4));
    const ease = (t) => t * t * (3 - 2 * t), shown = (it) => !this.hidden.has(it.p.name) && (it.p.group !== 'component' || this.ui.showComp);
    const when = new Map();
    order.forEach((it, i) => {
      const t0 = i * step; when.set(it, t0);
      const eg = it.edges.geometry, segs = eg.attributes.position.count, edgesOn = it.edges.visible;
      it.anim = true;
      it.mat.transparent = true; it.mat.opacity = 0; it.mat.depthWrite = false; it.mat.needsUpdate = true;
      it.edges.material.opacity = 0; it.edges.visible = true; eg.setDrawRange(0, 0);
      if (t0 > 0) this.animate(t0, () => { it.mesh.visible = false; }); // not built yet
      let started = false;
      this.animate(dur, (k) => {
        if (!started) { started = true; it.mesh.visible = shown(it); dispatchEvent(new CustomEvent('buildery:reveal', { detail: { name: it.p.name, i, n } })); }
        const line = ease(Math.min(1, k / 0.55)), fill = ease(Math.max(0, (k - 0.35) / 0.65));
        eg.setDrawRange(0, Math.ceil(segs * line / 2) * 2); // the outline draws itself
        it.edges.material.opacity = 0.6 * line + ((edgesOn ? 0.35 : 0) - 0.6) * fill; // bright while drawing, then settles
        it.mat.opacity = this.matBase(it).opacity * fill;
      }, () => {
        it.anim = false; eg.setDrawRange(0, Infinity); it.edges.visible = edgesOn; it.edges.material.opacity = 0.35;
        it.mesh.visible = shown(it); this.setMat(it, this.matBase(it));
      }, t0);
    });
    this.animate((n - 1) * step + dur, () => {}, () => dispatchEvent(new CustomEvent('buildery:reveal', { detail: { done: true } })));
    return when;
  }

  /** look: CAD viewport backdrop, 'dark' | 'light' (remembered). Render mode keeps its own backdrop. */
  setBackdrop(mode, save = true) {
    const b = BACKDROPS[mode] ? mode : 'light', B = BACKDROPS[b];
    this.backdrop = b;
    this.container.style.background = `linear-gradient(180deg, ${B.top} 0%, ${B.bottom} 100%)`;
    this.container.dataset.backdrop = b;
    this.grid.material.uniforms.cMinor.value.set(...B.minor);
    this.grid.material.uniforms.cMajor.value.set(...B.major);
    this.lights[0].groundColor.setHex(b === 'light' ? 0x77716b : 0x30333a); // light: brighter bounce under parts
    for (const it of this.items || []) this.tintItem(it); // display colours depend on the backdrop
    this.wiring?.apply(); // wireview: wire halos follow the backdrop
    if (save) { try { localStorage.setItem(BG_KEY, b); } catch {} }
    return b;
  }

  /** look: CAD display colour + edge colour for a part on the current backdrop. */
  tintItem(it) {
    if (it.vc) { // library part: per-vertex colours from its sub-parts
      const fn = hex => displayColor(hex, this.backdrop);
      recolor(it.mesh.geometry, fn);
      if (it.cgeo && it.cgeo !== it.mesh.geometry) recolor(it.cgeo, fn);
      it.edges?.material.color.setHex(this.backdrop === 'light' ? 0x3a3734 : 0x9a9ea6);
      return displayColor(it.p.color, this.backdrop);
    }
    if (it.look) return it.look.tint(this.backdrop); // materials: preset colours
    if (it.photo && this.photo) return this.photo.tint(it); // photoreal: real colours
    const shown = displayColor(it.p.color, this.backdrop);
    it.mat.color.copy(shown);
    it.edges?.material.color.copy(shown.clone().multiplyScalar(this.backdrop === 'light' ? 0.3 : 0.45));
    return shown;
  }

  renderNow() {
    if (this.studio?.on) this.studio.frame();
    else if (!this.fx?.render() && !this.photo?.render()) this.renderer.render(this.scene, this.camera); // power: night bloom draws its own frame; photoreal: AO / photo mode
  }

  /** Render mode on/off. Loads render.js on first use. */
  async setRender(on) {
    if (on && !this.studio) { const { Studio } = await import('./render.js'); this.studio = new Studio(this); }
    if (!this.studio) return;
    on ? this.studio.enter() : this.studio.exit();
    if (this.photo) { this.photo.root.visible = !on; this.photo.apply(); } // photoreal: render mode has its own shadow; edges back off
    this.partmenu?.apply(); // partmenu: render materials keep see-through parts
  }

  /** photoreal: path-traced still now (phones: only this way; desktop also starts it after 1.5 s idle). Any input
   * returns to raster. Progress: 'viewer:photomode' events { state: loading | running | done | off | error, samples }. */
  photoMode(on = true) { return this.photo ? this.photo.photoMode(on) : false; }

  /** PNG data URL of the product in render mode (works from CAD mode too). */
  async snapshot(opts) {
    if (!this.studio) { const { Studio } = await import('./render.js'); this.studio = new Studio(this); }
    return this.studio.snapshot(opts);
  }

  /** chattools: PNG Blob of the view exactly as shown (current camera, see-through / selection outlines, CAD backdrop
   * gradient under the transparent canvas). highlight: part names drawn with an orange outline and tint for this one
   * frame only. Renders and reads in the same task, so no preserveDrawingBuffer is needed. */
  async capture({ highlight = [], max = 1800 } = {}) {
    const src = this.renderer.domElement;
    if (!src.width || !src.height) return null;
    this.hover?.hide(); this.photo?.stopPt(); // photoreal: the raster frame shows the highlight
    const want = new Set(highlight), tmp = [], tints = [], fxOff = [], egResume = this.editGlow?.pause(); // editglow: undimmed
    this.scene.traverse(o => { if ((o.userData.fx || o.userData.fxGlow) && o.visible) { o.visible = false; fxOff.push(o); } }); // changefx glow / sparks / smoke: not part of the design
    for (const it of this.items) {
      if (!want.has(it.p.name) || !it.mesh.visible) continue;
      if (it.edges) {
        const l = new THREE.LineSegments(it.edges.geometry, new THREE.LineBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 1, depthTest: false }));
        l.renderOrder = 12; l.raycast = () => {}; it.mesh.add(l); tmp.push(l);
      }
      const m = it.mesh.material;
      if (m?.emissive) { tints.push([m, m.emissive.clone(), m.emissiveIntensity]); m.emissive.setHex(0xff7a1a); m.emissiveIntensity = 0.35; }
    }
    const k = Math.min(1, max / Math.max(src.width, src.height));
    const out = document.createElement('canvas');
    out.width = Math.round(src.width * k); out.height = Math.round(src.height * k);
    const g = out.getContext('2d');
    if (!this.studio?.on) { // CAD mode: the backdrop is CSS on the container, paint it under the frame
      const B = BACKDROPS[this.backdrop] || BACKDROPS.light, grad = g.createLinearGradient(0, 0, 0, out.height);
      grad.addColorStop(0, B.top); grad.addColorStop(1, B.bottom);
      g.fillStyle = grad; g.fillRect(0, 0, out.width, out.height);
    }
    try {
      this.world.updateMatrixWorld(true); this.renderNow();
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, out.width, out.height); // same task as the render: the drawing buffer is still valid
    } finally {
      for (const l of tmp) { l.parent?.remove(l); l.material.dispose(); }
      for (const [m, c, i] of tints) { m.emissive.copy(c); m.emissiveIntensity = i; }
      for (const o of fxOff) o.visible = true;
      egResume?.();
      if (tmp.length || tints.length || fxOff.length) this.renderNow();
    }
    return new Promise(res => out.toBlob(res, 'image/png'));
  }

  /** colours: show a filament colour pick on a printed part right away (hex null = back to the design's colour). */
  setPartColor(name, hex) {
    const it = this.items.find(x => x.p.name === name); if (!it || it.vc) return false;
    if (hex) { if (!it.p.design_color) it.p.design_color = it.p.color; it.p.color = hex; }
    else if (it.p.design_color) { it.p.color = it.p.design_color; delete it.p.design_color; }
    this.tintItem(it);
    if (this.studio) { this.studio.syncItems?.(); if (this.studio.on) this.studio.setOpts({}); }
    return true;
  }

  /** chattools: what the agent needs to know about a part: id (file stem), kind, size and centre in CAD mm (Z up). */
  partInfo(name) {
    const it = this.items.find(x => x.p.name === name); if (!it) return null;
    const p = it.p, proc = p.process || (p.group === 'component' ? 'bought' : 'print');
    const kind = proc === 'print' ? 'printed' : proc === 'bought' ? 'bought' : 'fabricated';
    const bb = it.mesh.geometry.boundingBox || (it.mesh.geometry.computeBoundingBox(), it.mesh.geometry.boundingBox);
    const c = new THREE.Vector3(); bb.getCenter(c);
    const id = String(p.file || p.name).split('/').pop().replace(/\.stl$/i, '');
    return { name, id, kind, process: proc, size: (p.size || []).map(Number), center: [c.x, c.y, c.z], color: p.color };
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    if (this.present?.offsetY) this.camera.setViewOffset(w, h, 0, -this.present.offsetY, w, h); else if (this.camera.view) this.camera.clearViewOffset(); // phone: model below the glass bar
    this.camera.updateProjectionMatrix();
    this.studio?.resize();
    // setSize clears the canvas; draw straight away so a resize (the phone card shrinking to its thumbnail) never shows a blank frame
    if (this.container.offsetParent) { try { this.renderNow(); } catch {} }
  }

  clear() {
    for (const it of this.items) { this.world.remove(it.mesh); (it.cgeo || it.mesh.geometry).dispose(); it.rgeo?.dispose(); it.mat.dispose(); it.rmat?.dispose(); it.edges?.geometry.dispose(); it.edges?.material.dispose(); }
    this.items = [];
    this.studio?.stopPt();
    this.clearPreviews(); // livepreview: another design (or an empty one) takes the stage
  }

  // base: URL prefix the manifest's relative "file" paths resolve against.
  // animate: a live update (a build landed) rather than opening a design: diff against what's shown and animate it.
  async load(manifest, base, { keepCamera = false, animate = false } = {}) {
    const id = ++this.loadId;
    const v = manifest?.t ?? Date.now();
    const parts = (manifest?.parts || []).map((p, i) => ({
      ...p, group: p.group || 'case',
      color: p.color || (p.group === 'component' ? COMP_COLORS : CASE_COLORS)[i % 7],
    }));
    const url = f => `${base}${f}?v=${encodeURIComponent(v)}`;
    const motionP = this.fetchMotion(manifest, url);
    const loaded = await Promise.all(parts.map(async p => {
      if (Array.isArray(p.subparts) && p.subparts.length) { // library part: detailed sub-parts with finishes
        try {
          const geos = await Promise.all(p.subparts.map(s => this.loader.loadAsync(url(s.file))));
          const geo = mergeSubparts(p.subparts.map((s, i) => ({ geo: geos[i], color: s.color || p.color || '#8a8f98', finish: s.finish })),
            hex => displayColor(hex, this.backdrop));
          return { p, geo, vc: true };
        } catch { /* fall back to the single mesh */ }
      }
      try { return { p, geo: await this.loader.loadAsync(url(p.file)) }; }
      catch { return null; }
    }));
    await refSwap(loaded, hex => displayColor(hex, this.backdrop)); // refmodels: swap matching parts' geometry in place
    if (id !== this.loadId) return this.parts(); // a newer load started
    const sig = geo => `${geo.attributes.position.count}|${geo.boundingBox.min.toArray().map(v => v.toFixed(1))}|${geo.boundingBox.max.toArray().map(v => v.toFixed(1))}`;
    const fromSketch = !!this.sketch;
    const anim = animate || fromSketch;
    const landing = anim && (fromSketch || !!this.previews || !this.items.length); // the first model of a new design
    for (const l of loaded.filter(Boolean)) { l.geo.computeBoundingBox(); l.sig = sig(l.geo); }
    // Pair new parts with old ones by name (names repeat, e.g. 8 x "Frame bar"): the same name and geometry is unchanged,
    // else an unused old part of that name (preferring one with the same mesh and size, i.e. moved) is its previous version.
    const pool = new Map(), was = new Map(), same = new Set();
    for (const it of this.items) { if (!pool.has(it.p.name)) pool.set(it.p.name, []); pool.get(it.p.name).push(it); }
    const take = (l, ok) => { const list = pool.get(l.p.name), i = list ? list.findIndex(ok) : -1; return i < 0 ? null : list.splice(i, 1)[0]; };
    const fresh = loaded.filter(Boolean);
    for (const l of fresh) { const o = take(l, o => o.sig === l.sig); if (o) { was.set(l, o); same.add(o); } }
    const shape = x => x.split('|')[0];
    for (const l of fresh) if (!was.has(l)) { const o = take(l, o => shape(o.sig) === shape(l.sig)) || take(l, () => true); if (o) was.set(l, o); }
    const paired = new Set(was.values());
    const fx = animate && !fromSketch && !landing && this.items.length ? changeFX(this) : null; // changefx: a model that was on screen changed
    if (anim) { // parts that changed or went away fade out; unchanged ones are swapped in place
      for (const it of this.items) {
        if (same.has(it)) { this.world.remove(it.mesh); (it.cgeo || it.mesh.geometry).dispose(); it.rgeo?.dispose(); it.mat.dispose(); it.rmat?.dispose(); it.edges?.geometry.dispose(); it.edges?.material.dispose(); }
        else if (!fx?.leave(it, paired.has(it))) this.fadeOut(it.mesh, it.mat, it.edges, () => { (it.cgeo || it.mesh.geometry).dispose(); it.rgeo?.dispose(); it.mat.dispose(); it.rmat?.dispose(); it.edges?.geometry.dispose(); it.edges?.material.dispose(); });
      }
      this.items = [];
      this.studio?.stopPt();
    } else { this.editGlow?.handoff(); this.clear(); } // editglow: another design (or a reload): nothing is being edited here
    this.clearSketch(anim, landing ? 1800 : 700); // landing: the sketch gives way slowly while the parts build up
    if (!landing) this.clearPreviews();
    const all = new THREE.Box3();
    let n = 0;
    for (const l of loaded.filter(Boolean)) {
      const { p, geo, vc } = l;
      geo.computeVertexNormals(); geo.computeBoundingBox();
      const comp = p.group === 'component';
      const shown = displayColor(p.color, this.backdrop); // look: display only (dark lifted; on light, white toned down)
      const mat = vc
        ? usePbrAttribute(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMapIntensity: 0.85 })) // finish per vertex
        : new THREE.MeshStandardMaterial({
          color: shown, roughness: 0.5, metalness: comp ? 0.25 : 0.04, side: THREE.DoubleSide, envMapIntensity: ENV_CAD,
          transparent: comp, opacity: comp ? 0.9 : 1,
        });
      const mesh = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, vc ? 50 : 30), // look: thin, a little darker than the part
        new THREE.LineBasicMaterial({ color: vc ? (this.backdrop === 'light' ? 0x3a3734 : 0x9a9ea6) : shown.clone().multiplyScalar(this.backdrop === 'light' ? 0.3 : 0.45), transparent: true, opacity: 0.35 }));
      if (vc) edges.visible = false; // detailed parts read on their own; their edges would only add noise
      mesh.add(edges);
      this.world.add(mesh);
      const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
      p.size = p.bbox || [size.x, size.y, size.z];
      const it = { p, mesh, mat, edges, sig: l.sig, vc: !!vc };
      this.items.push(it);
      dressItem(this, it); // materials: preset material + engraving (may replace it.mat)
      this.photo?.dress(it); // photoreal: PBR material, smooth shading
      all.union(geo.boundingBox);
      if (anim && !landing) {
        const old = fromSketch ? null : was.get(l);
        if (old?.sig === l.sig) continue;                         // unchanged: swapped in place
        if (fx?.enter(it, old || null)) continue;                 // changefx handled it
        if (!old) this.fadeIn(it, false, Math.min(n++, 8) * 60);  // new part
        else this.fadeIn(it, true);                               // changed part: fade + pulse
      }
    }
    layerCoplanar(this.items);
    if (landing && this.items.length) this.landPreviews(this.items, this.reveal(manifest)); // landing: built up part by part
    if (!all.isEmpty()) {
      const c = new THREE.Vector3(); all.getCenter(c);
      this.center.set(c.x, c.z, -c.y);
      const s = new THREE.Vector3(); all.getSize(s); this.radius = Math.max(s.x, s.y, s.z, 10); this.fitBox = all.clone(); // mqa: phone card framing (setView)
      this.grid.position.y = all.min.z - 2;
    }
    dressScene(this, manifest); // materials: decorative cables (not parts)
    if (this.studio) { this.studio.syncItems(); if (this.studio.on) this.studio.setOpts({}); }
    this.setMotion(await motionP, id);
    this.fx?.scan(); // power: what lights up / moves in this design
    if (this.present) this.presentItems(true);
    this.apply();
    fx?.finish();
    this.props.onLoad(manifest); this.assembly.onLoad(manifest); // scene.js / assembly.js
    this.wiring?.onLoad(manifest); // wireview: after assembly (it shares the prefetched build data)
    dispatchEvent(new Event('buildery:partsloaded')); // editglow: the chat can turn part names in replies into chips now
    if (landing && !all.isEmpty()) this.glideTo(all, true); // one smooth move to frame it, then the camera stays still
    else if (!keepCamera) this.setView('iso');
    return this.parts();
  }

  parts() { return this.items.map(i => i.p); }
  /** scene.js: 'none' | 'desk' | 'wall' | 'counter' | 'shelf' | 'handlebar' | 'floor'. assembly.js: the reveal (a Promise). */
  setScene(kind) { return this.props.set(kind); }
  playAssembly(opts) { return this.assembly.play(opts); }

  setHidden(name, hide) { hide ? this.hidden.add(name) : this.hidden.delete(name); this.apply(); }
  set(key, val) {
    this.ui[key] = val;
    if (key === 'explode' && val > 0 && this.moving) { this.moving = null; this.emitMotion(); } // Explode and Move exclude each other
    this.apply();
  }

  // ---------------------------------------------------------------- motion (Move button; CONTRACT.md "motion()")
  /** motion.json for a manifest that lists one, else null. Never throws. */
  async fetchMotion(manifest, url) {
    const f = manifest?.motion?.file;
    if (!f) return null;
    try { const r = await fetch(url(f), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
  }
  setMotion(data, id = this.loadId) {
    if (id !== this.loadId) return;
    const ok = data && data.parts && data.frames > 1 && data.duration > 0;
    this.motion = ok ? data : null;
    for (const it of this.items) it.track = this.motion?.parts?.[it.p.file] || null;
    if (!this.motion) this.moving = null; // a live build that dropped motion() stops it; one that changed it keeps playing
    this.emitMotion();
  }
  emitMotion() {
    this.container.dispatchEvent(new CustomEvent('viewer:motion', { bubbles: true,
      detail: { viewer: this, has: !!this.motion, moving: !!this.moving, phase: this.moving?.phase || 0 } }));
  }
  /** Move on: play the loop from the built pose. Off: back to the built pose. Turns Explode off. */
  setMoving(on) {
    on = !!on && !!this.motion;
    if (on === !!this.moving) return;
    if (on) { this.ui.explode = 0; this.moving = { phase: 0, speed: 1, scrub: null, last: performance.now() }; this.studio?.stopPt(); }
    else this.moving = null;
    this.apply();
    this.emitMotion();
  }
  /** Scrub: hold the loop at t (0..1); null resumes playing from there. */
  scrubMotion(t) {
    if (!this.moving) return;
    if (t == null) { this.moving.scrub = null; this.moving.last = performance.now(); return; }
    this.moving.scrub = this.moving.phase = ((t % 1) + 1) % 1;
  }
  stepMotion() {
    const mv = this.moving, M = this.motion; if (!mv || !M) return;
    const now = performance.now(), dt = Math.min(0.1, (now - mv.last) / 1000); mv.last = now; // no jump after a hidden tab
    if (mv.scrub == null) mv.phase = (mv.phase + dt * mv.speed / M.duration) % 1;
    this.poseMotion(mv.phase);
  }
  /** Put every moving part at loop time t: positions on a Catmull-Rom curve through the frames, rotations slerped. */
  poseMotion(t) {
    const N = this.motion.frames, f = t * N, i1 = Math.floor(f) % N, k = f - Math.floor(f);
    const i0 = (i1 + N - 1) % N, i2 = (i1 + 1) % N, i3 = (i1 + 2) % N;
    for (const it of this.items) {
      const tr = it.track; if (!tr) continue;
      const a = tr.pos[i0], b = tr.pos[i1], c = tr.pos[i2], d = tr.pos[i3];
      it.mesh.position.set(cr(a[0], b[0], c[0], d[0], k), cr(a[1], b[1], c[1], d[1], k), cr(a[2], b[2], c[2], d[2], k));
      it.mesh.quaternion.slerpQuaternions(_q0.fromArray(tr.quat[i1]), _q1.fromArray(tr.quat[i2]), k);
    }
    if (this.studio?.on) { const n = performance.now(); if (!(n - (this._shT || 0) < 120)) { this._shT = n; this.studio.dirtyShadow = true; } }
  }

  apply() {
    const ex = this.ui.explode * this.radius * 0.6;
    for (const it of this.items) {
      const isCase = it.p.group !== 'component';
      it.mesh.visible = !this.hidden.has(it.p.name) && (isCase || this.ui.showComp);
      it.mesh.position.set(...(it.p.explode || [0, 0, 0])).multiplyScalar(ex);
      it.mesh.quaternion.identity(); // built pose (Move sets it again below)
      if (isCase && !it.anim) { // a part mid fade-in sets its own opacity, then settles here
        it.mat.transparent = this.ui.ghost; it.mat.opacity = this.ui.ghost ? 0.15 : 1;
        it.mat.depthWrite = !this.ui.ghost; it.mat.needsUpdate = true;
      }
    }
    lookApply(this); // materials: clear parts stay see-through
    if (this.moving) this.poseMotion(this.moving.phase);
    this.partmenu?.apply(); // partmenu: see-through / isolate state, re-applied by part name
    this.fx?.apply(); // power: X-ray edges, spinner base pose
    this.photo?.apply(); // photoreal: edges only in X-ray, shadow + photo mode follow
    this.wiring?.apply(); // wireview: wires follow Explode
    if (this.studio) { this.studio.dirtyShadow = true; this.studio.resetPt(); }
  }

  setView(v) {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const narrow = w / h < 0.8 ? 1.6 : 1;
    const [x, y, z] = VIEWS[v] || VIEWS.iso;
    let d = this.radius * 1.9 * narrow * (1 + this.ui.explode * 0.6);
    if (this.present && this.fitBox && !this.fitBox.isEmpty()) d = this.cardFit(new THREE.Vector3(x, y, z), w / h) / Math.hypot(x, y, z) * (1 + this.ui.explode * 0.6); // VIEWS are not unit vectors
    this.controls.target.copy(this.center);
    this.camera.position.set(this.center.x + x * d, this.center.y + y * d, this.center.z + z * d);
    this.camera.near = Math.max(0.5, d / 200); this.camera.far = d * 50; this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  fit() { this.setView('iso'); }
  /** mqa: phone card: the camera distance that just fits the model's box corners (seen from dir) in the card, with a margin. */
  cardFit(dir, aspect) {
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(), up = new THREE.Vector3().crossVectors(dir, right);
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2), th = tv * aspect, b = this.fitBox, p = new THREE.Vector3();
    let d = 1;
    for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
      p.set(cx, cz, -cy).sub(this.center); // CAD Z-up -> three Y-up
      const f = p.dot(dir);
      d = Math.max(d, f + Math.abs(p.dot(up)) / tv, f + Math.abs(p.dot(right)) / th);
    }
    return d * 1.2;
  }

  // ---------------------------------------------------------------- phone presentation look (web/phonestudio.js)
  /** Phones only: softer studio light, matte plastic, a soft contact shadow, a fainter grid and a slow auto-rotate that
   * stops while the user touches the model (resumes after 8 s idle). opts: { offsetY: px the model shifts down (under the
   * glass bar), pip: true in the floating thumbnail (always turning, no offset) }. Desktop never calls this. */
  setPresentation(on, opts = {}) {
    if (!on) {
      const p = this.present; if (!p) return;
      this.present = null;
      this.renderer.toneMappingExposure = p.saved.exp;
      this.lights.forEach((l, i) => { l.intensity = p.saved.li[i]; l.position.copy(p.saved.pos[i]); });
      this.lights[0].color.setHex(p.saved.sky);
      this.camera.zoom = 1;
      this.setBackdrop(p.saved.bg, false);
      this.grid.material.uniforms.uAlpha.value = 1;
      this.controls.removeEventListener('start', p.onStart); this.controls.removeEventListener('end', p.onEnd);
      if (!this.studio?.on) this.controls.autoRotate = false;
      if (p.shadow) { this.scene.remove(p.shadow); p.shadow.geometry.dispose(); p.shadow.material.map.dispose(); p.shadow.material.dispose(); }
      this.presentItems(false);
      this.resize();
      return;
    }
    if (!this.present) {
      const p = this.present = { pip: false, offsetY: 0, idleAt: 0,
        saved: { exp: this.renderer.toneMappingExposure, li: this.lights.map(l => l.intensity), pos: this.lights.map(l => l.position.clone()), sky: this.lights[0].color.getHex(), bg: this.backdrop } };
      p.onStart = () => { p.idleAt = Infinity; };
      p.onEnd = () => { p.idleAt = performance.now() + 8000; };
      this.controls.addEventListener('start', p.onStart); this.controls.addEventListener('end', p.onEnd);
      this.setBackdrop('light', false);
      // soft studio light: a bright sky, a warm bounce, a high frontal key and gentle fill / rim
      const [hemi, key, fill, rim] = this.lights;
      if (!this.photo) { // photoreal: the studio HDR already is the soft light
        hemi.color.setHex(0xffffff); hemi.intensity = 1.25; hemi.groundColor.setHex(0xb9b2a8);
        key.intensity = 1.35; key.position.set(-260, 620, 520);
        fill.intensity = 0.55; rim.intensity = 0.55;
        this.renderer.toneMappingExposure = 1.02;
      }
      this.grid.material.uniforms.uAlpha.value = 0.45;
      // contact shadow: a radial blob on the floor under the model
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(40,34,28,.34)'); grad.addColorStop(0.45, 'rgba(40,34,28,.16)'); grad.addColorStop(1, 'rgba(40,34,28,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      p.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      p.shadow.rotation.x = -Math.PI / 2; p.shadow.renderOrder = -1; p.shadow.raycast = () => {};
      this.scene.add(p.shadow);
      this.presentItems(true);
      if (this.items.length) this.setView('iso');
    }
    const p = this.present;
    if ('pip' in opts) p.pip = !!opts.pip;
    if ('offsetY' in opts && opts.offsetY !== p.offsetY) { p.offsetY = opts.offsetY || 0; this.resize(); }
  }
  /** Matte plastic (and no edge lines) on the CAD materials while presenting; back to the CAD look otherwise. */
  presentItems(on) {
    for (const it of this.items) {
      if (it.vc || it.look || it.photo) continue; // library parts keep their real per-vertex finishes; materials / photoreal: keep theirs
      const comp = it.p.group === 'component';
      if (on) { it.mat.roughness = comp ? 0.42 : 0.66; it.mat.metalness = comp ? 0.2 : 0.0; it.mat.envMapIntensity = 0.22; }
      else { it.mat.roughness = 0.5; it.mat.metalness = comp ? 0.25 : 0.04; it.mat.envMapIntensity = ENV_CAD; }
      if (it.edges) it.edges.visible = !on;
    }
  }
  presentTick() {
    const p = this.present;
    if (p.shadow) {
      const vis = !!this.items.length && !this.emptyOn && !this.studio?.on && !this.photo; // photoreal: real contact shadow instead
      p.shadow.visible = vis;
      if (vis) { const s = this.radius * 1.5 * (1 + this.ui.explode * 0.5); p.shadow.scale.set(s, s, 1); p.shadow.position.set(this.center.x, this.grid.position.y + 0.3, this.center.z); }
    }
    if (this.studio?.on) return; // render mode runs its own turntable
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotate = !still && (p.pip || performance.now() > p.idleAt);
    const z = p.pip ? 1.35 : 1; // the floating thumbnail sits a little closer
    if (Math.abs(this.camera.zoom - z) > 0.002) { this.camera.zoom += (z - this.camera.zoom) * 0.12; this.camera.updateProjectionMatrix(); }
    this.controls.autoRotateSpeed = p.pip ? 1.6 : 1.1;
  }

  /** designing: hide the empty space's print volume and axes (the card's "building" ghost shows instead); grid stays. */
  setGuides(on) {
    if (this.guidesOff === !on) return;
    this.guidesOff = !on;
    if (this.vol) { this.vol.visible = this.emptyOn && on; this.axes.visible = this.emptyOn && on; }
  }

  /** Empty / first-build space: a faint 256 mm print volume and CAD axes (X red, Y green, Z blue up) on the grid. */
  showEmpty(on) {
    if (on && !this.vol) {
      const box = new THREE.BoxGeometry(256, 256, 256);
      this.vol = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x5a606b, transparent: true, opacity: 0.45 }));
      box.dispose();
      this.vol.position.set(0, 128, 0);
      const L = 70, g = new THREE.BufferGeometry();
      // CAD is Z-up: CAD X = three X, CAD Y = three -Z, CAD Z = three Y
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, L, 0, 0, 0, 0, 0, 0, 0, -L, 0, 0, 0, 0, L, 0], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([.94, .38, .35, .94, .38, .35, .43, .78, .45, .43, .78, .45, .35, .62, 1, .35, .62, 1], 3));
      this.axes = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
      this.axes.renderOrder = 2; this.axes.position.y = 0.5;
      this.scene.add(this.vol, this.axes);
    }
    const was = !!this.emptyOn;
    this.emptyOn = !!on;
    if (this.vol) { this.vol.visible = !!on && !this.guidesOff; this.axes.visible = !!on && !this.guidesOff; }
    if (on && !was) { this.grid.position.y = 0; this.center.set(0, 110, 0); this.radius = 300; this.setView('iso'); }
  }
}

/** Parts that share a face (a pad laid flat on a board, a panel flush in a frame) flicker as the camera moves: the depth
 * test can't pick one. Give smaller parts a slightly stronger depth offset so they always draw over the bigger part they
 * sit on. Set per draw, so it survives every material swap (materials, photoreal, render look). */
function layerCoplanar(items) {
  const vol = it => { const b = it.mesh.geometry.boundingBox; if (!b) return 0; const s = new THREE.Vector3(); b.getSize(s); return Math.max(s.x, 1e-3) * Math.max(s.y, 1e-3) * Math.max(s.z, 1e-3); };
  const sorted = [...items].sort((a, b) => vol(b) - vol(a)); // biggest first: no offset
  sorted.forEach((it, i) => {
    const k = Math.round((i / Math.max(1, sorted.length - 1)) * 3); // 0..3
    it.mesh.onBeforeRender = (r, sc, cam, g, mat) => {
      if (!mat || mat.isLineBasicMaterial) return;
      mat.polygonOffset = k > 0; mat.polygonOffsetFactor = -k; mat.polygonOffsetUnits = -k * 2;
    };
  });
}

