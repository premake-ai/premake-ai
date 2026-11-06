// Pricing for NON-printed fabricated parts: aluminium extrusion, sheet metal, laser-cut sheet.
// Input is bom.json["fabricated"] as written by cadlib/build.py (see CONTRACT.md):
//   {name, process: "extrusion"|"sheet"|"laser", params, bbox, est: {minutes, material_usd, length_mm | area_cm2, bends | cut_length_mm}}
//
// Hooked into server.js (search "fab-pricing:") by wrapping priceFor() and quote():
//   - unit.fabrication is added to every tier's cost before margin, so the margin applies to it like any other cost.
//   - quote() gains a "fabricated" section with per-part line items.
//
// DOUBLE-COUNT GUARD: before fabricated pricing existed, the design agent listed fabricated stock as bom.json
// "parts" lines with "fabricated": true (a stop-gap). When bom.json["fabricated"] is non-empty those lines are
// EXCLUDED from the bought-parts sum and from the quote's "bom" list (listed under fabricated.excluded_stopgap
// instead). Without a "fabricated" key (design never rebuilt) the stop-gap lines are kept as the only price we have.
//
// Extrusion brackets / T-nuts / screws stay ordinary bought "parts" lines (not "fabricated": true), so they are
// priced once, in the parts sum.
//
// Extrusion constants are in-house shop ASSUMPTIONS (USD, NYC, 2026); server/prices prefers catalog list prices for
// extrusion. Sheet and laser parts are priced like SendCutSend (calibrated; see server/prices/CALIBRATION.md).
'use strict';
const fabModel = require('./prices/fab_model');

// ---------------------------------------------------------------- assumptions (tune these)
const SHOP_RATE_PER_H = 60;            // labour $/h for handling, deburring, QA, packing the part
const SHOP_PER_MIN = SHOP_RATE_PER_H / 60;
const STOCK_WASTE = 1.25;              // sheet nesting / offcut waste on material
const EXTRUSION_WASTE = 1.10;          // kerf + unusable offcut on stock lengths

// extrusion stock $/m (6063-T5 T-slot / V-slot, retail cut-from-stock)
const EXTRUSION_USD_PER_M = { '2020': 6, '2040': 10, '3030': 11, '4040': 16, '2060': 14, '2080': 18 };
const EXTRUSION_USD_PER_M_DEFAULT = 10;
const EXTRUSION_CUT_USD = 0.75;        // per cut (each piece needs one cut from stock), incl. saw time + deburr
const EXTRUSION_CUT_MIN = 1.0;         // shop minutes covered by the cut fee
const EXTRUSION_TAP_USD = 1.00;        // per tapped end (M5 into 2020 centre bore)
const EXTRUSION_TAP_MIN = 1.5;         // shop minutes covered by the tap fee
const EXTRUSION_TAPPED_ENDS_DEFAULT = 2; // matches cadlib/build.py when params.tapped_ends is missing

// sheet metal + laser cutting: priced like SendCutSend (server/prices/fab_model.js + fab_calibration.json, CALIBRATION.md)
const SHEET_PERIMETER_FACTOR = 1.3;    // cut length ~ 4*sqrt(flat area) * this (holes, notches) when the build gives none

const FAB_LEAD_DAYS = 2;               // added to lead time when a design has fabricated parts

// ---------------------------------------------------------------- helpers
const cents = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const isFab = (f) => f && ['extrusion', 'sheet', 'laser'].includes(f.process);

