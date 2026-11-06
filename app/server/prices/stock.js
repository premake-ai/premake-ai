// Premake stock: small parts (electronics, small hardware) we buy in bulk, keep in NYC and ship in the same box as the
// printed parts, priced per piece at the bulk cost. The rules live in config.STOCK; see the comment there.
//
//   classify(part)        -> { stocked, cat, why }          is this bought line on our shelf?
//   bulkUnit(part)        -> { unit_usd, basis, why }       bulk cost of one piece (never a whole pack)
//   gramsEach(part)       -> estimated grams per piece      (box weight, the oversize check)
//
// Used by server/prices (Order tab lines and the Premake box), server/sourcing.js (lines carry `stocked`), server/fulfilment
// (stocked lines become a "pick from stock" job instead of an Amazon order) and scripts/bulk-stock-list.js.
'use strict';
const cfg = require('./config');
const match = require('./match');
const list = require('./list');
const packs = require('./packs');

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** What the rules look at: name, plus category / kind when a line has them, without bracketed notes ("(tripod bracket)"). */
const textOf = (p) => [p && p.name, p && p.category, p && p.kind].filter(Boolean).join(' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

function gramsEach(p) {
  const t = textOf(p);
  const hit = cfg.STOCK.grams.find(([re]) => re.test(t));
  return hit ? hit[1] : cfg.STOCK.default_g;
}

/** -> { stocked: bool, cat: 'electronics' | 'hardware' | null, why } */
function classify(p, opts = {}) {
  const S = cfg.STOCK;
  if (!p || typeof p !== 'object') return { stocked: false, cat: null, why: '' };
  const t = textOf(p);
  const allowHit = S.allow.find((a) => a.re.test(t));
  const cat = allowHit ? allowHit.cat : null;
  if (p.stock === true) return { stocked: true, cat: cat || 'hardware', why: 'Stocked (set on this parts line)' };
  if (p.stock === false || p.ship_direct === true) return { stocked: false, cat, why: 'Ships from the shop (set on this parts line)' };
  if (p.manual_order === true) return { stocked: false, cat, why: 'Ordered by hand from the listed shop' };
  const env = process.env.STOCK_SMALL_PARTS; // read live, so tests and admins can switch it
  const on = opts.enabled ?? (env != null && String(env).trim() ? !/^(0|false|no|off)$/i.test(String(env).trim()) : S.enabled);
  if (!on) return { stocked: false, cat, why: 'Stocking is switched off' };
  const deny = S.deny.find((d) => d.re.test(t));
  if (deny) return { stocked: false, cat, why: deny.why };
  if (!allowHit) return { stocked: false, cat: null, why: 'Not a small part we keep in stock' };
  if (n(p.unit_cost_usd) > S.max_unit_usd) return { stocked: false, cat, why: `Over $${S.max_unit_usd} a piece: ordered per kit` };
  if (gramsEach(p) > S.max_piece_g) return { stocked: false, cat, why: 'Heavy: ships from the shop' };
  return { stocked: true, cat, why: '' };
}

const r4 = (x) => Math.round(x * 10000) / 10000;

/** Bulk cost of one piece. Order of preference:
 *   1. the parts line's own pack (pack_qty + pack_usd)
 *   2. catalog list prices (list_prices.json, fasteners and rubber feet) at the bulk quantity break
 *   3. a pack size in the name ("pack of 10") or a typical pack (packs.js): the best per-piece price over its sizes
 *   4. a single-unit retail estimate times config.STOCK.bulk_factor[cat] (estimates until real bulk invoices)
 * -> { unit_usd, basis: 'pack' | 'catalog' | 'factor', why } */
function bulkUnit(p, cat) {
  const S = cfg.STOCK;
  const each = n(p.unit_cost_usd);
  if (n(p.pack_qty) >= 2 && n(p.pack_usd) > 0) {
    return { unit_usd: r4(n(p.pack_usd) / n(p.pack_qty)), basis: 'pack', why: `$${n(p.pack_usd).toFixed(2)} for ${n(p.pack_qty)}, per piece` };
  }
  const c = match.classify(p);
  if (c.route === 'list') {
    const r = list.priceFasteners(c.items, S.bulk_qty);
    if (r && r.unit_usd > 0) return { unit_usd: r4(r.unit_usd), basis: 'catalog', why: `catalog bulk price, ${[...new Set(r.rows.map((x) => x.supplier))].join(' + ')}` };
  }
  const named = packs.packInName(p.name);
  if (named > 1 && each > 2) return { unit_usd: r4(each / named), basis: 'pack', why: `$${each.toFixed(2)} for ${named}, per piece` };
  const hit = packs.PACKS.find(([re]) => re.test(String(p.name || '')));
  if (hit && each > 0) {
    const sizes = hit[1];
    if (sizes.length === 1 && sizes[0][0] === 1) { // a tube or roll shared across kits: the parts list's price is one kit's share
      const floor = sizes[0][1], kits = Math.max(1, Math.floor(floor / each));
      return { unit_usd: r4(floor / kits), basis: 'pack', why: `$${floor.toFixed(2)} ${/\b(tape|strip)\b/i.test(p.name) ? 'roll' : 'tube'} covers about ${kits} kits` };
    }
    const floorMax = Math.max(...sizes.map((x) => x[1]));
    if (each <= 1 && each < floorMax) { // a bulk item: the best per-piece price over the pack sizes we know
      const best = sizes.map(([qty, floor]) => ({ qty, usd: Math.min(Math.max(each * qty, floor), floor * 2) }))
        .sort((a, b) => a.usd / a.qty - b.usd / b.qty || b.qty - a.qty)[0];
      return { unit_usd: r4(best.usd / best.qty), basis: 'pack', why: `${hit[2]} of ${best.qty} at $${best.usd.toFixed(2)}, per piece` };
    }
  }
  const f = S.bulk_factor[cat] ?? S.bulk_factor.hardware;
  return { unit_usd: r4(each * f), basis: 'factor', why: `retail $${each.toFixed(2)} × ${f} bulk estimate` };
}

module.exports = { classify, bulkUnit, gramsEach, textOf };
