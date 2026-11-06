// node --test server/prices.test.js   price sources for the main quote (server/prices): no network, fake distributors
'use strict';
if (process.env.STOCK_SMALL_PARTS == null) process.env.STOCK_SMALL_PARTS = '1'; // stocking is off by default in the open-source app; these tests cover it
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const match = require('./prices/match');
const list = require('./prices/list');
const D = require('./prices/distributors');
const prices = require('./prices');
const sup = require('./prices/suppliers');
const cfg = require('./prices/config');

const near = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---------------------------------------------------------------- classification
test('fastener lines parse into components; mixed or non-metric lines do not', () => {
  assert.deepEqual(match.parseFasteners('M5x10 button head screw + drop-in T-nut'), [{ kind: 'bhcs', d: 5, length: 10 }, { kind: 'tnut', d: 5 }]);
  assert.deepEqual(match.parseFasteners('M3×10 socket head screw'), [{ kind: 'shcs', d: 3, length: 10 }]);
  assert.deepEqual(match.parseFasteners('M5x25 screw + nylock (idler axle)'), [{ kind: 'shcs', d: 5, length: 25 }, { kind: 'nylock', d: 5 }]);
  assert.deepEqual(match.parseFasteners('M3 socket screws assorted (8-20 mm) + nuts'), [{ kind: 'shcs', d: 3, length: 14 }, { kind: 'nut', d: 3 }]);
  assert.deepEqual(match.parseFasteners('M5 wing nut'), [{ kind: 'wing_nut', d: 5 }]);
  assert.equal(match.parseFasteners('MGN12H linear rail 500 mm'), null);
  assert.equal(match.parseFasteners('NEMA17 stepper motor 40 mm'), null);
});

test('routes: library boards by MPN, steppers/LEDs/converters to distributors, the rest stays an estimate', () => {
  assert.equal(match.classify({ name: 'ESP32 DevKitC (WROOM-32, 38 pin)' }).want.mpn, 'ESP32-DEVKITC-32E');
  assert.equal(match.classify({ name: '5 mm LED (red)' }).want.mpn, 'WP7113ID');
  assert.equal(match.classify({ name: 'NEMA17 stepper motor 40 mm' }).route, 'distributor');
  assert.equal(match.classify({ name: 'LM2596 buck converter' }).route, 'distributor');
  assert.equal(match.classify({ name: 'M3×10 socket head screw' }).route, 'list');
  assert.equal(match.classify({ name: 'Rubber feet 20 mm' }).route, 'list');
  assert.equal(match.classify({ name: 'MGN12H linear rail 500 mm with block' }).route, 'estimate');
  assert.equal(match.classify({ name: '625ZZ bearing' }).route, 'estimate');
});

// ---------------------------------------------------------------- list prices
test('list prices: quantity breaks, pack sizes, next-longer screw, hex bolt falls back to socket head', () => {
  const real = list.table();
  list._set({ checked: '2026-10-29', fasteners: [
    { kind: 'shcs', d: 3, length: 10, price_usd: 0.1, pack_size: 1, breaks: [{ qty: 1, unit_usd: 0.1 }, { qty: 100, unit_usd: 0.05 }], supplier: 'A', url: 'u', checked: '2026-10-29' },
    { kind: 'shcs', d: 5, length: 70, price_usd: 0.75, pack_size: 1, supplier: 'A', url: 'u' },
    { kind: 'nut', d: 3, price_usd: 5, pack_size: 100, supplier: 'B', url: 'v' },
  ], extrusion: [
    { profile: '2020', per_mm_usd: 0.01, cut_fee_usd: 3, supplier: 'R', url: 'x' },
    { profile: '2020', length_mm: 6000, price_usd: 60, supplier: 'R', url: 'y' },
  ] });
  try {
    near(list.priceFasteners([{ kind: 'shcs', d: 3, length: 10 }], 1).unit_usd, 0.1);
    near(list.priceFasteners([{ kind: 'shcs', d: 3, length: 10 }], 250).unit_usd, 0.05);
    near(list.priceFasteners([{ kind: 'nut', d: 3 }], 1).unit_usd, 0.05); // pack of 100 at $5
    const sub = list.priceFasteners([{ kind: 'shcs', d: 3, length: 8 }], 1);
    assert.match(sub.rows[0].substitute, /10 mm for 8 mm/);
    assert.equal(list.priceFasteners([{ kind: 'shcs', d: 3, length: 30 }], 1), null, 'never a much shorter screw');
    assert.match(list.priceFasteners([{ kind: 'hex_bolt', d: 5, length: 70 }], 1).rows[0].substitute, /socket head/);
    assert.equal(list.priceFasteners([{ kind: 'shcs', d: 3, length: 10 }, { kind: 'washer', d: 3 }], 1), null, 'all components or nothing');
    // extrusion: cheapest of per-mm + cut fee vs share of a stick + in-house cut
    const e = list.priceExtrusion('2020', 300, 0);
    near(e.usd, 300 / 6000 * 60 + require('./pricing_fab').constants.EXTRUSION_CUT_USD);
    assert.match(e.how, /stick, cut in-house/);
  } finally { list._set(real); }
});

