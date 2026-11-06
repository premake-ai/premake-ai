// Catalog list prices (server/prices/list_prices.json): real prices read by hand-run research from public product pages,
// each with its supplier, URL and the date it was checked. Used for fasteners and aluminium extrusion, where no
// account-free API exists. To refresh: re-check the URLs in the JSON and edit price_usd / breaks / checked.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'list_prices.json');
const { constants: FAB } = require('../pricing_fab');
const INHOUSE_CUT_USD = FAB.EXTRUSION_CUT_USD;
const INHOUSE_TAP_USD = FAB.EXTRUSION_TAP_USD;
let data = null;
function table() {
  if (!data) { try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { data = { fasteners: [], extrusion: [] }; } }
  return data;
}
function _set(d) { data = d; } // tests

/** Per-piece price at `need` pieces from an entry's breaks (qty = pieces) or its pack price. */
function pieceAt(e, need) {
  const pack = Number(e.pack_size) || 1;
  const br = (e.breaks || []).filter((b) => Number(b.unit_usd) > 0).map((b) => ({ qty: Number(b.qty) || 1, unit: Number(b.unit_usd) })).sort((a, b) => a.qty - b.qty);
  if (br.length) { let b = br[0]; for (const x of br) if (x.qty <= need) b = x; return b.unit / (e.breaks_per_pack ? pack : 1); }
  return Number(e.price_usd) / pack;
}

/** Closest list entry for one fastener component, or null. Screws: same length, else the next longer, else the nearest. */
function findFastener(c) {
  const rows = table().fasteners.filter((e) => e.kind === c.kind && (e.d == null ? c.d == null : Number(e.d) === Number(c.d)) && Number(e.price_usd) > 0);
  const asSocket = () => { if (c.kind !== 'hex_bolt') return null; const s = findFastener({ ...c, kind: 'shcs' }); return s ? { ...s, substitute: `socket head for hex head${s.substitute ? ', ' + s.substitute : ''}` } : null; };
  if (!rows.length) return asSocket();
  if (c.length == null || rows.every((e) => e.length == null)) return rows[0];
  const withLen = rows.filter((e) => e.length != null);
  const exact = withLen.find((e) => Number(e.length) === Number(c.length));
  if (exact) return exact;
  const longer = withLen.filter((e) => e.length > c.length).sort((a, b) => a.length - b.length)[0];
  if (longer && longer.length - c.length <= Math.max(6, c.length * 0.5)) return { ...longer, substitute: `${longer.length} mm for ${c.length} mm` };
  const near = withLen.filter((e) => e.length >= c.length - 2).sort((a, b) => Math.abs(a.length - c.length) - Math.abs(b.length - c.length))[0];
  if (near) return { ...near, substitute: `${near.length} mm for ${c.length} mm` };
  return asSocket(); // a hex bolt longer than the table has: the same-size socket head screw does the same job
}

/** Fastener line (parsed components) -> { unit_usd, rows } per BOM unit at `need` pieces, or null when any component has no list price. */
function priceFasteners(items, need) {
  const rows = [];
  let unit = 0;
  for (const c of items) {
    const e = findFastener(c);
    if (!e) return null;
    const each = pieceAt(e, need);
    unit += each;
    rows.push({ ...c, each_usd: each, supplier: e.supplier, url: e.url, checked: e.checked || table().checked, sku: e.sku || '', pack_size: e.pack_size || 1, substitute: e.substitute || '', material: e.material || '' });
  }
  return { unit_usd: unit, rows };
}

/** Extrusion piece price from list: per-mm (cut to length) or the smallest stock length that fits, + cut and tap fees. */
function priceExtrusion(profile, lengthMm, taps = 0) {
  const key = String(profile || '2020').replace(/[^0-9]/g, '').slice(0, 4);
  const rows = table().extrusion.filter((e) => String(e.profile).replace(/[^0-9]/g, '').slice(0, 4) === key);
  if (!rows.length || !(lengthMm > 0)) return null;
  const opts = [];
  for (const e of rows) {
    // a supplier that doesn't cut (full sticks) or tap: we do it in-house at the shop rates in pricing_fab.js
    const cut = e.cut_fee_usd != null ? Number(e.cut_fee_usd) : INHOUSE_CUT_USD;
    const tap = (e.tap_fee_usd != null ? Number(e.tap_fee_usd) : INHOUSE_TAP_USD) * taps;
    const extra = `${e.cut_fee_usd != null ? `, $${cut.toFixed(2)} cut` : ', cut in-house'}${taps ? (e.tap_fee_usd != null ? '' : ', tapped in-house') : ''}`;
    if (Number(e.per_mm_usd) > 0 && (!e.max_length_mm || lengthMm <= e.max_length_mm) && (!e.min_length_mm || lengthMm >= e.min_length_mm)) {
      opts.push({ e, usd: Number(e.per_mm_usd) * lengthMm + (Number(e.base_usd) || 0) + cut + tap, how: `cut to ${Math.round(lengthMm)} mm${extra}` });
    } else if (Number(e.price_usd) > 0 && Number(e.length_mm) >= lengthMm) {
      // a stock length; one cut makes the piece (leftover goes back on the shelf, so only the used share is charged)
      const share = lengthMm / Number(e.length_mm);
      opts.push({ e, usd: Number(e.price_usd) * share + cut + tap, how: `${Math.round(lengthMm)} mm from a ${e.length_mm} mm stick${extra}` });
    }
  }
  if (!opts.length) return null;
  opts.sort((a, b) => a.usd - b.usd);
  const o = opts[0];
  return { usd: o.usd, how: o.how, supplier: o.e.supplier, url: o.e.url, checked: o.e.checked || table().checked, sku: o.e.sku || '' };
}

module.exports = { table, pieceAt, findFastener, priceFasteners, priceExtrusion, _set, FILE };
