// Scene: shows the product in context (desk, wall, kitchen counter, shelf, bike handlebar, room corner) with simple,
// real-size props built procedurally (no downloads). Props live in CAD space (mm, Z up) inside viewer.world, so they
// line up with the model however the viewer is framed. The product never moves: the scene is placed around it (its
// bottom on the surface; on a wall, its back against the wall).
//
// The design picks the scene with SCENE / SCENE_FACE in design.py (manifest "scene" / "scene_face"); older designs get
// a guess from the title, description, tags and first prompt (viewer.sceneHint, set by app.js) and the part names.
// Works in CAD view (soft blob shadows) and in render mode (real key-light shadows, the studio's own floor hidden),
// Light and Dark. UI: a Scene button + menu in the desktop toolbar; on phones a chip row in the Look sheet (app.js).
import * as THREE from 'three';

export const SCENES = [['none', 'None'], ['desk', 'Desk'], ['wall', 'Wall'], ['counter', 'Counter'], ['shelf', 'Shelf'], ['handlebar', 'Bike'], ['floor', 'Floor']];
const FAST = /\b(screws?|bolts?|nuts?|washers?|inserts?|rivets?|nails?|anchors?|shcs|bhcs|csk)\b/i;
const KINDS = new Set(SCENES.map(s => s[0]));
const SURFACE = new Set(['desk', 'counter', 'shelf', 'floor']); // the product stands on something
const WALLED = new Set(['wall', 'counter', 'shelf', 'floor']);  // a wall behind: keep the camera in front of it

/** Guess a scene from text (title first, then the rest). */
export function guessScene(title = '', more = '', size = 0) {
  const rule = (t) => {
    if (/\bwall\b|wall-?mount/i.test(t)) return 'wall';
    if (/handlebar|\bbike\b|bicycle|cycling|\bmtb\b|\bstem\b/i.test(t)) return /hook|hanger|\brack\b|storage/i.test(t) ? 'wall' : 'handlebar';
    if (/kitchen|spice|drawer|counter|utensil|cutting board|knife|coffee/i.test(t)) return 'counter';
    if (/mount|hook|\brack\b|hanger|bracket/i.test(t)) return 'wall';
    if (/shelf|bookend/i.test(t)) return 'shelf';
    if (/desk|stand|lamp|organi[sz]er|monitor|keyboard|sign|charger|dock|holder/i.test(t)) return 'desk';
    return null;
  };
  return rule(title) || rule(more) || (size > 700 ? 'floor' : 'desk');
}