test('the shipped list table has real rows with url + date for common sizes', () => {
  const t = JSON.parse(fs.readFileSync(list.FILE, 'utf8'));
  for (const r of [...t.fasteners, ...t.extrusion]) { assert.match(r.url, /^https:\/\//); assert.match(r.checked, /^2026-\d\d-\d\d$/); }
  for (const d of [3, 4, 5]) assert.ok(list.findFastener({ kind: 'shcs', d, length: 10 }), `M${d}x10`);
  assert.ok(list.priceExtrusion('2020', 296, 0));
});

// ---------------------------------------------------------------- distributors
const dkProduct = { ManufacturerProductNumber: 'ESP32-DEVKITC-32E', Manufacturer: { Name: 'Espressif' }, Description: { ProductDescription: 'ESP32 dev board' },
  ProductUrl: 'https://www.digikey.com/x', QuantityAvailable: 500, ManufacturerLeadWeeks: '8',
  ProductVariations: [{ DigiKeyProductNumber: '1965-ESP32-DEVKITC-32E-ND', PackageType: { Name: 'Box' }, MinimumOrderQuantity: 1, QuantityAvailableforPackageType: 500,
    StandardPricing: [{ BreakQuantity: 1, UnitPrice: 10 }, { BreakQuantity: 10, UnitPrice: 9 }] }] };
const mouserPart = { MouserPartNumber: '356-ESP32DEVKTC32E', ManufacturerPartNumber: 'ESP32-DEVKITC-32E', Manufacturer: 'Espressif', Description: 'ESP32 board',
  ProductDetailUrl: 'https://www.mouser.com/x', AvailabilityInStock: '20', Min: '1', LeadTime: '56 Days',
  PriceBreaks: [{ Quantity: 1, Price: '$9.50', Currency: 'USD' }, { Quantity: 25, Price: '$8.75', Currency: 'USD' }] };

test('distributor responses normalise to price breaks, stock, lead time', () => {
  const d = D.fromDigikeyProduct(dkProduct);
  assert.equal(d.sku, '1965-ESP32-DEVKITC-32E-ND'); assert.equal(d.stock, 500); assert.equal(d.lead_days, 56);
  const m = D.fromMouserPart(mouserPart);
  assert.deepEqual(m.breaks, [{ qty: 1, unit_usd: 9.5 }, { qty: 25, unit_usd: 8.75 }]); assert.equal(m.stock, 20); assert.equal(m.lead_days, 56);
  assert.equal(D.unitAt(m.breaks, 30).unit_usd, 8.75);
  assert.equal(D.unitAt([{ qty: 10, unit_usd: 1 }], 3).buy_qty, 10, 'below the MOQ you buy the MOQ');
  assert.equal(D.matches({ ...m, description: 'Arduino', mpn: 'X' }, { must: 'ESP32' }), false);
  assert.equal(D.matches({ ...m, breaks: [{ qty: 1, unit_usd: 400 }] }, { must: 'ESP32', max_usd: 30 }), false);
});

test('distributor cache: not configured without keys; pending then live with keys; cheapest stocked offer wins', async () => {
  const keys = ['DIGIKEY_CLIENT_ID', 'DIGIKEY_CLIENT_SECRET', 'MOUSER_SEARCH_API_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  try {
    for (const k of keys) delete process.env[k];
    const calls = [];
    const fetchImpl = async (url, opt) => {
      calls.push(String(url));
      const j = (o) => ({ ok: true, status: 200, json: async () => o });
      if (/oauth2\/token/.test(url)) { assert.match(String(opt.body), /grant_type=client_credentials/); return j({ access_token: 't', expires_in: 599 }); }
      if (/digikey.*keyword/.test(url)) { assert.equal(opt.headers.Authorization, 'Bearer t'); return j({ Products: [dkProduct] }); }
      if (/mouser/.test(url)) { assert.match(String(url), /apiKey=mk/); return j({ Errors: [], SearchResults: { Parts: [mouserPart] } }); }
      throw new Error('unexpected ' + url);
    };
    const c = D.create({ cacheFile: path.join(tmp, 'd.json'), fetchImpl, log: () => {} });
    const want = { mpn: 'ESP32-DEVKITC-32E', keyword: 'ESP32-DEVKITC-32E', must: 'ESP32' };
    assert.equal(c.get(want, 1).status, 'not_configured');
    assert.equal(calls.length, 0);
    Object.assign(process.env, { DIGIKEY_CLIENT_ID: 'id', DIGIKEY_CLIENT_SECRET: 'sec', MOUSER_SEARCH_API_KEY: 'mk' });
    assert.equal(c.get(want, 1).status, 'pending'); // never blocks: answers now, fetches in the background
    await new Promise((r) => setImmediate(r));
    await c._pump();
    for (let i = 0; i < 50 && c._queue.length; i++) await new Promise((r) => setTimeout(r, 50));
    while (c._queue.length) await c._pump();
    const one = c.get(want, 1);
    assert.equal(one.status, 'live');
    assert.equal(one.offer.distributor, 'Mouser'); // $9.50 beats $10 and has stock
    const many = c.get(want, 50);
    assert.equal(many.offer.distributor, 'DigiKey', 'Mouser has only 20 in stock, DigiKey 500');
    near(many.price.unit_usd, 9);
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- the quote engine
const BULK = { 1: 1, 10: 0.9, 100: 0.75, 500: 0.6 };
const tierOf = (q) => [500, 100, 10, 1].find((t) => q >= t) || 1;
function base(bom, q, mode) { // same shape as server.js priceFor
  const unit = { parts: 0, material: 0, printing: 0, assembly: mode === 'assembled' ? 10 : 1, packaging: 2, margin: 0, handling: q === 1 ? 15 : 0 };
  const unit_price = 3 + unit.handling;
  return { qty: q, unit, unit_price, subtotal: unit_price * q, shipping: 9, total: unit_price * q + 9, lead_time_days: 1 };
}
function engine(tmp, slant, order = () => ({ status: 'none' })) {
  const PROJECTS = path.join(tmp, 'projects'), EXAMPLES = path.join(tmp, 'examples');
  fs.mkdirSync(path.join(PROJECTS, 'p1'), { recursive: true });
  const readJSON = (p, f = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return f; } };
  const P = prices.init({ DATA: tmp, PROJECTS, EXAMPLES, BULK, MARGIN: 0.35, tierOf, MATERIAL_PER_G: 0.025, PRINT_PER_H: 0.4, PRINTERS: 50, PRINTER_HOURS_PER_DAY: 20,
    readJSON, writeJSON: (p, v) => fs.writeFileSync(p, JSON.stringify(v)), fetchImpl: async () => { throw new Error('no network in tests'); } });
  P.attach({ sourcing: { slantState: () => slant(), slantOrder: (d, k, q) => order(q) } });
  return { P, dir: path.join(PROJECTS, 'p1'), priceFor: P.wrapPriceFor(base) };
}
const bom = { printed: [{ name: 'Body', file: 'a.stl', grams: 100, print_hours: 4 }],
  parts: [{ name: 'M3×10 socket head screw', qty_per_unit: 4, unit_cost_usd: 0.09 }, { name: 'MGN12H rail', qty_per_unit: 1, unit_cost_usd: 17 }],
  assembly_minutes: 30 };

const sumC = (ls) => ls.reduce((a, l) => a + Math.round(l.order_usd * 100), 0);
test('at cost: the total is exactly the lines (parts per pack bought, each supplier box’s shipping, the card fee), no margin', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PRINT_SOURCE; });
  delete process.env.SELL_ASSEMBLED; process.env.PRINT_SOURCE = 'inhouse';
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }));
  for (const q of [1, 7, 37]) {
    const r = priceFor(bom, q, 'assembled', dir);
    assert.equal(r.mode, 'kit'); assert.equal(r.at_cost, true); assert.equal(r.qty, q);
    assert.equal(r.unit.margin, undefined); assert.equal(r.unit.handling, undefined); assert.equal(r.sources.margin, undefined);
    assert.equal(r.goods_cents, sumC(r.lines), 'goods = the lines');
    assert.equal(r.shipping_cents, r.boxes.reduce((a, b) => a + Math.round(b.usd * 100), 0), 'shipping = each box');
    assert.equal(r.total_cents, r.goods_cents + r.shipping_cents + r.card_fee_cents);
    const base = r.goods_cents + r.shipping_cents; // the fee covers Stripe's 2.9% + 30c of the whole charge
    assert.ok(r.total_cents - Math.round(r.total_cents * 0.029) - 30 >= base && r.card_fee_cents < base * 0.03 + 32, `fee ${r.card_fee_cents}`);
    near(r.total, r.total_cents / 100, 0.001);
  }
  const r = priceFor(bom, 1, 'kit', dir);
  const rail = r.lines.find((l) => /MGN/.test(l.name));
  assert.equal(rail.order_usd, 17); assert.equal(rail.box, 'Amazon'); assert.equal(rail.source.kind, 'estimate');
  const screw = r.lines.find((l) => /M3/.test(l.name));
  assert.equal(screw.box, 'Premake', 'shelf stock rides in the NYC print box when we print in-house');
  assert.equal(r.lead_time_days, 5, 'the slowest box: the rail from Amazon; no assembly day for kits');
  for (const l of r.lines) assert.ok(['live', 'list', 'estimate'].includes(l.source.kind), l.name);
  assert.deepEqual(Object.keys(r.groups), ['printed', 'bought']);
  near(r.groups.printed.cost, r.unit.material + r.unit.printing);
});

