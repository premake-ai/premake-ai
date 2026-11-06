// node --test server/payments.test.js   (no real Stripe: a local fake Stripe API + generated secrets)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const P = require('./payments');

const SECRET = 'whsec_' + crypto.randomBytes(24).toString('hex');

// ---------------------------------------------------------------- signature verification
test('webhook signature: valid, tampered, wrong secret, stale, multiple v1', () => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }));
  const now = 1_800_000_000;
  const h = P.signPayload(body, SECRET, now);
  assert.equal(P.verifyWebhook(body, h, SECRET, now).id, 'evt_1');
  assert.equal(P.verifyWebhook(body, h, SECRET, now + 299).id, 'evt_1', 'inside the 5-minute tolerance');
  assert.throws(() => P.verifyWebhook(body, h, SECRET, now + 301), /tolerance/);
  assert.throws(() => P.verifyWebhook(body, h, SECRET, now - 301), /tolerance/);
  const tampered = Buffer.from(body.toString().replace('cs_1', 'cs_2'));
  assert.throws(() => P.verifyWebhook(tampered, h, SECRET, now), /mismatch/);
  assert.throws(() => P.verifyWebhook(body, h, 'whsec_other', now), /mismatch/);
  assert.throws(() => P.verifyWebhook(body, '', SECRET, now), /missing/);
  assert.throws(() => P.verifyWebhook(body, 'garbage', SECRET, now), /malformed/);
  assert.throws(() => P.verifyWebhook(body, `t=${now},v1=zz`, SECRET, now), /mismatch/);
  assert.throws(() => P.verifyWebhook(body, h, '', now), /not configured/);
  // Stripe sends several v1 signatures while a secret is being rolled: any match is enough
  const good = h.split('v1=')[1];
  assert.equal(P.verifyWebhook(body, `t=${now},v1=${'0'.repeat(64)},v1=${good},v0=abc`, SECRET, now).id, 'evt_1');
  // raw bytes matter: re-serialised JSON with different spacing must fail
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(body), null, 1));
  assert.throws(() => P.verifyWebhook(reserialised, h, SECRET, now), /mismatch/);
});

// ---------------------------------------------------------------- server-side pricing
test('checkout pricing comes from the server quote, in cents, any whole quantity from 1 to 500', () => {
  const calls = [];
  const priceFor = (bom, q, mode) => { calls.push([q, mode]); return { unit_price: 12.34, subtotal: Math.round(12.34 * q * 100) / 100, shipping: 9, total: Math.round((12.34 * q + 9) * 100) / 100, lead_time_days: 3 }; };
  const bom = { printed: [{ name: 'a', grams: 10, print_hours: 1 }] };
  const p = P.checkoutPrice(priceFor, bom, 10, 'kit');
  assert.deepEqual(calls, [[10, 'kit']]);
  assert.equal(p.subtotal_cents, 12340);
  assert.equal(p.shipping_cents, 900);
  assert.equal(p.total_cents, 13240);
  assert.equal(p.lead_time_days, 3);
  for (const q of [0, 1.5, -1, '10x', null]) assert.throws(() => P.checkoutPrice(priceFor, bom, q, 'kit'), /qty/);
  assert.throws(() => P.checkoutPrice(priceFor, bom, 501, 'kit'), /quote you/);
  assert.equal(P.checkoutPrice(priceFor, bom, 37, 'kit').qty, 37);
  assert.throws(() => P.checkoutPrice(priceFor, bom, 1, 'kit', null, [], ['gold']), /addons/);
  assert.equal(P.checkoutPrice(priceFor, bom, '100', 'kit').qty, 100);
  assert.throws(() => P.checkoutPrice(priceFor, bom, 1, 'gold'), /mode/);
  assert.throws(() => P.checkoutPrice(priceFor, { ...bom, kit_ok: false }, 1, 'kit'), /needs assembly/);
  assert.throws(() => P.checkoutPrice(priceFor, {}, 1, 'kit'), /No quote/);
  // SELL_ASSEMBLED off (default): kits only; on: assembled is offered again
  const prev = process.env.SELL_ASSEMBLED;
  delete process.env.SELL_ASSEMBLED;
  assert.throws(() => P.checkoutPrice(priceFor, bom, 10, 'assembled'), /Only kits/);
  process.env.SELL_ASSEMBLED = '1';
  assert.equal(P.checkoutPrice(priceFor, bom, 10, 'assembled').mode, 'assembled');
  if (prev === undefined) delete process.env.SELL_ASSEMBLED; else process.env.SELL_ASSEMBLED = prev;
  assert.notEqual(P.quoteHash('example:a', p), P.quoteHash('example:b', p));
});

