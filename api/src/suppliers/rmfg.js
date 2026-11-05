'use strict';
// rmfg: live quotes for metal parts from RMFG (rmfg.com, Fort Worth TX: laser-cut + bent sheet, laser-cut tube,
// tapping, hardware, powder coat). Agent API: https://www.rmfg.com/docs/api/agent-guide.txt
//
// Auth: an OAuth device-flow connection (scopes designs dfm quotes carts; never payments), stored in
// DATA/.rmfg-token.json (mode 600). Access tokens last 15 min; each refresh returns a new refresh token and reusing a
// spent one revokes the connection, so refreshes are serialized here and only one process may use the file.
// First start: if the file is missing and RMFG_TOKEN_JSON is set (the whole token JSON), it is written to the file once;
// from then on the file is the source of truth (the env value goes stale after the first refresh).
// RMFG_CLIENT_ID picks the OAuth client (default 'rmfg-agent', RMFG's public agent client).
// Nothing here can place an order: carts are links a person opens and pays on rmfg.com.
//
// quoteStep(stepFile, {material, qtys}) uploads a STEP file, picks catalog stock for each part (sheet: the material
// family at the detected thickness; tube: the nearest tube profile) and returns prices at each quantity, the DFM
// findings and a review link. Results are cached by file hash + options in DATA/.sourcing/rmfg/.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UA = require('../ua');

const API = 'https://api.rmfg.com';
const CLIENT_ID = process.env.RMFG_CLIENT_ID || 'rmfg-agent';
let DATA = '';
let refreshing = null;
const catalogs = { at: 0, materials: null, tubes: null };

function tokenFile() { return path.join(DATA, '.rmfg-token.json'); }
function readToken() { try { return JSON.parse(fs.readFileSync(tokenFile(), 'utf8')); } catch { return null; } }
function connected() { return !!readToken()?.refresh_token; }