test('bought parts are priced per pack actually bought, with the cheapest pack size', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PRINT_SOURCE; });
  process.env.PRINT_SOURCE = 'slant';
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }), () => ({ status: 'failed', error: 'x' }));
  // "stock": false on a line: ships straight from the shop (not Premake stock), so the shop's pack sizes apply
  const b = { printed: [], parts: [{ name: '#10 x 2-1/2 in wood screw', qty_per_unit: 3, unit_cost_usd: 0.22, stock: false }, { name: 'ESP32 board', qty_per_unit: 1, unit_cost_usd: 6, stock: false }] };
  const r1 = priceFor(b, 1, 'kit', dir);
  const s1 = r1.lines.find((l) => /screw/.test(l.name));
  assert.equal(s1.buy, '1 pack of 25'); assert.equal(s1.order_usd, 5.99);
  assert.equal(r1.lines.find((l) => /ESP32/.test(l.name)).order_usd, 6);
  const s50 = priceFor(b, 50, 'kit', dir).lines.find((l) => /screw/.test(l.name)); // 150 screws
  assert.equal(s50.buy, '2 packs of 100'); assert.equal(s50.order_usd, 2 * Math.min(Math.max(0.22 * 100, 7.99), 15.98));
});

test('ships tomorrow only when everything is in-house and in stock', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PRINT_SOURCE; });
  process.env.PRINT_SOURCE = 'inhouse'; // the admin override: our own printers
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }));
  const onShelf = { ...bom, parts: [bom.parts[0]] };
  assert.equal(priceFor(onShelf, 1, 'kit', dir).lead_time_days, 1);
  assert.ok(priceFor(onShelf, 100, 'kit', dir).lead_time_days > 1, 'a 100-unit batch queues on the farm');
  assert.ok(priceFor(bom, 1, 'kit', dir).lead_time_days > 1);
});

