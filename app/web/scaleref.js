// scaleref: the Scale toggle. installScale(viewer) -> viewer.scaleRef. Puts an everyday object next to the model, at true
// size, so you can see how big the design really is: a coin, an AA battery, a drink can, a phone, a person or a car,
// picked from the model's size (the chooser under the toolbar switches it). Display only: never part of the design.
// Objects are built from three.js primitives in CAD mm (Z up, front is -Y) and sit on the model's floor, to its right.
import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...o });
const mesh = (geo, m, at) => { const x = new THREE.Mesh(geo, m); if (at) x.position.set(...at); return x; };
const upright = geo => geo.rotateX(Math.PI / 2); // three's Y-up primitives -> CAD Z up
/** A rounded-rect plate: w x h in the XZ plane, t thick along Y, bottom edge on z = 0, centred on y = 0. */
function plate(w, h, t, r, bevel = 0) {
  const s = new THREE.Shape(), x0 = -w / 2, x1 = w / 2;
  s.moveTo(x0 + r, 0); s.lineTo(x1 - r, 0); s.quadraticCurveTo(x1, 0, x1, r); s.lineTo(x1, h - r); s.quadraticCurveTo(x1, h, x1 - r, h);
  s.lineTo(x0 + r, h); s.quadraticCurveTo(x0, h, x0, h - r); s.lineTo(x0, r); s.quadraticCurveTo(x0, 0, x0 + r, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  return g.translate(0, 0, -(t - bevel * 2) / 2).rotateX(Math.PI / 2); // extrude axis -> -Y (front)
}

const REFS = {
  coin: { label: 'Coin', note: '24 mm', build() {
    return [mesh(upright(new THREE.CylinderGeometry(12.13, 12.13, 1.75, 64)), mat(0xc9c9c6, { metalness: 1, roughness: 0.32 }), [0, 0, 0.875])];
  } },
  battery: { label: 'AA battery', note: '50 mm', build() {
    const body = mat(0x1d1d1f, { roughness: 0.35 }), copper = mat(0xc77a2e, { metalness: 0.8, roughness: 0.3 }), steel = mat(0xcfd0d2, { metalness: 1, roughness: 0.25 });
    return [mesh(upright(new THREE.CylinderGeometry(7.25, 7.25, 36, 48)), body, [0, 0, 18]),
      mesh(upright(new THREE.CylinderGeometry(7.25, 7.25, 13, 48)), copper, [0, 0, 42.5]),
      mesh(upright(new THREE.CylinderGeometry(2.75, 2.75, 1.5, 32)), steel, [0, 0, 49.75])];
  } },
  can: { label: 'Drink can', note: '330 ml, 122 mm', build() {
    const pts = [[0, 0], [24, 0], [27, 1.5], [33, 9], [33, 107], [28, 118], [27, 121], [27.6, 122]].map(([r, y]) => new THREE.Vector2(r, y));
    return [mesh(upright(new THREE.LatheGeometry(pts, 64)), mat(0xc8102e, { metalness: 0.55, roughness: 0.32 })),
      mesh(upright(new THREE.CylinderGeometry(26.5, 26.5, 0.8, 64)), mat(0xd4d5d7, { metalness: 1, roughness: 0.28 }), [0, 0, 121.2]),
      mesh(upright(new THREE.CylinderGeometry(24, 24, 1.6, 64)), mat(0xd4d5d7, { metalness: 1, roughness: 0.3 }), [0, 0, 0.8])];
  } },
  phone: { label: 'Phone', note: '147 mm', build() {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(67, 142.5).rotateX(Math.PI / 2), mat(0x0b0c0f, { roughness: 0.12, metalness: 0.2 }));
    screen.position.set(0, -3.95, 73.5); // just proud of the front face, which faces -Y
    return [mesh(plate(71.5, 147, 7.8, 11, 1.2), mat(0x3a3b3f, { metalness: 0.7, roughness: 0.35 })), screen,
      mesh(plate(30, 32, 2, 7, 0.5), mat(0x2c2d31, { metalness: 0.5, roughness: 0.3 }), [-15, 4.6, 110])]; // camera bump on the back
  } },
  person: { label: 'Person', note: '1.75 m', build() {
    const m = mat(0xbdb6ac, { roughness: 0.7 }), cap = (r, len, at, rotY = 0) => { const g = upright(new THREE.CapsuleGeometry(r, len, 8, 24)); if (rotY) g.rotateY(rotY); return mesh(g, m, at); };
    const torso = cap(150, 330, [0, 0, 1190]); torso.scale.set(1.25, 0.65, 1);
    return [cap(62, 720, [-95, 0, 420]), cap(62, 720, [95, 0, 420]), torso,
      cap(45, 560, [-245, 0, 1135], -0.12), cap(45, 560, [245, 0, 1135], 0.12),
      mesh(new THREE.SphereGeometry(100, 32, 24), m, [0, 0, 1650]), cap(45, 40, [0, 0, 1510])];
  } },
  car: { label: 'Car', note: '4.5 m', build() {
    const s = new THREE.Shape(), P = [[-2250, 330], [2250, 330], [2280, 760], [1450, 880], [700, 1400], [-950, 1440], [-1950, 1020], [-2280, 920]];
    s.moveTo(...P[0]); for (const p of P.slice(1)) s.lineTo(...p); s.closePath();
    const body = new THREE.ExtrudeGeometry(s, { depth: 1640, bevelEnabled: true, bevelThickness: 80, bevelSize: 80, bevelSegments: 4 }).translate(0, 0, -820).rotateX(Math.PI / 2);
    const tyre = mat(0x1f2023, { roughness: 0.85 }), rim = mat(0xb8bcc2, { metalness: 0.9, roughness: 0.3 }), out = [mesh(body, mat(0x9aa1ab, { metalness: 0.45, roughness: 0.4 }))];
    const win = new THREE.Shape([[1300, 930], [690, 1330], [-900, 1370], [-1800, 1010]].map(([x, y]) => new THREE.Vector2(x, y)));
    for (const y of [-1, 1]) {
      out.push(mesh(new THREE.ShapeGeometry(win).rotateX(Math.PI / 2).translate(0, y * 902, 0), mat(0x22262c, { roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide })));
      for (const x of [-1450, 1450]) {
        out.push(mesh(new THREE.CylinderGeometry(330, 330, 230, 40), tyre, [x, y * 760, 330]));
        out.push(mesh(new THREE.CylinderGeometry(200, 200, 236, 32), rim, [x, y * 760, 330]));
      }
    }
    return out;
  } },
};
export const SCALE_KEYS = Object.keys(REFS);
/** The object that reads best beside a model whose biggest side is d mm. */
export function pickRef(d) { return d < 45 ? 'coin' : d < 110 ? 'battery' : d < 280 ? 'can' : d < 600 ? 'phone' : d < 3000 ? 'person' : 'car'; }