// ---------------------------------------------------------------- procedural textures (made once, shared)
const TEX = {};
function canvasTex(key, w, h, draw, srgb = true) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return (TEX[key] = t);
}
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const woodTex = () => canvasTex('wood', 1024, 256, (g, w, h) => {
  const r = rnd(7);
  g.fillStyle = '#c99f74'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { // long grain lines
    const y0 = r() * h, a = 0.04 + r() * 0.09, dark = r() < 0.7, amp = 2 + r() * 6, f = 0.004 + r() * 0.01, ph = r() * 6;
    g.strokeStyle = dark ? `rgba(110,72,40,${a})` : `rgba(240,214,180,${a})`; g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3);
    g.stroke();
  }
});
const plankTex = () => canvasTex('plank', 1024, 1024, (g, w, h) => {
  const r = rnd(11), rows = 8, ph = h / rows;
  for (let i = 0; i < rows; i++) {
    let x = -r() * 600;
    while (x < w) {
      const len = 500 + r() * 500, t = 0.88 + r() * 0.2;
      g.fillStyle = `rgb(${196 * t | 0},${160 * t | 0},${118 * t | 0})`; g.fillRect(x, i * ph, len, ph);
      for (let k = 0; k < 10; k++) {
        const y = i * ph + 4 + r() * (ph - 8);
        g.strokeStyle = `rgba(105,70,40,${0.05 + r() * 0.08})`; g.lineWidth = 0.8 + r() * 1.6;
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len * 0.3, y + r() * 6 - 3, x + len * 0.6, y + r() * 6 - 3, x + len, y); g.stroke();
      }
      g.fillStyle = 'rgba(70,46,26,.35)'; g.fillRect(x, i * ph, 2, ph);
      x += len;
    }
    g.fillStyle = 'rgba(70,46,26,.3)'; g.fillRect(0, i * ph, w, 2);
  }
});
const plasterTex = () => canvasTex('plaster', 512, 512, (g, w, h) => {
  const r = rnd(3);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) { // soft blotches
    const x = r() * w, y = r() * h, rad = 30 + r() * 90, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(120,115,105,${0.025 + r() * 0.03})`); gr.addColorStop(1, 'rgba(120,115,105,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.5)'; g.fillRect(r() * w, r() * h, 1.2, 1.2); }
});
const tileTex = () => canvasTex('tile', 512, 512, (g, w, h) => { // subway tiles 150 x 75 mm: 4 x 8 per 600 mm square
  const r = rnd(5), tw = w / 4, th = h / 8;
  g.fillStyle = '#cfccc5'; g.fillRect(0, 0, w, h);
  for (let j = 0; j < 8; j++) for (let i = -1; i < 5; i++) {
    const x = i * tw + (j % 2 ? tw / 2 : 0), y = j * th, t = 0.97 + r() * 0.03;
    const gr = g.createLinearGradient(0, y, 0, y + th);
    gr.addColorStop(0, `rgb(${252 * t | 0},${251 * t | 0},${248 * t | 0})`); gr.addColorStop(1, `rgb(${240 * t | 0},${238 * t | 0},${233 * t | 0})`);
    g.fillStyle = gr; g.fillRect(x + 2, y + 2, tw - 4, th - 4);
  }
});
const fadeTex = () => canvasTex('fade', 256, 256, (g, w, h) => { // alpha map: solid middle, soft edges
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.max(0, Math.abs(x / w - 0.5) * 2 - 0.55) / 0.45, dy = Math.max(0, Math.abs(y / h - 0.5) * 2 - 0.55) / 0.45;
    const d = Math.min(1, Math.hypot(dx, dy)), a = 255 * (1 - d * d * (3 - 2 * d)), i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = a; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}, false);
const blobTex = () => canvasTex('blob', 128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(30,26,22,.5)'); gr.addColorStop(0.5, 'rgba(30,26,22,.2)'); gr.addColorStop(1, 'rgba(30,26,22,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});

// ---------------------------------------------------------------- props (CAD mm, Z up; built at the local origin)
function mat(o, dark = 0.62) { // dark: colour multiplier on a Dark backdrop
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, envMapIntensity: 0.45, ...o });
  m.userData.base = m.color.clone(); m.userData.dark = dark;
  return m;
}
function texRepeat(t, rx, ry) { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; }

function mug() {
  const g = new THREE.Group();
  const R = 41, H = 95, wall = 3.5;
  const pts = [[0, 0], [R - 3, 0], [R, 3], [R, H - 1], [R - 1, H], [R - wall + 0.5, H], [R - wall, H - 1], [R - wall, 9], [0, 8]].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 48); geo.rotateX(Math.PI / 2); // lathe axis Y -> CAD Z
  const ceramic = mat({ color: '#e9e4da', roughness: 0.28, envMapIntensity: 0.7 }, 0.55);
  g.add(new THREE.Mesh(geo, ceramic));
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(R - wall, 40), mat({ color: '#3b2416', roughness: 0.15, envMapIntensity: 0.8 }, 0.8));
  coffee.position.z = H - 14; g.add(coffee);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(24, 5.5, 14, 28, Math.PI * 1.15), ceramic);
  handle.rotation.set(Math.PI / 2, 0, -Math.PI * 0.575); handle.position.set(R + 2, 0, H * 0.52); handle.scale.set(0.75, 1, 1);
  g.add(handle);
  return { obj: g, size: [R * 2 + 30, R * 2, H] };
}

function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function phone() { // 147 x 72 x 7.8 mm, face up
  const g = new THREE.Group();
  const body = new THREE.ExtrudeGeometry(roundRect(72, 147, 10), { depth: 6.8, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5, bevelSegments: 2, curveSegments: 8 });
  body.translate(0, 0, 0.5);
  g.add(new THREE.Mesh(body, mat({ color: '#2c2e33', roughness: 0.35, metalness: 0.5, envMapIntensity: 0.8 }, 0.9)));
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(69, 144, 9), 8), mat({ color: '#0d0e10', roughness: 0.08, envMapIntensity: 1.1 }, 1));
  glass.position.z = 7.85; g.add(glass);
  const cam = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1.2, 20), mat({ color: '#15161a', roughness: 0.2 }, 1));
  cam.rotation.x = Math.PI / 2; cam.position.set(-22, 58, 0.1); g.add(cam); // on the back: barely shows, but reads at grazing angles
  return { obj: g, size: [72, 147, 7.8] };
}
function book(w, h, t, color) {
  const g = new THREE.Group();
  const cover = mat({ color, roughness: 0.8 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(t, w, h), cover); b.position.z = h / 2; g.add(b);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(t - 2, w - 3, h - 4), mat({ color: '#f1ece0', roughness: 0.9 }, 0.6));
  pages.position.set(0, -1.6, h / 2); g.add(pages);
  return g;
}
function plant() { // small pot with a few leaves
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(42, 34, 80, 28), mat({ color: '#c97b55', roughness: 0.85 }));
  pot.rotation.x = Math.PI / 2; pot.position.z = 40; g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(39, 24), mat({ color: '#3a2a1e', roughness: 1 }, 0.8)); soil.position.z = 76; g.add(soil);
  const leaf = mat({ color: '#5f8a4e', roughness: 0.6, side: THREE.DoubleSide });
  const r = rnd(9);
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), leaf);
    l.scale.set(9, 26 + r() * 14, 2.5);
    const a = (i / 9) * Math.PI * 2;
    l.position.set(Math.cos(a) * 12, Math.sin(a) * 12, 100 + r() * 20);
    l.rotation.set(0.5 * Math.sin(a), -0.5 * Math.cos(a), a + Math.PI / 2, 'ZXY');
    l.lookAt(l.position.x * 4, l.position.y * 4, 170); l.rotateX(Math.PI / 2);
    g.add(l);
  }
  return g;
}
function wallPlane(w, h, color = '#e7e2d9', tiles = 0) {
  // a wall in the XZ plane facing -Y (towards the front), bottom at z = 0, soft faded edges
  const g = new THREE.Group();
  const m = mat({ color, roughness: 0.92, map: texRepeat(plasterTex(), w / 700, h / 700), alphaMap: fadeTex(), transparent: true }, 0.33);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.rotation.x = Math.PI / 2; p.position.z = h / 2; p.receiveShadow = true;
  p.renderOrder = -1;
  g.add(p);
  if (tiles) { // tiled backsplash (bottom tiles mm), faded at the sides
    const am = texRepeat(fadeTex(), 1, 0.4); am.offset.set(0, 0.3); // fade the sides only
    const tm = mat({ color: '#ffffff', roughness: 0.35, map: texRepeat(tileTex(), w / 600, tiles / 600), alphaMap: am, transparent: true, envMapIntensity: 0.6 }, 0.45);
    const t = new THREE.Mesh(new THREE.PlaneGeometry(w, tiles), tm); t.rotation.x = Math.PI / 2; t.position.set(0, -0.6, tiles / 2); t.receiveShadow = true;
    g.add(t);
  }
  return g;
}
function slab(w, d, t, m) { // top face at z = 0
  const s = new THREE.Mesh(new THREE.BoxGeometry(w, d, t), m); s.position.z = -t / 2; s.receiveShadow = true; s.castShadow = true;
  return s;
}
function blob(w, d, opacity = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity, toneMapped: false }));
  m.scale.set(w, d, 1); m.renderOrder = 1; m.userData.blob = true;
  return m;
}

// ---------------------------------------------------------------- the scene controller (one per viewer)
export class Props {
  constructor(v) {
    this.v = v;
    this.kind = 'none';      // what is shown
    this.suggest = 'desk';   // what the design declares or the guess picks (the Scene button turns this on)
    this.declared = null;
    this.group = null;
    this.hide = [];          // render.js: hidden from the contact-shadow depth pass
    this.mode = null;        // light | dark the props are tinted for
    this.dir = 1;            // auto-rotate ping-pong in front of a wall
    this.ui = null;
  }
  get active() { return this.kind !== 'none' && !!this.group; }

  /** After every viewer.load: work out the suggestion; rebuild an active scene around the new model. */
  onLoad(manifest) {
    const hint = this.v.sceneHint || {};
    const key = hint.id || manifest?.title || '';
    if (key !== this.forKey) { this.forKey = key; if (this.kind !== 'none') this.set('none', { frame: false }); }
    this.manifest = manifest || null;
    this.declared = KINDS.has(manifest?.scene) && manifest.scene !== 'none' ? manifest.scene : null;
    const box = this.productBox(), size = box.isEmpty() ? 0 : Math.max(...box.getSize(new THREE.Vector3()).toArray());
    const names = (manifest?.parts || []).map(p => p.name).join(' ');
    this.suggest = this.declared || guessScene(hint.title || manifest?.title || '', `${hint.text || ''} ${names}`, size);
    if (this.kind !== 'none') this.build(this.kind);
    this.syncUi();
  }

  /** Product bounds in CAD mm (built pose, explode ignored). place: leave out fasteners (wall screws reach into the wall). */
  productBox(place = false) {
    const b = new THREE.Box3();
    for (const it of this.v.items) {
      if (place && FAST.test(it.p.name)) continue; const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); b.union(g.boundingBox); }
    return b;
  }

  /** 'none' | a scene kind. Frames the camera on the product and its props. */
  set(kind, { frame = true } = {}) {
    kind = KINDS.has(kind) ? kind : 'none';
    this.kind = kind;
    if (kind === 'none') this.clear(); else this.build(kind);
    const st = this.v.studio;
    if (st) { st.dirtyShadow = true; st.resetPt?.(); }
    if (frame && this.v.items.length) this.frame();
    this.syncUi();
    this.v.container.dispatchEvent(new CustomEvent('viewer:scene', { bubbles: true, detail: { viewer: this.v, kind } }));
    return kind;
  }

  clear() {
    const g = this.group; if (!g) return;
    this.v.world.remove(g);
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = o.material; for (const t of [m.map, m.alphaMap]) if (t && !Object.values(TEX).includes(t)) t.dispose(); m.dispose(); } });
    this.group = null; this.hide = []; this.walled = false;
    const c = this.v.controls; c.minAzimuthAngle = -Infinity; c.maxAzimuthAngle = Infinity;
    if (!this.v.studio?.on && !this.v.emptyOn) this.v.grid.visible = true;
    if (this.v.studio?.on) this.studioVis(this.v.studio, false);
  }

  /** Which horizontal side of the product goes against a wall: 'face' if declared, else the side with the most flat,
   * outward-facing printed surface right at the extreme (front is -Y by convention, so +Y wins ties). */
  backDir(box) {
    const f = this.manifest?.scene_face;
    if (f && /^[+-][xy]$/.test(f)) return f;
    const dirs = { '+y': [1, 1], '-y': [1, -1], '+x': [0, 1], '-x': [0, -1] }, score = { '+y': 0, '-y': 0, '+x': 0, '-x': 0 };
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const tol = Math.max(1.5, box.getSize(new THREE.Vector3()).length() * 0.01);
    for (const it of this.v.items) {
      if (it.p.group === 'component') continue;
      const pos = (it.cgeo || it.mesh.geometry).attributes.position, N = pos.count;
      const step = Math.max(1, Math.floor(N / 3 / 20000)) * 3; // big meshes: sample triangles
      for (let i = 0; i + 2 < N; i += step) {
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
        n.crossVectors(b.clone().sub(a), c.clone().sub(a));
        const area = n.length() / 2; if (area < 1e-6) continue; n.divideScalar(area * 2);
        for (const [k, [ax, s]] of Object.entries(dirs)) {
          const comp = ax ? n.y : n.x; if (comp * s < 0.96) continue;
          const ext = ax ? (s > 0 ? box.max.y : box.min.y) : (s > 0 ? box.max.x : box.min.x);
          const v = ax ? (a.y + b.y + c.y) / 3 : (a.x + b.x + c.x) / 3;
          if (Math.abs(v - ext) < tol) score[k] += area;
        }
      }
    }
    score['+y'] *= 1.25; // convention: product front faces -Y
    const best = Object.entries(score).sort((p, q) => q[1] - p[1])[0];
    return best[1] > 0 ? best[0] : '+y';
  }

  /** A bike-bar reference part in the design (e.g. "Handlebar (ref)"): its axis, centre and radius. */
  barRef() {
    const it = this.v.items.find(x => /handle\s*bar|\bbar\b.*\((ref|yours)\)/i.test(x.p.name));
    if (!it) return null;
    const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3()), c = g.boundingBox.getCenter(new THREE.Vector3());
    const axis = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z';
    if (axis === 'z') return null;
    const r = (axis === 'x' ? Math.min(s.y, s.z) : Math.min(s.x, s.z)) / 2;
    return { axis, c, r: Math.max(8, Math.min(r, 20)), len: axis === 'x' ? s.x : s.y, stem: this.v.items.some(x => /\bstem\b/i.test(x.p.name)) };
  }

  build(kind) {
    this.clear();
    let box = this.productBox(true); if (box.isEmpty()) box = this.productBox(); if (box.isEmpty()) return;
    const v = this.v, size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    // local frame: origin under the product centre (x, y) at its bottom z; local +Y is the back (wall side)
    let back = '+y';
    if (kind === 'wall') back = this.backDir(box);
    const bar = kind === 'handlebar' ? this.barRef() : null;
    if (bar?.axis === 'y') back = '-x'; // the bar runs along local X
    const ang = { '+y': 0, '-y': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[back];
    const g = new THREE.Group(), rig = new THREE.Group();
    rig.position.set(ctr.x, ctr.y, box.min.z); rig.rotation.z = ang; g.add(rig);
    // product bounds in the local frame
    const ca = Math.cos(-ang), sa = Math.sin(-ang), L = new THREE.Box3();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
      const dx = x - ctr.x, dy = y - ctr.y;
      L.expandByPoint(new THREE.Vector3(dx * ca - dy * sa, dx * sa + dy * ca, 0));
    }
    L.min.z = 0; L.max.z = size.z;
    const W = L.max.x - L.min.x, D = L.max.y - L.min.y, Hh = size.z;
    const frameAlso = []; // props worth keeping in frame
    const add = (o, x, y, z = 0, rz = 0, frame = false) => { o.position.set(x, y, z); o.rotation.z += rz; rig.add(o); if (frame) frameAlso.push(o); return o; };
    const shadowOn = (o) => o.traverse(m => { if (m.isMesh && !m.userData.blob) { m.castShadow = true; m.receiveShadow = true; } });
    const productBlob = (op = 0.9) => add(blob(W * 1.35 + 20, D * 1.35 + 20, op), (L.min.x + L.max.x) / 2, (L.min.y + L.max.y) / 2, 0.4);

    if (kind === 'desk') {
      const mx = L.max.x + 70, px = L.min.x - 75;
      const deskW = Math.max(1100, (mx + 90 - (px - 80)) + 360), deskD = Math.max(650, D + 420);
      add(slab(deskW, deskD, 28, mat({ color: '#ffffff', map: texRepeat(woodTex(), deskW / 1100, deskD / 280), roughness: 0.55 }, 0.6)), (mx + px) / 2, L.max.y + 120 - deskD / 2);
      const m = mug(); shadowOn(m.obj); add(m.obj, mx + 41, L.min.y + 30, 0, -0.5, true); add(blob(115, 100, 0.8), mx + 44, L.min.y + 30, 0.3);
      const p = phone(); shadowOn(p.obj); add(p.obj, px - 36, (L.min.y + L.max.y) / 2 - 30, 0, 0.18, true); add(blob(95, 165, 0.55), px - 36, (L.min.y + L.max.y) / 2 - 30, 0.3);
      productBlob();
    } else if (kind === 'wall') {
      const ww = Math.max(1500, W * 4), wh = Math.max(1200, Hh * 3.4);
      const wall = wallPlane(ww, wh); add(wall, 0, L.max.y + 0.5, Hh / 2 - wh / 2);
      // a light switch plate for scale (US 70 x 115 mm)
      const sp = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 115), mat({ color: '#f6f4ef', roughness: 0.4 }, 0.5));
      const tog = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 22), mat({ color: '#f0eee8', roughness: 0.35 }, 0.5)); tog.position.set(0, -6, 0); sp.add(tog);
      shadowOn(sp); add(sp, L.max.x + Math.max(160, W * 0.6), L.max.y - 3, Math.min(Hh * 0.55, Hh - 60), 0, true);
      const sh = blob(W * 1.25 + 30, 1, 0.55); sh.rotation.x = Math.PI / 2; sh.scale.set(W * 1.25 + 30, Hh * 1.15 + 30, 1);
      add(sh, (L.min.x + L.max.x) / 2 + 6, L.max.y - 0.2, Hh / 2 - Math.max(8, Hh * 0.05));
    } else if (kind === 'counter') {
      const back = L.max.y + 30, depth = Math.max(640, D + 360), cw = Math.max(1500, W * 3.2);
      const cx = W * 0.15;
      add(slab(cw, depth, 30, mat({ color: '#eceae6', roughness: 0.32, envMapIntensity: 0.7 }, 0.55)), cx, back - depth / 2);
      // base cabinet below the worktop, set back 20 mm, with door gaps and bar handles
      const cab = new THREE.Group(), ch = 720, cd = depth - 40, doorW = 500, n = Math.max(2, Math.round(cw / doorW));
      const front = mat({ color: '#8fa39a', roughness: 0.55 }, 0.6);
      const body = new THREE.Mesh(new THREE.BoxGeometry(cw - 10, cd, ch), front); body.position.z = -30 - ch / 2; cab.add(body);
      const gapM = mat({ color: '#4c5651', roughness: 0.8 }, 0.8), steel = mat({ color: '#c9ccd0', metalness: 1, roughness: 0.3, envMapIntensity: 1 }, 0.7);
      for (let i = 1; i < n; i++) { const gp = new THREE.Mesh(new THREE.BoxGeometry(3, 1, ch), gapM); gp.position.set(-cw / 2 + i * (cw / n), -cd / 2 - 0.4, -30 - ch / 2); cab.add(gp); }
      const hz = new THREE.Mesh(new THREE.BoxGeometry(cw - 10, 1, 3), gapM); hz.position.set(0, -cd / 2 - 0.4, -30 - 150); cab.add(hz);
      for (let i = 0; i < n; i++) {
        const hd = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 160, 12), steel); hd.rotation.z = Math.PI / 2;
        hd.position.set(-cw / 2 + (i + 0.5) * (cw / n), -cd / 2 - 14, -30 - 75); cab.add(hd);
      }
      add(cab, cx, back - depth / 2 - 20);
      const wallH = Math.max(900, Hh * 2.6), wall = wallPlane(cw * 1.3, wallH, '#f1eee8', 480); add(wall, cx, back + 0.5, 0);
      const m = mug(); shadowOn(m.obj); add(m.obj, L.max.x + 120, L.min.y - 40, 0, -0.4, true); add(blob(115, 100, 0.8), L.max.x + 123, L.min.y - 40, 0.3);
      productBlob();
    } else if (kind === 'shelf') {
      const back = L.max.y + 15, depth = Math.max(220, D + 70), sw = Math.max(900, W + 640);
      const sx = W * 0.2;
      add(slab(sw, depth, 22, mat({ color: '#ffffff', map: texRepeat(woodTex(), sw / 1100, depth / 280), roughness: 0.55 }, 0.6)), sx, back - depth / 2);
      const metal = mat({ color: '#2d2f33', metalness: 0.6, roughness: 0.45 }, 1);
      for (const s of [-1, 1]) { // L brackets
        const br = new THREE.Group();
        const a = new THREE.Mesh(new THREE.BoxGeometry(25, depth * 0.8, 4), metal); a.position.set(0, -depth * 0.4 + depth / 2, -24); br.add(a);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(25, 4, depth * 0.8), metal); b2.position.set(0, depth / 2 - 2, -22 - depth * 0.4); br.add(b2);
        shadowOn(br); add(br, sx + s * (sw / 2 - 120), back - depth / 2);
      }
      const wall = wallPlane(sw * 1.7, Math.max(1100, Hh * 3.2), '#ede9e2'); add(wall, sx, back + 0.5, -Math.max(1100, Hh * 3.2) * 0.45);
      const colors = ['#4d6a7d', '#b9874f', '#8a4f4a', '#d8d2c4', '#5c6b52'], r = rnd(4);
      let bx = L.max.x + 70;
      for (let i = 0; i < 5; i++) {
        const t = 22 + r() * 18, h = 200 + r() * 45, b = book(Math.min(depth - 20, 150 + r() * 20), h, t, colors[i]);
        shadowOn(b); add(b, bx + t / 2, back - 12 - Math.min(depth - 20, 160) / 2, 0, 0, i < 2); bx += t + 1;
      }
      const pl = plant(); shadowOn(pl); add(pl, L.min.x - 95, back - depth / 2, 0, 0, true); add(blob(110, 110, 0.7), L.min.x - 95, back - depth / 2, 0.3);
      productBlob();
    } else if (kind === 'floor') {
      const back = L.max.y + Math.max(160, D * 0.4), side = L.max.x + Math.max(260, W * 0.5);
      const fw = Math.max(2600, W * 5), fd = Math.max(2400, D * 5);
      const floorM = mat({ color: '#ffffff', map: texRepeat(plankTex(), fw / 1440, fd / 1440), alphaMap: fadeTex(), transparent: true, roughness: 0.6 }, 0.55);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorM); fl.receiveShadow = true; fl.renderOrder = -1;
      add(fl, side - fw / 2 + 200, back - fd / 2 + 200, 0.2);
      const wh = Math.max(1600, Hh * 2.4);
      const w1 = wallPlane(fw, wh, '#eeebe5'); add(w1, side - fw / 2, back + 0.5, 0);
      const w2 = wallPlane(fd, wh, '#e9e5de'); w2.rotation.z = -Math.PI / 2; add(w2, side + 0.5, back - fd / 2, 0);
      const sk = mat({ color: '#f7f6f2', roughness: 0.5 }, 0.5);
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.72, 14, 90), sk); s1.position.set(side - fw * 0.36, back - 7, 45); s1.receiveShadow = true; rig.add(s1);
      const s2 = new THREE.Mesh(new THREE.BoxGeometry(14, fd * 0.72, 90), sk); s2.position.set(side - 7, back - fd * 0.36, 45); s2.receiveShadow = true; rig.add(s2);
      productBlob(1);
    } else if (kind === 'handlebar') {
      const R = bar ? bar.r + 0.4 : 15.9;
      let bc = new THREE.Vector3(0, (L.min.y + L.max.y) / 2, -R); // no reference bar: under the mount
      if (bar) { const dx = bar.c.x - ctr.x, dy = bar.c.y - ctr.y; bc = new THREE.Vector3(dx * ca - dy * sa, dx * sa + dy * ca, bar.c.z - box.min.z); }
      const alloy = mat({ color: '#26282c', roughness: 0.4, metalness: 0.5, envMapIntensity: 0.8 }, 1);
      const rubber = mat({ color: '#141516', roughness: 0.9 }, 1);
      const tube = (r1, r2, len, x, m = alloy) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 32), m); t.rotation.z = -Math.PI / 2; t.position.set(x, 0, 0); return t; };
      const bg = new THREE.Group(), half = 380, clampL = 60, rr = Math.min(R, 15.9) * 0.7;
      bg.add(tube(R, R, clampL * 2, 0));
      for (const s of [-1, 1]) {
        bg.add(tube(s > 0 ? R : rr, s > 0 ? rr : R, 40, s * (clampL + 20)));
        bg.add(tube(rr, rr, half - clampL - 40 - 130, s * (clampL + 40 + (half - clampL - 40 - 130) / 2)));
        bg.add(tube(rr + 5, rr + 5, 130, s * (half - 65), rubber));
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(rr + 5.5, rr + 5.5, 4, 24), alloy); cap.rotation.z = -Math.PI / 2; cap.position.x = s * (half + 1); bg.add(cap);
      }
      if (!bar?.stem) { // stem forward (+Y local, away from the rider at -Y) to the steerer
        const st = new THREE.Mesh(new THREE.BoxGeometry(38, 100, 34), alloy); st.position.set(0, 50 + R, 0); bg.add(st);
        const fc = new THREE.Mesh(new THREE.CylinderGeometry(R + 5, R + 5, 46, 28), alloy); fc.rotation.z = Math.PI / 2; bg.add(fc);
        const steer = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 260, 28), alloy); steer.rotation.x = Math.PI / 2; steer.position.set(0, 100 + R + 6, -100); bg.add(steer);
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 30, 28), rubber); sp.rotation.x = Math.PI / 2; sp.position.set(0, 100 + R + 6, -12); bg.add(sp);
      }
      shadowOn(bg);
      add(bg, bc.x, bc.y, bc.z);
    }
    g.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
    g.userData.scene = true;
    v.world.add(g);
    this.group = g; this.hide = [g]; this.kindBuilt = kind;
    this.walled = WALLED.has(kind);
    this.surface = SURFACE.has(kind);
    this.frameObjs = frameAlso;
    // keep the camera on the room side of a wall: azimuth limits about the room normal (three.js Y-up)
    const c = v.controls;
    if (this.walled) {
      const nx = -(-Math.sin(ang)), ny = -Math.cos(ang); // room side = local -Y in CAD
      this.az0 = Math.atan2(nx, -ny); // CAD (x, y) -> three (x, -y): azimuth = atan2(x, z) = atan2(nx, -ny)
      c.minAzimuthAngle = this.az0 - 1.35; c.maxAzimuthAngle = this.az0 + 1.35;
    } else { c.minAzimuthAngle = -Infinity; c.maxAzimuthAngle = Infinity; }
    this.mode = null; this.tick();
  }

  /** Camera onto the product plus the props that give it scale, keeping the current angle (in front of a wall). */
  frame() {
    const v = this.v, b = this.productBox(); if (b.isEmpty()) return;
    v.world.updateMatrixWorld(true);
    const w = new THREE.Box3(); // world (three.js) space
    for (const it of v.items) { // the parts' own geometry (not children such as decorative cables)
      if (!it.mesh.visible) continue;
      const g = it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
      w.union(g.boundingBox.clone().applyMatrix4(it.mesh.matrixWorld));
    }
    if (w.isEmpty()) return;
    if (this.active) for (const o of this.frameObjs || []) w.expandByObject(o);
    const c = w.getCenter(new THREE.Vector3()), s = w.getSize(new THREE.Vector3());
    const dir = v.camera.position.clone().sub(v.controls.target).normalize();
    if (this.walled) { // in front of the wall, a little above
      let az = Math.atan2(dir.x, dir.z); const d = ((az - this.az0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(d) > 0.9) az = this.az0 - 0.6;
      const el2 = Math.max(0.25, Math.min(0.7, Math.asin(Math.max(-1, Math.min(1, dir.y)))));
      dir.set(Math.sin(az) * Math.cos(el2), Math.sin(el2), Math.cos(az) * Math.cos(el2));
    }
    // fit the bounding sphere in the narrower field of view (phone card: a bit more room for the buttons over it)
    const vh = THREE.MathUtils.degToRad(v.camera.fov) / 2, half = Math.min(vh, Math.atan(Math.tan(vh) * v.camera.aspect));
    const k = this.kind === 'handlebar' ? 1.3 : this.active ? 1.0 : 1.05;
    const dist = (s.length() / 2) / Math.sin(half) * k * (v.present ? 1.1 : 1) * (1 + v.ui.explode * 0.6);
    const p0 = v.camera.position.clone(), t0 = v.controls.target.clone();
    const t1 = this.active ? c : v.center.clone(), p1 = t1.clone().addScaledVector(dir, dist);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.controls.target.copy(t1); v.camera.position.copy(p1); }
    else v.animate(650, k => { v.controls.target.lerpVectors(t0, t1, k); v.camera.position.lerpVectors(p0, p1, k); });
    v.camera.far = Math.max(v.camera.far, dist * 50); v.camera.updateProjectionMatrix();
    if (v.present) v.present.idleAt = performance.now() + 6000;
  }

  /** Render mode: the studio's own floor, catcher and contact shadow vs the scene's surfaces. */
  studioVis(st, on = this.active) {
    if (!st.ground) return;
    const pt = st.ptState === 'running' || st.ptState === 'done';
    st.ground.visible = !on && !pt;
    st.catcher.visible = !on && !pt;
    st.shadow.group.visible = (!on || this.surface) && !pt;
  }

  /** Every frame (viewer loop): grid and phone blob off under a scene, tint for the backdrop, studio surfaces, and keep an
   * auto-rotating camera swinging in front of a wall instead of sticking at the limit. */
  tick() {
    const v = this.v;
    if (!this.active) return;
    v.grid.visible = false;
    if (v.present?.shadow) v.present.shadow.visible = false;
    const st = v.studio;
    if (st?.on) this.studioVis(st);
    const mode = st?.on ? st.opts.backdrop : v.backdrop;
    if (mode !== this.mode) {
      this.mode = mode;
      this.group.traverse(o => { const m = o.material; if (m?.userData?.base) m.color.copy(m.userData.base).multiplyScalar(mode === 'dark' ? m.userData.dark : 1); });
    }
    const blobs = !st?.on; // studio has real shadows
    this.group.traverse(o => { if (o.userData.blob) o.visible = blobs; });
    const c = v.controls;
    if (this.walled && c.autoRotate) {
      const a = c.getAzimuthalAngle();
      if (a <= c.minAzimuthAngle + 0.04) this.dir = -1; else if (a >= c.maxAzimuthAngle - 0.04) this.dir = 1;
      c.autoRotateSpeed = (v.present && !v.studio?.on ? (v.present.pip ? 1.6 : 1.1) : 1.5) * this.dir * 0.6;
    }
  }

  // ---------------------------------------------------------------- UI
  label(k) { return (SCENES.find(s => s[0] === k) || SCENES[0])[1]; }
  /** Desktop: a Scene button with a menu, after Render in this viewer's toolbar (studio and build pages). */
  mountToolbar() {
    if (this.ui) return;
    const tb = this.v.container.closest('.model-pane')?.querySelector('.toolbar'); if (!tb) return;
    injectCss();
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'tbtn scn-btn'; btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Scene: show it in context (desk, wall, kitchen, bike...)';
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.8 12.5h12.4M3.5 12.5V7.2L8 3.8l4.5 3.4v5.3" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><rect x="6.4" y="8.6" width="3.2" height="3.9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg><span>Scene</span>';
    const pop = document.createElement('div'); pop.className = 'scn-pop'; pop.hidden = true; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', 'Scene');
    const anchor = tb.querySelector('.render-btn') || tb.lastElementChild;
    anchor.after(btn);
    tb.parentElement.append(pop);
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = (e) => {
      e.stopPropagation();
      if (!pop.hidden) return close();
      this.fillPop(pop);
      const r = btn.getBoundingClientRect(), pr = tb.parentElement.getBoundingClientRect();
      pop.style.top = (r.bottom - pr.top + 6) + 'px';
      pop.style.right = Math.max(8, pr.right - r.right) + 'px';
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      pop.querySelector('[aria-checked=true]')?.focus();
    };
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (!b) return; this.set(b.dataset.scene); close(); btn.focus(); });
    pop.addEventListener('keydown', (e) => {
      const items = [...pop.querySelectorAll('[data-scene]')], i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { close(); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(); }, true);
    btn._viewer = this.v; // devtools / tests: document.querySelector('.scn-btn')._viewer
    this.ui = { btn, pop };
    fitToolbar(tb);
  }
  fillPop(pop) {
    const opts = this.order();
    pop.innerHTML = opts.map(([k, t]) => `<button type="button" role="menuitemradio" aria-checked="${this.kind === k}" data-scene="${k}">
      <span class="scn-dot" aria-hidden="true"></span><span>${t}</span>${k === this.suggest && k !== 'none' ? '<span class="scn-sug">Suggested</span>' : ''}</button>`).join('');
  }
  /** None, then the suggestion, then the rest. */
  order() { return [SCENES[0], ...SCENES.filter(s => s[0] === this.suggest), ...SCENES.filter(s => s[0] !== 'none' && s[0] !== this.suggest)]; }
  syncUi() {
    if (!this.ui) this.mountToolbar();
    if (!this.ui) return;
    const { btn, pop } = this.ui, on = this.kind !== 'none';
    btn.classList.toggle('on', on);
    btn.querySelector('span').textContent = on ? this.label(this.kind) : 'Scene';
    btn.hidden = !this.v.items.length;
    if (!pop.hidden) this.fillPop(pop);
  }
  /** Phone Look sheet: a "Scene" section with a horizontal chip row (app.js puts it in, then calls bindSheet). */
  sheetHTML() {
    if (!this.v.items.length) return '';
    injectCss();
    return `<div class="lk-sec"><span>Scene</span><span class="lk-cur">${this.kind === 'none' ? 'Studio' : this.label(this.kind)}</span></div>
      <div class="lk-chips" role="radiogroup" aria-label="Scene">${this.order().map(([k, t]) =>
        `<button type="button" role="radio" class="lk-chip ${this.kind === k ? 'on' : ''}" aria-checked="${this.kind === k}" data-scene="${k}">${k === 'none' ? 'Studio' : t}</button>`).join('')}</div>`;
  }
  bindSheet(el, rerender) {
    const row = el.querySelector('.lk-chips'); if (!row) return;
    row.scrollLeft = this.chipScroll || 0;
    row.addEventListener('scroll', () => { this.chipScroll = row.scrollLeft; }, { passive: true });
    row.addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (!b) return; this.set(b.dataset.scene); rerender?.(); });
  }
}

/** Desktop toolbar too narrow for every label: drop the Scene / Assemble labels first, then all button labels. */
function fitToolbar(tb) {
  if (tb._fit) return;
  const fit = () => {
    if (matchMedia('(max-width: 640px)').matches) return tb.classList.remove('tb-c1', 'tb-c2');
    if (!tb.clientWidth) return; // hidden: measure when it shows (ResizeObserver)
    tb.classList.remove('tb-c1', 'tb-c2');
    if (tb.scrollWidth > tb.clientWidth + 1) tb.classList.add('tb-c1');
    if (tb.scrollWidth > tb.clientWidth + 1) tb.classList.add('tb-c2');
  };
  tb._fit = fit;
  new ResizeObserver(fit).observe(tb);
  new MutationObserver(() => requestAnimationFrame(fit)).observe(tb, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  fit();
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.scn-pop { position: absolute; z-index: 30; min-width: 190px; padding: 5px; border-radius: 12px; background: var(--panel, #fff);
  box-shadow: 0 0 0 .5px rgba(28,25,23,.14), 0 10px 30px rgba(28,25,23,.16); display: flex; flex-direction: column; }
.scn-pop[hidden] { display: none; }
.scn-pop button { display: flex; align-items: center; gap: 9px; height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: none;
  font: 500 13px/1 var(--ui, system-ui); color: var(--text, #1c1917); text-align: left; cursor: pointer; }
.scn-pop button:hover, .scn-pop button:focus-visible { background: rgba(28,25,23,.06); outline: none; }
.scn-pop .scn-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.scn-pop [aria-checked=true] .scn-dot { background: var(--accent, #e8590c); }
.scn-pop .scn-sug { margin-left: auto; font-weight: 400; font-size: 12px; color: var(--muted, #78716c); }
.toolbar .asm-btn.on, .toolbar .scn-btn.on { color: var(--accent-2, #c2470a); }
@media (min-width: 641px) { .toolbar.tb-c1 .scn-btn > span, .toolbar.tb-c1 .asm-btn > span, .toolbar.tb-c2 .tbtn > span { display: none; } }
@media (max-width: 640px) { .toolbar .scn-btn, .toolbar .asm-btn, .scn-pop { display: none !important; } }
.m-look .lk-chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 2px 16px 4px; scroll-padding: 0 16px; }
.m-look .lk-chips::-webkit-scrollbar { display: none; }
.m-look .lk-chip { flex: none; height: 34px; padding: 0 15px; border-radius: 17px; border: 0; background: rgba(118,118,128,.12);
  font: 500 14px/1 var(--ui, system-ui); color: var(--text, #1c1917); transition: background .2s, color .2s; }
.m-look .lk-chip.on { background: #1c1917; color: #fff; font-weight: 600; }
`;
  document.head.append(s);
}
