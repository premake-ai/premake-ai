// Order routing with a human in the loop. Every paid order gets a fulfilment plan: supplier jobs (printed parts,
// sheet/laser/extrusion parts, bought parts grouped by vendor), each with parts x order qty, files, material, ship-to,
// estimated cost, status (todo / quoted / placed / shipped / received), supplier order # and tracking.
// Josh reviews and places each job from /admin (Orders -> Fulfilment, and the Fulfilment queue). See FULFILMENT.md.
//
//   Plan file: <DATA>/fulfilment/<order_id>.json   (created by onPaid() from payments.applySession, or lazily for older paid orders)
//   API (admins only, mounted by server/admin.js under /api/admin/fulfilment):
//     GET    /                         queue: open jobs across orders, oldest paid first
//     GET    /<oid>                    plan + order kits + margin
//     POST   /<oid>/rebuild            regenerate from the current BOM (only while nothing is placed)
//     PATCH  /<oid>                    customer shipment: { carrier, tracking, shipped: true } | { status: 'printing' }
//     PATCH  /<oid>/<job>              { status, supplier, ship_to, order_no, carrier, tracking, cost_actual_usd, note }
//     POST   /<oid>/<job>/quote        live quote (Slant 3D: upload, quantity, shipping to the job's ship-to)
//     POST   /<oid>/<job>/checkout     Slant 3D payment link (quote_checkout). Explicit click only. Never pays.
//     GET    /<oid>/<job>/zip          that job's files (STL, DXF for flat parts, STEP when present) + ORDER.txt
//
// Ship-from (Premake's own address, for "ship to us"): BUILDERY_SHIP_FROM_NAME, _COMPANY, _LINE1, _LINE2, _CITY, _STATE,
// _POSTAL_CODE, _COUNTRY, _PHONE, _EMAIL in app/.env.local.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { zip } = require('./zip');
const shops = require('../prices/suppliers');

const SUPPLIERS = Object.fromEntries(['slant3d', 'inhouse', 'stock', 'sendcutsend', 'oshcut', 'ponoko', 'misumi', 'openbuilds', 'xometry', 'jlc', 'pcbway',
  'mcmaster', 'digikey', 'mouser', 'lcsc', 'amazon', 'aliexpress', 'other'].map((id) => [id, require('./suppliers/' + id)]));
const SERVICE_ID = { 'slant 3d': 'slant3d', 'buildery print': 'inhouse', sendcutsend: 'sendcutsend', oshcut: 'oshcut', ponoko: 'ponoko', misumi: 'misumi',
  openbuilds: 'openbuilds', xometry: 'xometry', jlccnc: 'jlc', jlc3dp: 'jlc', pcbway: 'pcbway', 'mcmaster-carr': 'mcmaster', mcmaster: 'mcmaster',
  digikey: 'digikey', mouser: 'mouser', lcsc: 'lcsc', amazon: 'amazon', aliexpress: 'aliexpress' };
const JOB_STATUSES = ['todo', 'quoted', 'placed', 'shipped', 'received', 'skipped'];
const OPEN = new Set(['todo', 'quoted', 'placed', 'shipped']);
const DONE = new Set(['received', 'skipped']);
const KIND_ORDER = { printed: 0, fabricated: 1, bought: 2 };
const KIND_LABEL = { printed: 'Printed parts', fabricated: 'Cut and machined parts', bought: 'Bought parts' };
const STRIPE_PCT = 0.029, STRIPE_FIXED = 0.30;

