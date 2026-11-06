// Sheet-metal and laser-cut piece price, modelled on SendCutSend's published pricing (see CALIBRATION.md).
//
//   qty-1 piece = max(PART_MIN, base + area_cm2 * t_mm * rate[material class] + cut_mm * t_mm^2 * cut
//                                 + (bends ? bend_setup + bends * bend_each : 0))
//   piece at qty q = qty-1 piece * D(q)       D = SendCutSend's quantity discount curve, log-interpolated
//   per order: SendCutSend's $39 order minimum (applied across all of a design's sheet / laser parts by server/prices)
//
// Coefficients live in fab_calibration.json, written by `node server/prices/refit_fab.js` from published example
// prices (published_fab_examples.json) plus the owner's own real quotes (sendcutsend_quotes.json).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CAL_FILE = path.join(__dirname, 'fab_calibration.json');
const CLASSES = ['aluminium', 'steel', 'stainless', 'acrylic', 'wood', 'copper'];

/** Material text -> class. */
function classOf(material) {
  const m = String(material || '').toLowerCase();
  if (/stainless|304|316/.test(m)) return 'stainless';
  if (/alumin|5052|6061|7075/.test(m)) return 'aluminium';
  if (/steel|a1008|a36|galvan|g90|cold rolled|crs/.test(m)) return 'steel';
  if (/acrylic|pmma|perspex|plexi|polycarb|delrin|acetal|hdpe|abs/.test(m)) return 'acrylic';
  if (/ply|wood|mdf|hardboard|birch|cardboard/.test(m)) return 'wood';
  if (/copper|brass|bronze/.test(m)) return 'copper';
  return 'aluminium';
}

/** A part (or quote record) -> model features. Cut length defaults to the blank's perimeter * 1.3 (holes, notches). */
function features(r) {
  const size = (r.size_mm || []).map(Number).filter((x) => x > 0);
  const area = Number(r.area_cm2) > 0 ? Number(r.area_cm2) : size.length >= 2 ? (size[0] * size[1]) / 100 : 0;
  const t = Number(r.thickness_mm) > 0 ? Number(r.thickness_mm) : 1.5;
  const cut = Number(r.cut_length_mm) > 0 ? Number(r.cut_length_mm)
    : size.length >= 2 ? 2 * (size[0] + size[1]) * (r.simple ? 1.0 : 1.3) : 4 * Math.sqrt(area * 100) * 1.3;
  const bends = Math.max(0, Math.round(Number(r.bends) || 0));
  return { cls: classOf(r.material), area, t, cut, bends };
}

const DEFAULT = {
  part_min_usd: 1.5,
  order_min_usd: 39,
  coeffs: { base: 1.2, rate: { aluminium: 0.012, steel: 0.006, stainless: 0.015, acrylic: 0.006, wood: 0.003, copper: 0.03 }, cut: 0.0004, bend_setup: 15, bend_each: 3 },
  discount: { 1: 1, 10: 0.51, 100: 0.35, 1000: 0.255 },
  lead_days: { cut: 8, bent: 10 },
};
let cal = null;
function calibration() {
  if (!cal) { try { cal = { ...DEFAULT, ...JSON.parse(fs.readFileSync(CAL_FILE, 'utf8')) }; } catch { cal = { ...DEFAULT }; } }
  return cal;
}
function _set(c) { cal = c ? { ...DEFAULT, ...c } : null; }

function piece1(f, c = calibration().coeffs) {
  const rate = c.rate[f.cls] ?? c.rate.aluminium;
  const parts = {
    base: c.base,
    material: f.area * f.t * rate,
    cut: f.cut * f.t * f.t * c.cut, // laser time grows faster than thickness
    bend: f.bends ? c.bend_setup + f.bends * c.bend_each : 0,
  };
  return { usd: Math.max(calibration().part_min_usd, parts.base + parts.material + parts.cut + parts.bend), parts };
}

/** Quantity discount multiplier, log-linear between the calibrated points. */
function discount(q, d = calibration().discount) {
  const pts = Object.entries(d).map(([k, v]) => [Number(k), Number(v)]).sort((a, b) => a[0] - b[0]);
  if (q <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (q <= pts[i][0]) {
      const [q0, v0] = pts[i - 1], [q1, v1] = pts[i];
      const t = (Math.log(q) - Math.log(q0)) / (Math.log(q1) - Math.log(q0));
      return v0 + t * (v1 - v0);
    }
  }
  return pts[pts.length - 1][1];
}