test('at-cost checkout charges exactly the Order tab total (goods + each supplier’s shipping + card fee), add-ons passed through', () => {
  const seen = [];
  const priceFor = (bom, q, mode, dir, opts) => { seen.push(opts); return { at_cost: true, qty: q, unit_price: 24.8, goods: 40.84, shipping: 7.01, card_fee: 1.74, total: 49.59,
    goods_cents: 4084, shipping_cents: 701, card_fee_cents: 174, total_cents: 4959, lead_time_days: 8, groups: { printed: {}, bought: {} },
    addons: { solder: { needed: true, on: !!opts?.addons?.includes('solder') } } }; };
  const bom = { printed: [{ name: 'a', grams: 10, print_hours: 1 }] };
  const p = P.checkoutPrice(priceFor, bom, 2, 'kit', null, ['bought'], ['solder']);
  assert.deepEqual(seen[0], { omit: ['bought'], addons: ['solder'] });
  assert.equal(p.total_cents, 4959); assert.equal(p.subtotal_cents + p.shipping_cents + p.card_fee_cents, p.total_cents);
  assert.deepEqual(p.addons, ['solder']); assert.deepEqual(p.omit, ['bought']);
  assert.notEqual(P.quoteHash('example:a', p), P.quoteHash('example:a', { ...p, addons: [] }));
  assert.throws(() => P.checkoutPrice(() => ({ at_cost: true, refreshing: true, groups: {} }), bom, 1, 'kit'), /live supplier prices/);
});

test('checkout can leave kit-contents groups out: their price comes off, lead is the slowest line left', () => {
  const priceFor = () => ({ unit_price: 100, subtotal: 1000, shipping: 25, total: 1025, lead_time_days: 10,
    groups: { printed: { lines: 1, cost: 10, off: 13.5 }, metal: { lines: 1, cost: 20, off: 27 }, bought: { lines: 1, cost: 5, off: 6.75 } },
    lines: [{ type: 'printed', lead_days: 2 }, { type: 'fabricated', process: 'sheet', lead_days: 10 }, { type: 'bought', lead_days: 5 }] });
  const bom = { printed: [{ name: 'a', grams: 10, print_hours: 1 }] };
  const full = P.checkoutPrice(priceFor, bom, 10, 'kit');
  assert.deepEqual(full.omit, []);
  assert.equal(full.total_cents, 102500);
  const p = P.checkoutPrice(priceFor, bom, 10, 'kit', null, ['metal', 'extrusion']); // extrusion isn't in this design: ignored
  assert.deepEqual(p.omit, ['metal']);
  assert.equal(p.unit_price, 73);
  assert.equal(p.subtotal_cents, 73000);
  assert.equal(p.total_cents, 75500);
  assert.equal(p.lead_time_days, 5);
  assert.notEqual(P.quoteHash('example:a', p), P.quoteHash('example:a', full));
  assert.throws(() => P.checkoutPrice(priceFor, bom, 10, 'kit', null, ['gold']), /omit can only/);
  assert.throws(() => P.checkoutPrice(priceFor, bom, 10, 'kit', null, 'metal'), /list/);
  assert.throws(() => P.checkoutPrice(priceFor, bom, 10, 'kit', null, ['printed', 'metal', 'bought']), /Nothing left/);
  assert.equal(P.kitGroupOf({ type: 'fabricated', process: 'extrusion' }), 'extrusion');
});

test('form encoding matches Stripe bracket syntax', () => {
  const s = P.formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { unit_amount: 500 } }], a: { b: ['US'] }, skip: undefined }).toString();
  assert.equal(decodeURIComponent(s), 'mode=payment&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=500&a[b][0]=US');
});

// ---------------------------------------------------------------- end to end: real server.js + fake Stripe
function listen(srv) { return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port))); }
async function waitUp(port) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