test('SELL_ASSEMBLED on: assembled mode charges labour and adds bench days', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.SELL_ASSEMBLED; });
  process.env.SELL_ASSEMBLED = '1';
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }));
  const r = priceFor(bom, 100, 'assembled', dir);
  assert.equal(r.mode, 'assembled');
  assert.ok(r.lead.assembly_days >= 1);
  assert.equal(r.lead_time_days, r.lead.supply_days + r.lead.assembly_days);
});

test('print source: live Slant 3D by default, admin override per design, live / quoting / unreachable', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PRINT_SOURCE; });
  delete process.env.PRINT_SOURCE;
  let order = { status: 'quoting' };
  const { P, priceFor, dir } = engine(tmp, () => ({ status: 'none' }), () => order);
  assert.equal(P.printSource(dir).source, 'slant');
  process.env.PRINT_SOURCE = 'inhouse';
  assert.equal(P.printSource(dir).source, 'inhouse');
  delete process.env.PRINT_SOURCE;
  // quoting: an estimate for now, flagged so the Order tab polls (and checkout waits)
  let r = priceFor(bom, 10, 'kit', dir);
  assert.equal(r.refreshing, true); assert.match(r.sources.print_service.why, /Getting Slant/);
  // live: Slant's exact subtotal for this quantity (setup included) and its own shipping line
  order = { status: 'live', fetched_at: 123, material: 'PETG', subtotal_usd: 61.5, setup_usd: 0, ship_usd: 9.4, ship_service: 'UPS Ground', lead_time: '3–7 days', ship_days: 4 };
  r = priceFor(bom, 3, 'kit', dir);
  assert.equal(r.refreshing, false);
  const printed = r.lines.filter((l) => l.type === 'printed');
  assert.equal(sumC(printed), 6150); assert.ok(printed.every((l) => l.box === 'Slant 3D' && l.source.kind === 'live'));
  const sb = r.boxes.find((b) => b.shop === 'Slant 3D');
  assert.equal(sb.usd, 9.4); assert.equal(sb.live, true);
  assert.equal(r.lead_time_days, 7 + 4);
  assert.equal(r.unit.material, 0); assert.equal(r.unit.printing, 0);
  // a setup fee is its own line, once per order
  order = { ...order, subtotal_usd: 200, setup_usd: 150 };
  r = priceFor(bom, 100, 'kit', dir);
  assert.equal(r.lines.find((l) => l.fee).order_usd, 150);
  assert.equal(sumC(r.lines.filter((l) => l.type === 'printed')), 20000);
  // unreachable: still a Slant 3D box, priced with our print cost model, and the reason
  order = { status: 'failed', error: 'Slant 3D 503' };
  r = priceFor(bom, 1, 'kit', dir);
  assert.equal(r.sources.print_service.kind, 'estimate'); assert.match(r.sources.print_service.why, /can’t quote this \(Slant 3D 503\)/);
  assert.ok(r.lines.filter((l) => l.type === 'printed').every((l) => l.box === 'Slant 3D'));
  // per-design admin override beats the default; "default" clears it
  assert.equal(P.setPrintSource(dir, 'inhouse').source, 'inhouse');
  assert.ok(priceFor(bom, 1, 'kit', dir).sources.printing.why.startsWith('In-house'));
  assert.equal(P.setPrintSource(dir, 'default').source, 'slant');
  assert.equal(priceFor(bom, 1, 'kit', dir, { force_print: 'inhouse' }).unit.print_service, undefined);
});

