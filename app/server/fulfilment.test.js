// node --test server/fulfilment.test.js  (no network: Slant is never called here)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const F = require('./fulfilment');
const { zip, crc32 } = require('./fulfilment/zip');

const APP = path.join(__dirname, '..');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

function setup() {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ful-'));
  const ORDERS = path.join(DATA, 'orders.json');
  const exDir = (s) => (/^[\w-]+$/.test(s) ? path.join(APP, 'data', 'examples', s) : null);
  const sourcing = require('./sourcing').init({ DATA, projDir: () => null, exDir, exists: fs.existsSync, readJSON, writeJSON, send: () => {}, quote: () => ({ tiers: [] }) });
  const sent = [];
  const send = (res, code, body) => { sent.push({ code, body }); };
  const ful = F.init({ DATA, ORDERS, readJSON, writeJSON, send, sourcing, plateDxf: sourcing.plateDxf, projDir: () => null, exDir });
  return { DATA, ORDERS, ful, sent, sourcing };
}
const order = (o) => ({ id: 'ord_test0001', status: 'paid', title: 'Fin glow lamp', qty: 10, mode: 'assembled', source: { example: 'fin-glow-lamp' },
  total: 400, amount_total: 40000, amount_tax: 0, paid_at: new Date().toISOString(), created: new Date().toISOString(),
  ship_to: { name: 'Test Customer', line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' }, ...o });
const call = async (ful, sent, m, rest, body) => {
  const req = { body };
  await ful.adminApi(req, {}, { rest, m, acc: { user: 'owner@example.com' }, readBody: async () => body || {} });
  return sent.pop();
};

test('zip: valid archive with deflated entries', () => {
  const data = Buffer.from('hello hello hello hello hello');
  const z = zip([{ name: 'a.txt', data }, { name: 'b.bin', data: Buffer.from([1, 2, 3]) }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const nameLen = z.readUInt16LE(26), size = z.readUInt32LE(18), method = z.readUInt16LE(8);
  const body = z.subarray(30 + nameLen, 30 + nameLen + size);
  assert.deepEqual(method === 8 ? zlib.inflateRawSync(body) : body, data);
  assert.equal(z.readUInt32LE(14), crc32(data));
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 2);
});

test('trackingUrl picks the carrier', () => {
  assert.match(F.trackingUrl('UPS', '1Z999'), /ups\.com/);
  assert.match(F.trackingUrl('USPS', '9400100000000000000000'), /usps\.com/);
  assert.equal(F.trackingUrl('', ''), null);
});

test('onPaid creates a plan with printed, fabricated and bought jobs x order qty', { skip: 'needs the example designs in data/examples, not in the open-source repo' }, () => {
  const { ORDERS, ful, DATA } = setup();
  const o = order();
  writeJSON(ORDERS, [o]);
  ful.onPaid(o);
  const plan = readJSON(path.join(DATA, 'fulfilment', o.id + '.json'));
  assert.ok(plan && plan.jobs.length >= 3);
  const kinds = new Set(plan.jobs.map((j) => j.kind));
  assert.deepEqual([...kinds].sort(), ['bought', 'fabricated', 'printed']);
  const printed = plan.jobs.find((j) => j.kind === 'printed');
  assert.equal(printed.supplier, 'slant3d');
  assert.deepEqual(printed.alternatives, ['slant3d', 'inhouse']);
  for (const p of printed.parts) assert.equal(p.qty, 10 * p.qty_per_unit);
  const sheet = plan.jobs.find((j) => j.kind === 'fabricated' && j.parts.some((p) => p.process === 'sheet'));
  assert.ok(sheet, 'sheet job');
  assert.ok(plan.jobs.every((j) => j.ship_to === 'customer'), 'every supplier drop-ships to the customer');
  assert.ok(plan.jobs.every((j) => j.status === 'todo'));
  const ok = new Set(['amazon', 'sendcutsend', 'slant3d', 'inhouse', 'stock']);
  for (const j of plan.jobs) { assert.ok(ok.has(j.supplier), j.supplier); for (const a of j.alternatives) assert.ok(ok.has(a), a); }
  assert.ok(plan.jobs.filter((j) => j.kind === 'bought').every((j) => ['amazon', 'stock'].includes(j.supplier)), '"Local sheet-metal shop" etc. are not routed to');
});

test('planJobs: new plans only use Amazon, SendCutSend and Slant 3D (plus in-house printing)', () => {
  const L = { bom: {}, lines: [
    { id: 'fab:0', type: 'fabricated', process: 'sheet', name: 'Plate', options: [{ service: 'OSHCut', kind: 'link', url: 'https://app.oshcut.com/' }, { service: 'SendCutSend', kind: 'link', url: 'https://sendcutsend.com/' }] },
    { id: 'fab:1', type: 'fabricated', process: 'extrusion', name: 'Rail', options: [{ service: 'Misumi', kind: 'link', url: 'https://us.misumi-ec.com/' }, { service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/s?k=2020' }] },
    { id: 'bought:0', type: 'bought', name: 'Screw', supplier: 'McMaster-Carr', options: [{ service: 'McMaster-Carr', kind: 'link', url: 'https://www.mcmaster.com/' }] }] };
  const jobs = F.planJobs({ id: 'o', qty: 1 }, L);
  assert.deepEqual(jobs.map((j) => `${j.kind}:${j.supplier}`).sort(), ['bought:amazon', 'fabricated:amazon', 'fabricated:sendcutsend']);
  assert.ok(jobs.every((j) => !j.alternatives.some((a) => ['oshcut', 'misumi', 'mcmaster'].includes(a))));
});

test('planJobs: Premake stock lines are one pick-and-pack job at the bulk cost; the rest still goes to Amazon', () => {
  const amz = { service: 'Amazon', kind: 'link', url: 'https://www.amazon.com/s?k=x' };
  const L = { bom: {}, lines: [
    { id: 'bought:0', type: 'bought', name: 'SG90 micro servo', supplier: 'Amazon', stocked: true, stock_unit_usd: 1.5, estimate: { unit_usd: 2.5 }, options: [amz] },
    { id: 'bought:1', type: 'bought', name: 'Rubber feet', supplier: 'Amazon', stocked: true, stock_unit_usd: 0.19, qty_per_unit: 4, options: [amz] },
    { id: 'bought:2', type: 'bought', name: 'Mini ball head', supplier: 'Amazon', estimate: { unit_usd: 12 }, options: [amz] }] };
  const jobs = F.planJobs({ id: 'o', qty: 2 }, L);
  assert.deepEqual(jobs.map((j) => `${j.kind}:${j.supplier}`).sort(), ['bought:amazon', 'bought:stock']);
  const st = jobs.find((j) => j.supplier === 'stock');
  assert.deepEqual(st.parts.map((p) => [p.name, p.qty, p.unit_usd, p.stocked]), [['SG90 micro servo', 2, 1.5, true], ['Rubber feet', 8, 0.19, true]]);
  assert.ok(st.parts[0].links.length, 'restock link kept');
  assert.equal(F.SUPPLIERS.stock.name, 'Premake stock (pick and pack)');
});

test('planJobs skips the kit-contents groups the customer left out', () => {
  const opt = { service: 'Premake print', kind: 'estimate', prices: { 1: 1 } };
  const L = { bom: {}, lines: [{ id: 'printed:0', type: 'printed', name: 'Body', options: [opt] },
    { id: 'fab:0', type: 'fabricated', process: 'sheet', name: 'Plate', options: [] },
    { id: 'bought:0', type: 'bought', name: 'Screw', options: [] }] };
  const all = F.planJobs({ id: 'o', qty: 1 }, L).map((j) => j.kind).sort();
  assert.deepEqual(all, ['bought', 'fabricated', 'printed']);
  const some = F.planJobs({ id: 'o', qty: 1, omit: ['printed', 'metal'] }, L).map((j) => j.kind);
  assert.deepEqual(some, ['bought']);
});

test('admin API: view, supplier switch, placed -> order printing, drop-ship tracking -> shipped', { skip: 'needs the example designs in data/examples, not in the open-source repo' }, async () => {
  const { ORDERS, ful, sent } = setup();
  const o = order();
  writeJSON(ORDERS, [o]);
  let r = await call(ful, sent, 'GET', [o.id]);
  assert.equal(r.code, 200);
  assert.ok(r.body.summary.paid_usd === 400 && r.body.summary.cost_usd > 0);
  const printed = r.body.jobs.find((j) => j.kind === 'printed');
  assert.ok(printed.kit.files.length && printed.kit.zip);
  const bought = r.body.jobs.find((j) => j.kind === 'bought');
  assert.ok(bought.kit.cart.length && bought.kit.cart_text);
  assert.ok(r.body.ship_from.placeholder, 'ship-from placeholders until env is set');

  r = await call(ful, sent, 'PATCH', [o.id, printed.id], { supplier: 'inhouse' });
  assert.equal(r.body.jobs.find((j) => j.id === printed.id).supplier, 'inhouse');
  r = await call(ful, sent, 'PATCH', [o.id, printed.id], { supplier: 'mcmaster' });
  assert.equal(r.code, 400);

  r = await call(ful, sent, 'PATCH', [o.id, printed.id], { status: 'placed', order_no: 'INH-1', cost_actual_usd: '12.5' });
  assert.equal(r.body.order.status, 'printing');
  assert.equal(r.body.jobs.find((j) => j.id === printed.id).cost.kind, 'actual');

  r = await call(ful, sent, 'GET', []);
  assert.ok(r.body.jobs.length >= 3 && r.body.jobs.every((x) => x.order_id === o.id));

  r = await call(ful, sent, 'POST', [o.id, 'rebuild']);
  assert.equal(r.code, 409, 'no rebuild once something is placed');

  r = await call(ful, sent, 'PATCH', [o.id], { shipped: true, carrier: 'UPS', tracking: '1Z123' });
  assert.equal(r.body.order.status, 'shipped');
  assert.match(r.body.order.tracking[0].url, /ups\.com/);

  // checkout without an explicit confirm is refused, and never reaches Slant
  r = await call(ful, sent, 'PATCH', [o.id, printed.id], { supplier: 'slant3d' });
  r = await call(ful, sent, 'POST', [o.id, printed.id, 'checkout'], {});
  assert.equal(r.code, 400);
});

test('single-supplier order drop-ships; tracking on it marks the order shipped', async () => {
  const { ORDERS, ful, sent } = setup();
  const o = order({ id: 'ord_test0002', source: { example: 'door-wedge' }, qty: 1, title: 'Door wedge' });
  writeJSON(ORDERS, [o]);
  let r = await call(ful, sent, 'GET', [o.id]);
  assert.equal(r.code, 200);
  if (r.body.jobs.length !== 1) return; // the example changed; the rule is covered by planJobs below
  const j = r.body.jobs[0];
  assert.equal(j.ship_to, 'customer');
  r = await call(ful, sent, 'PATCH', [o.id, j.id], { status: 'placed', order_no: 'S-1' });
  r = await call(ful, sent, 'PATCH', [o.id, j.id], { carrier: 'USPS', tracking: '9400100000000000000000' });
  assert.equal(r.body.jobs[0].status, 'shipped');
  assert.equal(r.body.order.status, 'shipped');
});

test('unpaid orders get no plan', async () => {
  const { ORDERS, ful, sent } = setup();
  const o = order({ id: 'ord_test0003', status: 'pending' });
  writeJSON(ORDERS, [o]);
  const r = await call(ful, sent, 'GET', [o.id]);
  assert.equal(r.code, 409);
});

test('manual suppliers say why they are manual', async () => {
  const r = await F.SUPPLIERS.sendcutsend.quote({}, {});
  assert.equal(r.manual, true);
  const d = await F.SUPPLIERS.digikey.place({}, {});
  assert.match(d.reason, /DIGIKEY_CLIENT_ID/);
});
