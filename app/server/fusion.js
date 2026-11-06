'use strict';
// fusion: "buy this part" from inside Autodesk Fusion (add-in in fusion-addin/Premake). Josh, 3 Nov 2026: hover a part,
// see a price, click to buy from local manufacturers. Our edge is how well we predict the price, so every estimate,
// live supplier quote and (later) shop reply is logged to learn from.
//
// Connect (device flow, like RMFG's): the add-in POSTs /api/fusion/connect/start, opens /fusion/connect?code=XXXX-XXXX in
// the browser, the signed-in user approves, and the add-in exchanges its device code for a token (pmk_...) at
// /api/fusion/connect/token. Tokens are stored hashed in DATA/.fusion/tokens.json and map to the Premake user.
//   POST /api/fusion/estimate  Bearer  {parts:[{name, bbox_mm:[x,y,z], volume_mm3, area_mm2, material, qty}]} -> instant prices
//   POST /api/fusion/quote     Bearer  {parts:[...same + step_b64]} -> {id, url} a quote page with live supplier prices
//   GET  /rfq/<id>                    the quote page (its owner only)
// Nothing here orders, pays or emails anyone. Sending requests to local shops is phase 2, behind Josh's approval.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let C = {}; // { DATA, send, readBody, allow, rmfg, afn, materiam, BASE }
const dir = () => path.join(C.DATA, '.fusion');
const rfqDir = (id) => path.join(dir(), 'rfq', id);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '–' : `$${Number(n).toFixed(2)}`);