export function installScale(v) {
  if (v.scaleRef) return v.scaleRef;
  return (v.scaleRef = new ScaleRef(v));
}

class ScaleRef {
  constructor(v) { this.v = v; this.on = false; this.key = null; this.picked = false; this.group = null; this.bar = null; }
  modelBox() { return this.v.fitBox && !this.v.fitBox.isEmpty() ? this.v.fitBox.clone() : null; }
  set(on) {
    on = !!on && !!this.v.items?.length;
    if (on === this.on) return;
    this.on = on;
    if (on) { if (!this.picked) this.key = null; this.place(true); }
    else { this.clear(); const b = this.modelBox(); if (b) this.frame(b, true); }
    this.syncUi();
  }
  /** Frame box; the phone card frames itself from fitBox (setView), so snap it there. */
  frame(box, force) { this.v.glideTo(box, force); if (this.v.present) { this.v.fitBox = box.clone(); this.v.setView('iso'); } }
  toggle() { this.set(!this.on); }
  choose(key) { if (!REFS[key]) return; this.key = key; this.picked = true; if (this.on) this.place(true); this.syncUi(); }
  /** viewer.load(): a new or edited model -> keep the object beside it (a new design picks again). */
  onLoad(manifest) {
    const id = manifest?.id || manifest?.name || '';
    if (id !== this.design) { this.design = id; this.picked = false; }
    if (!this.on) return;
    if (!this.v.items?.length) { this.set(false); return; }
    if (!this.picked) this.key = null;
    this.place(false);
  }
  clear() {
    if (!this.group) return;
    this.group.parent?.remove(this.group);
    this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.group = null;
  }
  place(frame) {
    this.clear();
    const B = this.modelBox(); if (!B) return;
    const sz = B.getSize(new THREE.Vector3());
    if (!this.key) this.key = pickRef(Math.max(sz.x, sz.y, sz.z));
    const g = new THREE.Group(); g.name = 'scale-ref'; g.userData.display = true;
    for (const m of REFS[this.key].build()) { m.raycast = () => {}; m.castShadow = m.receiveShadow = true; g.add(m); }
    g.updateMatrixWorld(true);
    const rb = new THREE.Box3().setFromObject(g), rs = rb.getSize(new THREE.Vector3());
    const gap = Math.max(8, 0.18 * Math.min(Math.max(sz.x, sz.y), Math.max(rs.x, rs.y)));
    g.position.set(B.max.x + gap - rb.min.x, (B.min.y + B.max.y) / 2 - (rb.min.y + rb.max.y) / 2, B.min.z - rb.min.z);
    this.v.world.add(g); this.group = g;
    const all = B.clone().union(rb.clone().translate(g.position));
    this.frame(all, frame);
  }
  // ---------------------------------------------------------------- UI: the toolbar button (index.html #scaleBtn) + the chooser
  syncUi() {
    const btn = document.getElementById('scaleBtn');
    if (btn) { btn.classList.toggle('on', this.on); btn.setAttribute('aria-pressed', String(this.on)); }
    const pane = this.v.container.closest('.model-pane') || this.v.container;
    if (!this.bar) {
      this.bar = document.createElement('div'); this.bar.className = 'scale-bar'; this.bar.hidden = true;
      this.bar.setAttribute('role', 'group'); this.bar.setAttribute('aria-label', 'Compare with');
      this.bar.innerHTML = SCALE_KEYS.map(k => `<button type="button" data-k="${k}" title="${REFS[k].note}">${REFS[k].label}</button>`).join('');
      this.bar.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) this.choose(b.dataset.k); });
      pane.appendChild(this.bar);
    }
    this.bar.hidden = !this.on;
    for (const b of this.bar.querySelectorAll('button')) { const on = b.dataset.k === this.key; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
}
