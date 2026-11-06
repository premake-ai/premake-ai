'use strict';
// premakeapi: live metal quotes (RMFG, MATERIAM, AFN) for the Order tab from Premake's own quoting service, the premake-api
// Railway service at https://premake.ai/api/v1 (code: ~/Documents/Dev/premake-ai/api, README there). Since 5 Nov the RMFG
// token lives only on that service (one process may refresh it) and MATERIAM rate-limits uploads from the Mac's IP, so the
// studio asks the service instead of the shops. server/prices/{rmfg,materiam,afn}.js stay as the fallback when the service
// can't be reached (network error or 5xx), never when it answers with a limit.
//
//   ensure(step, {material, qtys, name})   queue a quote (no-op while a fresh answer is cached or one is running)
//   cached(step, opts)                     -> entry | null
//     entry: { at, status: 'pending' | 'complete', quote_id, url, offers: [API offers for this part], pending: [names], errors: [...] }
//          | { at, error, limited?: true, unreachable?: true }
//   quoting(step, opts)                    a quote for this part is queued or being polled
//   unreachable(step, opts)                the last try could not reach the service (callers fall back to the direct path)
//   shopsOf(entry)                         -> { RMFG, MATERIAM, AFN, SendCutSend } price rows for server/sourcing.js (pure)
//
// The service's per-IP limits (premake-ai api/server.js): 60 uploads and 20 quotes a day. So: each STEP is uploaded once
// (part ids cached by file hash for 25 days; the service keeps them 30), parts asked for within 1.5 s go in one quote
// (up to 10), answers are cached 7 days by file hash + material + quantities, failures are retried after 10 minutes and
// a limit answer after an hour. Polls are every 8 s for at most 16 minutes (the service gives up on a shop at 15).
// Cache: DATA/.sourcing/premake-api/ (parts.json, q/<key>.json). Nothing here can order or pay.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE = () => String(process.env.PREMAKE_API_URL || 'https://premake.ai').replace(/\/+$/, '');
const TTL_MS = 7 * 864e5, PART_TTL_MS = 25 * 864e5;
const RETRY_FAIL_MS = 10 * 60e3, RETRY_LIMIT_MS = 60 * 60e3, RETRY_UNREACHABLE_MS = 5 * 60e3;
const BATCH_MS = 1500, MAX_PARTS = 10, POLL_MS = 8e3, POLL_MAX_MS = 16 * 60e3, CALL_MS = 60e3;

let DATA = '';
const queue = new Map(); // key -> { key, file, opts }
const polling = new Set(); // quote ids being polled
let timer = null, flushing = null;

const dir = () => path.join(DATA, '.sourcing', 'premake-api');
const readJ = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
const norm = (o = {}) => ({ material: ['steel', 'stainless'].includes(o.material) ? o.material : 'aluminium', qtys: (o.qtys || [1, 10, 100, 500]).map(Number) });
function keyOf(buf, o) { return crypto.createHash('sha256').update(buf).update(JSON.stringify([o.material, o.qtys])).digest('hex').slice(0, 24); }
const entryFile = (k) => path.join(dir(), 'q', k + '.json');
function keyFor(file, opts) { try { return keyOf(fs.readFileSync(file), norm(opts)); } catch { return null; } }

/** Is this entry still a good answer (no new quote needed)? */
function fresh(e, now = Date.now()) {
  if (!e) return false;
  if (e.error) return now - e.at < (e.limited ? RETRY_LIMIT_MS : e.unreachable ? RETRY_UNREACHABLE_MS : RETRY_FAIL_MS);
  if (e.status === 'pending') return now - e.at < POLL_MAX_MS + 60e3;
  return now - e.at < TTL_MS;
}

function cached(file, opts) {
  const k = keyFor(file, opts);
  const e = k && readJ(entryFile(k));
  if (!e) return null;
  if (e.error) return fresh(e) ? e : null;
  if (e.status === 'complete' && Date.now() - e.at >= TTL_MS) return null;
  return e;
}
function quoting(file, opts) {
  const k = keyFor(file, opts);
  if (!k) return false;
  if (queue.has(k)) return true;
  const e = readJ(entryFile(k));
  return !!(e && e.status === 'pending' && e.quote_id && polling.has(e.quote_id));
}
function unreachable(file, opts) { const e = cached(file, opts); return !!(e && e.unreachable); }

