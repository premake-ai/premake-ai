'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fab = require('./pricing_fab');
const C = fab.constants;

const BULK = { 1: 1.0, 10: 0.9, 100: 0.75, 500: 0.6 };
const TIERS = [1, 10, 100, 500];
const tierOf = (q) => [...TIERS].reverse().find((t) => q >= t) || 1;
const MARGIN = 0.35;
const near = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// minimal stand-in for server.js priceFor/quote (same shape)
function basePriceFor(bom, q) {
  const parts = (bom.parts || []).reduce((s, p) => s + p.qty_per_unit * p.unit_cost_usd, 0);
  const unit = { parts: parts * BULK[tierOf(q)], packaging: 2 };
  const cost = unit.parts + unit.packaging;
  unit.margin = Math.round(cost * MARGIN * 100) / 100;
  unit.handling = q === 1 ? 15 : 0;
  const unit_price = Math.round((cost + unit.margin + unit.handling) * 100) / 100;
  return { qty: q, unit, unit_price, subtotal: unit_price * q, shipping: 9, total: unit_price * q + 9, lead_time_days: 3 };
}
let priceFor = basePriceFor;
function baseQuote(bom, mode) {
  return { mode, bom: (bom.parts || []).map((p) => ({ name: p.name })), tiers: TIERS.map((q) => priceFor(bom, q, mode)), notes: ['Estimate only.'] };
}

const ext = { name: 'Rail', process: 'extrusion', params: { profile: '2020', length_mm: 1000, tapped_ends: 2 }, est: { minutes: 5 } };
const sheet = { name: 'Bracket', process: 'sheet', params: { material: 'aluminium 5052', thickness_mm: 1.5, bends: 2 }, est: { area_cm2: 100, bends: 2, minutes: 10 } };
const laser = { name: 'Top', process: 'laser', params: { material: 'acrylic', thickness_mm: 3 }, est: { cut_length_mm: 900, area_cm2: 400, minutes: 2 } };

test('extrusion: $/m by profile + cut + taps; labour only for unbilled minutes', () => {
  const l = fab.priceLine(ext);
  near(l.material_usd, 6 * 1 * C.EXTRUSION_WASTE);
  near(l.machine_usd, C.EXTRUSION_CUT_USD + 2 * C.EXTRUSION_TAP_USD);
  near(l.labour_min, 5 - (1 + 2 * 1.5));
  const l40 = fab.priceLine({ ...ext, params: { profile: '2040', length_mm: 1000, tapped_ends: 0 } });
  near(l40.material_usd, 10 * C.EXTRUSION_WASTE);
  near(l40.machine_usd, C.EXTRUSION_CUT_USD);
});

test('extrusion: missing tapped_ends defaults to 2 like cadlib', () => {
  const l = fab.priceLine({ ...ext, params: { profile: '2020', length_mm: 500 } });
  near(l.machine_usd, C.EXTRUSION_CUT_USD + 2 * C.EXTRUSION_TAP_USD);
});

test('sheet: calibrated SendCutSend model: bends add setup + per bend, thicker and aluminium cost more, no batch setup', () => {
  const M = require('./prices/fab_model');
  const c = M.calibration().coeffs;
  const a = fab.priceLine(sheet);
  const flat = fab.priceLine({ ...sheet, params: { ...sheet.params, bends: 0 }, est: { ...sheet.est, bends: 0 } });
  near(a.piece_usd - flat.piece_usd, c.bend_setup + 2 * c.bend_each, 0.02);
  const thick = fab.priceLine({ ...sheet, params: { ...sheet.params, thickness_mm: 3 } });
  assert.ok(thick.piece_usd > a.piece_usd);
  const steel = fab.priceLine({ ...sheet, params: { ...sheet.params, material: 'mild steel' } });
  assert.ok(steel.piece_usd <= a.piece_usd);
  assert.equal(a.setup_usd_per_batch, 0);
  assert.equal(a.supplier, 'SendCutSend');
});

test('laser: same model; acrylic cheaper than aluminium; never below the part minimum', () => {
  const M = require('./prices/fab_model');
  const l = fab.priceLine(laser);
  const al = fab.priceLine({ ...laser, params: { material: 'aluminium 5052', thickness_mm: 3 } });
  assert.ok(l.piece_usd < al.piece_usd);
  const tiny = fab.priceLine({ ...laser, est: { area_cm2: 1, cut_length_mm: 10 } });
  assert.ok(tiny.piece_usd >= M.calibration().part_min_usd);
  assert.equal(l.setup_usd_per_batch, 0);
});

