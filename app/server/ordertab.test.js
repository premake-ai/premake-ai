// node --test server/ordertab.test.js   the Order tab's where-to-buy helpers (web/ordertab.js), with browser globals stubbed
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

Object.assign(globalThis, {
  location: { hostname: 'localhost', href: 'http://localhost/', search: '', pathname: '/' }, window: globalThis,
  localStorage: { getItem: () => null, setItem() {} },
  document: { cookie: '', addEventListener() {}, createElement: () => ({}), head: { appendChild() {} } },
});
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'web', 'ordertab.js')).href);

// /api/sourcing lines, shaped like server/sourcing.js builds them
const P = (o) => ({ 1: o, 10: o * 0.9, 100: o * 0.5, 500: o * 0.4 });
const printed = { id: 'printed:0', type: 'printed', name: 'Body', qty_per_unit: 1,
  downloads: [{ label: 'STL', href: '/files/projects/x/stl/body.stl' }],
  options: [
    { service: 'Slant 3D', kind: 'live', url: 'https://www.slant3d.com/', prices: P(4), lead: { 1: '1–3 days', 10: '1–3 days', 100: '7–11 days', 500: '15–19 days' }, setup: { 1: 5, 10: 5, 100: 5, 500: 5 }, note: 'Share of the whole-set quote; setup fee is per order' },
    { service: 'Premake print', kind: 'estimate', source: 'Premake', compare: true, prices: P(0.5) },
    { service: 'Craftcloud', kind: 'link', url: 'https://craftcloud3d.com/upload', upload: 'STL', note: 'Upload to compare 150+ print shops' },
  ] };
const plate = { id: 'fab:0', type: 'fabricated', process: 'laser', name: 'Plate', qty_per_unit: 2,
  downloads: [{ label: 'STL', href: '/files/projects/x/stl/plate.stl' }, { label: 'DXF', href: '/api/sourcing?project=x&dxf=stl%2Fplate.stl' }],
  options: [
    { service: 'Premake shop model', kind: 'estimate', source: 'Premake', prices: P(6.5) },
    { service: 'SendCutSend', kind: 'link', url: 'https://app.sendcutsend.com/customer#/quote?action=builder', upload: 'DXF outline', note: 'Check their material list for this stock' },
  ] };