test('soldering iron add-on: offered when the design needs soldering, one per order, at cost, kept when bought parts are left out', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }), () => ({ status: 'failed', error: 'x' }));
  assert.equal(priceFor(bom, 1, 'kit', dir).addons.solder.needed, false);
  assert.equal(priceFor({ ...bom, needs_soldering: true }, 1, 'kit', dir).addons.solder.needed, true);
  const wired = { ...bom, parts: [...bom.parts, { name: 'Pogo pin', qty_per_unit: 4, unit_cost_usd: 0.3, notes: 'solder the leads to the board' }] };
  const off = priceFor(wired, 2, 'kit', dir), on = priceFor(wired, 2, 'kit', dir, { addons: ['solder'] });
  assert.equal(off.addons.solder.needed, true); assert.equal(off.addons.solder.on, false);
  const iron = on.lines.find((l) => l.addon === 'solder');
  assert.equal(iron.order_usd, cfg.SOLDER_KIT.usd); assert.equal(iron.box, 'Amazon'); assert.equal(iron.type, 'bought');
  assert.equal(on.goods_cents - off.goods_cents, Math.round(cfg.SOLDER_KIT.usd * 100));
  const noBought = priceFor(wired, 2, 'kit', dir, { omit: ['bought'], addons: ['solder'] });
  assert.ok(noBought.lines.some((l) => l.addon) && noBought.goods_cents === sumC(noBought.lines.filter((l) => l.addon || l.type !== 'bought')));
  assert.equal(priceFor(bom, 1, 'kit', dir, { addons: ['solder'] }).lines.some((l) => l.addon), false, 'not offered, not added');
});

test('quote: kit_ok:false designs are not orderable while only kits are sold', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  delete process.env.SELL_ASSEMBLED;
  const { P, priceFor, dir } = engine(tmp, () => ({ status: 'none' }));
  const quote = P.wrapQuote((b, mode, d) => ({ mode, tiers: [1, 10].map((q) => priceFor(b, q, mode, d)), notes: ['Estimate only. x'] }));
  const q = quote({ ...bom, kit_ok: false }, 'assembled', dir);
  assert.equal(q.mode, 'kit'); assert.equal(q.orderable, false); assert.match(q.not_orderable, /needs assembly/);
  assert.equal(q.sell_assembled, false);
  assert.ok(!q.notes.some((n) => /^Estimate only/.test(n)));
  assert.equal(quote(bom, 'kit', dir).orderable, true);
});

test('lead-time text parses to the upper bound', () => {
  assert.equal(prices.leadDays('43–47 days'), 47);
  assert.equal(prices.leadDays('1-3 days'), 3);
  assert.equal(prices.leadDays('2 weeks'), 14);
  assert.equal(prices.leadDays(''), null);
});

