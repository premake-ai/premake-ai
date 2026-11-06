// Reference models (cadlib/refmodels, served from web/refmodels/): which library model stands in for a bought part,
// and the transform that fits it to the part's box. Pure math, no three.js (refmodels.js does the loading; tests run
// this file under node). All coordinates are CAD mm, Z up; the front of a design faces -Y.
//
// A part gets a reference model when
//   - its manifest entry has ref_model {key, m} (cadlib.refmodels.ref(): exact 4x4 placement), or
//   - it is a library part (lib.key) listed in a model's lib_keys (a better-looking model of the same part), or
//   - it is a bought part whose name matches a model's `match` regexes and whose size is within 30% of the model's
//     two biggest dimensions (the heuristic that upgrades existing designs without a rebuild).
// A product "screen" / "display" part sitting inside a swapped product is hidden (the model has its own screen).

const SCREENISH = /\b(screen|display|glass|bezel|lcd panel)\b/i;
const NOT_SWITCH = /tact|rocker|limit|micro ?switch|toggle|slide|reed|\bdip\b|light switch|wall switch|switch (plate|cover|box)|power switch|key ?switch|reed/i;
const TOL = 1.3; // size ratio allowed on the two biggest dimensions

const rx = (s) => { try { return new RegExp(s, 'i'); } catch { return null; } };
const any = (list, s) => (list || []).some(r => { const x = rx(r); return x && x.test(s); });

/** Sorted (desc) extents with their axis indices. */
function order(e) { return [0, 1, 2].sort((a, b) => e[b] - e[a]); }

/** How well model m fits a target with extents e (any orientation). Lower is better; Infinity = no fit. */
export function sizeError(m, e, tol = TOL) {
  const TOL_ = tol;
  if (m.fit === 'tile' || m.fit === 'stretch') { // the long axis is free: compare the cross-section
    const t = order(e), s = [m.size[1], m.size[2]].sort((a, b) => b - a), te = [e[t[1]], e[t[2]]];
    let err = 0;
    for (let i = 0; i < 2; i++) { const r = te[i] / s[i]; if (!(r > 1 / TOL_ && r < TOL_)) return Infinity; err += Math.abs(Math.log(r)); }
    return err;
  }
  const t = order(e).map(i => e[i]), s = [...m.size].sort((a, b) => b - a);
  let err = 0;
  for (let i = 0; i < 2; i++) { const r = t[i] / s[i]; if (!(r > 1 / TOL_ && r < TOL_)) return Infinity; err += Math.abs(Math.log(r)); }
  return err + 0.25 * Math.abs(Math.log(Math.max(t[2], 0.1) / s[2])); // thickness counts a little (boxes skip sticks, bumps)
}

/** Pick the model for one part. part: manifest entry; ext: its extents [x, y, z]; models: index.models.
 * Returns {model, why} or null. side: 'L' | 'R' hint for paired products (Joy-Con) from the part's position. */
export function pickModel(part, ext, models, side = null) {
  if (!models?.length || !part) return null;
  const byKey = new Map(models.map(m => [m.key, m]));
  const rm = part.ref_model;
  if (rm?.key && byKey.has(rm.key)) return { model: byKey.get(rm.key), why: 'ref' };
  const lib = part.lib?.key;
  if (lib) {
    const m = models.find(x => (x.lib_keys || []).includes(lib));
    return m && sizeError(m, ext) < Infinity ? { model: m, why: 'lib' } : null; // other library parts keep their own model
  }
  const bought = (part.process || (part.group === 'component' ? 'bought' : 'print')) === 'bought';
  if (!bought || part.subparts?.length) return null;
  const name = String(part.name || '');
  if (SCREENISH.test(name) && models.some(m => m.kind === 'product' && any(m.match, name))) return null; // absorbed, see hideInside
  let best = null;
  for (const m of models) {
    if (!any(m.match, name)) continue;
    if (/switch/i.test(m.key) && NOT_SWITCH.test(name)) continue;
    const named = any(m.prefer, name); // a specific name ("NEMA 17") allows more size slack (boxes skip shafts, plugs)
    let err = sizeError(m, ext, named ? 1.6 : TOL);
    if (err === Infinity) continue;
    if (named) err -= 0.5;
    if (side && /_(l|r)$/.test(m.key) && !any(m.prefer, name)) err += m.key.endsWith('_' + side.toLowerCase()) ? -0.3 : 0.3;
    if (!best || err < best.err) best = { model: m, err };
  }
  return best ? { model: best.model, why: 'name' } : null;
}

