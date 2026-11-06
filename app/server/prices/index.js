// Real prices for the main quote, with provenance on every line.
//
//   Printed parts   in-house (our NYC printers, our cost model: Estimate) or Slant 3D (live quote: Live), chosen by env
//                   PRINT_SOURCE (inhouse | slant, default slant) and an admin's per-design override
//                   (<DATA>/.sourcing/print_source.json, set with POST /api/pricing/print-source).
//   Bought parts    small parts (electronics, small hardware; config.STOCK, stock.js) are Premake stock: bought in bulk,
//                   kept in NYC, shipped in the Premake box with the printed parts, priced per piece at the bulk cost.
//                   Everything else (bulky, heavy, specialty) is Amazon (suppliers.js normalises every bom line onto
//                   config.ALLOWED_SUPPLIERS). DigiKey / Mouser live prices and catalog list prices (list.js) are used only
//                   for shops on that list, so by default such a line is the parts list's own estimate, labelled as Amazon.
//   Fabricated      extrusion: Amazon pre-cut lengths (estimate); sheet / laser: SendCutSend (pricing_fab.js, calibrated).
//   At cost         the total is exactly what the suppliers charge: printed parts, cut parts, stocked parts per piece at
//                   bulk cost, other bought parts per pack actually bought (packs.js), each supplier box's shipping (config.SHIP), plus the card fee Stripe keeps
//                   (config.CARD_FEE). No margin, kitting, packaging or handling. Any quantity from 1 to config.MAX_QTY.
//
// Hooked into server.js (search "prices:"): wrapPriceFor() is the outermost priceFor, wrapQuote() the outermost quote.
// Both take the design dir as an extra last argument; without it printed parts use the default print source.
// Never blocks: Slant and distributor lookups answer from cache at once and refresh in the background; the quote says
// `pricing.refreshing: true` while anything is still being fetched, and the Order tab polls until it's false.
// Prices are written into the quote response only, never into design files.
//
// Selling mode: env SELL_ASSEMBLED (default off). Off: every quote is kit pricing (assembly labour not charged), the
// suppliers drop-ship to the customer, and the lead time is the slowest supplier's. Designs with kit_ok:false are
// not orderable then (quote.orderable = false).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const match = require('./match');
const list = require('./list');
const distributors = require('./distributors');
const sup = require('./suppliers');
const pricingFab = require('../pricing_fab');
const packs = require('./packs');
const stock = require('./stock');
const rmfg = require('./rmfg'); // rmfg: live sheet-metal quotes from the part's STEP file

const cents = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sellAssembled = () => /^(1|true|yes|on)$/i.test(String(process.env.SELL_ASSEMBLED || '').trim());
const printDefault = () => (/^inhouse$/i.test(String(process.env.PRINT_SOURCE || '').trim()) ? 'inhouse' : 'slant'); // live Slant 3D unless set
const NOT_ORDERABLE = 'Not available to order yet. This design needs assembly.';

/** "1–3 days" / "43-47 days" / "2 weeks" -> the larger number in days. */
function leadDays(text) {
  const t = String(text || '');
  const nums = [...t.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!nums.length) return null;
  return Math.max(...nums) * (/week/i.test(t) ? 7 : 1);
}

const src = {
  live: (supplier, at, url, extra = {}) => ({ kind: 'live', supplier, at, url: url || '', ...extra }),
  list: (supplier, checked, url, extra = {}) => ({ kind: 'list', supplier, checked, url: url || '', ...extra }),
  estimate: (why, extra = {}) => ({ kind: 'estimate', why, ...extra }),
  buildery: (why) => ({ kind: 'buildery', supplier: 'Premake', why }),
};