/** Price ONE fabricated part (one piece). Returns per-piece costs before bulk discount, plus batch setup. */
function priceLine(f) {
  const p = f.params || {};
  const est = f.est || {};
  const bb = (f.bbox || []).map(Number).filter(Number.isFinite);
  const sorted = [...bb].sort((a, b) => a - b);
  let material = 0, machine = 0, billedMin = 0, setup = 0, detail = '';

  if (f.process === 'extrusion') {
    const prof = String(p.profile || '2020');
    const key = prof.replace(/[^0-9]/g, '').slice(0, 4);
    const len = num(p.length_mm, num(est.length_mm, sorted[2] || 0));
    const taps = Number.isFinite(Number(p.tapped_ends)) ? Math.max(0, Math.min(2, Number(p.tapped_ends))) : EXTRUSION_TAPPED_ENDS_DEFAULT;
    material = (EXTRUSION_USD_PER_M[key] ?? EXTRUSION_USD_PER_M_DEFAULT) * (len / 1000) * EXTRUSION_WASTE;
    machine = EXTRUSION_CUT_USD + taps * EXTRUSION_TAP_USD;
    billedMin = EXTRUSION_CUT_MIN + taps * EXTRUSION_TAP_MIN;
    detail = `${prof} x ${Math.round(len)} mm, 1 cut${taps ? `, ${taps} tapped end${taps > 1 ? 's' : ''}` : ''}`;
  } else if (f.process === 'sheet' || f.process === 'laser') {
    // Calibrated to SendCutSend's published prices (server/prices/fab_model.js, CALIBRATION.md): the price of
    // having the part cut (and bent) by SendCutSend at qty 1. Quantity discount: pieceAt().
    const t = num(p.thickness_mm, sorted[0] || (f.process === 'laser' ? 3 : 1.5));
    const mat = String(p.material || (f.process === 'laser' ? 'acrylic' : 'aluminium 5052'));
    const area = num(est.area_cm2, ((sorted[1] || 0) * (sorted[2] || 0)) / 100);
    const bends = f.process === 'sheet' ? Math.max(0, Math.round(Number(est.bends ?? p.bends) || 0)) : 0;
    const cut = num(est.cut_length_mm, f.process === 'laser' ? 2 * ((sorted[1] || 0) + (sorted[2] || 0)) : 4 * Math.sqrt(area * 100) * SHEET_PERIMETER_FACTOR);
    const r = fabModel.piece1(fabModel.features({ material: mat, thickness_mm: t, area_cm2: area, cut_length_mm: cut, bends }));
    return {
      name: String(f.name || 'Part'), process: f.process, supplier: 'SendCutSend',
      detail: `${t} mm ${mat}, ${Math.round(area)} cm2, ${Math.round(cut)} mm cut${bends ? `, ${bends} bend${bends > 1 ? 's' : ''}` : ''}`,
      material_usd: cents(r.parts.material), machine_usd: cents(r.usd - r.parts.material), labour_usd: 0, labour_min: 0,
      setup_usd_per_batch: 0, bends, piece_usd: cents(r.usd),
    };
  } else {
    return null;
  }
  // Labour: cadlib's est.minutes is TOTAL shop time for the part. Minutes already billed as machine/process fees
  // (cut, tap, bend, laser time) are subtracted so the same minute is never charged twice.
  const labourMin = Math.max(0, num(est.minutes, billedMin) - billedMin);
  const labour = labourMin * SHOP_PER_MIN;
  return {
    name: String(f.name || 'Part'), process: f.process, detail,
    material_usd: cents(material), machine_usd: cents(machine), labour_usd: cents(labour), labour_min: cents(labourMin),
    setup_usd_per_batch: cents(setup),
    piece_usd: cents(material + machine + labour), // before bulk discount and setup
  };
}

/** Per-piece price at order quantity q: sheet / laser follow SendCutSend's quantity discount; extrusion the bulk curve. */
function pieceAt(l, q, bulk = 1) {
  if (l.process === 'sheet' || l.process === 'laser') return cents(l.piece_usd * fabModel.discount(q));
  return cents(l.piece_usd * bulk + l.setup_usd_per_batch / Math.max(1, q));
}
/** Calendar days until a fabricated part is at the customer / our door (SendCutSend: 2-4 days cutting, +1-2 bending, 2-4 ground). */
function leadDays(process, bends = 0) {
  const c = fabModel.calibration().lead_days || {};
  if (process === 'sheet' || process === 'laser') return bends > 0 ? c.bent || 10 : c.cut || 8;
  return FAB_LEAD_DAYS;
}