const env = (k) => String(process.env[k] || '').trim();
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const str = (v, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const serviceId = (name) => SERVICE_ID[String(name || '').toLowerCase()] || null;
const supplierName = (id) => SUPPLIERS[id]?.name || id;

/** Premake's own address ("ship to us"). Placeholders until BUILDERY_SHIP_FROM_* are set. */
function shipFrom() {
  const g = (k, ph) => env('BUILDERY_SHIP_FROM_' + k) || ph;
  const a = { name: g('NAME', '<BUILDERY_SHIP_FROM_NAME>'), company: g('COMPANY', 'Premake'), line1: g('LINE1', '<BUILDERY_SHIP_FROM_LINE1>'), line2: g('LINE2', ''),
    city: g('CITY', '<BUILDERY_SHIP_FROM_CITY>'), state: g('STATE', '<ST>'), postal_code: g('POSTAL_CODE', g('ZIP', '<ZIP>')), country: g('COUNTRY', 'US'),
    phone: g('PHONE', ''), email: g('EMAIL', '') };
  a.placeholder = Object.values(a).some((v) => /^<.*>$/.test(v));
  return a;
}
const addrText = (a) => !a ? '' : [a.name, a.company && a.company !== a.name ? a.company : '', a.line1, a.line2,
  [a.city, a.state].filter(Boolean).join(', ') + (a.postal_code ? ' ' + a.postal_code : ''), a.country, a.phone].filter(Boolean).join('\n');

function trackingUrl(carrier, n) {
  const c = String(carrier || '').toLowerCase(), e = encodeURIComponent(n || '');
  if (!n) return null;
  if (/ups/.test(c) || /^1Z/i.test(n)) return `https://www.ups.com/track?tracknum=${e}`;
  if (/usps/.test(c) || /^9[2-5]\d{18,24}$/.test(n)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${e}`;
  if (/fedex/.test(c)) return `https://www.fedex.com/fedextrack/?trknbr=${e}`;
  if (/dhl/.test(c)) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${e}`;
  return null;
}

// ---------------------------------------------------------------- plan generation (pure, given sourcing lines)
const fileRel = (href) => {
  const m = /^\/files\/(?:projects|examples)\/[^/]+\/(.+)$/.exec(href || '');
  if (m) return { type: 'stl', rel: m[1].split('/').map(decodeURIComponent).join('/') };
  const d = /[?&]dxf=([^&]+)/.exec(href || '');
  return d ? { type: 'dxf', rel: decodeURIComponent(d[1]) } : null;
};
function filesOf(line) {
  return (line.downloads || []).map((d) => ({ label: d.label, href: d.href, ...fileRel(d.href) })).filter((f) => f.rel);
}
function priceAt(opt, q) { return opt?.prices && opt.prices[q] != null ? Number(opt.prices[q]) : null; }

/**
 * Pure: sourcing lines (server/sourcing.js linesFor) + the order -> plan.jobs. Exported for tests.
 * order: { id, qty, mode, ship_to, omit? }.  L: { lines, bom }.
 */
function planJobs(order, L) {
  const q = Number(order.qty) || 1;
  const jobs = new Map();
  // New plans route only to allowed shops (config ALLOWED_SUPPLIERS: amazon / sendcutsend / slant3d) plus in-house printing.
  // The other supplier modules stay for older plans and a widened list.
  // Premake stock (config.STOCK): small bought parts come off our NYC shelf, a "pick and pack" job, not an Amazon order.
  const okId = (id) => id === 'inhouse' || id === 'stock' || (SUPPLIERS[id] && shops.isAllowed(SUPPLIERS[id].name));
  const job = (kind, supplier0, alternatives0) => {
    const alternatives = alternatives0.filter(okId);
    const supplier = okId(supplier0) ? supplier0 : alternatives[0] || (kind === 'printed' ? 'slant3d' : kind === 'bought' ? 'amazon' : 'sendcutsend');
    if (!alternatives.includes(supplier)) alternatives.unshift(supplier);
    const k = `${kind}:${supplier}`;
    if (!jobs.has(k)) jobs.set(k, { id: '', kind, supplier, alternatives: [...new Set(alternatives)], parts: [], setup_usd: 0, status: 'todo' });
    const j = jobs.get(k); for (const a of alternatives) if (!j.alternatives.includes(a)) j.alternatives.push(a);
    return j;
  };
  const jobManual = () => {
    if (!jobs.has('bought:other')) jobs.set('bought:other', { id: '', kind: 'bought', supplier: 'other', alternatives: ['other'], parts: [], setup_usd: 0, status: 'todo', manual: true });
    return jobs.get('bought:other');
  };
  const fabs = (L.bom?.fabricated || []).filter((f) => f && typeof f === 'object');
  // kit contents the customer left out at checkout (payments.checkoutPrice omit): nothing to order for those lines
  const omit = new Set(Array.isArray(order.omit) ? order.omit : []);
  const groupOf = (l) => l.type === 'fabricated' ? (l.process === 'extrusion' ? 'extrusion' : 'metal') : l.type;
  for (const l of L.lines || []) {
    if (omit.has(groupOf(l))) continue;
    const qpu = Number(l.qty_per_unit) || 1;
    const base = { line_id: l.id, name: l.name, qty_per_unit: qpu, qty: qpu * q, detail: l.detail || '', files: filesOf(l) };
    if (l.type === 'printed') {
      const live = l.options.find((o) => o.service === 'Slant 3D' && o.kind === 'live');
      const est = l.options.find((o) => o.service === 'Premake print' || o.service === 'Formery print');
      const j = job('printed', 'slant3d', ['slant3d', 'inhouse']);
      j.parts.push({ ...base, material: 'PETG', color: l.color ? l.color.charAt(0).toUpperCase() + l.color.slice(1) : 'Black', // colours: studio pick file: base.files[0]?.rel || null,
        unit_usd: priceAt(live, q) ?? priceAt(est, q), price_kind: priceAt(live, q) != null ? 'live' : 'estimate', inhouse_unit_usd: priceAt(est, q) });
      if (live?.setup?.[q]) j.setup_usd = Math.max(j.setup_usd, Number(live.setup[q]) || 0);
    } else if (l.type === 'fabricated') {
      const f = fabs.find((x) => x.name === l.name && String(x.process) === l.process) || {};
      const p = f.params || {};
      const svc = l.options.filter((o) => o.kind === 'link').map((o) => ({ id: serviceId(o.service) || 'other', o }));
      const first = svc[0] || { id: 'other', o: {} };
      const est = l.options.find((o) => o.kind === 'estimate');
      const j = job('fabricated', first.id, svc.map((s) => s.id));
      j.parts.push({ ...base, process: l.process, material: str(p.material) || (l.process === 'extrusion' ? 'aluminium 6063' : ''), thickness_mm: Number(p.thickness_mm) || null,
        bends: Number(p.bends) || 0, profile: str(p.profile), length_mm: Number(p.length_mm) || null, upload: first.o.upload || '',
        links: svc.map((s) => ({ supplier: s.id, service: s.o.service, url: s.o.url, upload: s.o.upload || '' })),
        unit_usd: priceAt(est, q), price_kind: est ? 'estimate' : null });
    } else if (l.type === 'bought') {
      const links = l.options.filter((o) => o.url).map((o) => ({ supplier: serviceId(o.service) || 'other', service: o.service, url: o.url, kind: o.kind }));
      const listedSup = serviceId(l.supplier);
      const first = (listedSup && links.find((x) => x.supplier === listedSup)) || links.find((x) => x.supplier !== 'other') || links[0] || { supplier: 'other' };
      const listed = l.options.find((o) => o.kind === 'listed');
      const unit = priceAt(listed, q) ?? l.estimate?.unit_usd ?? null;
      // agentbrain: a manual-order line (the agent's own shop, not one we auto-order): its own job on the manual "other" supplier
      const manualLine = l.manual_order === true;
      const j = manualLine ? jobManual() : l.stocked ? job('bought', 'stock', ['stock', ...links.map((x) => x.supplier)]) : job('bought', first.supplier, links.map((x) => x.supplier));
      const own = manualLine ? links.find((x) => x.service === l.supplier) || links[0] || first : first;
      const bulk = l.stocked && l.stock_unit_usd != null ? l.stock_unit_usd : null; // stocked: our bulk per-piece cost
      j.parts.push({ ...base, search: l.search || '', links, url: own.url || '', unit_usd: bulk ?? unit, price_kind: bulk != null ? 'estimate' : listed ? 'listed' : unit != null ? 'estimate' : null,
        ...(l.stocked ? { stocked: true } : {}),
        ...(manualLine ? { manual_order: true, shop: l.supplier } : {}) });
    }
  }
  // agentbrain: checkout add-ons (a soldering iron kit, one per order) go in the Amazon box
  for (const a of Array.isArray(order.addons) ? order.addons : []) {
    if (!a || typeof a !== 'object' || !a.id) continue;
    const search = String(a.search || a.name || '');
    const url = shops.amazonSearchUrl ? shops.amazonSearchUrl(search) : '';
    job('bought', 'amazon', ['amazon']).parts.push({ line_id: 'addon:' + a.id, name: String(a.name || a.id), qty_per_unit: 1, qty: 1, detail: 'Checkout add-on (one per order)', files: [],
      search, links: url ? [{ supplier: 'amazon', service: 'Amazon', url, kind: 'search' }] : [], url, unit_usd: Number(a.usd) || null, price_kind: 'estimate', addon: true });
  }
  const out = [...jobs.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.supplier.localeCompare(b.supplier));
  out.forEach((j, i) => { j.id = `j${i + 1}`; });
  // Every supplier drop-ships straight to the customer (the owner's choice). Set FULFIL_SHIP_TO=us to route
  // multi-supplier orders through Premake instead (needed if we assemble them).
  const viaUs = (process.env.FULFIL_SHIP_TO || 'customer') === 'us' && out.length > 1;
  for (const j of out) j.ship_to = viaUs ? 'us' : 'customer';
  return out;
}

/** Estimated (or actual, when entered) cost of a job. */
function jobCost(j) {
  if (j.status === 'skipped') return { usd: 0, kind: 'skipped' };
  if (Number.isFinite(j.cost_actual_usd)) return { usd: j.cost_actual_usd, kind: 'actual' };
  if (j.supplier === 'slant3d' && j.slant?.total_usd != null) return { usd: j.slant.total_usd, kind: 'live' };
  let usd = 0, unpriced = 0, live = true;
  for (const p of j.parts) {
    const u = j.supplier === 'inhouse' ? p.inhouse_unit_usd : p.unit_usd;
    if (u == null) { unpriced++; continue; }
    usd += u * p.qty;
    if (j.supplier === 'inhouse' || p.price_kind !== 'live') live = false;
  }
  if (j.supplier !== 'inhouse') usd += j.setup_usd || 0;
  return { usd: r2(usd), kind: live && !unpriced ? 'live' : 'estimate', unpriced };
}

function money(order) {
  const paid = order.amount_total != null ? (order.amount_total - (order.amount_tax || 0)) / 100 : Number(order.total) || 0;
  return { paid_usd: r2(paid), stripe_fee_usd: paid > 0 ? r2(paid * STRIPE_PCT + STRIPE_FIXED) : 0 };
}

function summary(plan, order) {
  const m = money(order);
  let cost = 0, estimated = false, unpriced = 0;
  for (const j of plan.jobs) { const c = jobCost(j); cost += c.usd; if (c.kind === 'estimate') estimated = true; unpriced += c.unpriced || 0; }
  const margin = m.paid_usd - m.stripe_fee_usd - cost;
  const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, plan.jobs.filter((j) => j.status === s).length]));
  return { ...m, cost_usd: r2(cost), cost_estimated: estimated, unpriced, margin_usd: r2(margin), margin_pct: m.paid_usd ? Math.round((margin / m.paid_usd) * 100) : null, counts,
    open: plan.jobs.filter((j) => OPEN.has(j.status)).length };
}

// ---------------------------------------------------------------- order kits (what Josh types into each supplier's site)
function settingsFor(j, p) {
  const s = [];
  const add = (k, v) => { if (v != null && v !== '') s.push([k, String(v)]); };
  if (j.kind === 'printed') {
    add('Material', p.material); add('Color', p.color); add('Quantity', p.qty);
    if (j.supplier === 'slant3d') add('Upload', 'STL (one file per part)');
  } else if (j.kind === 'fabricated') {
    add('Process', { sheet: 'Sheet metal' + (p.bends ? ` with ${p.bends} bend${p.bends > 1 ? 's' : ''}` : ''), laser: 'Laser cut', extrusion: 'Extrusion, cut to length' }[p.process] || p.process);
    add('Material', p.material); add('Thickness', p.thickness_mm ? `${p.thickness_mm} mm` : '');
    if (p.process === 'extrusion') { add('Profile', p.profile || '2020'); add('Length', p.length_mm ? `${p.length_mm} mm` : ''); add('Ends', 'Plain cut (tapped ends optional)'); }
    else add('Finish', p.process === 'sheet' ? 'Deburred, no coating' : 'As cut');
    add('Quantity', p.qty);
    add('Upload', p.process === 'extrusion' ? '' : p.bends ? 'STEP (bent part); STL as reference' : 'DXF (flat outline, mm)');
  } else {
    add('Quantity', p.qty); add('Search', p.search); if (p.detail) add('Notes', p.detail);
  }
  return s;
}
function kitFor(j, plan, order) {
  const sup = SUPPLIERS[j.supplier] || SUPPLIERS.other;
  const to = j.ship_to === 'customer' ? order.ship_to : shipFrom();
  const partLink = (p) => (p.links || []).find((l) => l.supplier === j.supplier)?.url || '';
  const open = j.supplier === 'inhouse' ? '' : (j.parts.map(partLink).find(Boolean) || sup.url || '');
  const files = j.parts.flatMap((p) => p.files.map((f) => ({ ...f, part: p.name })));
  const cart = j.kind === 'bought' ? j.parts.map((p) => ({ name: p.name, qty: p.qty, url: partLink(p) || p.url || '', unit_usd: p.unit_usd })) : null;
  const shipTxt = to ? addrText(to) : '';
  const parts = j.parts.map((p) => ({ name: p.name, qty: p.qty, settings: settingsFor(j, p) }));
  const lines = [`${supplierName(j.supplier)} order for ${order.id} (${order.qty} × ${order.title})`, ''];
  for (const p of parts) { lines.push(p.name); for (const [k, v] of p.settings) lines.push(`  ${k}: ${v}`); }
  if (cart) { lines.push('', 'Cart:'); for (const c of cart) lines.push(`  ${c.qty} × ${c.name}${c.url ? '  ' + c.url : ''}`); }
  lines.push('', `Ship to (${j.ship_to === 'customer' ? 'customer, drop-ship' : 'Premake'}):`, shipTxt || '(no address)');
  return {
    supplier_name: sup.name, open_url: open, api: sup.api || '', auto: !!sup.auto?.(), has_keys: !!sup.hasKeys?.(),
    files, zip: files.length ? `/api/admin/fulfilment/${encodeURIComponent(order.id)}/${j.id}/zip` : null, parts, cart,
    cart_text: cart ? cart.map((c) => `${c.qty}\t${c.name}${c.url ? '\t' + c.url : ''}`).join('\n') : null,
    ship_to: { mode: j.ship_to, text: shipTxt, placeholder: j.ship_to === 'us' && !!to?.placeholder, missing: !to },
    text: lines.join('\n'),
  };
}

// ---------------------------------------------------------------- module
function init({ DATA, ORDERS, readJSON, writeJSON, send, sourcing, plateDxf, projDir, exDir }) {
  const DIR = path.join(DATA, 'fulfilment');
  const fileOf = (oid) => (/^ord_[A-Za-z0-9_]{4,40}$/.test(oid) ? path.join(DIR, oid + '.json') : null);
  const loadOrders = () => { const a = readJSON(ORDERS, []); return Array.isArray(a) ? a : []; };
  const PAIDISH = new Set(['paid', 'printing', 'shipped']);
  const busy = new Set(); // job keys with a supplier call in flight

  function updateOrder(oid, fn) {
    const all = loadOrders();
    const o = all.find((x) => x.id === oid);
    if (!o) return null;
    if (fn(o) !== false) writeJSON(ORDERS, all);
    return o;
  }
  function savePlan(plan) { plan.updated = new Date().toISOString(); fs.mkdirSync(DIR, { recursive: true }); writeJSON(fileOf(plan.order_id), plan); return plan; }
  function designDir(source) { return source?.project ? projDir(source.project) : source?.example ? exDir(source.example) : null; }

  function createPlan(order) {
    const L = sourcing.linesFor(order.source);
    const plan = { order_id: order.id, created: new Date().toISOString(), source: order.source, title: order.title, qty: order.qty, mode: order.mode,
      jobs: L ? planJobs(order, L) : [], error: L ? null : 'The design for this order was not found, so there is nothing to route. Check the order by hand.',
      customer: { tracking: [] }, log: [{ t: new Date().toISOString(), what: 'Plan created' }] };
    return savePlan(plan);
  }
  function getPlan(order, create = true) {
    const f = fileOf(order.id);
    if (!f) return null;
    const p = readJSON(f, null);
    if (p && Array.isArray(p.jobs)) return p;
    return create && PAIDISH.has(order.status) ? createPlan(order) : null;
  }

  /** payments.applySession hook: an order just became paid. Never throws into payments. */
  function onPaid(order) {
    try { if (order?.id) { const p = getPlan(order); if (p) console.log(`[fulfilment] plan ${order.id}: ${p.jobs.length} supplier job(s)`); } }
    catch (e) { console.error(`[fulfilment] plan for ${order?.id} failed: ${e.message}`); }
  }

  function view(plan, order) {
    return { ...plan, order: { id: order.id, title: order.title, qty: order.qty, mode: order.mode, status: order.status, paid_at: order.paid_at || null,
        created: order.created, email: order.customer_email || order.email || null, ship_to: order.ship_to || null, livemode: !!order.livemode, tracking: order.tracking || [] },
      ship_from: shipFrom(), summary: summary(plan, order), statuses: JOB_STATUSES,
      jobs: plan.jobs.map((j) => ({ ...j, label: `${KIND_LABEL[j.kind]} · ${supplierName(j.supplier)}`, supplier_name: supplierName(j.supplier),
        alternatives: j.alternatives.map((id) => ({ id, name: supplierName(id) })), cost: jobCost(j), kit: kitFor(j, plan, order), busy: busy.has(`${plan.order_id}/${j.id}`) })) };
  }

  function queue() {
    const rows = [];
    for (const o of loadOrders().filter((x) => PAIDISH.has(x.status))) {
      let plan; try { plan = getPlan(o); } catch { plan = null; }
      if (!plan) continue;
      const s = summary(plan, o);
      for (const j of plan.jobs) {
        if (!OPEN.has(j.status)) continue;
        rows.push({ order_id: o.id, title: o.title, qty: o.qty, mode: o.mode, paid_at: o.paid_at || o.created, order_status: o.status, livemode: !!o.livemode,
          job: { id: j.id, kind: j.kind, supplier: j.supplier, supplier_name: supplierName(j.supplier), label: `${KIND_LABEL[j.kind]} · ${supplierName(j.supplier)}`,
            status: j.status, ship_to: j.ship_to, parts: j.parts.length, units: j.parts.reduce((a, p) => a + p.qty, 0), cost: jobCost(j), order_no: j.order_no || null,
            tracking: j.tracking || null }, margin_usd: s.margin_usd });
      }
      if (plan.error) rows.push({ order_id: o.id, title: o.title, qty: o.qty, mode: o.mode, paid_at: o.paid_at || o.created, order_status: o.status, error: plan.error });
    }
    return rows.sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)));
  }

  /** After a job change: paid -> printing when the first job is placed; shipped when every job went straight to the customer. */
  function syncOrder(plan, order, by) {
    const live = plan.jobs.filter((j) => j.status !== 'skipped');
    const placed = live.some((j) => ['placed', 'shipped', 'received'].includes(j.status));
    const direct = live.length && live.every((j) => j.ship_to === 'customer' && ['shipped', 'received'].includes(j.status) && j.tracking);
    updateOrder(order.id, (o) => {
      let changed = false;
      if (direct && o.status !== 'shipped') {
        o.tracking = live.map((j) => ({ carrier: j.carrier || '', number: j.tracking, url: trackingUrl(j.carrier, j.tracking) }));
        o.status = 'shipped'; o.shipped_at = new Date().toISOString(); changed = true;
      } else if (placed && o.status === 'paid') { o.status = 'printing'; changed = true; }
      if (changed) { o.status_at = new Date().toISOString(); o.status_by = by; }
      return changed;
    });
  }

  function readPartFor(plan) {
    const dir = designDir(plan.source);
    return (rel) => {
      if (!dir || !rel) return null;
      const abs = path.resolve(dir, rel);
      if (!abs.startsWith(path.resolve(dir) + path.sep)) return null;
      try { return fs.readFileSync(abs); } catch { return null; }
    };
  }

  function zipFor(plan, order, j) {
    const read = readPartFor(plan);
    const entries = [], seen = new Set();
    const put = (name, data) => { let n = name, k = 2; while (seen.has(n)) n = name.replace(/(\.\w+)?$/, `-${k++}$1`); seen.add(n); entries.push({ name: n, data }); };
    for (const p of j.parts) for (const f of p.files) {
      const buf = read(f.rel); if (!buf) continue;
      const base = path.basename(f.rel).replace(/\.stl$/i, '');
      if (f.type === 'dxf') { const d = plateDxf(buf); if (d) put(`${base}.dxf`, Buffer.from(d.dxf)); continue; }
      put(path.basename(f.rel), buf);
      for (const ext of ['.step', '.stp']) { const s = read(f.rel.replace(/\.stl$/i, ext)) || read(f.rel.replace(/^stl\//, 'step/').replace(/\.stl$/i, ext)); if (s) { put(base + ext, s); break; } }
    }
    put('ORDER.txt', Buffer.from(kitFor(j, plan, order).text + '\n'));
    return zip(entries);
  }

  const log = (plan, by, what) => { plan.log = [...(plan.log || []), { t: new Date().toISOString(), by, what }].slice(-200); };

  /** /api/admin/fulfilment/... (server/admin.js checks admin first). rest = path parts after "fulfilment". */
  async function adminApi(req, res, { rest, m, acc, readBody }) {
    const [oid, jid, action] = rest;
    const by = acc.user || 'admin';
    if (!oid && m === 'GET') return send(res, 200, { jobs: queue(), ship_from: shipFrom() });
    const order = oid && loadOrders().find((x) => x.id === oid);
    if (!order) return send(res, 404, { error: 'order not found' });
    if (!PAIDISH.has(order.status) && !readJSON(fileOf(oid), null)) return send(res, 409, { error: `This order is ${order.status}. Plans start when it is paid.` });
    let plan = getPlan(order, true) || readJSON(fileOf(oid), null);
    if (!plan) return send(res, 409, { error: 'No plan for this order.' });

    if (!jid) {
      if (m === 'GET') return send(res, 200, view(plan, order));
      if (m === 'PATCH') {
        const b = await readBody(req, 2e4);
        updateOrder(oid, (o) => {
          if (b.shipped) {
            const n = str(b.tracking, 80);
            if (n) o.tracking = [...(Array.isArray(o.tracking) ? o.tracking : []).filter((t) => t.number !== n), { carrier: str(b.carrier, 40), number: n, url: trackingUrl(b.carrier, n) }];
            o.status = 'shipped'; o.shipped_at = new Date().toISOString();
          } else if (b.status === 'printing' || b.status === 'paid') o.status = b.status;
          else return false;
          o.status_at = new Date().toISOString(); o.status_by = by;
        });
        log(plan, by, b.shipped ? `Shipped to customer${b.tracking ? ` (${str(b.carrier, 40)} ${str(b.tracking, 80)})` : ''}` : `Order status ${b.status}`);
        savePlan(plan);
        return send(res, 200, view(plan, loadOrders().find((x) => x.id === oid)));
      }
      return send(res, 405, { error: 'method not allowed' });
    }
    if (jid === 'rebuild' && m === 'POST') {
      if (plan.jobs.some((j) => ['placed', 'shipped', 'received'].includes(j.status))) return send(res, 409, { error: 'Some jobs are already placed. Edit them instead of rebuilding.' });
      const fresh = createPlan(order); fresh.log = [...(plan.log || []), { t: new Date().toISOString(), by, what: 'Plan rebuilt from the current parts list' }];
      return send(res, 200, view(savePlan(fresh), order));
    }
    const j = plan.jobs.find((x) => x.id === jid);
    if (!j) return send(res, 404, { error: 'job not found' });
    const key = `${oid}/${jid}`;

    if (!action && m === 'PATCH') {
      const b = await readBody(req, 2e4);
      const changes = [];
      if (b.supplier != null) {
        if (!j.alternatives.includes(b.supplier) || !SUPPLIERS[b.supplier]) return send(res, 400, { error: 'That supplier is not an option for this job.' });
        if (b.supplier !== j.supplier) { j.supplier = b.supplier; delete j.slant; if (j.status === 'quoted') j.status = 'todo'; changes.push(`supplier ${supplierName(b.supplier)}`); }
      }
      if (b.ship_to != null) {
        if (!['us', 'customer'].includes(b.ship_to)) return send(res, 400, { error: 'ship_to is us or customer' });
        if (b.ship_to !== j.ship_to) { j.ship_to = b.ship_to; if (j.slant) { delete j.slant; if (j.status === 'quoted') j.status = 'todo'; } changes.push(`ship to ${b.ship_to}`); }
      }
      if (b.status != null) {
        if (!JOB_STATUSES.includes(b.status)) return send(res, 400, { error: `status must be one of ${JOB_STATUSES.join(', ')}` });
        if (b.status !== j.status) { j.status = b.status; j[b.status + '_at'] = new Date().toISOString(); changes.push(`status ${b.status}`); }
      }
      for (const [k, n] of [['order_no', 80], ['carrier', 40], ['tracking', 80], ['note', 1000]]) {
        if (b[k] != null && str(b[k], n) !== (j[k] || '')) { j[k] = str(b[k], n); changes.push(`${k.replace('_', ' ')} ${j[k] || '(cleared)'}`); }
      }
      if (b.cost_actual_usd !== undefined) {
        const v = b.cost_actual_usd === '' || b.cost_actual_usd === null ? null : Number(b.cost_actual_usd);
        if (v != null && !(v >= 0 && v < 1e6)) return send(res, 400, { error: 'cost must be a dollar amount' });
        if (v == null) delete j.cost_actual_usd; else j.cost_actual_usd = r2(v);
        changes.push(`actual cost ${v == null ? '(cleared)' : '$' + r2(v).toFixed(2)}`);
      }
      if (j.tracking && j.status === 'placed') { j.status = 'shipped'; j.shipped_at = new Date().toISOString(); changes.push('status shipped'); }
      if (changes.length) log(plan, by, `${j.id} ${supplierName(j.supplier)}: ${changes.join(', ')}`);
      savePlan(plan); syncOrder(plan, order, by);
      return send(res, 200, view(plan, loadOrders().find((x) => x.id === oid)));
    }

    if (action === 'zip' && m === 'GET') {
      const buf = zipFor(plan, order, j);
      const name = `${oid}-${j.id}-${j.supplier}.zip`;
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      return res.end(buf);
    }

    if ((action === 'quote' || action === 'checkout') && m === 'POST') {
      const sup = SUPPLIERS[j.supplier];
      if (busy.has(key)) return send(res, 409, { error: 'Already working on this job. Wait a moment.' });
      const b = await readBody(req, 2e4);
      const shipTo = j.ship_to === 'customer' ? order.ship_to : shipFrom();
      const ctx = { order, plan, shipTo, readPart: readPartFor(plan), email: env('BUILDERY_SHIP_FROM_EMAIL') || env('BUILDERY_ORDERS_EMAIL'), confirm: false };
      busy.add(key);
      try {
        if (action === 'quote') {
          const r = await sup.quote(j, ctx);
          if (r?.manual) return send(res, 200, { manual: true, reason: r.reason, ...view(plan, order) });
          plan = readJSON(fileOf(oid), plan); const jj = plan.jobs.find((x) => x.id === jid); // re-read: other edits may have landed meanwhile
          jj.slant = r; if (jj.status === 'todo') jj.status = 'quoted';
          log(plan, by, `${jid} Slant quote ${r.quote_id}: $${r.subtotal_usd} + shipping${r.shipping_options[0] ? ` $${r.shipping_options[0].rate_usd}` : ' (none)'}`);
          savePlan(plan);
          return send(res, 200, view(plan, order));
        }
        // checkout: Slant only, and only because an admin clicked "Create Slant payment link" (b.confirm === true from the UI).
        if (typeof sup.checkout !== 'function') return send(res, 400, { error: `${sup.name} has no payment-link step. Use the order kit.` });
        if (b.confirm !== true) return send(res, 400, { error: 'Confirm the payment link from the admin panel.' });
        if (j.slant?.checkout?.checkout_url && !b.again) return send(res, 200, view(plan, order));
        const r = await sup.checkout(j, { ...ctx, confirm: true }, { shipping_option_id: str(b.shipping_option_id, 120) || null });
        plan = readJSON(fileOf(oid), plan); const jj = plan.jobs.find((x) => x.id === jid);
        jj.slant = { ...(jj.slant || {}), checkout: r, chosen_shipping: r.shipping_option_id };
        const opt = (jj.slant.shipping_options || []).find((o) => o.id === r.shipping_option_id);
        if (opt && jj.slant.subtotal_usd != null) jj.slant.total_usd = r2(jj.slant.subtotal_usd + (opt.rate_usd || 0));
        log(plan, by, `${jid} Slant payment link created (${r.shipping_option_id}). Not paid.`);
        savePlan(plan);
        return send(res, 200, view(plan, order));
      } catch (e) {
        console.error(`[fulfilment] ${action} ${key}: ${e.message}`);
        return send(res, e.code >= 400 && e.code < 500 ? e.code : 502, { error: String(e.message || e).slice(0, 300) });
      } finally { busy.delete(key); }
    }
    return send(res, 404, { error: 'no such endpoint' });
  }

  return { onPaid, adminApi, getPlan, queue };
}

module.exports = { init, planJobs, jobCost, summary, kitFor, shipFrom, trackingUrl, SUPPLIERS, JOB_STATUSES };