// ---------------------------------------------------------------- three suppliers: Amazon, SendCutSend, Slant 3D
test('normalise on read: other shops become Amazon with a Prime search link, the original kept as supplier_note', () => {
  delete process.env.ALLOWED_SUPPLIERS;
  const b = sup.normalizeBom({ parts: [
    { name: 'M4 acorn (cap) nut', supplier: 'McMaster / hardware store' },
    { name: 'Wood screw #8 x 1-1/2" pan head', supplier: 'Home Depot / Amazon', url: 'https://www.homedepot.com/p/123' },
    { name: 'Fan', supplier: 'Amazon / Micro Center', url: 'https://www.amazon.com/s?k=arctic+p12' },
    { name: 'Filter', supplier: 'Amazon', url: 'https://www.amazon.com/dp/B07VVK39F7' },
    { name: 'Bracket', supplier: 'SendCutSend' },
    { name: 'Glue', notes: 'search "titebond 2 4 oz"' },
  ] });
  const [nut, screw, fan, filter, bracket, glue] = b.parts;
  assert.equal(nut.supplier, 'Amazon'); assert.equal(nut.supplier_note, 'McMaster / hardware store');
  assert.equal(nut.url, 'https://www.amazon.com/s?k=M4+acorn+nut&rh=p_85%3A2470955011');
  assert.equal(screw.supplier, 'Amazon'); assert.equal(screw.ref_url, 'https://www.homedepot.com/p/123'); assert.match(screw.url, /^https:\/\/www\.amazon\.com\/s\?k=Wood\+screw/);
  assert.equal(fan.url, 'https://www.amazon.com/s?k=arctic+p12&rh=p_85%3A2470955011', 'Prime filter added to an Amazon search');
  assert.equal(filter.url, 'https://www.amazon.com/dp/B07VVK39F7'); assert.equal(filter.supplier_note, undefined);
  assert.ok(sup.isAmazonProduct(filter.url) && !sup.isAmazonProduct(fan.url));
  assert.equal(bracket.supplier, 'SendCutSend'); assert.equal(bracket.url, undefined);
  assert.match(glue.url, /k=titebond\+2\+4\+oz/);
  assert.deepEqual(sup.normalizeBom(b), b, 'idempotent');
  assert.equal(sup.amazonSearchUrl('M3 x 10 socket head'), 'https://www.amazon.com/s?k=M3+x+10+socket+head&rh=p_85%3A2470955011', 'same as cadlib search_url');
  assert.deepEqual(cfg.ALLOWED_SUPPLIERS, ['Amazon', 'SendCutSend', 'Slant 3D', 'RMFG', 'AFN', 'MATERIAM']); // rmfg + afn + materiam: live metal quotes
});

test('stocking off: quote lines are on three shops only: Amazon (bought + pre-cut extrusion), SendCutSend (laser), Slant 3D (print)', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PRINT_SOURCE; delete process.env.STOCK_SMALL_PARTS; });
  delete process.env.ALLOWED_SUPPLIERS; process.env.PRINT_SOURCE = 'slant'; process.env.STOCK_SMALL_PARTS = '0';
  const slant = { status: 'live', fetched_at: 1, material: 'PETG', color: '', parts: {}, byIndex: [null],
    set: Object.fromEntries([1, 10, 100, 500].map((q) => [q, { unit_usd: 10, setup_usd: 0, lead_time: '1–3 days' }])) };
  const { priceFor, dir } = engine(tmp, () => slant, () => ({ status: 'live', subtotal_usd: 10, setup_usd: 0, ship_usd: 7, lead_time: '1–3 days', fetched_at: 1 }));
  const b = { printed: [{ name: 'Body', file: 'a.stl', grams: 50, print_hours: 2 }],
    parts: [{ name: 'M3×10 socket head screw', qty_per_unit: 4, unit_cost_usd: 0.1, supplier: 'Albany County Fasteners' },
      { name: 'NEMA17 stepper motor 40 mm', qty_per_unit: 1, unit_cost_usd: 12, supplier: 'StepperOnline', url: 'https://www.amazon.com/dp/B00PNEQKC0' },
      { name: '625ZZ bearing', qty_per_unit: 2, unit_cost_usd: 1, supplier: 'Hardware store' }],
    fabricated: [{ name: 'Rail', process: 'extrusion', params: { profile: '2020', length_mm: 480, tapped_ends: 0 }, bbox: [480, 20, 20] },
      { name: 'Rail 2', process: 'extrusion', params: { profile: '2040', length_mm: 600, tapped_ends: 2 }, bbox: [600, 40, 20] },
      { name: 'Panel', process: 'laser', params: { material: 'plywood', thickness_mm: 6 }, est: { area_cm2: 200 }, bbox: [200, 100, 6] }] };
  const r = priceFor(b, 1, 'kit', dir);
  assert.deepEqual([...new Set(r.lines.map((l) => l.shop))].sort(), ['Amazon', 'SendCutSend', 'Slant 3D']);
  const by = (re) => r.lines.find((l) => re.test(l.name));
  assert.equal(by(/M3/).source.kind, 'estimate'); assert.equal(by(/M3/).in_stock, undefined, 'stocking off: no NYC shelf');
  assert.equal(by(/M3/).lead_days, cfg.LEAD.amazon, 'Amazon search link: the estimate lead');
  assert.equal(by(/NEMA/).source.kind, 'estimate', 'no DigiKey / Mouser');
  assert.equal(by(/NEMA/).lead_days, cfg.LEAD.amazon_prime, 'a real Amazon product link: Prime lead');
  const rail = by(/^Rail$/), rail2 = by(/Rail 2/);
  assert.equal(rail.shop, 'Amazon'); assert.match(rail.detail, /500 mm pre-cut, cut to 480 mm/); assert.equal(rail.cut_by_hand, true);
  assert.match(rail2.detail, /2040, 600 mm pre-cut, tap 2 ends/); assert.equal(rail2.cut_by_hand, false);
  assert.equal(by(/Panel/).shop, 'SendCutSend');
  assert.ok(r.lines.filter((l) => l.type === 'printed').every((l) => l.shop === 'Slant 3D'));
});