// ---------------------------------------------------------------- small linear algebra (3x3 as arrays of rows)

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return scale(a, 1 / l); };

/** Eigenvectors of a symmetric 3x3 (Jacobi). Returns 3 unit vectors. */
function eig3(A) {
  const a = A.map(r => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1, mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { p = 0; q = 2; mx = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > mx) { p = 1; q = 2; mx = Math.abs(a[1][2]); }
    if (mx < 1e-10) break;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  return [0, 1, 2].map(j => norm([v[0][j], v[1][j], v[2][j]]));
}

/** Oriented box of a point cloud (Float32Array xyz...): the axis-aligned box unless a PCA box is clearly tighter
 * (a tilted part). Returns {axes: [3 unit vectors], ext: [3], center: [3], skew: [3]} (skew = mean - centre, per axis). */
export function orientedBox(pos) {
  const n = Math.floor(pos.length / 3), step = Math.max(1, Math.floor(n / 20000));
  const fit = (axes) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], mean = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < n; i += step) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      for (let j = 0; j < 3; j++) { const d = dot(p, axes[j]); if (d < lo[j]) lo[j] = d; if (d > hi[j]) hi[j] = d; mean[j] += d; }
      k++;
    }
    const ext = [0, 1, 2].map(j => hi[j] - lo[j]), mid = [0, 1, 2].map(j => (hi[j] + lo[j]) / 2);
    const center = axes.reduce((c, ax, j) => add(c, scale(ax, mid[j])), [0, 0, 0]);
    return { axes, ext, center, skew: [0, 1, 2].map(j => mean[j] / Math.max(1, k) - mid[j]), vol: ext[0] * ext[1] * ext[2] };
  };
  const aabb = fit([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  if (n < 8) return aabb;
  const c = [0, 0, 0]; let k = 0;
  for (let i = 0; i < n; i += step) { c[0] += pos[i * 3]; c[1] += pos[i * 3 + 1]; c[2] += pos[i * 3 + 2]; k++; }
  const m = scale(c, 1 / k), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i += step) {
    const d = [pos[i * 3] - m[0], pos[i * 3 + 1] - m[1], pos[i * 3 + 2] - m[2]];
    for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[r][s] += d[r] * d[s];
  }
  const axes = eig3(C);
  const pca = fit([axes[0], axes[1], norm(cross(axes[0], axes[1]))]);
  return pca.vol < aabb.vol * 0.9 ? pca : aabb;
}

/** 4x4 (row-major, array of 16) that places model m (library frame, bbox-centred) into target box `box`
 * (from orientedBox). ctx: {assemblyCenter: [3], modelSkew: [3] (vertex mean - centre in the model frame)}.
 * Returns {m: [16], repeat: n, stretch: k} for tile / stretch fits (along the model's X). */