const rail = { id: 'fab:1', type: 'fabricated', process: 'extrusion', name: 'Rail', qty_per_unit: 1, downloads: [],
  options: [
    { service: 'RMFG', kind: 'live', url: 'https://www.rmfg.com/quote/sheet', upload: 'STEP', prices: {} },
    { service: 'MATERIAM', kind: 'link', url: 'https://materiam.com/', upload: 'STEP', note: 'Live quote unavailable (MATERIAM upload_part: {"error":"Too many uploads"})' },
    { service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/s?k=2040', note: 'Prime' },
  ] };
const screw = { id: 'bought:0', type: 'bought', name: 'M5 screw', qty_per_unit: 10, supplier: 'Amazon', estimate: { unit_usd: 0.1 }, downloads: [],
  options: [{ service: 'McMaster', kind: 'link', url: 'https://www.mcmaster.com/' }, { service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/s?k=m5', note: 'Prime only' }] };
const motor = { id: 'bought:1', type: 'bought', name: 'Motor', qty_per_unit: 1, supplier: 'Amazon', estimate: { unit_usd: 11 }, downloads: [],
  options: [{ service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/s?k=motor' },
    { service: 'StepperOnline', kind: 'listed', url: 'https://www.omc-stepperonline.com/', prices: P(9), fetched_at: 1 }] };

test('price break: the biggest priced quantity not above the build count', async () => {
  const { tierFor } = await load();
  assert.deepEqual([1, 5, 9, 10, 99, 100, 499, 500, 2000].map((n) => tierFor(n)), [1, 1, 1, 10, 10, 100, 100, 500, 500]);
});

test('buy options: our own cost models are never a place to buy; cheapest real price first', async () => {
  const { buyOptions } = await load();
  const o = buyOptions(printed, 1);
  assert.deepEqual(o.map((x) => x.service), ['Slant 3D', 'Craftcloud'], 'Premake print is gone');
  assert.equal(o[0].kind, 'live'); assert.equal(o[0].usd, 4); assert.equal(o[0].lead, '1–3 days'); assert.equal(o[0].setup, 5);
  assert.equal(o[0].note, '', 'the whole-set note is dropped');
  assert.equal(o[1].kind, 'quote'); assert.equal(o[1].upload, 'STL');
  // at 10 builds: the 10-piece price break, times 10
  assert.equal(buyOptions(printed, 10)[0].usd, 36);
  // the cut plate only had our shop model: it rides on SendCutSend as "about" (2 per build x 6.50), our model never shows
  const p = buyOptions(plate, 1);
  assert.deepEqual(p.map((x) => [x.service, x.usd, x.kind]), [['SendCutSend', 13, 'estimate']]);
  // a real price anywhere wins: our model is not added
  const live = { ...plate, options: [...plate.options, { service: 'RMFG', kind: 'live', url: 'https://www.rmfg.com/', upload: 'STEP', prices: P(5) }] };
  assert.deepEqual(buyOptions(live, 1).map((x) => [x.service, x.usd, x.kind]), [['RMFG', 10, 'live'], ['SendCutSend', null, 'quote']]);
});

test('buy options: bought parts put Amazon first, carrying the parts-list estimate, even over a cheaper listed price', async () => {
  const { buyOptions } = await load();
  const m = buyOptions(motor, 1);
  assert.deepEqual(m.map((x) => [x.service, x.usd, x.kind]), [['Amazon', 11, 'estimate'], ['StepperOnline', 9, 'live']]);
  // the estimate goes on Amazon even when the parts list named another shop
  const other = { ...motor, supplier: 'StepperOnline', options: [{ service: 'StepperOnline', kind: 'link', url: 'https://www.omc-stepperonline.com/' }, { service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/s?k=motor' }] };
  assert.deepEqual(buyOptions(other, 1).map((x) => [x.service, x.usd]), [['Amazon', 11], ['StepperOnline', null]]);
  // printed parts are not Amazon-biased
  assert.equal(buyOptions(printed, 1)[0].amz, false);
  const s = buyOptions(screw, 2);
  assert.deepEqual(s.map((x) => [x.service, x.usd, x.kind]), [['Amazon', 2, 'estimate'], ['McMaster', null, 'quote']], '20 screws at about $0.10, on Amazon (the listed supplier)');
  assert.equal(s[0].need, 20);
});

test('buy options: an empty live quote and raw API errors read as plain words', async () => {
  const { buyOptions, cleanNote } = await load();
  const r = buyOptions(rail, 1);
  assert.deepEqual(r.map((x) => [x.service, x.kind]), [['Amazon', 'quote'], ['RMFG', 'quote'], ['MATERIAM', 'quote']], 'extrusion is a bought part: Amazon first');
  assert.equal(r[2].note, 'No live price right now');
  // a $0 "live" price is a failed quote: shown as Get quote, never counted
  const zero = { ...rail, options: [{ service: 'MATERIAM', kind: 'live', url: 'https://materiam.com/', upload: 'STEP', prices: { 1: 0 } }] };
  assert.deepEqual(buyOptions(zero, 1).map((x) => [x.kind, x.usd]), [['quote', null]]);
  assert.equal(cleanNote('x'.repeat(120)).length, 88);
});

test('estimate: cheapest per part, setup fee once per shop, unpriced parts counted', async () => {
  const { estimateTotal } = await load();
  const t = estimateTotal([printed, plate, rail, screw, motor], 1);
  // Slant 4 + setup 5, plate about 13 (our model on SendCutSend), screws 10 x 0.1 = 1, motor 11 (Amazon estimate); rail has no price
  assert.equal(t.usd, 34); assert.equal(t.live, 9); assert.equal(t.estimate, 25); assert.equal(t.setup, 5); assert.equal(t.unpriced, 1);
  const t10 = estimateTotal([printed, motor], 10);
  assert.equal(t10.usd, 36 + 5 + 110); assert.equal(t10.each, 15.1);
});

test('files: the download sits next to the shops that need it', async () => {
  const { filesFor, buyOptions } = await load();
  assert.deepEqual(filesFor(printed, buyOptions(printed, 1)).map((f) => [f.label, f.for]), [['STL', 'Slant 3D or Craftcloud']]);
  assert.deepEqual(filesFor(plate, buyOptions(plate, 1)).map((f) => [f.label, f.for]), [['STL', ''], ['DXF', 'SendCutSend']]);
  assert.deepEqual(filesFor({ type: 'bought', downloads: [{ label: 'STEP', href: 'javascript:alert(1)' }] }, []), [], 'unsafe links dropped');
});

test('sections: extrusion sits with bought parts; no separate extrusion section', async () => {
  const { groupOf, GROUPS } = await load();
  assert.deepEqual([printed, plate, rail, screw].map(groupOf), ['printed', 'metal', 'bought', 'bought']);
  assert.deepEqual(GROUPS.map((g) => g.k), ['printed', 'metal', 'bought']);
});

// ---------------------------------------------------------------- Amazon basket (web/amazon.js)
const amz = () => import(pathToFileURL(path.join(__dirname, '..', 'web', 'amazon.js')).href);

test('amazon: ASIN only from exact amazon.com product links', async () => {
  const { asinOf } = await amz();
  assert.equal(asinOf('https://www.amazon.com/dp/B07PGL2ZSL'), 'B07PGL2ZSL');
  assert.equal(asinOf('https://www.amazon.com/Some-Name/dp/b07pgl2zsl/ref=sr_1_3?th=1'), 'B07PGL2ZSL');
  assert.equal(asinOf('https://amazon.com/gp/product/B000FN6MZC?psc=1'), 'B000FN6MZC');
  assert.equal(asinOf('https://www.amazon.com/gp/aw/d/B01N0ZNG2V'), 'B01N0ZNG2V');
  for (const u of ['https://www.amazon.com/s?k=608ZZ+bearing', 'https://amzn.to/3abcDEF', 'https://www.amazon.co.uk/dp/B07PGL2ZSL',
    'https://evil.com/amazon.com/dp/B07PGL2ZSL', 'https://www.amazon.com/dp/B07PGL2ZS', 'https://www.amazon.com/dp/B07PGL2ZSLX', '', null]) assert.equal(asinOf(u), '', String(u));
});

test('amazon: basket URL merges ASINs, scales by build count, leaves a hook for an Associates tag', async () => {
  const { amazonBasket, amazonCartUrls, lineAsin, AMAZON_TAG, CART_URL } = await amz();
  assert.equal(AMAZON_TAG, '', 'no tag yet');
  const bearing = { name: '608ZZ', qty_per_unit: 2, options: [{ service: 'Amazon', url: 'https://www.amazon.com/dp/B07PGL2ZSL' }] };
  const bearing2 = { name: '608ZZ again', qty_per_unit: 1, options: [{ service: 'Amazon', url: 'https://www.amazon.com/x/dp/B07PGL2ZSL/' }] };
  const ref = { name: 'Fan', qty_per_unit: 1, ref_url: 'https://www.amazon.com/dp/B0000FAN01', options: [{ service: 'Amazon', url: 'https://www.amazon.com/s?k=fan' }] };
  const own = { name: 'Board', asin: 'b0board123', options: [] };
  const b = amazonBasket([bearing, bearing2, ref, screw, own, { name: 'Lamp', options: [{ service: 'IKEA', url: 'https://www.ikea.com/' }] }], 3);
  assert.equal(lineAsin(ref), 'B0000FAN01');
  assert.deepEqual(b.basket.map((x) => [x.asin, x.qty]), [['B07PGL2ZSL', 6], ['B07PGL2ZSL', 3], ['B0000FAN01', 3], ['B0BOARD123', 3]]);
  assert.deepEqual(b.search.map((x) => [x.line.name, x.qty]), [['M5 screw', 30]], 'no exact product: an Amazon search; IKEA line is in neither');
  assert.deepEqual(b.urls, [`${CART_URL}?ASIN.1=B07PGL2ZSL&Quantity.1=9&ASIN.2=B0000FAN01&Quantity.2=3&ASIN.3=B0BOARD123&Quantity.3=3`]);
  assert.match(amazonCartUrls([{ asin: 'B07PGL2ZSL', qty: 1 }], { tag: 'premake-20' })[0], /&AssociateTag=premake-20$/);
  const many = Array.from({ length: 51 }, (_, i) => ({ asin: 'B' + String(i).padStart(9, '0'), qty: 1 }));
  assert.equal(amazonCartUrls(many).length, 2, 'over 50: a second basket link');
  assert.deepEqual(amazonCartUrls([]), []);
});

test('sourcing: extrusion is Amazon pre-cut first with an estimate, then Misumi / OpenBuilds; no metal shops', () => {
  const { fabServices } = require('./sourcing');
  const o = fabServices({ process: 'extrusion', params: { profile: '2040', length_mm: 290, tapped_ends: 2 } });
  assert.deepEqual(o.map((x) => x.service), ['Amazon', 'Misumi', 'OpenBuilds']);
  assert.equal(o[0].kind, 'estimate'); assert.ok(o[0].prices[1] > 0 && o[0].prices[500] === o[0].prices[1]);
  assert.match(o[0].note, /300 mm pre-cut, cut to 290 mm/);
});

// ---------------------------------------------------------------- Buy group (top of the tab) and the cut-part steps
const amzBolt = { id: 'bought:2', type: 'bought', name: 'Bolt', qty_per_unit: 4, estimate: { unit_usd: 0.5 }, downloads: [],
  options: [{ service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/dp/B07PGL2ZSL' }] };
const plateB = { id: 'fab:2', type: 'fabricated', process: 'sheet', name: 'Side plate', qty_per_unit: 1,
  downloads: [{ label: 'STL', href: '/files/projects/x/stl/side.stl' }, { label: 'STEP', href: '/files/projects/x/step/side.step' }],
  options: [{ service: 'RMFG', kind: 'live', url: 'https://www.rmfg.com/quote/sheet', upload: 'STEP', prices: P(3) },
    { service: 'SendCutSend', kind: 'estimate', url: 'https://app.sendcutsend.com/customer#/quote?action=builder', upload: 'DXF', prices: P(9) }] };

test('buy group: Slant set, cheaper live metal shop before SendCutSend, Amazon basket and search', async () => {
  const { buyGroup, cutSet, cutFileList, printedSet } = await load();
  assert.deepEqual(printedSet([printed], 1), { usd: 9, pending: false, url: 'https://www.slant3d.com/', lead: '1–3 days', setup: 5 });
  const src = { printed_zip: '/api/sourcing?project=x&zip=printed', cut_zip: '/api/sourcing?project=x&zip=cut' };
  // plate (SCS about 13, no live) + plateB (RMFG 3 live, SCS 9): no live shop covers both, SendCutSend about 22
  let c = cutSet([plate, plateB], 1);
  assert.deepEqual([c.scs.usd, c.scs.kind, c.live], [22, 'estimate', null]);
  const rows = buyGroup([printed, plate, plateB, screw, amzBolt], 1, undefined, src);
  assert.deepEqual(rows.map((r) => [r.shop, r.title, r.usd]), [
    ['Slant 3D', 'Slant 3D · all 1 printed part', 9],
    ['SendCutSend', 'SendCutSend · 2 cut parts', 22],
    ['Amazon', 'Amazon · add 1 part to basket', 2],
    ['Amazon', 'Amazon · find 1 more part', 1],
  ]);
  assert.equal(rows[0].files.href, src.printed_zip); assert.ok(rows[1].steps); assert.equal(rows[1].files.label, 'Download 2 files');
  assert.match(rows[1].url, /^https:\/\/app\.sendcutsend\.com\//, 'the quote page, not the homepage');
  assert.equal(rows[3].find, 1); assert.match(rows[2].url, /cart\/add\.html\?ASIN\.1=B07PGL2ZSL&Quantity\.1=4/);
  // only plateB: RMFG live 3 covers every cut part and beats SendCutSend 9, so it comes first, with the STEP zip
  c = cutSet([plateB], 1);
  assert.deepEqual(c.live, { service: 'RMFG', usd: 3, url: 'https://www.rmfg.com/quote/sheet' });
  const r2 = buyGroup([plateB], 1, undefined, src);
  assert.deepEqual(r2.map((r) => [r.shop, r.usd, r.kind]), [['RMFG', 3, 'live'], ['SendCutSend', 9, 'estimate']]);
  assert.equal(r2[0].files.href, src.cut_zip + '&want=step');
  // each cut part's own file: DXF when there is one, else STEP
  assert.deepEqual(cutFileList([plate, plateB]).map((f) => [f.name, f.label]), [['Plate', 'DXF'], ['Side plate', 'STEP']]);
  assert.deepEqual(buyGroup([], 1), []);
});

test('sourcing: live metal options from the quoting service; MATERIAM hidden; SendCutSend estimate on its link', () => {
  const { metalOptionsFrom, withEstimate, fabServices, HIDDEN_SHOPS, SCS_QUOTE, NONMETAL_RE } = require('./sourcing');
  assert.ok(HIDDEN_SHOPS.has('MATERIAM'));
  const o = (supplier, qty, unit, extra = {}) => ({ part_id: 'prt_1', qty, supplier, unit_usd: unit, live: true, notes: [], ...extra });
  const entry = { at: 1, status: 'complete', offers: [o('RMFG', 1, 30, { ships_by: '2026-11-10', notes: ['5052 aluminium 3 mm'] }), o('RMFG', 10, 12),
    o('MATERIAM', 1, 20), o('Justway', 1, 50, { via: 'AFN', notes: ['machined from aluminum 6061', 'unfinished (no anodize)'] }), o('PCBWay', 1, 44, { via: 'AFN' }),
    o('SendCutSend', 1, 39, { live: false }), o('Local shop', 1, 80, { live: false, via: 'Premake estimate' })], pending: [], errors: [] };
  const { opts, scs } = metalOptionsFrom(entry, false);
  assert.deepEqual(opts.map((x) => [x.service, x.kind, x.prices?.[1]]), [['RMFG', 'live', 30], ['AFN · CNC', 'live', 44]], 'MATERIAM hidden');
  assert.match(opts[0].note, /5052 aluminium 3 mm · ships by 2026-11-10/);
  assert.match(opts[1].note, /Cheapest of Justway, PCBWay/);
  assert.deepEqual(scs, { 1: 39 });
  // nothing back yet: quoting rows; a failed quote: links with the reason
  assert.deepEqual(metalOptionsFrom(null, true).opts.map((x) => [x.service, x.kind]), [['RMFG', 'pending'], ['AFN · CNC', 'pending']]);
  assert.deepEqual(metalOptionsFrom({ at: 1, error: 'limit', limited: true }, false).opts.map((x) => x.kind), ['link', 'link']);
  assert.deepEqual(metalOptionsFrom({ ...entry, offers: [], pending: ['AFN network'], status: 'pending' }, true).opts.map((x) => [x.service, x.kind]), [['AFN · CNC', 'pending']]);
  const sv = withEstimate(fabServices({ process: 'laser', params: { material: 'aluminium' } }), scs);
  assert.deepEqual(sv.map((x) => [x.service, x.kind, x.url]), [['SendCutSend', 'estimate', SCS_QUOTE], ['OSHCut', 'link', 'https://app.oshcut.com/']]);
  assert.ok(NONMETAL_RE.test('phenolic') && NONMETAL_RE.test('G10') && !NONMETAL_RE.test('aluminium 5052'), 'phenolic panels are not metal');
});

test('premake-api client: when a cached answer is still good (no new quote spent)', () => {
  const { fresh } = require('./prices/premakeapi');
  const now = 1e13, min = 60e3;
  assert.equal(fresh(null, now), false);
  assert.equal(fresh({ at: now - 6 * 864e5, status: 'complete' }, now), true, 'answers kept 7 days');
  assert.equal(fresh({ at: now - 8 * 864e5, status: 'complete' }, now), false);
  assert.equal(fresh({ at: now - 11 * min, error: 'x' }, now), false, 'failures retried after 10 min');
  assert.equal(fresh({ at: now - 30 * min, error: 'limit', limited: true }, now), true, 'a limit answer waits an hour');
  assert.equal(fresh({ at: now - 6 * min, error: 'down', unreachable: true }, now), false, 'unreachable: retried after 5 min');
});