// ---------------------------------------------------------------- Premake stock (config.STOCK, stock.js)
test('stock: small electronics and hardware are stocked; bulky, hazmat, specialty and dear lines ship from the shop', () => {
  const stock = require('./prices/stock');
  const is = (name, usd = 1, extra = {}) => stock.classify({ name, unit_cost_usd: usd, ...extra }).stocked;
  for (const n of ['Rubber feet', 'SG90 micro servo', '0.96" OLED display (SSD1306)', 'M3×10 self-tapping screw for plastic', 'M3 heat-set insert',
    '470 uF 10 V electrolytic capacitor', 'Dupont jumper wires 10-20 cm', 'ESP32 DevKitC (WROOM-32, 38 pin)', 'NEMA17 stepper motor 40 mm',
    'Double-sided foam tape', '625ZZ bearing', 'M5x10 button head + M5 drop-in T-nut (tripod bracket)', 'GT2 6 mm belt (5 m roll)',
    '12 V 2 A power adapter, 5.5x2.1, UL listed', 'Wall screw #8 x 1-1/4in + anchor', 'Zip ties 100 mm']) assert.ok(is(n), n);
  for (const n of ['2040 V-slot extrusion 600 mm', '3 mm plywood sheet 600×400', 'MGN12H linear rail 500 mm with block', '18650 Li-ion cell',
    '24 V 10 A power adapter, UL listed', 'Heated bed 220 mm round 24 V', 'Mini ball head, 1/4"-20', 'Delta carbon arms 300 mm', 'Steel rod 8 mm × 400 mm']) assert.ok(!is(n), n);
  assert.ok(!is('32-bit mainboard with 4x TMC2209', 40), 'over max_unit_usd: a specialty part ordered per kit');
  assert.ok(!is('SG90 micro servo', 2.5, { stock: false }) && !is('SG90 micro servo', 2.5, { ship_direct: true }), 'per-line override: ship direct');
  assert.ok(is('Mini ball head', 12, { stock: true }), 'per-line override: stocked');
  assert.equal(stock.classify({ name: 'SG90 micro servo', unit_cost_usd: 2.5 }).cat, 'electronics');
  assert.equal(stock.classify({ name: 'M3 nylock nut', unit_cost_usd: 0.1 }).cat, 'hardware');
});

test('stock: bulk per-piece cost, never a whole pack (own pack, catalog, typical pack, bulk factor)', () => {
  const stock = require('./prices/stock');
  near(stock.bulkUnit({ name: 'Bumpers', unit_cost_usd: 0.5, pack_qty: 24, pack_usd: 6.99 }).unit_usd, 0.2913, 0.001); // 24 for $6.99 -> $0.29 each
  near(stock.bulkUnit({ name: 'Magnets (pack of 50)', unit_cost_usd: 9.99 }).unit_usd, 0.1998, 0.001);
  near(stock.bulkUnit({ name: '470 uF capacitor', unit_cost_usd: 0.1 }).unit_usd, 5.99 / 50, 0.001); // typical pack of 50
  const servo = stock.bulkUnit({ name: 'SG90 micro servo', unit_cost_usd: 2.5 }, 'electronics');
  near(servo.unit_usd, 2.5 * cfg.STOCK.bulk_factor.electronics); assert.equal(servo.basis, 'factor');
  near(stock.bulkUnit({ name: 'GT2 pulley 20T', unit_cost_usd: 1.5 }, 'hardware').unit_usd, 1.5 * cfg.STOCK.bulk_factor.hardware);
  assert.equal(stock.bulkUnit({ name: 'M3×10 socket head screw', unit_cost_usd: 0.1 }).basis, 'catalog');
  assert.deepEqual(cfg.STOCK.bulk_factor, { electronics: 0.6, hardware: 0.5 });
});

