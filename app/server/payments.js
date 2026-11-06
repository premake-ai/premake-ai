// Stripe Checkout for orders. Zero dependencies: Stripe's REST API via fetch with form-encoded bodies.
// Wired into server.js by `// payments:` hooks. Setup: PAYMENTS.md. Tests: node --test server/payments.test.js
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (app/.env.local), STRIPE_API_BASE (tests: a local fake Stripe),
//      STRIPE_TAX=1 (automatic tax), FORMA_PUBLIC_URL (success/cancel base), FORMA_ADMIN_EMAILS, FORMA_NOTIFY=1.
//      FORMA_PUBLIC_URL falls back to FORMA_GATEWAY_URL, then https://premake.ai.
// FORMA_* is a legacy prefix from before the Premake rename; kept so existing env files and sessions keep working.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const TIERS = [1, 10, 100, 500];
const STATUSES = ['pending', 'paid', 'printing', 'shipped', 'canceled', 'expired', 'refunded'];
const TOLERANCE_S = 300;
const CONTACT = String(process.env.FORMA_CONTACT_EMAIL || '').trim(); // shown when checkout is off; set in .env.local
const env = (k, d = '') => (process.env[k] || d).trim();

// ---------------------------------------------------------------- pure helpers (unit-tested)
/** Flatten {a:{b:[{c:1}]}} into Stripe's form encoding: a[b][0][c]=1. */
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

const toCents = (usd) => Math.round(Number(usd) * 100);

/** Kit contents groups a customer can leave out (Order tab checklist): quote tier `groups` keys. */
const KIT_GROUPS = ['printed', 'metal', 'extrusion', 'bought'];
/** Which kit-contents group a quote or sourcing line belongs to. */
const kitGroupOf = (l) => l?.type === 'printed' ? 'printed' : l?.type === 'bought' ? 'bought' : l?.type === 'fabricated' ? (l.process === 'extrusion' ? 'extrusion' : 'metal') : null;
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Most kits one checkout takes; bigger orders get a quote by email (same as server/prices/config.js MAX_QTY). */
const MAX_QTY = 500;
/** Server-side price for a checkout: any whole quantity from 1 to MAX_QTY. Throws {code} on bad input.
 * omit: kit-contents groups the customer already has. An at-cost priceFor (server/prices) prices the order without them
 * itself (shipping and the card fee change too); an older priceFor takes each group's `off` off the kit price. */