function init({ DATA, PROJECTS, EXAMPLES, BULK, MARGIN, tierOf, MATERIAL_PER_G, PRINT_PER_H, PRINTERS, PRINTER_HOURS_PER_DAY, readJSON, writeJSON, fetchImpl }) {
  const dist = distributors.create({ cacheFile: path.join(DATA, '.sourcing', 'distributors.json'), ...(fetchImpl ? { fetchImpl } : {}) });
  const OVR = path.join(DATA, '.sourcing', 'print_source.json');
  let sourcing = null;
  rmfg.init(DATA);

  /** design dir -> "projects/<id>" | "examples/<slug>" (the override key), or null */
  function keyOf(dir) {
    if (!dir) return null;
    const d = path.resolve(dir);
    if (path.dirname(d) === path.resolve(PROJECTS)) return 'projects/' + path.basename(d);
    if (path.dirname(d) === path.resolve(EXAMPLES) || path.dirname(d) === path.resolve(DATA, 'showcase')) return 'examples/' + path.basename(d); // showcase: published designs are examples
    return null;
  }
  function overrides() { return readJSON(OVR, {}) || {}; }
  function printSource(dir) {
    const k = keyOf(dir), o = k ? overrides()[k] : null;
    const def = printDefault();
    return { source: o === 'slant' || o === 'inhouse' ? o : def, default: def, override: o === 'slant' || o === 'inhouse' ? o : null };
  }
  function setPrintSource(dir, v) {
    const k = keyOf(dir);
    if (!k) throw Object.assign(new Error('design not found'), { code: 404 });
    const all = overrides();
    if (v === 'slant' || v === 'inhouse') all[k] = v; else delete all[k];
    fs.mkdirSync(path.dirname(OVR), { recursive: true });
    writeJSON(OVR, all);
    return printSource(dir);
  }

  // ---------------------------------------------------------------- bought parts
  /** A stocked small part (config.STOCK): from our NYC shelf, in the Premake box, per piece at the bulk cost. Never a whole
   * pack: 4 rubber feet are 4 × the per-piece price of the big bag we keep. The shop link stays on the line (where we buy
   * it, and where a builder can). */
  function stockedLine(p, q, sc) {
    const qpu = n(p.qty_per_unit) || 1;
    const need = Math.max(1, Math.ceil(qpu * q));
    const b = stock.bulkUnit(p, sc.cat);
    const unit = b.unit_usd;
    const order = unit > 0 ? Math.max(0.01, cents(need * unit)) : 0;
    return { type: 'bought', name: String(p.name || ''), qty_per_unit: qpu, need, shop: 'Premake', stocked: true, stock_cat: sc.cat, buy_from: sup.shopFor(p),
      in_stock: cfg.STOCK.label, unit_usd: unit, pack_qty: 1, packs: need, pack_usd: cents(unit), order_usd: order, buy: String(need),
      total_usd: cents(order / Math.max(1, q)), lead_days: cfg.LEAD.in_stock, grams_each: stock.gramsEach(p), bulk_basis: b.basis,
      source: src.estimate(`Premake stock, bulk price: ${b.why}`, { supplier: 'Premake', url: String(p.url || '') }) };
  }

  function boughtLine(p, q, tier) {
    const sc = stock.classify(p);
    if (sc.stocked) return stockedLine(p, q, sc);
    const qpu = n(p.qty_per_unit) || 1;
    const need = Math.max(1, Math.ceil(qpu * q));
    const est = n(p.unit_cost_usd);
    const estUnit = est; // at cost: the parts-list price as is (pack sizes, below, are where bigger orders get cheaper)
    const shop = sup.shopFor(p);
    const amazon = sup.canon(shop) === 'amazon';
    const base = { type: 'bought', name: String(p.name || ''), qty_per_unit: qpu, need, shop, ...(sc.why ? { direct_why: sc.why } : {}) };
    const c = match.classify(p);
    // a parts-list estimate, ordered from the line's shop: Prime product link ~3 days, an Amazon search ~5
    const estLead = amazon ? (sup.isAmazonProduct(p.url) ? cfg.LEAD.amazon_prime : cfg.LEAD.amazon) : cfg.LEAD.estimate;
    const est$ = (why) => src.estimate(why, { supplier: shop, url: String(p.url || '') });
    let out = null;
    if (c.route === 'list') {
      const r = list.priceFasteners(c.items, need);
      const fromShop = r && sup.isAllowed([...new Set(r.rows.map((x) => x.supplier))].join(' + '));
      if (r && !fromShop) out = { ...base, unit_usd: estUnit, source: est$(`${shop} estimate (parts-list price)`), lead_days: estLead };
      else if (r) {
        const sups = [...new Set(r.rows.map((x) => x.supplier))];
        const checked = r.rows.map((x) => x.checked).sort()[0];
        const subs = r.rows.filter((x) => x.substitute).map((x) => x.substitute);
        out = { ...base, unit_usd: r.unit_usd, _rows: r.rows, source: src.list(sups.join(' + '), checked, r.rows[0].url,
          { detail: r.rows.map((x) => `${x.kind === 'feet' ? 'rubber feet' : `M${x.d}${x.length ? '×' + x.length : ''} ${x.kind.replace('_', ' ')}`} $${x.each_usd.toFixed(3)}${x.pack_size > 1 ? ` (pack of ${x.pack_size})` : ''}`).join(' + ')
            + (subs.length ? `; ${subs.join(', ')}` : '') }), lead_days: cfg.LEAD.list_price };
      } else out = { ...base, unit_usd: estUnit, source: est$(`${shop} estimate (parts-list price)`), lead_days: estLead };
    } else if (c.route === 'distributor' && !(sup.isAllowed('DigiKey') || sup.isAllowed('Mouser'))) {
      out = { ...base, unit_usd: estUnit, source: est$(`${shop} estimate (parts-list price)`), lead_days: estLead };
    } else if (c.route === 'distributor') {
      const w = c.want;
      const scale = w.per_led && w.leds ? w.leds / w.per_led : 1; // LED strip: priced per metre, used per LED
      const r = dist.get(w, Math.max(1, Math.ceil(need * scale)));
      if (r.status === 'live' && !sup.isAllowed(r.offer.distributor)) {
        out = { ...base, unit_usd: estUnit, source: est$(`${shop} estimate (parts-list price)`), lead_days: estLead };
      } else if (r.status === 'live') {
        const unit = r.price.unit_usd * scale;
        const sane = !est || (unit <= est * 8 + 5 && unit >= est / 10);
        if (sane) {
          out = { ...base, unit_usd: unit, refreshing: !!r.pending,
            source: src.live(r.offer.distributor, r.at, r.offer.url, { sku: r.offer.sku, mpn: r.offer.mpn, stock: r.offer.stock, break_qty: r.price.break_qty,
              detail: `${r.offer.manufacturer} ${r.offer.mpn}${w.note ? ` (${w.note})` : ''}, ${r.offer.stock.toLocaleString('en-US')} in stock` }),
            lead_days: r.enough ? cfg.LEAD.distributor_in_stock : (r.offer.lead_days || cfg.LEAD.distributor_no_stock) };
        } else {
          out = { ...base, unit_usd: estUnit, source: est$(`${r.offer.distributor}'s closest match (${r.offer.mpn}, $${unit.toFixed(2)}) looks like a different product; parts-list price`), lead_days: estLead };
        }
      } else {
        const why = r.status === 'not_configured' ? 'DigiKey / Mouser keys not configured; parts-list price'
          : r.status === 'pending' ? 'Getting DigiKey / Mouser prices…'
            : r.status === 'no_match' ? 'No DigiKey / Mouser match; parts-list price'
              : `DigiKey / Mouser unavailable (${r.error}); parts-list price`;
        out = { ...base, unit_usd: estUnit, source: est$(why), lead_days: estLead, refreshing: r.status === 'pending' };
      }
    } else {
      out = { ...base, unit_usd: estUnit, source: est$(amazon ? `${shop} estimate (parts-list price)` : c.why), lead_days: estLead };
    }
    out.unit_usd = Math.round(out.unit_usd * 10000) / 10000;
    // what the order really buys: shops sell small hardware by the pack (packs.js); distributors and catalog rows sell
    // single pieces. order_usd is the whole order's cost for this line; total_usd its share per kit.
    const rows = out.source.kind === 'list' && Array.isArray(out._rows) ? out._rows : null; // catalog rows know their pack size
    const pk = out.source.kind !== 'estimate' && !rows ? { qty: 1, usd: out.unit_usd, why: '' }
      : rows ? (rows.length === 1 && n(rows[0].pack_size) > 1 ? { qty: n(rows[0].pack_size), usd: n(rows[0].each_usd) * n(rows[0].pack_size), why: `sold in packs of ${n(rows[0].pack_size)}` } : { qty: 1, usd: out.unit_usd, why: '' })
        : packs.packFor({ ...p, unit_cost_usd: out.unit_usd }, need);
    delete out._rows;
    const nPacks = Math.ceil(need / Math.max(1, pk.qty));
    out.pack_qty = pk.qty; out.packs = nPacks; out.pack_usd = cents(pk.usd);
    out.order_usd = cents(nPacks * pk.usd);
    out.buy = packs.buyText(nPacks, pk.qty, need, pk.noun);
    if (pk.why) out.pack_why = pk.why;
    out.total_usd = cents(out.order_usd / Math.max(1, q));
    return out;
  }

  // ---------------------------------------------------------------- printed parts
  function printLines(bom, q, tier, dir, force, background) {
    const printed = bom.printed || [];
    const grams = printed.reduce((s, p) => s + n(p.grams), 0), hours = printed.reduce((s, p) => s + n(p.print_hours), 0);
    const ps = force ? { source: force, default: printDefault(), override: null } : printSource(dir);
    const farm = q === 1 && hours <= PRINTER_HOURS_PER_DAY ? 1 : 2 + Math.ceil((q * hours) / (PRINTERS * PRINTER_HOURS_PER_DAY));
    const inhouse = (why) => ({
      key: 'inhouse', material: cents(grams * MATERIAL_PER_G), printing: cents(hours * PRINT_PER_H), service: 0, lead_days: farm, inhouse: true,
      source: src.estimate(why || `In-house print (our NYC printers): ${Math.round(grams)} g PETG at $${(MATERIAL_PER_G * 1000).toFixed(0)}/kg + ${hours.toFixed(1)} h at $${PRINT_PER_H.toFixed(2)}/h`),
      lines: printed.map((p) => ({ type: 'printed', shop: 'Premake', name: p.name, file: p.file, total_usd: cents(n(p.grams) * MATERIAL_PER_G + n(p.print_hours) * PRINT_PER_H) })),
    });
    if (!printed.length) return { ...inhouse(), ps };
    if (ps.source !== 'slant') return { ...inhouse(), ps };
    // Slant 3D, live: the exact quantity's price (setup included) and Slant's own shipping rate, from their quote API
    const kind = (keyOf(dir) || '').split('/')[0];
    const bg = background ? { background: true } : undefined; // the designs list: Slant quotes queue behind open Order tabs
    const o = sourcing && dir && sourcing.slantOrder ? sourcing.slantOrder(dir, kind, q, bg) : { status: 'none', error: 'no design folder' };
    const st = sourcing && dir ? sourcing.slantState(dir, kind, bg) : { status: 'none', error: 'no design folder' };
    const sum = st.status === 'live' ? Object.values(st.parts || {}).reduce((s, p) => s + n(p.price_usd), 0) : 0;
    const share = (i) => (st.byIndex?.[i] && sum > 0 ? n(st.byIndex[i].price_usd) / sum : 1 / printed.length);
    if (o.status === 'live') {
      const setup = n(o.setup_usd), parts = Math.max(0, n(o.subtotal_usd) - setup);
      return {
        key: 'slant', material: 0, printing: 0, service: cents(n(o.subtotal_usd) / q), setup_usd: setup, ps, inhouse: false, refreshing: false,
        ship_usd: o.ship_usd, ship_why: o.ship_usd != null ? `Slant 3D’s live rate${o.ship_service ? `, ${o.ship_service}` : ''}, to ${o.region_label || 'NYC'}` : '',
        lead_days: (leadDays(o.lead_time) || 7) + (n(o.ship_days) || cfg.LEAD.slant_transit), lead_text: o.lead_time,
        source: src.live('Slant 3D', o.fetched_at, 'https://www.slant3d.com/', { detail: `${o.material || 'PETG'}${o.color ? ' ' + o.color : ''}, ${q} ${q === 1 ? 'set' : 'sets'}, ${o.lead_time}${setup ? `, $${setup} setup per order` : ''}` }),
        lines: (() => { // whole-order amounts that add up to Slant's subtotal to the cent
          const ls = printed.map((p, i) => ({ type: 'printed', shop: 'Slant 3D', name: p.name, file: p.file, order_usd: cents(parts * share(i)) }));
          const diff = cents(parts - ls.reduce((a, l) => a + l.order_usd, 0));
          if (ls.length && diff) ls[ls.length - 1].order_usd = cents(ls[ls.length - 1].order_usd + diff);
          for (const l of ls) l.total_usd = cents(l.order_usd / q);
          return ls;
        })(),
      };
    }
    if (o.status === 'quoting') { // an estimate until Slant answers: their nearest quantity tier if we have it, else our cost model
      const set = st.status === 'live' ? st.set[tier] || st.set[String(tier)] : null;
      const est = set && n(set.unit_usd) > 0 ? { unit: n(set.unit_usd), setup: n(set.setup_usd), lead: set.lead_time } : null;
      const base = inhouse();
      const unit = est ? est.unit : base.material + base.printing;
      return {
        key: 'slant', material: 0, printing: 0, service: cents(unit + (est ? est.setup / q : 0)), setup_usd: est ? est.setup : 0, ps, inhouse: false, refreshing: true,
        lead_days: est ? (leadDays(est.lead) || 7) + cfg.LEAD.slant_transit : 7 + cfg.LEAD.slant_transit, ...(est ? { lead_text: est.lead } : {}),
        source: src.estimate('Getting Slant 3D’s live quote for this quantity…', { supplier: 'Slant 3D' }),
        lines: printed.map((p, i) => ({ type: 'printed', shop: 'Slant 3D', name: p.name, file: p.file,
          total_usd: cents(est ? est.unit * share(i) : n(p.grams) * MATERIAL_PER_G + n(p.print_hours) * PRINT_PER_H) })),
      };
    }
    const why = o.error || st.error || '';
    // Slant can't quote it right now: still a Slant 3D box (we'd order there by hand), priced with our print cost model
    const est = inhouse(`Slant 3D can’t quote this${why ? ` (${why})` : ''}; our own print cost estimate`);
    return { ...est, key: 'slant', inhouse: false, lead_days: 7 + cfg.LEAD.slant_transit, ps, slant_error: why,
      lines: est.lines.map((l) => ({ ...l, shop: 'Slant 3D' })) };
  }

  // ---------------------------------------------------------------- fabricated parts
  /** rmfg: the live RMFG unit price for a metal sheet / laser part at quantity q (the quoted break at or below q),
   * from cache; starts a background quote when there is none. -> { price, at, detail } | { pending } | null */
  function rmfgLive(dir, f, q) {
    if (!dir || !sup.isAllowed('RMFG') || !rmfg.connected()) return null;
    if (/acrylic|ply|wood|mdf|delrin|acetal|polycarbonate|hdpe|abs/i.test(JSON.stringify(f.params || {}))) return null;
    const man = readJSON(path.join(dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && x.file === f.file);
    if (!mp || !/^step\/[\w.-]+\.step$/.test(mp.step)) return null;
    const step = path.join(dir, mp.step);
    const m = String(mp.material || '').toLowerCase();
    const opts = { material: /stainless/.test(m) ? 'stainless' : /steel/.test(m) ? 'steel' : 'aluminium', qtys: [1, 10, 100, 500], name: mp.name };
    const c = rmfg.cached(step, opts);
    if (c && !c.error) {
      const row = (c.prices || []).filter((p) => p.unit_usd != null && p.qty <= q).sort((a, b) => b.qty - a.qty)[0] || (c.prices || [])[0];
      if (!row || row.unit_usd == null) return null;
      return { price: cents(row.unit_usd), at: c.at, detail: [c.stock?.map((s) => s.stock).join(', '), (c.findings || [])[0]].filter(Boolean).join(' · ') };
    }
    if (!c || Date.now() - c.at > 10 * 60e3) rmfg.ensure(step, opts);
    return rmfg.quoting(step, opts) ? { pending: true } : null;
  }
  function fabLines(bom, q, tier, dir) {
    const ls = pricingFab.lines(bom);
    const fabs = (bom.fabricated || []).filter((f) => f && ['extrusion', 'sheet', 'laser'].includes(f.process));
    const out = [];
    // extrusion is never Premake stock (long and heavy: the owner's call, 2026-11-03): pre-cut from Amazon, straight to the customer
    fabs.forEach((f, i) => {
      const l = ls[i];
      if (!l) return;
      const p = f.params || {};
      if (f.process === 'extrusion') {
        const taps = Number.isFinite(Number(p.tapped_ends)) ? Math.max(0, Math.min(2, Number(p.tapped_ends))) : 2;
        const len = n(p.length_mm || f.est?.length_mm);
        const r = list.priceExtrusion(p.profile || '2020', len, taps);
        const prof = String(p.profile || '2020');
        const a = sup.amazonExtrusion(prof, len, taps);
        if ((!r || !sup.isAllowed(r.supplier)) && a) { // pre-cut lengths from Amazon (the catalog list rows are other shops)
          out.push({ type: 'fabricated', process: 'extrusion', shop: 'Amazon', name: l.name, detail: `${prof}, ${a.how}`, total_usd: cents(a.usd),
            source: src.estimate(`Amazon pre-cut ${prof}, ${a.stock_mm} mm (typical Prime price)${a.cut ? `; cut to ${Math.round(len)} mm by hand` : ''}`, { supplier: 'Amazon', url: a.url }),
            lead_days: cfg.LEAD.amazon, cut_by_hand: a.cut });
          return;
        }
        if (r && sup.isAllowed(r.supplier)) {
          out.push({ type: 'fabricated', process: 'extrusion', shop: r.supplier, name: l.name, detail: `${prof}, ${r.how}${taps ? `, ${taps} tapped` : ''}`, total_usd: cents(r.usd),
            source: src.list(r.supplier, r.checked, r.url, { detail: r.sku }), lead_days: cfg.LEAD.list_price });
          return;
        }
      }
      const live = f.process !== 'extrusion' ? rmfgLive(dir, f, q) : null; // rmfg: a real RMFG quote beats the estimate
      if (live?.price) {
        out.push({ type: 'fabricated', process: f.process, shop: 'RMFG', name: l.name, detail: live.detail, total_usd: live.price,
          source: src.live('RMFG', live.at, 'https://www.rmfg.com/quote/sheet', { detail: live.detail }), lead_days: pricingFab.leadDays(f.process, l.bends || 0) });
        return;
      }
      const unit = pricingFab.pieceAt(l, q, BULK[tier] ?? 1);
      const cal = pricingFab.calibration();
      const why = f.process === 'extrusion' ? 'Longer than Amazon’s pre-cut lengths; shop cost model'
        : cal.quotes ? `Estimate, calibrated to ${cal.quotes} real ${cal.supplier || 'SendCutSend'} quote${cal.quotes === 1 ? '' : 's'}`
          : 'Estimate, calibrated to SendCutSend pricing (Oct 2026)';
      out.push({ type: 'fabricated', process: f.process, shop: sup.fabShop(f), name: l.name, detail: l.detail, total_usd: unit, source: src.estimate(why), refreshing: !!live?.pending,
        lead_days: f.process === 'extrusion' ? cfg.LEAD.amazon : pricingFab.leadDays(f.process, l.bends || 0), scs: f.process !== 'extrusion' });
    });
    // SendCutSend's per-order minimum ($39): one order per batch for all of a design's sheet / laser parts
    const scs = out.filter((l) => l.scs);
    const orderMin = pricingFab.calibration().order_min_usd || 0;
    const batch = scs.reduce((s, l) => s + l.total_usd, 0) * q;
    if (scs.length && orderMin && batch < orderMin) {
      const k = orderMin / batch;
      for (const l of scs) { l.total_usd = cents(l.total_usd * k); l.source = { ...l.source, why: `${l.source.why}; includes SendCutSend's $${orderMin} order minimum` }; }
    }
    return out;
  }

  // ---------------------------------------------------------------- the wrapped priceFor
  function costs(bom, q, mode, dir, opts = {}) {
    const tier = tierOf(q);
    bom = sup.normalizeBom(bom);
    const print = printLines(bom, q, tier, dir, opts.force_print, !!opts.background);
    const bought = (pricingFab.withoutStopgap(bom).parts || []).filter((p) => p && typeof p === 'object').map((p) => boughtLine(p, q, tier));
    const fab = fabLines(bom, q, tier, dir);
    return { tier, bought, print, fab };
  }
  /** Kit-contents group of a quote line (Order tab, checkout `omit`). Same rule as payments.kitGroupOf. */
  const groupOf = (l) => l?.type === 'printed' ? 'printed' : l?.type === 'bought' ? 'bought' : l?.type === 'fabricated' ? (l.process === 'extrusion' ? 'extrusion' : 'metal') : null;
  const KIT_GROUPS = ['printed', 'metal', 'extrusion', 'bought'];
  /** Which box a line ships in: Premake (printed in NYC, or from our shelf), Slant 3D, SendCutSend, Amazon, or another shop. */
  const boxOf = (l, print) => l.type === 'printed' ? (print.key === 'slant' ? 'Slant 3D' : 'Premake') : l.in_stock ? 'Premake' : sup.canon(l.shop) === 'amazon' ? 'Amazon'
    : /sendcutsend/i.test(l.shop || '') ? 'SendCutSend' : /slant/i.test(l.shop || '') ? 'Slant 3D' : /formery|premake/i.test(l.shop || '') ? 'Premake' : String(l.shop || 'Other shop');
  const toC = (usd) => Math.round(n(usd) * 100);

  /** Does building this need a soldering iron? bom.json needs_soldering (the design agent sets it), or a parts line that
   * mentions solder / soldering in its name, notes or search term. */
  function needsSoldering(bom) {
    if (bom && bom.needs_soldering === true) return true;
    if (bom && bom.needs_soldering === false) return false;
    return (bom?.parts || []).some((p) => p && /\bsolder(?:ing|ed)?\b/i.test([p.name, p.notes, p.supplier_note, p.search].filter(Boolean).join(' ')));
  }
  /** The soldering iron add-on as a bought line: one kit per order, from Amazon. */
  function solderLine(q) {
    const k = cfg.SOLDER_KIT;
    return { type: 'bought', addon: 'solder', name: k.name, qty_per_unit: 1, need: 1, shop: 'Amazon', unit_usd: k.usd, pack_qty: 1, packs: 1, pack_usd: k.usd,
      order_usd: cents(k.usd), buy: '1', total_usd: cents(k.usd / Math.max(1, q)), lead_days: cfg.LEAD.amazon_prime,
      source: src.estimate(k.why, { supplier: 'Amazon', url: k.url }) };
  }

  /** At cost: the order total is exactly what the suppliers charge (parts per pack bought, printing, cutting, each box's
   * shipping) plus the card fee Stripe keeps. No margin, kitting, packaging or handling. opts.omit: groups left out. */
  function wrapPriceFor(orig) {
    return function pricedFor(bom, q, mode, dir, opts) {
      bom = bom || {}; opts = opts || {};
      if (!sellAssembled()) mode = 'kit';
      q = Math.max(1, Math.floor(n(q)) || 1);
      const r = orig(bom, q, mode);
      const c = costs(bom, q, mode, dir, opts);
      const omit = new Set((Array.isArray(opts.omit) ? opts.omit : []).filter((k) => KIT_GROUPS.includes(k)));
      // add-on: a soldering iron kit, one per order, when the design needs soldering and the customer switched it on
      const solderNeeded = needsSoldering(bom);
      const solderOn = solderNeeded && (Array.isArray(opts.addons) ? opts.addons : []).includes('solder');
      if (solderOn) c.bought.push(solderLine(q));

      const printLs = c.print.lines.map((l) => ({ ...l, source: c.print.source, lead_days: c.print.lead_days, ...(c.print.lead_text ? { lead_text: c.print.lead_text } : {}),
        order_usd: l.order_usd != null ? l.order_usd : cents(l.total_usd * q) }));
      if (c.print.key === 'slant' && n(c.print.setup_usd) > 0 && printLs.length) {
        printLs.push({ type: 'printed', shop: 'Slant 3D', name: 'Slant 3D setup fee (once per order)', fee: true, total_usd: cents(n(c.print.setup_usd) / q),
          order_usd: cents(n(c.print.setup_usd)), source: c.print.source, lead_days: c.print.lead_days });
      }
      const fabLs = c.fab.map((l) => ({ ...l, order_usd: cents(l.total_usd * q) }));
      const all = [...printLs, ...fabLs, ...c.bought];
      for (const l of all) l.box = boxOf(l, c.print);
      const kept = all.filter((l) => l.addon || !omit.has(groupOf(l))); // add-ons stay when their group is left out

      // each supplier's box: parts cost, weight and shipping
      const gramsEach = (bom.printed || []).reduce((s, p) => s + n(p.grams), 0);
      const boxes = new Map();
      for (const l of kept) {
        if (!boxes.has(l.box)) boxes.set(l.box, { shop: l.box, parts_usd: 0, lines: 0, grams: 150 });
        const b = boxes.get(l.box);
        b.parts_usd = cents(b.parts_usd + n(l.order_usd)); b.lines++;
        if (l.type === 'printed' && !l.fee) b.grams += gramsEach * q / Math.max(1, c.print.lines.length);
        else if (l.type !== 'printed') b.grams += (n(l.grams_each) || 40) * (n(l.need) || q);
      }
      const shipping_lines = [...boxes.values()].map((b) => {
        const rate = cfg.SHIP[b.shop] || cfg.SHIP.other;
        const lb = b.grams / 453.6;
        const live = b.shop === 'Slant 3D' && c.print.ship_usd != null;
        return { shop: b.shop, usd: live ? cents(c.print.ship_usd) : cents(rate.base + rate.per_lb * Math.max(0, lb - 1)), why: live ? c.print.ship_why : rate.why,
          live, parts_usd: b.parts_usd, weight_lb: Math.round(lb * 10) / 10 };
      });

      // money in cents, so the screen, the checkout and Stripe agree to the cent
      const goods_cents = kept.reduce((s, l) => s + toC(l.order_usd), 0);
      const shipping_cents = shipping_lines.reduce((s, x) => s + toC(x.usd), 0);
      const base = goods_cents + shipping_cents;
      const total_cents = base > 0 ? Math.ceil((base + toC(cfg.CARD_FEE.fixed_usd)) / (1 - cfg.CARD_FEE.rate)) : 0;
      const card_fee_cents = total_cents - base;
      const total = total_cents / 100;

      // lead time: every supplier ships straight to the customer at once; the order is ready when the slowest box lands
      const leadOf = (ls) => Math.max(0, ...ls.filter((l) => !l.fee).map((l) => n(l.lead_days)));
      const keptPrint = kept.filter((l) => l.type === 'printed');
      const keptFab = kept.filter((l) => l.type === 'fabricated'), keptBought = kept.filter((l) => l.type === 'bought');
      const supply = Math.max(leadOf(keptPrint), leadOf(keptBought), leadOf(keptFab));
      const asmMin = n(bom.assembly_minutes) * q;
      const asmDays = mode === 'assembled' ? Math.max(1, Math.ceil(asmMin / (cfg.ASSEMBLY_STAFF * cfg.ASSEMBLY_MIN_PER_DAY))) : 0;
      const allHere = kept.every((l) => l.box === 'Premake') && c.print.inhouse;
      const tomorrow = allHere && supply <= 1 && mode !== 'assembled';
      const lead_time_days = tomorrow ? 1 : Math.max(1, supply + asmDays);
      const slowest = kept.filter((l) => !l.fee).map((l) => ({ what: l.type === 'printed' ? (c.print.key === 'slant' ? `Slant 3D printing (${c.print.lead_text})` : 'Printing in-house') : l.name, days: n(l.lead_days) }))
        .sort((a, b) => b.days - a.days)[0];

      const sum = (ls) => cents(ls.reduce((s, l) => s + n(l.order_usd), 0) / q);
      const unit = { // per kit, for the 3D viewer's hover prices and the sourcing view
        parts: sum(c.bought), material: c.print.material, printing: c.print.printing,
        ...(c.print.service ? { print_service: c.print.service } : {}),
        ...(c.fab.length ? { fabrication: sum(fabLs) } : {}),
      };
      const groups = {};
      for (const k of KIT_GROUPS) {
        const ls = all.filter((l) => groupOf(l) === k && !l.addon);
        if (!ls.length) continue;
        const order = cents(ls.reduce((s, l) => s + n(l.order_usd), 0));
        groups[k] = { lines: ls.filter((l) => !l.fee).length, order_usd: order, cost: cents(order / q), off: cents(order / q) };
      }
      const sources = {
        parts: summary(c.bought),
        material: c.print.key === 'inhouse' ? c.print.source : null,
        printing: c.print.key === 'inhouse' ? c.print.source : null,
        print_service: c.print.key === 'slant' ? c.print.source : null,
        fabrication: c.fab.length ? summary(c.fab) : null,
        shipping: src.estimate('Each supplier’s own shipping to one US address'),
        card_fee: src.buildery(`What Stripe keeps per card payment (${(cfg.CARD_FEE.rate * 100).toFixed(1)}% + ${Math.round(cfg.CARD_FEE.fixed_usd * 100)}¢)`),
      };
      return {
        qty: q, mode, at_cost: true, omit: [...omit].filter((k) => groups[k]),
        addons: { solder: { needed: solderNeeded, on: solderOn, name: cfg.SOLDER_KIT.name, usd: cfg.SOLDER_KIT.usd, url: cfg.SOLDER_KIT.url } },
        unit, lines: all, groups, boxes: shipping_lines,
        goods: goods_cents / 100, subtotal: goods_cents / 100, shipping: shipping_cents / 100, card_fee: card_fee_cents / 100, total,
        goods_cents, subtotal_cents: goods_cents, shipping_cents, card_fee_cents, total_cents,
        unit_price: cents(total / q), // per kit, everything included
        tax: { at_checkout: /^1$/.test(String(process.env.STRIPE_TAX || '').trim()) },
        lead_time_days,
        lead: { supply_days: supply, assembly_days: asmDays, slowest: slowest?.what || '', in_house: tomorrow },
        sources,
        refreshing: !!(c.print.refreshing || c.bought.some((l) => l.refreshing) || c.fab.some((l) => l.refreshing)),
        print_source: c.print.ps,
        ...(r && r.fabricated ? { fabricated: r.fabricated } : {}),
      };
    };
  }

  /** Several lines' sources -> one badge: the weakest kind wins (estimate < list < live), with counts. */
  function summary(lines) {
    if (!lines.length) return null;
    const count = { live: 0, list: 0, estimate: 0 };
    for (const l of lines) count[l.source.kind] = (count[l.source.kind] || 0) + 1;
    const kind = count.estimate ? 'estimate' : count.list ? 'list' : 'live';
    const sups = [...new Set(lines.filter((l) => l.source.supplier).map((l) => l.source.supplier))];
    return { kind, count, suppliers: sups, why: kind === 'estimate' ? `${count.estimate} of ${lines.length} lines are estimates` : '' };
  }

  function wrapQuote(orig) {
    return function pricedQuote(bom, mode, dir, opts) {
      bom = bom || {};
      if (!sellAssembled()) mode = 'kit';
      const q = orig(bom, mode, dir, opts);
      const t1 = q.tiers?.[0];
      const ls = t1?.lines || [];
      const count = { live: 0, list: 0, estimate: 0 };
      for (const l of ls) count[l.source.kind] = (count[l.source.kind] || 0) + 1;
      const notes = (q.notes || []).filter((x) => !/^Estimate only\./.test(x) && !/^Fabricated parts priced from the model/.test(x));
      notes.push(`Price sources at 1 unit: ${count.live} live, ${count.list} list price, ${count.estimate} estimated lines. At cost: no margin; shipping is each supplier's own, plus the card fee Stripe keeps.`);
      if (!sellAssembled()) notes.push('Kit: parts ship to you, with step-by-step instructions. Printed parts and small parts (electronics, screws, feet) come in one Premake box from NYC; anything big ships straight from its shop, and the lead time is the slowest box’s.');
      // hover tooltips: printed and bought parts at their sourced 1-unit cost
      if (Array.isArray(q.part_costs) && ls.length) {
        for (const pc of q.part_costs) {
          const l = ls.find((x) => x.type === (pc.kind === 'print' ? 'printed' : pc.kind === 'bought' ? 'bought' : 'fabricated') && x.name === pc.name && (!pc.file || !x.file || x.file === pc.file));
          if (!l) continue;
          if (pc.kind === 'bought') { pc.unit_usd = cents(l.unit_usd); pc.usd = l.total_usd; } else pc.usd = l.total_usd;
          pc.source = l.source.kind;
        }
      }
      const orderable = sellAssembled() || bom.kit_ok !== false;
      return {
        ...q, mode, notes, max_qty: cfg.MAX_QTY,
        sell_assembled: sellAssembled(), orderable, ...(orderable ? {} : { not_orderable: NOT_ORDERABLE }),
        pricing: {
          refreshing: (q.tiers || []).some((t) => t.refreshing),
          print_source: t1?.print_source || printSource(dir),
          distributors: distributors.configured(),
          count,
        },
      };
    };
  }

  /** POST /api/pricing/print-source { project | example, source: "inhouse" | "slant" | "default" } (admins). */
  function handle(req, res, body, { acc, isAdmin, projDir, exDir, send }) {
    if (!isAdmin(acc)) return send(res, 403, { error: 'admins only' });
    const dir = body.project ? projDir(String(body.project)) : body.example ? exDir(String(body.example)) : null;
    if (!dir || !fs.existsSync(dir)) return send(res, 404, { error: 'design not found' });
    const v = String(body.source || 'default');
    if (!['inhouse', 'slant', 'default'].includes(v)) return send(res, 400, { error: 'source must be inhouse, slant or default' });
    return send(res, 200, setPrintSource(dir, v));
  }

  return { wrapPriceFor, wrapQuote, printSource, setPrintSource, handle, sellAssembled, NOT_ORDERABLE, attach: (d) => { sourcing = d.sourcing || sourcing; }, keyOf, _dist: dist };
}

module.exports = { init, leadDays, sellAssembled, NOT_ORDERABLE };