test('stock: printed + stocked parts are one Premake box, per piece, in stock; extrusion still ships from Amazon', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.PRINT_SOURCE; });
  delete process.env.ALLOWED_SUPPLIERS; delete process.env.STOCK_SMALL_PARTS; process.env.PRINT_SOURCE = 'inhouse';
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }));
  const b = { printed: [{ name: 'Body', file: 'a.stl', grams: 60, print_hours: 3 }],
    parts: [{ name: 'Rubber feet', qty_per_unit: 4, unit_cost_usd: 0.06, pack_qty: 24, pack_usd: 6.99, url: 'https://www.amazon.com/s?k=rubber+feet' },
      { name: 'SG90 micro servo', qty_per_unit: 1, unit_cost_usd: 2.5 }, { name: 'M3×10 socket head screw', qty_per_unit: 4, unit_cost_usd: 0.09 }] };
  const r = priceFor(b, 1, 'kit', dir);
  assert.deepEqual(r.boxes.map((x) => x.shop), ['Premake'], 'one box from NYC');
  assert.equal(r.lead_time_days, 1, 'everything in-house and in stock: ships tomorrow');
  const feet = r.lines.find((l) => /feet/.test(l.name));
  assert.equal(feet.box, 'Premake'); assert.equal(feet.stocked, true); assert.equal(feet.buy, '4'); assert.equal(feet.pack_qty, 1);
  assert.equal(feet.order_usd, 1.17, '4 × $0.29, not the $6.99 bag'); assert.equal(feet.lead_days, cfg.LEAD.in_stock);
  assert.match(feet.source.url, /amazon\.com\/s\?k=rubber\+feet/, 'where we buy it stays on the line');
  assert.equal(r.goods_cents, sumC(r.lines));
  // 50 kits: still per piece (200 feet = 200 × the bulk piece price)
  near(priceFor(b, 50, 'kit', dir).lines.find((l) => /feet/.test(l.name)).order_usd, 200 * 6.99 / 24, 0.01);
  // a design with extrusion and a ball head: those two ship from Amazon, the rest is still one Premake box
  const big = { ...b, parts: [...b.parts, { name: 'Mini ball head, 1/4"-20', qty_per_unit: 1, unit_cost_usd: 12 }],
    fabricated: [{ name: 'Rail', process: 'extrusion', params: { profile: '2020', length_mm: 300, tapped_ends: 0 }, bbox: [300, 20, 20] }] };
  const rb = priceFor(big, 1, 'kit', dir);
  assert.deepEqual(rb.boxes.map((x) => x.shop).sort(), ['Amazon', 'Premake']);
  assert.equal(rb.lines.find((l) => /ball head/.test(l.name)).box, 'Amazon');
  assert.equal(rb.lines.find((l) => l.name === 'Rail').box, 'Amazon');
  // Slant prints: the stocked parts still come in a Premake box
  process.env.PRINT_SOURCE = 'slant';
  const rs = engine(fs.mkdtempSync(path.join(tmp, 's-')), () => ({ status: 'none' }), () => ({ status: 'failed', error: 'x' }));
  assert.deepEqual(rs.priceFor(b, 1, 'kit', rs.dir).boxes.map((x) => x.shop).sort(), ['Premake', 'Slant 3D']);
});

test('ALLOWED_SUPPLIERS widens the list: that shop’s list prices come back', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
  t.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.ALLOWED_SUPPLIERS; });
  process.env.ALLOWED_SUPPLIERS = 'Amazon,SendCutSend,Slant 3D,Albany County Fasteners';
  const { priceFor, dir } = engine(tmp, () => ({ status: 'none' }));
  const r = priceFor({ parts: [{ name: 'M3×10 socket head screw', qty_per_unit: 4, unit_cost_usd: 0.1, supplier: 'Albany County Fasteners', stock: false }] }, 1, 'kit', dir);
  assert.equal(r.lines[0].source.kind, 'list'); assert.equal(r.lines[0].shop, 'Albany County Fasteners');
});