export function fitMatrix(model, box, ctx = {}) {
  const ms = model.size, mo = order(ms), to = order(box.ext);
  const fit = model.fit || 'fixed';
  // model axis index -> target axis index (biggest to biggest); tile / stretch: model X -> the target's long axis
  const map = [0, 0, 0];
  if (fit === 'tile' || fit === 'stretch') {
    map[0] = to[0];
    const rest = [1, 2].sort((a, b) => ms[b] - ms[a]);
    map[rest[0]] = to[1]; map[rest[1]] = to[2];
  } else for (let i = 0; i < 3; i++) map[mo[i]] = to[i];
  const sgn = [1, 1, 1];
  const fAxis = 'xyz'.indexOf(model.front?.[1] || 'z'), fSign = model.front?.[0] === '-' ? -1 : 1;
  const world = (i) => scale(box.axes[map[i]], sgn[i]); // model axis i -> world direction
  const Z = [0, 0, 1], Y = [0, 1, 0];
  // 1. the front: up when the front axis is vertical (boards, a phone lying down), else towards the viewer (-Y),
  //    else away from the rest of the design
  const fw = () => scale(world(fAxis), fSign);
  const fdir = box.axes[map[fAxis]];
  if (Math.abs(fdir[2]) > 0.7) { if (fw()[2] < 0) sgn[fAxis] = -1; }
  else if (Math.abs(fdir[1]) > 0.3) { if (fw()[1] > 0) sgn[fAxis] = -1; }
  else { const away = box.center.map((c, i) => c - (ctx.assemblyCenter?.[i] ?? 0)); if (dot(fw(), away) < 0) sgn[fAxis] = -1; }
  // 2. a second axis: standing products keep their top up (or away from the viewer when lying down);
  //    flat parts match the target's mass distribution (the USB end of a board), else keep +X
  const others = [0, 1, 2].filter(i => i !== fAxis);
  const second = fAxis === 1 ? 2 : (fit === 'tile' || fit === 'stretch') ? 0 : others.sort((a, b) => ms[b] - ms[a])[0];
  if (fAxis === 1) { // standing product: model +Z is its top
    const up = world(2);
    if (Math.abs(up[2]) > 0.5) { if (up[2] < 0) sgn[2] = -1; } else if (up[1] < 0) sgn[2] = -1;
  } else if (ctx.modelSkew && box.skew) {
    const ms2 = ctx.modelSkew[second] / Math.max(ms[second], 1e-6), ts = box.skew[map[second]] / Math.max(box.ext[map[second]], 1e-6);
    if (Math.abs(ms2) > 0.01 && Math.abs(ts) > 0.01 && Math.sign(ms2) !== Math.sign(ts)) sgn[second] = -1;
  } else { const d = world(second); if (d[0] + d[1] * 0.01 < -1e-6) sgn[second] = -1; }
  // 3. the last axis keeps the frame right-handed (never mirror a product)
  const third = [0, 1, 2].find(i => i !== fAxis && i !== second);
  const R = [world(0), world(1), world(2)]; // columns: where model X, Y, Z go
  const det = dot(R[0], cross(R[1], R[2]));
  if (det < 0) { sgn[third] *= -1; R[third] = scale(R[third], -1); }
  // scale / repeat along the long axis
  let repeat = 1, stretch = 1;
  const tlong = box.ext[map[0]];
  if (fit === 'tile' && model.pitch) repeat = Math.max(1, Math.round(tlong / model.pitch));
  if (fit === 'stretch') stretch = tlong / ms[0];
  // position: centred, except along the front axis where the model's back sits on the target's back face
  const tf = box.ext[map[fAxis]], mf = ms[fAxis];
  let c = add(box.center, scale(fw(), (mf - tf) / 2));
  const lenX = fit === 'tile' ? repeat * model.pitch : fit === 'stretch' ? tlong : ms[0];
  if (fit === 'tile') c = add(c, scale(R[0], -lenX / 2 + model.pitch / 2)); // first unit at the start of the strip
  const sx = fit === 'stretch' ? stretch : 1;
  const m = [
    R[0][0] * sx, R[1][0], R[2][0], c[0],
    R[0][1] * sx, R[1][1], R[2][1], c[1],
    R[0][2] * sx, R[1][2], R[2][2], c[2],
    0, 0, 0, 1,
  ];
  return { m, repeat, stretch, axes: R };
}

/** Is point-set box b inside box a (axis-aligned boxes {min, max} in CAD mm), with a margin? */
export function inside(a, b, margin = 3) {
  for (let i = 0; i < 3; i++) if (b.min[i] < a.min[i] - margin || b.max[i] > a.max[i] + margin) return false;
  return true;
}

/** Styles for the credit lines (tooltip + parts list), added once. */
export function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById('refm-style')) return;
  const st = document.createElement('style'); st.id = 'refm-style';
  st.textContent = '.titem .nm .refc { display: block; font-size: 10.5px; line-height: 1.25; color: var(--muted, #8b8f98); overflow: hidden; text-overflow: ellipsis; }'
    + '.hv-tip .hv-credit { display: block; margin-top: 3px; font-size: 11px; color: #a8a29e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }';
  document.head.appendChild(st);
}

/** Parts list: a small muted credit under the part name, e.g. "Model: Gafeju (FreeCAD-library), CC BY 3.0". */
export function refCreditHtml(p, esc) {
  if (!p?.ref?.credit) return '';
  ensureStyle();
  const t = p.ref.partOf ? `Shown as part of ${p.ref.partOf}` : p.ref.credit;
  return `<small class="refc" title="${esc(p.ref.attribution || p.ref.label || '')}">${esc(t)}</small>`;
}

export const _test = { eig3, order, SCREENISH, NOT_SWITCH };