/** Fit coefficients to records [{material, thickness_mm, size_mm | area_cm2, cut_length_mm?, bends, qty, price_usd, weight?}].
 * Weighted relative least squares with a pull toward the defaults (so a handful of quotes can't produce nonsense),
 * all coefficients kept >= 0. The discount curve is refit from parts quoted at several quantities. */
function fit(records, { iters = 20000, lambda = 0.02 } = {}) {
  const q1 = records.filter((r) => Number(r.qty) === 1 && Number(r.price_usd) > 0);
  const prior = DEFAULT.coeffs;
  const flat = (c) => [c.base, ...CLASSES.map((k) => c.rate[k]), c.cut, c.bend_setup, c.bend_each];
  const unflat = (v) => ({ base: v[0], rate: Object.fromEntries(CLASSES.map((k, i) => [k, v[1 + i]])), cut: v[7], bend_setup: v[8], bend_each: v[9] });
  const p0 = flat(prior);
  let v = [...p0];
  const feats = q1.map((r) => ({ f: features(r), y: Number(r.price_usd), w: Number(r.weight) || 1 }));
  const row = (f) => { const x = new Array(10).fill(0); x[0] = 1; x[1 + CLASSES.indexOf(f.cls)] = f.area * f.t; x[7] = f.cut * f.t * f.t; if (f.bends) { x[8] = 1; x[9] = f.bends; } return x; };
  const X = feats.map((o) => row(o.f));
  // In units of the defaults (u = v / p0) so every coefficient has the same scale. Minimise
  //   sum w * ((x.v - y) / y)^2 + lambda * sum (u - 1)^2,  u >= 0,  by projected gradient descent with step backoff.
  const Z = X.map((x) => x.map((xj, j) => xj * p0[j]));
  const loss = (u) => feats.reduce((s, o, i) => s + o.w * ((Z[i].reduce((a, z, j) => a + z * u[j], 0) - o.y) / o.y) ** 2, 0)
    + lambda * u.reduce((s, x) => s + (x - 1) ** 2, 0);
  let u = new Array(10).fill(1), L = loss(u), lr = 0.01;
  for (let it = 0; it < iters && feats.length; it++) {
    const g = u.map((x) => 2 * lambda * (x - 1));
    feats.forEach((o, i) => { const e = (Z[i].reduce((a, z, j) => a + z * u[j], 0) - o.y) / o.y; for (let j = 0; j < 10; j++) g[j] += 2 * o.w * e * Z[i][j] / o.y; });
    const nu = u.map((x, j) => Math.max(0, x - lr * g[j]));
    const nL = loss(nu);
    if (nL <= L) { u = nu; L = nL; lr *= 1.1; } else lr *= 0.5;
  }
  v = u.map((x, j) => x * p0[j]);
  const coeffs = unflat(v.map((x) => +x.toPrecision(4)));
  // discount: median price(q)/price(1) per quantity across parts quoted at both
  const byPart = new Map();
  for (const r of records) { const k = r.part || `${r.material}|${r.thickness_mm}|${(r.size_mm || []).join('x')}|${r.bends || 0}|${r.desc || ''}`; if (!byPart.has(k)) byPart.set(k, {}); byPart.get(k)[Number(r.qty)] = Number(r.price_usd); }
  const ratios = {};
  for (const m of byPart.values()) if (m[1] > 0) for (const [q, p] of Object.entries(m)) if (Number(q) > 1 && p > 0) (ratios[q] ||= []).push(p / m[1]);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const discountOut = { 1: 1 };
  for (const [q, a] of Object.entries(ratios)) discountOut[q] = +med(a).toFixed(3);
  for (const [q, d] of Object.entries(DEFAULT.discount)) if (!(q in discountOut)) discountOut[q] = d;
  const resid = feats.map((o, i) => ({ y: o.y, pred: +Math.max(DEFAULT.part_min_usd, X[i].reduce((a, x, j) => a + x * v[j], 0)).toFixed(2) }));
  return { coeffs, discount: discountOut, residuals: resid };
}

module.exports = { classOf, features, piece1, discount, fit, calibration, _set, DEFAULT, CAL_FILE, CLASSES };