test('fab model refit recovers coefficients from synthetic quotes', () => {
  const M = require('./prices/fab_model');
  const truth = { base: 2, rate: { aluminium: 0.02, steel: 0.01, stainless: 0.015, acrylic: 0.005, wood: 0.003, copper: 0.03 }, cut: 0.0004, bend_setup: 15, bend_each: 3 };
  const recs = [];
  for (const material of ['5052 aluminium', 'mild steel', 'acrylic']) for (const t of [1.5, 3, 4.75]) for (const w of [40, 120]) for (const bends of [0, 2]) {
    const f = M.features({ material, thickness_mm: t, size_mm: [w, 60], bends });
    const rate = truth.rate[f.cls];
    recs.push({ material, thickness_mm: t, size_mm: [w, 60], bends, qty: 1, price_usd: truth.base + f.area * f.t * rate + f.cut * f.t * f.t * truth.cut + (bends ? truth.bend_setup + bends * truth.bend_each : 0) });
  }
  const r = M.fit(recs, { lambda: 1e-6 });
  for (const x of r.residuals) assert.ok(Math.abs(x.pred - x.y) / x.y < 0.05, `${x.pred} vs ${x.y}`);
});

test('missing est/params fall back to bbox without throwing', () => {
  for (const process of ['extrusion', 'sheet', 'laser']) {
    const l = fab.priceLine({ name: 'x', process, bbox: [200, 100, 3] });
    assert.ok(l.piece_usd > 0, process);
  }
  assert.equal(fab.priceLine({ name: 'x', process: 'print' }), null);
  assert.deepEqual(fab.lines({}), []);
});

test('qty curves: sheet follows the SendCutSend discount, extrusion the bulk curve', () => {
  const M = require('./prices/fab_model');
  const ls = fab.lines({ fabricated: [sheet] });
  const piece = ls[0].piece_usd;
  near(fab.unitCost(ls, 1, 1), piece);
  near(fab.unitCost(ls, 100, 0.75), piece * M.discount(100));
  assert.ok(fab.unitCost(ls, 500, 0.6) < fab.unitCost(ls, 10, 0.9));
  const le = fab.lines({ fabricated: [ext] });
  near(fab.unitCost(le, 100, 0.75), le[0].piece_usd * 0.75);
});

test('double-count guard: stop-gap parts dropped only when fabricated pricing applies', () => {
  const parts = [{ name: 'stock', qty_per_unit: 1, unit_cost_usd: 20, fabricated: true }, { name: 'screw', qty_per_unit: 4, unit_cost_usd: 0.1 }];
  assert.equal(fab.withoutStopgap({ parts }).parts.length, 2);
  assert.equal(fab.withoutStopgap({ parts, fabricated: [] }).parts.length, 2);
  assert.deepEqual(fab.withoutStopgap({ parts, fabricated: [laser] }).parts.map((p) => p.name), ['screw']);
});

test('wrapped priceFor/quote: fabrication in unit, margin applied, stop-gap excluded, section present', () => {
  priceFor = fab.wrapPriceFor(basePriceFor, { BULK, MARGIN, tierOf });
  const quote = fab.wrapQuote(baseQuote);
  const bom = { parts: [{ name: 'stock', qty_per_unit: 1, unit_cost_usd: 20, fabricated: true }, { name: 'screw', qty_per_unit: 10, unit_cost_usd: 0.1 }],
    fabricated: [ext, sheet, laser] };
  const q = quote(bom, 'assembled');
  assert.deepEqual(q.bom.map((p) => p.name), ['screw']);
  assert.equal(q.fabricated.parts, 3);
  assert.equal(q.fabricated.excluded_stopgap[0].name, 'stock');
  assert.equal(q.fabricated.lines.length, 3);
  const t1 = q.tiers[0];
  near(t1.unit.parts, 1); // 10 x 0.1, the $20 stop-gap is gone
  const fab1 = fab.unitCost(fab.lines(bom), 1, 1);
  near(t1.unit.fabrication, fab1);
  const cost = 1 + 2 + fab1;
  near(t1.unit.margin, cost * MARGIN);
  near(t1.unit_price, cost * (1 + MARGIN) + 15, 0.02);
  near(t1.total, t1.subtotal + t1.shipping);
  assert.equal(t1.lead_time_days, 3 + C.FAB_LEAD_DAYS);
  assert.ok(q.notes.some((n) => /Fabricated parts priced/.test(n)));
  assert.equal(q.notes[q.notes.length - 1], 'Estimate only.');
  // unit price falls with qty
  for (let i = 1; i < q.tiers.length; i++) assert.ok(q.tiers[i].unit_price < q.tiers[i - 1].unit_price);
  priceFor = basePriceFor;
});

test('wrapped quote without fabricated parts is unchanged (stop-gap kept)', () => {
  priceFor = fab.wrapPriceFor(basePriceFor, { BULK, MARGIN, tierOf });
  const quote = fab.wrapQuote(baseQuote);
  const bom = { parts: [{ name: 'stock', qty_per_unit: 1, unit_cost_usd: 20, fabricated: true }] };
  const plain = (() => { const p = priceFor; priceFor = basePriceFor; const r = baseQuote(bom, 'kit'); priceFor = p; return r; })();
  assert.deepEqual(quote(bom, 'kit'), plain);
  priceFor = basePriceFor;
});