const ADDONS = ['solder']; // Order tab add-ons (server/prices: the soldering iron kit)
const ADDON_ALIAS = { soldering_iron: 'solder' }; // agentbrain's checkout modal id
/** An add-on as stored on the order (fulfilment puts it in the Amazon box): { id, name, usd, search }. */
function addonRecord(k) {
  const kit = require('./prices/config').SOLDER_KIT;
  return k === 'solder' ? { id: 'soldering_iron', name: kit.name, usd: kit.usd, search: 'NEIKO 40421A cordless soldering iron kit' } : { id: String(k) };
}
function checkoutPrice(priceFor, bom, qty, mode, dir, omit, addons) {
  qty = typeof qty === 'string' && /^\d+$/.test(qty.trim()) ? Number(qty) : qty;
  if (!(Number.isInteger(qty) && qty >= 1)) throw Object.assign(new Error(`qty must be a whole number from 1 to ${MAX_QTY}`), { code: 400 });
  if (qty > MAX_QTY) throw Object.assign(new Error(`For more than ${MAX_QTY} kits, email ${CONTACT} and we'll quote you.`), { code: 400 });
  if (mode !== 'assembled' && mode !== 'kit') throw Object.assign(new Error('mode must be assembled or kit'), { code: 400 });
  // prices: SELL_ASSEMBLED off (the default) means kits only, and designs that need factory assembly can't be ordered
  if (mode === 'assembled' && !/^(1|true|yes|on)$/i.test(String(process.env.SELL_ASSEMBLED || '').trim())) throw Object.assign(new Error('Only kits are sold right now.'), { code: 400 });
  bom = bom || {};
  if (mode === 'kit' && bom.kit_ok === false) throw Object.assign(new Error('Not available to order yet. This design needs assembly.'), { code: 400 });
  if (!(bom.printed || []).length) throw Object.assign(new Error('No quote yet: this design has no printed parts.'), { code: 409 });
  if (omit != null && !Array.isArray(omit)) throw Object.assign(new Error('omit must be a list'), { code: 400 });
  const want = [...new Set(omit || [])];
  if (want.some((k) => !KIT_GROUPS.includes(k))) throw Object.assign(new Error(`omit can only hold ${KIT_GROUPS.join(', ')}`), { code: 400 });
  if (want.length && mode !== 'kit') throw Object.assign(new Error('Only a kit can leave parts out.'), { code: 400 });
  const adds = [...new Set((Array.isArray(addons) ? addons : []).map((k) => ADDON_ALIAS[k] || k))];
  if (adds.some((k) => !ADDONS.includes(k))) throw Object.assign(new Error(`addons can only hold ${ADDONS.join(', ')}`), { code: 400 });
  const p = priceFor(bom, qty, mode, dir, want.length || adds.length ? { ...(want.length ? { omit: want } : {}), ...(adds.length ? { addons: adds } : {}) } : undefined);
  const gone = want.filter((k) => p.groups?.[k]);
  if (gone.length && gone.length === Object.keys(p.groups).length) throw Object.assign(new Error('Nothing left to ship: the build guide is free on the design’s guide page.'), { code: 400 });
  if (p.at_cost) { // the quote is already the whole order, in cents: goods + each supplier's shipping + card fee
    if (p.refreshing) throw Object.assign(new Error('Getting the live supplier prices for this quantity. Try again in a few seconds.'), { code: 409 });
    if (!(p.goods_cents >= 50) || !(p.total_cents >= p.goods_cents)) throw Object.assign(new Error('This design has no valid price yet.'), { code: 409 });
    return { qty, mode, at_cost: true, unit_price: p.unit_price, subtotal: p.goods, shipping: p.shipping, card_fee: p.card_fee, total: p.total,
      subtotal_cents: p.goods_cents, shipping_cents: p.shipping_cents, card_fee_cents: p.card_fee_cents, total_cents: p.total_cents,
      lead_time_days: p.lead_time_days, omit: gone, addons: adds.filter((k) => p.addons?.[k]?.on) };
  }
  let { unit_price, subtotal, total, lead_time_days } = p;
  if (gone.length) {
    unit_price = r2(p.unit_price - gone.reduce((s, k) => s + Number(p.groups[k].off || 0), 0));
    subtotal = r2(unit_price * qty); total = r2(subtotal + Number(p.shipping));
    const left = (p.lines || []).filter((l) => !gone.includes(kitGroupOf(l)));
    lead_time_days = Math.max(1, ...left.map((l) => Number(l.lead_days) || 0));
  }
  const subtotal_cents = toCents(subtotal), shipping_cents = toCents(p.shipping);
  if (!(subtotal_cents >= 50) || !(shipping_cents >= 0)) throw Object.assign(new Error('This design has no valid price yet.'), { code: 409 });
  return { qty, mode, unit_price, subtotal, shipping: p.shipping, total,
    subtotal_cents, shipping_cents, total_cents: subtotal_cents + shipping_cents, lead_time_days, omit: gone };
}

function quoteHash(source, price) {
  const snap = JSON.stringify([source, price.qty, price.mode, price.unit_price, price.subtotal_cents, price.shipping_cents, price.lead_time_days, ...(price.omit?.length ? [price.omit] : []), ...(price.addons?.length ? [price.addons] : []),
    ...(price.card_fee_cents ? [price.card_fee_cents] : [])]);
  return crypto.createHash('sha256').update(snap).digest('hex').slice(0, 16);
}

/** Verify a Stripe-Signature header against the raw body bytes. Returns the parsed event or throws. */
function verifyWebhook(rawBody, header, secret, nowS = Math.floor(Date.now() / 1000), tolerance = TOLERANCE_S) {
  if (!secret) throw Object.assign(new Error('webhook secret not configured'), { code: 503 });
  if (typeof header !== 'string' || !header) throw Object.assign(new Error('missing Stripe-Signature'), { code: 400 });
  let t = null; const sigs = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') sigs.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !sigs.length) throw Object.assign(new Error('malformed Stripe-Signature'), { code: 400 });
  if (Math.abs(nowS - Number(t)) > tolerance) throw Object.assign(new Error('signature timestamp outside tolerance'), { code: 400 });
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const want = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(t + '.', 'utf8'), raw])).digest();
  const ok = sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    return crypto.timingSafeEqual(Buffer.from(s, 'hex'), want);
  });
  if (!ok) throw Object.assign(new Error('signature mismatch'), { code: 400 });
  try { return JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { code: 400 }); }
}