function ensure(file, opts = {}) {
  const k = keyFor(file, opts);
  if (!k || queue.has(k)) return;
  const e = readJ(entryFile(k));
  if (e && e.status === 'pending' && e.quote_id && !polling.has(e.quote_id) && fresh(e)) { poll(e.quote_id); return; } // lost to a restart
  if (fresh(e)) return;
  queue.set(k, { key: k, file, opts: { ...norm(opts), name: opts.name || path.basename(file).replace(/\.(step|stp)$/i, '') } });
  if (!timer) timer = setTimeout(() => { timer = null; flushing = (flushing || Promise.resolve()).then(flush).catch((er) => console.error(`[premake-api] ${er.message}`)); }, BATCH_MS);
}

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function call(p, init = {}) {
  let r;
  try { r = await fetch(BASE() + p, { ...init, signal: AbortSignal.timeout(CALL_MS), headers: { 'User-Agent': 'premake-studio', ...(init.headers || {}) } }); }
  catch (e) { throw new ApiError(`Premake quoting service unreachable (${e.cause?.code || e.name || 'network'})`, 0); }
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) throw new ApiError(String(j?.error || `Premake quoting service ${r.status}`).slice(0, 200), r.status);
  if (!j) throw new ApiError('Premake quoting service: not JSON', 502);
  return j;
}
const failEntry = (e) => ({ at: Date.now(), error: e.message, ...(e.status === 429 ? { limited: true } : {}), ...(!e.status || e.status >= 500 ? { unreachable: true } : {}) });