async function accessToken() {
  const t = readToken();
  if (!t) throw Object.assign(new Error('RMFG is not connected'), { code: 'rmfg_not_connected' });
  if (t.access_token && Date.now() < t.obtained_at + ((t.expires_in || 900) - 60) * 1000) return t.access_token;
  if (!refreshing) {
    refreshing = (async () => {
      const r = await fetch(`${API}/v1/oauth/token`, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: t.refresh_token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw Object.assign(new Error(`RMFG token refresh failed (${r.status}); reconnect RMFG`), { code: 'rmfg_reconnect' });
      j.obtained_at = Date.now();
      fs.writeFileSync(tokenFile(), JSON.stringify(j), { mode: 0o600 });
      return j.access_token;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function api(p, { method = 'GET', json, form, key, wait } = {}) {
  const headers = { 'User-Agent': UA, Authorization: `Bearer ${await accessToken()}` };
  if (key) headers['Idempotency-Key'] = key;
  if (wait) headers.Prefer = `wait=${wait}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  for (let i = 0; ; i++) {
    const r = await fetch(p.startsWith('http') ? p : API + p, { method, headers, body });
    if (r.status === 429 && i < 3) { await sleep(1000 * (Number(r.headers.get('retry-after')) || 2)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`RMFG ${method} ${p}: ${r.status} ${j.error?.message || ''}`.trim()), { status: r.status, detail: j.error });
    return j;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(obj, done, ms = 90e3) {
  const end = Date.now() + ms;
  while (!done(obj) && Date.now() < end) { await sleep(2000); obj = await api(obj.status_url); }
  return obj;
}
async function list(p) {
  const out = []; let cursor = null;
  for (let i = 0; i < 20; i++) {
    const j = await api(`${p}${p.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(j.data || []));
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return out;
}
async function loadCatalogs() {
  if (catalogs.materials && Date.now() - catalogs.at < 24 * 3600e3) return catalogs;
  catalogs.materials = await list('/v1/materials');
  catalogs.tubes = await list('/v1/tube-profiles');
  catalogs.at = Date.now();
  return catalogs;
}

// ---------------------------------------------------------------- quoting
const FAMILY = { // our material words -> RMFG catalog (material, type preference)
  aluminium: ['Aluminum', /5052|6061/], aluminum: ['Aluminum', /5052|6061/], steel: ['Steel', /Cold Rolled|DOM|ERW/],
  stainless: ['Stainless Steel', /304/],
};
function family(word) { return FAMILY[String(word || 'aluminium').toLowerCase()] || FAMILY.aluminium; }
const near = (list, f) => list.slice().sort((a, b) => f(a) - f(b))[0] || null;

/** Catalog stock for one analysed part: a tube profile for tubes, else sheet at the detected thickness. */
function pickStock(part, cat, material) {
  const [fam, pref] = family(material);
  const tube = part.tube;
  if (tube || /tube/i.test(part.suggested_process || '')) {
    const xs = tube?.cross_section || {};
    const fd = part.formed_dimensions || {};
    const od = xs.outer_diameter_mm || xs.outer_width_mm || Math.min(fd.length_mm || 0, fd.width_mm || 0, fd.height_mm || 0);
    const wall = xs.wall_thickness_mm || 2;
    const shape = xs.shape || 'round';
    let pool = cat.tubes.filter((t) => t.shape === shape);
    const same = pool.filter((t) => t.material === fam);
    if (same.length) pool = same;
    const t = near(pool, (t) => Math.abs((t.outer_diameter_mm || t.outer_width_mm || 0) - od) * 4 + Math.abs((t.wall_thickness_mm || 0) - wall));
    return t ? { tube_profile_id: t.id, stock: t.display_name } : null;
  }
  const th = part.detected_thickness_mm || 1.6;
  let pool = cat.materials.filter((m) => m.material === fam);
  const typed = pool.filter((m) => pref.test(m.type)); if (typed.length) pool = typed;
  const m = near(pool, (m) => Math.abs(m.thickness_mm - th));
  return m ? { material_id: m.id, stock: `${m.material} ${m.type} ${m.display_thickness}` } : null;
}

function cacheFile(key) { return path.join(DATA, '.sourcing', 'rmfg', key + '.json'); }

const TTL = 7 * 86400e3;
function keyOf(buf, opts) {
  const qtys = (opts.qtys || [1, 10, 100]).slice(0, 11);
  return crypto.createHash('sha256').update(buf).update(JSON.stringify([opts.material || '', qtys])).digest('hex').slice(0, 24);
}
/** The cached quote for this file + options (sync), or null. */
function cached(stepFile, opts = {}) {
  try { const c = JSON.parse(fs.readFileSync(cacheFile(keyOf(fs.readFileSync(stepFile), opts)), 'utf8')); return Date.now() - c.at < TTL ? c : null; } catch { return null; }
}
const running = new Map(); // cache key -> promise (one upload per file at a time)
/** Start a background quote if none is cached or running. Returns the promise. */
function ensure(stepFile, opts = {}) {
  let k; try { k = keyOf(fs.readFileSync(stepFile), opts); } catch { return null; }
  if (running.has(k)) return running.get(k);
  const p = quoteStep(stepFile, opts).catch((e) => {
    console.error(`[rmfg] quote failed for ${path.basename(stepFile)}: ${e.message}`);
    const out = { at: Date.now(), error: e.message.slice(0, 200) };
    try { fs.mkdirSync(path.dirname(cacheFile(k)), { recursive: true }); fs.writeFileSync(cacheFile(k), JSON.stringify(out)); } catch {}
    return out;
  }).finally(() => running.delete(k));
  running.set(k, p);
  return p;
}
function quoting(stepFile, opts = {}) { try { return running.has(keyOf(fs.readFileSync(stepFile), opts)); } catch { return false; } }

/** Quote a STEP file. opts: { material ('aluminium' | 'steel' | 'stainless'), qtys ([1, 10, 100]), name } */
async function quoteStep(stepFile, opts = {}) {
  const qtys = (opts.qtys || [1, 10, 100]).slice(0, 11);
  const buf = fs.readFileSync(stepFile);
  const key = keyOf(buf, opts);
  try { const c = JSON.parse(fs.readFileSync(cacheFile(key), 'utf8')); if (!c.error && Date.now() - c.at < TTL) return c; } catch {}
  const cat = await loadCatalogs();
  const form = new FormData();
  const base = (opts.name || path.basename(stepFile, path.extname(stepFile))).replace(/[^\w.-]+/g, '-').replace(/\.(step|stp)$/i, '');
  form.append('file', new Blob([buf]), `${base || 'part'}.step`); // RMFG checks the extension
  let design = await api('/v1/analyze', { method: 'POST', form, key: `pm-analyze-${key}`, wait: 30 });
  design = await poll(design, (d) => !/queued|processing|pending/.test(d.status), 120e3);
  if (design.status !== 'ready') throw new Error(`RMFG analysis ${design.status}: ${design.error?.message || ''}`);
  const parts = design.parts || [];
  const conf = [], stock = [];
  for (const p of parts) {
    const s = pickStock(p, cat, opts.material);
    if (!s) throw new Error(`no RMFG stock for part ${p.name}`);
    const { stock: label, ...ids } = s;
    conf.push({ part_id: p.id, ...ids });
    stock.push({ part: p.name, process: p.suggested_process, stock: label, thickness_mm: p.detected_thickness_mm, bends: p.bend_count, holes: p.hole_count });
  }
  const qkey = crypto.createHash('sha256').update(key + JSON.stringify(conf)).digest('hex').slice(0, 24); // a new stock choice is a new request
  let q = await api('/v1/quotes', { method: 'POST', key: `pm-quote-${qkey}`, json: { items: [{ design_id: design.id, quantity: qtys[0], quantity_options: qtys.slice(1), configuration: { parts: conf } }] } });
  q = await poll(q, (x) => !/queued|processing|pending/.test(x.status), 120e3);
  const item = q.items?.[0] || {};
  const prices = [{ qty: item.quantity, unit_usd: cents(item.unit_amount_cents), total_usd: cents(item.amount_cents) }]
    .concat((item.quantity_options || []).map((o) => ({ qty: o.quantity, unit_usd: cents(o.unit_amount_cents), total_usd: cents(o.amount_cents) })));
  const findings = [...(q.requirements || []), ...(item.requirements || [])].map((r) => r.message || r.code || JSON.stringify(r)).slice(0, 8);
  // Seen 3 Nov: a round tube with a milled slot and 2 holes analysed with no features, priced as a plain cut tube.
  // Say so instead of passing a too-low price off as the real one.
  const blindTube = parts.some((p) => p.tube && !(p.tube.features || []).length && !p.hole_count);
  if (blindTube) findings.unshift('RMFG found no holes or slots in this tube, so the price may be for a plain cut tube. Check the cuts on rmfg.com before ordering.');
  const out = { at: Date.now(), supplier: 'RMFG', status: q.status, quote_id: q.id, design_id: design.id, review_url: design.review_url || null,
    stock, prices, findings, lead: q.fulfillment || null };
  fs.mkdirSync(path.dirname(cacheFile(key)), { recursive: true });
  fs.writeFileSync(cacheFile(key), JSON.stringify(out, null, 1));
  return out;
}
const cents = (c) => (c == null ? null : Math.round(c) / 100);

function init(dataDir) {
  DATA = dataDir;
  const seed = process.env.RMFG_TOKEN_JSON;
  if (seed && !fs.existsSync(tokenFile())) {
    try {
      const t = JSON.parse(seed);
      if (t.refresh_token) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(tokenFile(), JSON.stringify(t), { mode: 0o600 }); console.log('[rmfg] token written from RMFG_TOKEN_JSON'); }
    } catch { console.error('[rmfg] RMFG_TOKEN_JSON is not valid JSON; ignored'); }
  }
  return module.exports;
}
module.exports = { init, connected, api, poll, list, loadCatalogs, quoteStep, pickStock, cached, ensure, quoting };