/** For tests and local tools: a header Stripe would send for this body. */
function signPayload(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return `t=${t},v1=${sig}`;
}

function readRaw(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function readJsonBody(req, limit = 1e4) {
  return readRaw(req, limit).then((b) => {
    if (!b.length) return {};
    try { return JSON.parse(b.toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { code: 400 }); }
  });
}

// ---------------------------------------------------------------- the module wired into server.js
/**
 * deps: { priceFor, readJSON, writeJSON, projDir, exDir, exists, send, ORDERS, DATA, TRANSIT_DAYS }
 * Returns { api(req,res,ctx) -> bool, webhook(req,res), config(), ... }.
 */
function init(deps) {
  const { priceFor, readJSON, writeJSON, projDir, exDir, exists, send, ORDERS, DATA, TRANSIT_DAYS } = deps;
  const KEY = () => env('STRIPE_SECRET_KEY');
  const WH_SECRET = () => env('STRIPE_WEBHOOK_SECRET');
  const API_BASE = () => env('STRIPE_API_BASE', 'https://api.stripe.com').replace(/\/+$/, '');
  const PUBLIC_URL = () => env('FORMA_PUBLIC_URL', env('FORMA_GATEWAY_URL', 'https://premake.ai')).replace(/\/+$/, '');
  const ADMINS = () => new Set(env('FORMA_ADMIN_EMAILS', '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const enabled = () => /^(sk|rk)_(test|live)_/.test(KEY());

  const owner = (acc) => acc.user || (acc.sid ? 'session:' + acc.sid : 'local');
  // Admin: a Google user on the list, or the Mac's own password / local session (no gateway user).
  const isAdmin = (acc) => !!acc.authed && (acc.user ? ADMINS().has(acc.user) : !String(acc.sid || '').startsWith('gw:'));

  const load = () => { const a = readJSON(ORDERS, []); return Array.isArray(a) ? a : []; };
  function save(all) { fs.mkdirSync(DATA, { recursive: true }); writeJSON(ORDERS, all); }
  /** Read-modify-write one order (sync, so no interleaving inside this process). */
  function update(match, fn) {
    const all = load();
    const o = all.find(match);
    if (!o) return null;
    const changed = fn(o);
    if (changed !== false) save(all);
    return o;
  }

  async function stripe(method, p, params, idem) {
    const headers = { Authorization: `Bearer ${KEY()}`, 'Stripe-Version': '2024-06-20' };
    let body;
    if (params) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = formEncode(params).toString(); }
    if (idem) headers['Idempotency-Key'] = idem;
    let r;
    try { r = await fetch(API_BASE() + p, { method, headers, body, signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw Object.assign(new Error('Could not reach Stripe. Try again in a minute.'), { code: 502, cause: e }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.log(`[payments] stripe ${method} ${p} -> ${r.status} ${j?.error?.type || ''} ${j?.error?.message || ''}`);
      throw Object.assign(new Error('Checkout is unavailable right now. Try again in a minute.'), { code: 502 });
    }
    return j;
  }

  function sourceOf(src) {
    src = src || {};
    if (typeof src === 'string') src = src.startsWith('example:') ? { example: src.slice(8) } : { project: src.replace(/^project:/, '') };
    if (src.project) { const dir = projDir(src.project); return dir && exists(path.join(dir, 'meta.json')) ? { key: 'project:' + src.project, src: { project: src.project }, dir } : null; }
    if (src.example) { const dir = exDir(src.example); return dir && exists(path.join(dir, 'meta.json')) ? { key: 'example:' + src.example, src: { example: src.example }, dir } : null; }
    return null;
  }

  function baseUrl(req) {
    const h = String(req.headers.host || '').toLowerCase();
    // Local dev (no gateway): come back to this server. Everything else goes through the public gateway URL.
    if (!req.headers['x-forma-user'] && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h)) return `http://${h}`;
    return PUBLIC_URL();
  }

  async function createCheckout(req, acc, body) {
    if (!enabled()) throw Object.assign(new Error('Checkout opens soon.'), { code: 503 });
    const s = sourceOf(body.source ?? body.project ?? (body.example ? { example: body.example } : null));
    if (!s) throw Object.assign(new Error('design not found'), { code: 404 });
    // per-user projects (server.js): someone else's unlisted project doesn't exist for you
    if (s.src.project && deps.canOrder && !deps.canOrder(acc, s.src.project)) throw Object.assign(new Error('design not found'), { code: 404 });
    const bom = readJSON(path.join(s.dir, 'bom.json'), {});
    const price = checkoutPrice(priceFor, bom, body.qty, body.mode === 'kit' ? 'kit' : body.mode === 'assembled' ? 'assembled' : body.mode == null ? 'kit' : body.mode, s.dir, body.omit, body.addons);
    const without = (price.omit.length ? ` · without ${price.omit.map((k) => KIT_LABEL[k]).join(', ')}` : '') + (price.addons?.includes('solder') ? ' · with a soldering iron kit' : '');
    const meta = readJSON(path.join(s.dir, 'meta.json'), {}) || {};
    const title = String(meta.title || 'Premake design').replace(/\s+/g, ' ').trim().slice(0, 80);
    const user = owner(acc);
    const email = acc.user && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acc.user) ? acc.user : undefined;
    const id = 'ord_' + crypto.randomBytes(6).toString('hex');
    const hash = quoteHash(s.key, addons.length ? { ...price, omit: [...(price.omit || []), ...addons.map((a) => '+' + a.id)] } : price);
    const base = baseUrl(req);
    const back = s.src.project ? `/designs/${encodeURIComponent(s.src.project)}` : `/examples/${encodeURIComponent(s.src.example)}`; // urls: clean studio URLs
    const TAX = env('STRIPE_TAX') === '1';
    const params = {
      mode: 'payment',
      line_items: [
        { quantity: 1, price_data: { currency: 'usd', unit_amount: price.subtotal_cents,
          product_data: { name: `${title} · ${price.qty} ${price.qty === 1 ? (price.mode === 'kit' ? 'kit' : 'unit') : (price.mode === 'kit' ? 'kits' : 'units')}${without}`,
            description: price.at_cost ? `Parts at cost, exactly what the suppliers charge. Arrives in about ${price.lead_time_days} days.`
              : `${price.qty} × $${price.unit_price.toFixed(2)} each. Made to order, ships in about ${price.lead_time_days} days.`,
            tax_code: TAX ? 'txcd_99999999' : undefined }, tax_behavior: TAX ? 'exclusive' : undefined } }, // general tangible goods
        ...(price.shipping_cents > 0 || !price.at_cost ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price.shipping_cents, tax_behavior: TAX ? 'exclusive' : undefined,
          product_data: { name: price.at_cost ? 'Shipping (each supplier’s own, US ground)' : 'Shipping (US ground, one address)', tax_code: TAX ? 'txcd_92010001' : undefined } } }] : []), // shipping
        ...(price.card_fee_cents > 0 ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price.card_fee_cents, tax_behavior: TAX ? 'exclusive' : undefined,
          product_data: { name: 'Card fee (what Stripe charges us)', tax_code: TAX ? 'txcd_00000000' : undefined } } }] : []),
      ],
      shipping_address_collection: { allowed_countries: ['US'] },
      customer_email: email,
      client_reference_id: id,
      metadata: { order_id: id, source: s.key, qty: price.qty, mode: price.mode, user: user.slice(0, 200), quote_hash: hash, ...(price.omit.length ? { omit: price.omit.join(',') } : {}), ...(price.addons?.length ? { addons: price.addons.map((a) => addonRecord(a).id).join(',') } : {}) },
      payment_intent_data: { metadata: { order_id: id, source: s.key } },
      success_url: `${base}/orders/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}${back}`,
      automatic_tax: { enabled: env('STRIPE_TAX') === '1' ? 'true' : 'false' },
    };
    const session = await stripe('POST', '/v1/checkout/sessions', params, 'forma-' + id);
    if (!session?.id || !/^https:\/\//.test(String(session.url || '')) && !String(session.url || '').startsWith(API_BASE())) {
      throw Object.assign(new Error('Stripe did not return a checkout page.'), { code: 502 });
    }
    const order = {
      id, user, email: email || null, source: s.src, title, qty: price.qty, mode: price.mode, ...(price.omit.length ? { omit: price.omit } : {}), ...(price.addons?.length ? { addons: price.addons.map(addonRecord) } : {}),
      unit_price: price.unit_price, subtotal: price.subtotal, shipping: price.shipping, ...(price.card_fee != null ? { card_fee: price.card_fee } : {}), total: price.total, total_cents: price.total_cents,
      currency: 'usd', lead_time_days: price.lead_time_days, eta_days: price.lead_time_days + TRANSIT_DAYS, quote_hash: hash,
      status: 'pending', session_id: session.id, livemode: !!session.livemode, created: new Date().toISOString(),
    };
    const all = load(); all.push(order); save(all);
    console.log(`[payments] checkout ${id} ${s.key} ${price.qty}x${price.mode} $${price.total.toFixed(2)} for ${user}`);
    return { order_id: id, url: session.url };
  }

  function notify(o) {
    if (env('FORMA_NOTIFY') !== '1' || process.platform !== 'darwin') return;
    const text = `${o.qty} × ${o.title} (${o.mode}${o.omit?.length ? `, without ${o.omit.map((k) => KIT_LABEL[k] || k).join(', ')}` : ''}) · $${(o.amount_total != null ? o.amount_total / 100 : o.total).toFixed(2)} · ${o.email || o.user}`;
    try {
      // The text goes in as argv, never into the AppleScript source.
      const c = spawn('/usr/bin/osascript', ['-e', 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run',
        'Premake: new paid order', text.slice(0, 200)], { stdio: 'ignore' });
      c.on('error', () => {}); c.unref();
    } catch {}
  }

  /** Apply a completed Checkout Session to its order. Idempotent: a second call changes nothing. */
  function applySession(session, eventId) {
    const oid = session?.metadata?.order_id || session?.client_reference_id;
    let became = false;
    const o = update((x) => (oid && x.id === oid) || x.session_id === session.id, (x) => {
      if (x.session_id && session.id && x.session_id !== session.id) return false;
      const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
      if (!paid) { if (x.status === 'pending') { x.payment_status = session.payment_status || null; return true; } return false; }
      if (x.status !== 'pending' && x.status !== 'expired') return false; // already paid/printing/shipped: no-op
      const sd = session.collected_information?.shipping_details || session.shipping_details || null;
      const cd = session.customer_details || {};
      x.status = 'paid';
      x.paid_at = new Date().toISOString();
      x.amount_total = session.amount_total ?? null;
      x.amount_tax = session.total_details?.amount_tax ?? null;
      x.payment_intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
      x.ship_to = sd ? { name: sd.name || cd.name || '', ...(sd.address || {}) } : cd.address ? { name: cd.name || '', ...cd.address } : null;
      x.customer_email = cd.email || x.email || null;
      x.event_id = eventId || null;
      if (x.amount_total != null && x.total_cents != null && x.amount_total !== x.total_cents && !session.total_details?.amount_tax) {
        x.amount_mismatch = true;
        console.log(`[payments] WARNING ${x.id}: paid ${x.amount_total} cents, expected ${x.total_cents}`);
      }
      became = true;
    });
    if (o && became) { console.log(`[payments] paid ${o.id} $${((o.amount_total ?? 0) / 100).toFixed(2)}`); notify(o); deps.onPaid?.(o); } // fulfilment: supplier plan
    return { order: o, changed: became };
  }

  async function webhook(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    let raw, ev;
    try {
      raw = await readRaw(req, 1e6);
      ev = verifyWebhook(raw, req.headers['stripe-signature'], WH_SECRET());
    } catch (e) {
      console.log(`[payments] webhook rejected: ${e.message}`);
      return send(res, e.code || 400, { error: e.message });
    }
    const obj = ev?.data?.object || {};
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      const r = applySession(obj, ev.id);
      return send(res, 200, { received: true, order: r.order?.id || null, changed: r.changed });
    }
    if (ev.type === 'checkout.session.expired') {
      update((x) => x.session_id === obj.id, (x) => { if (x.status !== 'pending') return false; x.status = 'expired'; });
    }
    return send(res, 200, { received: true });
  }

  /** Success page fallback: if the webhook is late, ask Stripe directly (same idempotent update). */
  async function reconcile(o) {
    if (!o || o.status !== 'pending' || !o.session_id || !enabled()) return o;
    try {
      const s = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(o.session_id)}`);
      if (s?.metadata?.order_id === o.id) return applySession(s, null).order || o;
    } catch {}
    return o;
  }

  const publicOrder = (o, admin) => {
    const out = { id: o.id, title: o.title, source: o.source, qty: o.qty, mode: o.mode, ...(o.omit?.length ? { omit: o.omit } : {}), unit_price: o.unit_price, subtotal: o.subtotal,
      shipping: o.shipping, ...(o.card_fee != null ? { card_fee: o.card_fee } : {}), total: o.total, amount_total: o.amount_total ?? null, status: o.status, created: o.created, paid_at: o.paid_at || null,
      lead_time_days: o.lead_time_days, eta_days: o.eta_days, ship_to: o.ship_to || null, livemode: !!o.livemode,
      tracking: Array.isArray(o.tracking) ? o.tracking : [], shipped_at: o.shipped_at || null }; // fulfilment: customer tracking
    if (admin) Object.assign(out, { user: o.user, email: o.customer_email || o.email || null, payment_intent: o.payment_intent || null,
      session_id: o.session_id || null, amount_mismatch: !!o.amount_mismatch, note: o.note || null });
    return out;
  };

  /** /api/checkout* and /api/orders*. Returns true if it answered. */
  async function api(req, res, { a, b, c, m, url, acc }) {
    if (a === 'checkout' && b === 'config' && !c && m === 'GET') {
      return send(res, 200, { enabled: enabled(), test: KEY().startsWith('sk_test_') || KEY().startsWith('rk_test_'), contact: CONTACT,
        admin: isAdmin(acc), tax: env('STRIPE_TAX') === '1' }), true;
    }
    if (a !== 'checkout' && a !== 'orders') return false;
    if (!acc.authed) return send(res, 403, { error: 'Sign in to order.' }), true;
    if (a === 'checkout' && !b && m === 'POST') {
      return send(res, 200, await createCheckout(req, acc, await readJsonBody(req))), true;
    }
    if (a === 'orders' && !b && m === 'POST') return send(res, 410, { error: 'Orders go through /api/checkout now.' }), true;
    const admin = isAdmin(acc), me = owner(acc);
    const mine = (o) => o.user === me || (acc.user && (o.email === acc.user || o.customer_email === acc.user));
    const visible = (o) => o.status !== 'demo_received' && o.status !== undefined;
    if (a === 'orders' && !b && m === 'GET') {
      const all = url.searchParams.get('all') === '1';
      if (all && !admin) return send(res, 403, { error: 'admins only' }), true;
      const list = load().filter(visible).filter((o) => all || mine(o)).sort((x, y) => String(y.created).localeCompare(String(x.created)));
      return send(res, 200, list.map((o) => publicOrder(o, all))), true;
    }
    if (a === 'orders' && b === 'session' && c && m === 'GET') {
      let o = load().find((x) => x.session_id === c);
      if (!o || !(mine(o) || admin)) return send(res, 404, { error: 'order not found' }), true;
      o = await reconcile(o);
      return send(res, 200, publicOrder(o, false)), true;
    }
    if (a === 'orders' && b && !c && (m === 'GET' || m === 'PATCH')) {
      const o0 = load().find((x) => x.id === b);
      if (!o0 || !(mine(o0) || admin)) return send(res, 404, { error: 'order not found' }), true;
      if (m === 'GET') return send(res, 200, publicOrder(o0, admin)), true;
      if (!admin) return send(res, 403, { error: 'admins only' }), true;
      const body = await readJsonBody(req);
      if (!STATUSES.includes(body.status)) return send(res, 400, { error: `status must be one of ${STATUSES.join(', ')}` }), true;
      const o = update((x) => x.id === b, (x) => { x.status = body.status; x.status_at = new Date().toISOString(); x.status_by = acc.user || 'admin'; });
      return send(res, 200, publicOrder(o, true)), true;
    }
    return false;
  }

  return { api, webhook, enabled, applySession, createCheckout, isAdmin };
}

const KIT_LABEL = { printed: 'printed parts', metal: 'cut metal and panels', extrusion: 'aluminium extrusion', bought: 'bought parts' };

module.exports = { init, verifyWebhook, signPayload, checkoutPrice, quoteHash, formEncode, kitGroupOf, TIERS, STATUSES, KIT_GROUPS, MAX_QTY };