// ---------------------------------------------------------------- connect (device flow)
const pending = new Map(); // device_code -> { user_code, exp, user }
function userCode() { const a = 'BCDFGHJKLMNPQRSTVWXZ23456789'; let s = ''; for (const b of crypto.randomBytes(8)) s += a[b % a.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; }
function tokenUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer (pmk_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const t = readJ(path.join(dir(), 'tokens.json'), {})[sha(m[1])];
  return t && !t.revoked ? t.user : null;
}

// ---------------------------------------------------------------- the price model (v0; learns from logged quotes)
// Process guess from the material and shape; prices are a fair LOCAL-SHOP price, not the cheapest overseas offer.
const MATS = {
  aluminum_6061: { label: 'Aluminum 6061', density: 2.70, usd_kg: 9, metal: true },
  steel: { label: 'Mild steel', density: 7.85, usd_kg: 4, metal: true },
  stainless_304: { label: 'Stainless 304', density: 8.0, usd_kg: 11, metal: true },
  petg_print: { label: 'PETG (3D printed)', density: 1.27, usd_kg: 25, print: true },
  acrylic_laser: { label: 'Acrylic (laser cut)', density: 1.19, usd_kg: 12, laser: true },
};
function guessMaterial(m) {
  const s = String(m || '').toLowerCase();
  if (/stainless/.test(s)) return 'stainless_304';
  if (/steel|iron/.test(s)) return 'steel';
  if (/acryl|pmma|plexi/.test(s)) return 'acrylic_laser';
  if (/pla|petg|abs|nylon|plastic|resin|print/.test(s)) return 'petg_print';
  return 'aluminum_6061';
}
function estimatePart(p) {
  const bb = (p.bbox_mm || []).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
  if (bb.length !== 3) return { error: 'missing size' };
  const vol = Math.max(1, Number(p.volume_mm3) || bb[0] * bb[1] * bb[2] * 0.4) / 1000; // cm3
  const box = (bb[0] * bb[1] * bb[2]) / 1000; // cm3
  const qty = Math.max(1, Math.min(10000, Math.round(Number(p.qty) || 1)));
  const key = MATS[p.material] ? p.material : guessMaterial(p.material);
  const M = MATS[key];
  const wall = Number(p.area_mm2) > 0 ? (2 * vol * 1000) / Number(p.area_mm2) : null; // mm: average wall thickness (sheet / tube test)
  let process, unit, setup, lead, why;
  if (M.print) {
    const g = vol * M.density, h = 0.25 + g / 12;
    process = 'print'; unit = g * 0.025 + h * 0.40 + 1.5; setup = 0; lead = 3; why = `${g.toFixed(0)} g, about ${h.toFixed(1)} h of printing`;
  } else if (M.metal && wall && wall <= 3.5 && Math.abs(bb[1] - bb[0]) / bb[1] < 0.03 && bb[2] > bb[1] * 1.2) {
    // thin-walled, square cross-section, long: tube, laser cut to length (holes and slots priced roughly by length)
    const kg = vol * M.density / 1000;
    process = 'tube'; unit = kg * M.usd_kg * 2.2 + 6 + bb[2] * 0.02; setup = 25; lead = 6;
    why = `${bb[0].toFixed(1)} mm tube, ${bb[2].toFixed(0)} mm long, ${wall.toFixed(1)} mm wall`;
  } else if (M.laser || (M.metal && wall && wall <= 6.5)) {
    // thin plate: laser cut, bent when the part has depth beyond its own thickness
    const bent = !M.laser && bb[0] > wall * 3;
    const flat = (Number(p.area_mm2) || 2 * bb[1] * bb[2]) / 2 / 100; // cm2, one side
    process = M.laser ? 'laser' : bent ? 'sheet_bent' : 'sheet';
    unit = 4 + flat * 0.06 * (M.metal ? 1 : 0.5) + (bent ? 6 : 0); setup = M.laser ? 10 : 30; lead = bent ? 7 : 5;
    why = `${flat.toFixed(0)} cm² of ${(wall || bb[0]).toFixed(1)} mm ${M.label.toLowerCase()}${bent ? ', bent' : ''}`;
  } else {
    // CNC from bar or block: stock + machining time; setup spread over the batch
    const stockKg = box * 1.15 * M.density / 1000, removed = Math.max(0, box - vol);
    const minutes = 12 + removed * 0.16 + Math.sqrt(Number(p.area_mm2) || 0) * 0.04;
    process = 'cnc'; unit = stockKg * M.usd_kg + (minutes / 60) * 85; setup = 90; lead = 8;
    why = `${(stockKg * 1000).toFixed(0)} g of stock, about ${minutes.toFixed(0)} min machining`;
  }
  const disc = qty >= 100 ? 0.55 : qty >= 25 ? 0.7 : qty >= 10 ? 0.8 : qty >= 5 ? 0.9 : 1;
  const each = Math.round((unit * disc + setup / qty) * 100) / 100;
  return { process, material: key, material_label: M.label, qty, each_usd: each, total_usd: Math.round(each * qty * 100) / 100, lead_days: lead, why, model: 'v0' };
}

// ---------------------------------------------------------------- live supplier quotes for a quote's parts
function liveQuotes(id) {
  const q = readJ(path.join(rfqDir(id), 'rfq.json'), null);
  if (!q) return;
  q.parts.forEach((p, i) => {
    if (!p.step) return;
    const file = path.join(rfqDir(id), p.step);
    const metal = !['print', 'laser'].includes(p.estimate?.process);
    if (!metal) return;
    const material = /stainless/.test(p.estimate.material) ? 'stainless' : /steel/.test(p.estimate.material) ? 'steel' : 'aluminium';
    const qtys = [...new Set([1, p.qty, 10, 100])].filter((x) => x > 0).sort((a, b) => a - b).slice(0, 4);
    if (/sheet|tube/.test(p.estimate.process) && C.rmfg?.connected()) C.rmfg.ensure(file, { material, qtys, name: p.name });
    if (/sheet|tube/.test(p.estimate.process) && C.materiam) C.materiam.ensure(file, { material, qtys });
    if (p.estimate.process === 'cnc' && C.afn) C.afn.ensure(file, { process: 'cnc', material: p.estimate.material === 'aluminum_6061' ? 'aluminum 6061' : p.estimate.material.replace('_', ' '), qtys });
  });
}
function liveFor(id, p) {
  if (!p.step) return [];
  const file = path.join(rfqDir(id), p.step), out = [];
  const material = /stainless/.test(p.estimate?.material) ? 'stainless' : /steel/.test(p.estimate?.material) ? 'steel' : 'aluminium';
  const qtys = [...new Set([1, p.qty, 10, 100])].filter((x) => x > 0).sort((a, b) => a - b).slice(0, 4);
  const r = C.rmfg?.cached?.(file, { material, qtys, name: p.name });
  if (r && !r.error) { const row = (r.prices || []).filter((x) => x.qty <= p.qty).sort((a, b) => b.qty - a.qty)[0]; if (row) out.push({ who: 'RMFG (Texas, laser + bend)', each: row.unit_usd, note: (r.findings || [])[0] || r.stock?.map((s) => s.stock).join(', ') }); }
  const mt = C.materiam?.cached?.(file, { material, qtys });
  if (mt && !mt.error) { const row = (mt.prices || []).filter((x) => x.qty <= p.qty).sort((a, b) => b.qty - a.qty)[0]; if (row) out.push({ who: 'MATERIAM (Querétaro MX, laser + bend + weld)', each: row.unit_usd, note: [(mt.stock || []).join(', '), row.ships_by && `ships by ${row.ships_by}`, ...(mt.findings || [])].filter(Boolean).join(' · ') }); }
  const a = C.afn?.cached?.(file, { process: 'cnc', material: p.estimate?.material === 'aluminum_6061' ? 'aluminum 6061' : String(p.estimate?.material || '').replace('_', ' '), qtys });
  if (a && !a.error) {
    const offers = (a.offers || []).filter((o) => o.qty === p.qty || o.qty === 1).sort((x, y) => x.unit_usd - y.unit_usd);
    for (const o of offers.slice(0, 3)) out.push({ who: `${o.vendor} (via AFN)`, each: o.unit_usd, note: `qty ${o.qty}${o.finish && o.finish !== 'standard' ? ', ' + o.finish : ', unfinished'}${o.ships_from?.length ? ', ships from ' + o.ships_from.join('/') : ''}` });
  }
  return out;
}

// ---------------------------------------------------------------- pages
function page(res, code, title, body) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Premake</title>
<style>body{font:16px/1.5 system-ui,-apple-system,sans-serif;max-width:46rem;margin:3rem auto;padding:0 16px;background:#fafaf9;color:#1c1917}
h1{font-size:26px;margin:0 0 6px}p.sub{color:#78716c;margin:0 0 22px}.card{background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:16px 18px;margin:0 0 12px}
.row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.big{font-size:22px;font-weight:650}.muted{color:#78716c;font-size:14px}
.code{font:600 28px ui-monospace,monospace;letter-spacing:2px}button{font:inherit;font-weight:600;padding:11px 18px;border-radius:10px;border:0;background:#e8590c;color:#fff;cursor:pointer}
ul{margin:8px 0 0;padding-left:18px}li{font-size:14px;color:#44403c}</style></head><body>${body}</body></html>`);
}

async function handle(req, res, { parts, m, acc, url }) {
  const P = url.pathname;
  // connect: start (the add-in, no login)
  if (P === '/api/fusion/connect/start' && m === 'POST') {
    if (!C.allow('fusion-start:' + (req.socket.remoteAddress || '?'), 20, 3600e3)) return C.send(res, 429, { error: 'Too many connect attempts' });
    const device_code = crypto.randomBytes(24).toString('base64url'), user_code = userCode();
    pending.set(device_code, { user_code, exp: Date.now() + 15 * 60e3, user: null });
    return C.send(res, 200, { device_code, user_code, url: `${C.BASE(req)}/fusion/connect?code=${user_code}`, interval: 3, expires_in: 900 });
  }
  if (P === '/api/fusion/connect/token' && m === 'POST') {
    const body = await C.readBody(req, 4e3).catch(() => ({}));
    const d = pending.get(String(body.device_code || ''));
    if (!d || d.exp < Date.now()) return C.send(res, 400, { error: 'expired_token' });
    if (!d.user) return C.send(res, 400, { error: 'authorization_pending' });
    pending.delete(String(body.device_code));
    const token = 'pmk_' + crypto.randomBytes(24).toString('base64url');
    const f = path.join(dir(), 'tokens.json'), all = readJ(f, {});
    all[sha(token)] = { user: d.user, created: new Date().toISOString(), client: 'fusion' };
    writeJ(f, all);
    return C.send(res, 200, { token, user: d.user });
  }
  // connect: the browser page (signed in)
  if (P === '/fusion/connect' && (m === 'GET' || m === 'POST')) {
    if (!acc.authed) { res.writeHead(302, { Location: `/auth/signin?next=${encodeURIComponent(P + url.search)}`, 'Cache-Control': 'no-store' }); return res.end(); }
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    const entry = [...pending.entries()].find(([, v]) => v.user_code === code && v.exp > Date.now());
    if (!entry) return page(res, 404, 'Connect Fusion', '<h1>That code has expired</h1><p class="sub">Click Connect in the Fusion add-in again.</p>');
    if (m === 'POST') { entry[1].user = acc.user; return page(res, 200, 'Connected', '<h1>Fusion is connected</h1><p class="sub">Go back to Fusion. You can close this tab.</p>'); }
    return page(res, 200, 'Connect Fusion', `<h1>Connect Fusion to Premake</h1><p class="sub">Check this code matches the one in Fusion, then connect. The add-in can get prices and create quotes for ${esc(acc.user)}. It can't order or pay.</p>
<div class="card"><div class="code">${esc(code)}</div></div><form method="post"><button type="submit">Connect</button></form>`);
  }
  // estimate (instant, for hover)
  if (P === '/api/fusion/estimate' && m === 'POST') {
    const user = tokenUser(req) || (acc.authed ? acc.user : null);
    if (!user) return C.send(res, 401, { error: 'Connect the add-in to Premake first' });
    if (!C.allow('fusion-est:' + user, 600, 3600e3)) return C.send(res, 429, { error: 'Too many requests' });
    const body = await C.readBody(req, 64e3).catch(() => ({}));
    const list = (Array.isArray(body.parts) ? body.parts : []).slice(0, 50).map((p) => ({ name: String(p.name || 'Part').slice(0, 80), ...estimatePart(p) }));
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(path.join(dir(), 'estimates.jsonl'), JSON.stringify({ t: Date.now(), user, parts: list }) + '\n'); // the learning log
    return C.send(res, 200, { parts: list });
  }
  // quote (upload STEP files, live supplier prices start in the background)
  if (P === '/api/fusion/quote' && m === 'POST') {
    const user = tokenUser(req) || (acc.authed ? acc.user : null);
    if (!user) return C.send(res, 401, { error: 'Connect the add-in to Premake first' });
    if (!C.allow('fusion-quote:' + user, 30, 3600e3)) return C.send(res, 429, { error: 'Too many quotes this hour' });
    const body = await C.readBody(req, 40e6).catch((e) => ({ _err: e.message }));
    if (body._err) return C.send(res, 413, { error: body._err });
    const id = crypto.randomBytes(8).toString('hex');
    const partsIn = (Array.isArray(body.parts) ? body.parts : []).slice(0, 25);
    if (!partsIn.length) return C.send(res, 400, { error: 'No parts' });
    const out = [];
    partsIn.forEach((p, i) => {
      const est = estimatePart(p);
      const rec = { name: String(p.name || `Part ${i + 1}`).slice(0, 80), qty: est.qty || 1, bbox_mm: p.bbox_mm, volume_mm3: p.volume_mm3, area_mm2: p.area_mm2, material_in: p.material, estimate: est };
      if (typeof p.step_b64 === 'string' && p.step_b64.length < 30e6) {
        const buf = Buffer.from(p.step_b64, 'base64');
        if (/ISO-10303-21/.test(buf.subarray(0, 200).toString('latin1'))) { // a real STEP file, nothing else is stored
          fs.mkdirSync(rfqDir(id), { recursive: true });
          rec.step = `part-${i + 1}.step`;
          fs.writeFileSync(path.join(rfqDir(id), rec.step), buf, { mode: 0o600 });
        }
      }
      out.push(rec);
    });
    writeJ(path.join(rfqDir(id), 'rfq.json'), { id, user, created: new Date().toISOString(), source: String(body.source || 'fusion').slice(0, 40), doc: String(body.doc || '').slice(0, 120), parts: out });
    liveQuotes(id);
    return C.send(res, 200, { id, url: `${C.BASE(req)}/rfq/${id}` });
  }
  // the quote page
  if (parts[0] === 'rfq' && parts.length === 2 && /^[0-9a-f]{16}$/.test(parts[1]) && m === 'GET') {
    const q = readJ(path.join(rfqDir(parts[1]), 'rfq.json'), null);
    if (!q || !acc.authed || (q.user !== acc.user && !acc.local)) return page(res, 404, 'Quote', '<h1>Quote not found</h1><p class="sub">Sign in with the account that made it.</p>');
    let total = 0;
    const cards = q.parts.map((p) => {
      const e = p.estimate || {}; total += e.total_usd || 0;
      const live = liveFor(q.id, p);
      return `<div class="card"><div class="row"><div><b>${esc(p.name)}</b> <span class="muted">× ${p.qty}</span><div class="muted">${esc(e.material_label || '')} · ${esc(String(e.process || '').replace('_', ' '))} · ${esc(e.why || '')}</div></div>
<div style="text-align:right"><div class="big">${money(e.each_usd)}</div><div class="muted">each, Premake estimate · ${e.lead_days || '?'} days</div></div></div>
${live.length ? `<ul>${live.map((l) => `<li>${esc(l.who)}: <b>${money(l.each)}</b> each${l.note ? ` · ${esc(l.note)}` : ''}</li>`).join('')}</ul>` : p.step && !['print', 'laser'].includes(e.process) ? '<p class="muted">Getting live prices from shops… refresh in a minute.</p>' : ''}</div>`;
    }).join('');
    return page(res, 200, 'Your quote', `<h1>Your parts</h1><p class="sub">${esc(q.doc || 'From Fusion')} · ${q.parts.length} part${q.parts.length === 1 ? '' : 's'} · estimated total <b>${money(total)}</b></p>${cards}
<div class="card"><b>Next: local shops</b><p class="muted">Soon you'll be able to send this to manufacturers near you with one click and pay when one accepts. For now this is a price check.</p></div>`);
  }
  return false;
}

function init(ctx) { C = ctx; return module.exports; }
module.exports = { init, handle, estimatePart, guessMaterial };
