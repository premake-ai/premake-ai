// Reference models in the viewer: bought parts whose name (or ref_model / library key) matches the vetted library in
// web/refmodels/ (built by cadlib/refmodels, licences in cadlib/refmodels/LICENSES.md) are drawn with the real-looking
// model instead of their box. Display only: the design's files, downloads, order and prices never see these models.
// viewer.js calls refSwap(loaded) once per load: it swaps each matching part's geometry in place (one merged mesh with
// per-vertex colour + finish, like library parts, so picking, fades, see-through, explode and render mode work as they
// are) and sets part.ref = {key, label, credit, ...} for the hover card and the parts list. Lazy: the index and each
// GLB load on first use and stay cached; a model that fails to load leaves the box.
import * as THREE from 'three';
import { pickModel, orientedBox, fitMatrix, inside, ensureStyle, _test } from './refmatch.js';
import { FINISHES, recolor } from './finish.js';

const BASE = '/refmodels/';
let idxP = null;
const glbs = new Map(); // key -> Promise<{parts, skew}>

export function refIndex() {
  idxP ||= fetch(BASE + 'index.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] }));
  return idxP;
}

function finishOf(name, met, rough) {
  const f = String(name || '').split(':')[0];
  if (FINISHES[f]) return f;
  return met > 0.5 ? 'metal' : rough < 0.15 ? 'glass' : 'plastic';
}

/** The model's meshes in the library frame: [{pos, idx, color, finish, met, rough, role}] plus its vertex skew. */
function loadModel(m) {
  if (!glbs.has(m.key)) {
    glbs.set(m.key, (async () => {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(BASE + m.file.replace(/^refmodels\//, ''));
      gltf.scene.updateMatrixWorld(true);
      const parts = [], mean = [0, 0, 0];
      let n = 0;
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        const pos = g.attributes.position.array;
        const idx = g.index ? g.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const met = mat?.metalness ?? 0, rough = mat?.roughness ?? 0.6;
        const [fin, role] = String(mat?.name || '').split(':');
        parts.push({ pos, idx, color: '#' + (mat?.color?.getHexString() || '8a8f98'), finish: finishOf(fin, met, rough), met, rough, role: role || '' });
        for (let i = 0; i < pos.length; i += 3) { mean[0] += pos[i]; mean[1] += pos[i + 1]; mean[2] += pos[i + 2]; n++; }
      });
      if (!parts.length) throw new Error('empty model');
      return { parts, skew: mean.map(v => v / Math.max(1, n)) };
    })());
    glbs.get(m.key).catch(() => glbs.delete(m.key)); // retry on the next load
  }
  return glbs.get(m.key);
}

/** One indexed geometry (position, color, pbr) of the model placed by the 4x4 m (row-major), repeated `repeat` times
 * along the model's X every `pitch` mm. tint: hex for the model's tintable role (Joy-Con body = the design's colour). */
function buildGeometry(mdl, fit, model, tint, colorFn) {
  const rep = Math.max(1, Math.min(400, fit.repeat || 1)), pitch = model.pitch || 0, M = fit.m;
  let nv = 0, ni = 0;
  for (const p of mdl.parts) { nv += p.pos.length / 3; ni += p.idx.length; }
  nv *= rep; ni *= rep;
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), pbr = new Float32Array(nv * 2);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const ranges = [];
  let o = 0, oi = 0;
  for (let r = 0; r < rep; r++) {
    const dx = r * pitch;
    for (const p of mdl.parts) {
      const c = p.pos.length / 3, mr = FINISHES[p.finish] || [p.met, p.rough];
      for (let i = 0; i < c; i++) {
        const x = p.pos[i * 3] + dx, y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2], k = (o + i) * 3;
        pos[k] = M[0] * x + M[1] * y + M[2] * z + M[3];
        pos[k + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
        pos[k + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
        pbr[(o + i) * 2] = mr[0]; pbr[(o + i) * 2 + 1] = mr[1];
      }
      for (let i = 0; i < p.idx.length; i++) index[oi + i] = p.idx[i] + o;
      ranges.push({ start: o, count: c, color: tint && p.role && p.role === model.tint ? tint : p.color, finish: p.finish });
      o += c; oi += p.idx.length;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.userData.ranges = ranges;
  recolor(g, colorFn);
  return g;
}

/** Mean position of each colour: {hex: [x, y, z]} (library part geometry with ranges, or model parts through M). */
function colourMeans(groups) {
  const acc = new Map(), q = (hex) => { const n = parseInt(String(hex).slice(1), 16); return ((n >> 19) & 31) + ',' + ((n >> 11) & 31) + ',' + ((n >> 3) & 31); };
  for (const { color: hex, pts } of groups) {
    const color = q(hex), a = acc.get(color) || [0, 0, 0, 0];
    for (let i = 0; i < pts.length; i += 3) { a[0] += pts[i]; a[1] += pts[i + 1]; a[2] += pts[i + 2]; a[3]++; }
    acc.set(color, a);
  }
  const out = new Map();
  for (const [c, a] of acc) if (a[3]) out.set(c, [a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
  return out;
}

/** A library part's box is symmetric under a half turn about its front axis (USB end?). Keep the turn whose colours
 * (USB shell, chips, LEDs) land where the old library model had them. */
function bestTurn(fit, model, mdl, geo) {
  const f = 'xyz'.indexOf(model.front?.[1] || 'z'), M = fit.m, T = [...M];
  for (let i = 0; i < 3; i++) if (i !== f) for (let r = 0; r < 3; r++) T[r * 4 + i] = -M[r * 4 + i];
  const src = geo.attributes.position.array;
  const want = colourMeans(geo.userData.ranges.map(r => ({ color: r.color, pts: src.subarray(r.start * 3, (r.start + r.count) * 3) })));
  const score = (m) => {
    const got = colourMeans(mdl.parts.map(p => {
      const pts = new Float32Array(p.pos.length);
      for (let i = 0; i < p.pos.length; i += 3) {
        const x = p.pos[i], y = p.pos[i + 1], z = p.pos[i + 2];
        pts[i] = m[0] * x + m[1] * y + m[2] * z + m[3]; pts[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7]; pts[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
      }
      return { color: p.color, pts };
    }));
    let s = 0, n = 0;
    for (const [c, w] of want) { const g = got.get(c); if (g) { s += Math.hypot(w[0] - g[0], w[1] - g[1], w[2] - g[2]); n++; } }
    return n ? s / n : 0;
  };
  return score(T) < score(M) * 0.9 ? { ...fit, m: T } : fit;
}

const flat = (m) => (Array.isArray(m?.[0]) ? m.flat() : m);
const aabb = (geo) => { geo.computeBoundingBox(); const b = geo.boundingBox; return { min: b.min.toArray(), max: b.max.toArray() }; };

/** viewer.js hook: swap reference models into `loaded` ([{p, geo, vc}] | null). Never throws. */
export async function refSwap(loaded, colorFn) {
  try {
    const live = (loaded || []).filter(Boolean);
    if (!live.length) return;
    const models = (await refIndex()).models || [];
    if (!models.length) return;
    const boxes = new Map(live.map(l => [l, aabb(l.geo)]));
    const lo = [0, 1, 2].map(i => Math.min(...live.map(l => boxes.get(l).min[i]))), hi = [0, 1, 2].map(i => Math.max(...live.map(l => boxes.get(l).max[i])));
    const ac = [0, 1, 2].map(i => (lo[i] + hi[i]) / 2);
    await Promise.all(live.map(async l => {
      const p = l.p;
      delete p.ref;
      const exact = Array.isArray(p.ref_model?.m) ? flat(p.ref_model.m) : null;
      const b = boxes.get(l), ext = [0, 1, 2].map(i => b.max[i] - b.min[i]);
      const box = exact ? null : orientedBox(l.geo.attributes.position.array);
      const side = (b.min[0] + b.max[0]) / 2 < ac[0] ? 'L' : 'R';
      const pick = pickModel(p, box ? box.ext : ext, models, side);
      if (!pick) return;
      const mdl = await loadModel(pick.model);
      let fit = exact ? { m: exact, repeat: 1 } : fitMatrix(pick.model, box, { assemblyCenter: ac, modelSkew: mdl.skew });
      if (!exact && pick.why === 'lib' && l.geo.userData?.ranges) fit = bestTurn(fit, pick.model, mdl, l.geo); // e.g. which end the USB is
      const own = p.design_color || p.color || '';
      const tint = pick.model.tint && !p.lib && /^#[0-9a-f]{6}$/i.test(own) && own.toLowerCase() !== '#8a8f98' ? own : null;
      const geo = buildGeometry(mdl, fit, pick.model, tint, colorFn);
      l.geo.dispose();
      l.geo = geo; l.vc = true;
      const M = pick.model;
      p.ref = { key: M.key, title: M.title, label: M.label, kind: M.kind, credit: M.credit, license: M.license, license_url: M.license_url,
        source_url: M.source_url, author: M.author, attribution: M.attribution_text, yours: M.kind === 'product' || !!p.ref_model?.yours, why: pick.why };
    }));
    // a product's separate "screen" part (box designs drew one) disappears inside the swapped product
    const prods = live.filter(l => l.p.ref?.kind === 'product');
    for (const l of live) {
      if (l.p.ref || !_test.SCREENISH.test(l.p.name || '') || l.p.group !== 'component') continue;
      const host = prods.find(s => inside(boxes.get(s), boxes.get(l)));
      if (!host) continue;
      l.geo.dispose();
      l.geo = new THREE.BufferGeometry(); l.geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      l.vc = false;
      l.p.ref = { key: host.p.ref.key, label: host.p.ref.label, credit: host.p.ref.credit, kind: 'product', yours: true, partOf: host.p.name };
    }
    if (live.some(l => l.p.ref)) ensureStyle();
  } catch (e) { console.warn('refmodels: kept the boxes', e); }
}