/** All fabricated line items for a bom. */
function lines(bom) {
  return ((bom && bom.fabricated) || []).filter(isFab).map(priceLine).filter(Boolean);
}

/** Per-unit fabrication cost at quantity q (extrusion: the server's bulk curve + setup / q; sheet / laser: pieceAt). */
function unitCost(ls, q, bulk) {
  return cents(ls.reduce((s, l) => s + pieceAt(l, q, bulk), 0));
}

/** True when real fabricated pricing applies, so stop-gap "fabricated": true parts lines must be dropped. */
function hasFab(bom) { return lines(bom).length > 0; }

/** bom with stop-gap lines removed when real fabricated pricing applies (double-count guard). */
function withoutStopgap(bom) {
  if (!bom || !hasFab(bom)) return bom;
  return { ...bom, parts: (bom.parts || []).filter((p) => !(p && p.fabricated === true)) };
}

/**
 * Wrap server.js priceFor(bom, q, mode). ctx = { BULK, MARGIN, tierOf }.
 * Re-derives cost from the original result (unit_price - margin - handling), adds unit.fabrication, re-applies margin.
 */
function wrapPriceFor(orig, ctx) {
  return function priceForFab(bom, q, mode) {
    const ls = lines(bom);
    const r = orig(withoutStopgap(bom), q, mode);
    if (!ls.length) return r;
    const bulk = ctx.BULK[ctx.tierOf(q)] ?? 1;
    const fab = unitCost(ls, q, bulk);
    const u = { ...r.unit };
    const baseCost = (Number(r.unit_price) || 0) - (Number(u.margin) || 0) - (Number(u.handling) || 0);
    const cost = baseCost + fab;
    u.fabrication = fab;
    u.margin = cents(cost * ctx.MARGIN);
    const unit_price = cents(cost + u.margin + (Number(u.handling) || 0));
    const subtotal = cents(unit_price * q);
    return { ...r, unit: u, unit_price, subtotal, total: cents(subtotal + (Number(r.shipping) || 0)),
      lead_time_days: (Number(r.lead_time_days) || 0) + FAB_LEAD_DAYS };
  };
}

/** Wrap server.js quote(bom, mode): stop-gap guard on the bom list + a "fabricated" section with line items. */
function wrapQuote(orig) {
  return function quoteFab(bom, mode, ...rest) { // rest: design dir + options for server/prices
    bom = bom || {};
    const ls = lines(bom);
    const r = orig(withoutStopgap(bom), mode, ...rest);
    if (!ls.length) return r;
    // the guarded bom keeps its "fabricated" key, so the wrapped priceFor (called inside orig) still prices it.
    const excluded = (bom.parts || []).filter((p) => p && p.fabricated === true)
      .map((p) => ({ name: p.name, qty_per_unit: p.qty_per_unit, unit_cost_usd: p.unit_cost_usd }));
    const notes = [...(r.notes || [])];
    const counts = ['extrusion', 'sheet', 'laser'].map((k) => [k, ls.filter((l) => l.process === k).length]).filter(([, n]) => n);
    notes.splice(Math.max(0, notes.length - 1), 0,
      `Fabricated parts priced from the model: ${counts.map(([k, n]) => `${n} ${k}`).join(', ')}. Adds ${FAB_LEAD_DAYS} days for cutting and forming.`);
    return {
      ...r,
      fabricated: {
        parts: ls.length,
        lines: ls,
        setup_usd_per_batch: cents(ls.reduce((s, l) => s + l.setup_usd_per_batch, 0)),
        shop_rate_per_h: SHOP_RATE_PER_H,
        excluded_stopgap: excluded,
      },
      notes,
    };
  };
}

module.exports = {
  priceLine, lines, unitCost, pieceAt, leadDays, calibration: () => fabModel.calibration(), hasFab, withoutStopgap, wrapPriceFor, wrapQuote,
  constants: { SHOP_RATE_PER_H, STOCK_WASTE, EXTRUSION_WASTE, EXTRUSION_USD_PER_M, EXTRUSION_CUT_USD, EXTRUSION_TAP_USD,
    FAB_LEAD_DAYS },
};