/** The service's part id for a STEP file: uploaded once per file hash. */
async function partId(file) {
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const parts = readJ(path.join(dir(), 'parts.json'), {}) || {};
  const hit = parts[sha];
  if (hit && Date.now() - hit.at < PART_TTL_MS) return hit.part_id;
  const r = await call('/api/v1/parts', { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': path.basename(file) } });
  if (!/^prt_[0-9a-f]{20}$/.test(String(r.part_id || ''))) throw new ApiError('Premake quoting service: no part id', 502);
  const now = readJ(path.join(dir(), 'parts.json'), {}) || {};
  for (const [s, v] of Object.entries(now)) if (Date.now() - v.at >= PART_TTL_MS) delete now[s];
  now[sha] = { part_id: r.part_id, at: Date.now() };
  writeJ(path.join(dir(), 'parts.json'), now);
  return r.part_id;
}

async function flush() {
  while (queue.size) {
    const batch = [...queue.values()].slice(0, MAX_PARTS);
    const items = [];
    for (const it of batch) {
      try { items.push({ ...it, part_id: await partId(it.file) }); }
      catch (e) {
        queue.delete(it.key); writeJ(entryFile(it.key), failEntry(e));
        console.error(`[premake-api] upload ${it.opts.name}: ${e.message}`);
        if (e.status === 429 || !e.status || e.status >= 500) { // same answer for the rest of this batch: don't spend more calls
          for (const o of batch) if (queue.has(o.key)) { queue.delete(o.key); writeJ(entryFile(o.key), failEntry(e)); }
          break;
        }
      }
    }
    if (!items.length) continue;
    // one quote line per part id (two queued keys can share a STEP with different materials: one line each)
    try {
      const q = await call('/api/v1/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: items.map((it) => ({ part_id: it.part_id, qty: it.opts.qtys, material: it.opts.material })) }) });
      const ids = {};
      for (const it of items) { ids[it.key] = it.part_id; queue.delete(it.key); writeJ(entryFile(it.key), { at: Date.now(), status: 'pending', quote_id: q.quote_id, url: q.url, part_id: it.part_id, offers: [], pending: q.suppliers_asked || [], errors: [] }); }
      console.log(`[premake-api] quote ${q.quote_id}: ${items.length} part${items.length === 1 ? '' : 's'} (${(q.suppliers_asked || []).join(', ')})`);
      poll(q.quote_id);
    } catch (e) {
      console.error(`[premake-api] quote: ${e.message}`);
      for (const it of items) { queue.delete(it.key); writeJ(entryFile(it.key), failEntry(e)); }
    }
  }
}

/** Every entry waiting on this quote id. */
function entriesFor(quoteId) {
  let names = []; try { names = fs.readdirSync(path.join(dir(), 'q')); } catch {}
  return names.filter((n) => n.endsWith('.json')).map((n) => ({ key: n.slice(0, -5), e: readJ(path.join(dir(), 'q', n)) }))
    .filter((x) => x.e && x.e.quote_id === quoteId && x.e.status === 'pending');
}

function poll(quoteId) {
  if (polling.has(quoteId)) return;
  polling.add(quoteId);
  const started = Date.now();
  (async () => {
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const waiting = entriesFor(quoteId);
        if (!waiting.length) return;
        let q;
        try { q = await call(`/api/v1/quotes/${quoteId}`); }
        catch (e) {
          if (e.status === 404 || Date.now() - started > POLL_MAX_MS) { for (const w of waiting) writeJ(entryFile(w.key), failEntry(e)); return; }
          continue; // a blip: ask again next round
        }
        const done = q.status === 'complete' || Date.now() - started > POLL_MAX_MS;
        for (const w of waiting) {
          const pid = w.e.part_id;
          writeJ(entryFile(w.key), { ...w.e, at: done ? Date.now() : w.e.at, status: done ? 'complete' : 'pending', url: q.url || w.e.url,
            offers: (q.offers || []).filter((o) => o.part_id === pid), pending: done ? [] : (q.pending || []).filter((p) => p.part_id === pid).map((p) => p.supplier),
            errors: (q.errors || []).filter((x) => x.part_id === pid) });
        }
        if (done) return;
      }
    } finally { polling.delete(quoteId); }
  })().catch((e) => console.error(`[premake-api] poll ${quoteId}: ${e.message}`));
}

// ---------------------------------------------------------------- pure: entry -> per-shop rows (server/sourcing.js)
const r2 = (x) => Math.round(x * 100) / 100;
/** -> { RMFG, MATERIAM, AFN, SendCutSend }: each { state: 'live' | 'estimate' | 'pending' | 'error', prices: {qty: unit}, ... }
 * or absent when the service didn't ask that shop. AFN is the cheapest offer per quantity across its machine shops. */
function shopsOf(e) {
  const out = {};
  if (!e || e.error) return out;
  const offers = e.offers || [];
  const by = (pred) => offers.filter(pred);
  const priced = (list) => {
    const prices = {};
    for (const o of list) if (o.unit_usd > 0 && (prices[o.qty] == null || o.unit_usd < prices[o.qty])) prices[o.qty] = r2(o.unit_usd);
    return prices;
  };
  const errOf = (name) => (e.errors || []).find((x) => x.supplier === name)?.message || null;
  const pend = (name) => (e.pending || []).includes(name);
  for (const [k, name] of [['RMFG', 'RMFG'], ['MATERIAM', 'MATERIAM']]) {
    const list = by((o) => o.supplier === name && o.live);
    if (list.length) {
      const first = list.slice().sort((a, b) => a.qty - b.qty)[0];
      out[k] = { state: 'live', prices: priced(list), ships_by: first.ships_by || null, notes: (first.notes || []).filter(Boolean), url: first.supplier_url || null };
    } else if (pend(name)) out[k] = { state: 'pending' };
    else if (errOf(name)) out[k] = { state: 'error', error: errOf(name) };
  }
  const afn = by((o) => o.via === 'AFN');
  if (afn.length) {
    const prices = priced(afn);
    const vendors = [...new Set(afn.map((o) => o.supplier))];
    const cheapest1 = afn.filter((o) => o.qty === Math.min(...afn.map((x) => x.qty))).sort((a, b) => a.unit_usd - b.unit_usd)[0];
    out.AFN = { state: 'live', prices, vendors, url: cheapest1?.supplier_url || null, material: (cheapest1?.notes || []).find((n) => /^machined from/.test(n)) || '',
      unfinished: afn.some((o) => (o.notes || []).some((n) => /unfinished/.test(n))), shop_estimates: afn.some((o) => !o.live) };
  } else if (pend('AFN network')) out.AFN = { state: 'pending' };
  else if (errOf('AFN network')) out.AFN = { state: 'error', error: errOf('AFN network') };
  const scs = by((o) => o.supplier === 'SendCutSend' && !o.live);
  if (scs.length) out.SendCutSend = { state: 'estimate', prices: priced(scs) };
  return out;
}

function init(dataDir) { DATA = dataDir; return module.exports; }
module.exports = { init, ensure, cached, quoting, unreachable, shopsOf, fresh, _keyOf: keyOf, _flush: () => flushing };