test('checkout session → redirect URL → signed webhook → paid (idempotent)', { skip: 'needs the example designs in data/examples, not in the open-source repo' }, async (t) => {
  const seen = [];
  let sessionState = null;
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], body: new URLSearchParams(b) });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        const f = new URLSearchParams(b);
        sessionState = { id: 'cs_test_fake1', object: 'checkout.session', url: `http://127.0.0.1:${fakePort}/pay/cs_test_fake1`, livemode: false,
          payment_status: 'unpaid', metadata: { order_id: f.get('metadata[order_id]') }, client_reference_id: f.get('client_reference_id') };
        return res.end(JSON.stringify(sessionState));
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/checkout/sessions/')) return res.end(JSON.stringify(sessionState));
      res.statusCode = 404; res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'nope' } }));
    });
  });
  const fakePort = await listen(fake);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-pay-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gw = crypto.randomBytes(16).toString('hex');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: tmp,
    STRIPE_SECRET_KEY: 'sk_test_fake_' + crypto.randomBytes(8).toString('hex'), STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_API_BASE: `http://127.0.0.1:${fakePort}`, FORMA_GATEWAY_SECRET: gw, FORMA_PUBLIC_URL: 'https://gw.example.test' };
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  t.after(() => { srv.kill(); fake.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await waitUp(port);
  const base = `http://127.0.0.1:${port}`;
  const asUser = (email) => ({ 'Content-Type': 'application/json', 'X-Forma-Gateway': gw, 'X-Forma-User': email });

  const cfg = await (await fetch(`${base}/api/checkout/config`)).json();
  assert.equal(cfg.enabled, true); assert.equal(cfg.test, true);

  // the expected price, from the same quote endpoint the Order tab uses
  const q = await (await fetch(`${base}/api/quote?example=bike-hook&mode=kit`)).json();
  const tier = q.tiers.find((x) => x.qty === 10);

  // client-sent prices are ignored
  const r = await fetch(`${base}/api/checkout`, { method: 'POST', headers: asUser('buyer@example.com'),
    body: JSON.stringify({ source: { example: 'bike-hook' }, qty: 10, mode: 'kit', total: 0.01, unit_price: 0.01 }) });
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out) + log);
  assert.equal(out.url, `http://127.0.0.1:${fakePort}/pay/cs_test_fake1`);
  const sent = seen.find((x) => x.url === '/v1/checkout/sessions').body;
  const call = seen.find((x) => x.url === '/v1/checkout/sessions');
  assert.match(call.auth, /^Bearer sk_test_fake_/);
  assert.equal(call.idem, 'forma-' + out.order_id);
  assert.equal(sent.get('mode'), 'payment');
  assert.equal(Number(sent.get('line_items[0][price_data][unit_amount]')), Math.round(tier.subtotal * 100));
  assert.equal(Number(sent.get('line_items[1][price_data][unit_amount]')), Math.round(tier.shipping * 100));
  assert.match(sent.get('line_items[0][price_data][product_data][name]'), /10 units · kit/);
  assert.equal(sent.get('shipping_address_collection[allowed_countries][0]'), 'US');
  assert.equal(sent.get('customer_email'), 'buyer@example.com');
  assert.equal(sent.get('metadata[order_id]'), out.order_id);
  assert.equal(sent.get('metadata[source]'), 'example:bike-hook');
  assert.equal(sent.get('metadata[user]'), 'buyer@example.com');
  assert.match(sent.get('metadata[quote_hash]'), /^[0-9a-f]{16}$/);
  assert.equal(sent.get('success_url'), 'https://gw.example.test/orders/success?session_id={CHECKOUT_SESSION_ID}');
  assert.equal(sent.get('cancel_url'), 'https://gw.example.test/examples/bike-hook');
  assert.equal(sent.get('automatic_tax[enabled]'), 'false');

  let orders = JSON.parse(fs.readFileSync(path.join(tmp, 'orders.json'), 'utf8'));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'pending');
  assert.equal(orders[0].session_id, 'cs_test_fake1');
  assert.equal(orders[0].total, tier.total);

  // bad inputs (assembled: not sold while SELL_ASSEMBLED is off)
  const asm = await fetch(`${base}/api/checkout`, { method: 'POST', headers: asUser('buyer@example.com'), body: JSON.stringify({ source: { example: 'bike-hook' }, qty: 10, mode: 'assembled' }) });
  assert.equal(asm.status, 400);
  const bad = await fetch(`${base}/api/checkout`, { method: 'POST', headers: asUser('buyer@example.com'), body: JSON.stringify({ source: { example: 'bike-hook' }, qty: 3, mode: 'assembled' }) });
  assert.equal(bad.status, 400);
  const nf = await fetch(`${base}/api/checkout`, { method: 'POST', headers: asUser('buyer@example.com'), body: JSON.stringify({ source: { example: 'nope-nope' }, qty: 1 }) });
  assert.equal(nf.status, 404);
  const demo = await fetch(`${base}/api/orders`, { method: 'POST', headers: asUser('buyer@example.com'), body: '{}' });
  assert.equal(demo.status, 410);

  // other users can't see it; the buyer can
  assert.equal((await fetch(`${base}/api/orders/session/cs_test_fake1`, { headers: asUser('someone@else.com') })).status, 404);
  assert.equal((await (await fetch(`${base}/api/orders`, { headers: asUser('someone@else.com') })).json()).length, 0);
  assert.equal((await fetch(`${base}/api/orders?all=1`, { headers: asUser('someone@else.com') })).status, 403);
  let mine = await (await fetch(`${base}/api/orders/session/cs_test_fake1`, { headers: asUser('buyer@example.com') })).json();
  assert.equal(mine.status, 'pending', 'unpaid session stays pending');

  // webhook: bad signature rejected, nothing changes
  const completed = { ...sessionState, payment_status: 'paid', amount_total: Math.round(tier.total * 100), payment_intent: 'pi_test_1',
    customer_details: { email: 'buyer@example.com', name: 'Ada Buyer' },
    collected_information: { shipping_details: { name: 'Ada Buyer', address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' } } } };
  const evBody = JSON.stringify({ id: 'evt_test_1', type: 'checkout.session.completed', data: { object: completed } });
  const forged = await fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': P.signPayload(evBody, 'whsec_wrong') }, body: evBody });
  assert.equal(forged.status, 400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'orders.json'), 'utf8'))[0].status, 'pending');

  const hook = () => fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': P.signPayload(evBody, SECRET) }, body: evBody });
  const w1 = await (await hook()).json();
  assert.deepEqual([w1.order, w1.changed], [out.order_id, true]);
  const w2 = await (await hook()).json();
  assert.equal(w2.changed, false, 'second delivery is a no-op');

  orders = JSON.parse(fs.readFileSync(path.join(tmp, 'orders.json'), 'utf8'));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'paid');
  assert.equal(orders[0].amount_total, Math.round(tier.total * 100));
  assert.equal(orders[0].payment_intent, 'pi_test_1');
  assert.equal(orders[0].ship_to.city, 'Austin');
  assert.equal(orders[0].ship_to.name, 'Ada Buyer');

  mine = await (await fetch(`${base}/api/orders/session/cs_test_fake1`, { headers: asUser('buyer@example.com') })).json();
  assert.equal(mine.status, 'paid');
  assert.equal(mine.lead_time_days, tier.lead_time_days);
  assert.equal(mine.user, undefined, 'buyer view hides admin fields');

  // admin view + status change; a status set by an admin survives a replayed webhook
  const all = await (await fetch(`${base}/api/orders?all=1`, { headers: asUser('admin2@example.com') })).json();
  assert.equal(all.length, 1); assert.equal(all[0].email, 'buyer@example.com');
  assert.equal((await fetch(`${base}/api/orders/${out.order_id}`, { method: 'PATCH', headers: asUser('buyer@example.com'), body: JSON.stringify({ status: 'shipped' }) })).status, 403);
  const pr = await fetch(`${base}/api/orders/${out.order_id}`, { method: 'PATCH', headers: asUser('owner@example.com'), body: JSON.stringify({ status: 'printing' }) });
  assert.equal((await pr.json()).status, 'printing');
  assert.equal((await (await hook()).json()).changed, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'orders.json'), 'utf8'))[0].status, 'printing');
});

test('checkout is off without a key', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-pay-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: tmp, FORMA_ADMIN_EMAILS: 'owner@example.com,admin2@example.com' }, stdio: 'ignore' });
  t.after(() => { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await waitUp(port);
  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/checkout/config`)).json();
  assert.equal(cfg.enabled, false);
  const r = await fetch(`http://127.0.0.1:${port}/api/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: { example: 'bike-hook' }, qty: 1, mode: 'assembled' }) });
  assert.equal(r.status, 503);
  const w = await fetch(`http://127.0.0.1:${port}/stripe/webhook`, { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=1,v1=00' } });
  assert.equal(w.status, 503);
});
