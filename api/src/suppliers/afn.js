'use strict';
// afn: multi-shop machining quotes from the Agentic Fabrication Network (agenticfabricationnetwork.ai, "UFP"), a public
// MCP that takes a STEP file and returns ranked offers from several shops (Justway, PCBWay, Craftcloud, Protolabs,
// SendCutSend CNC ...), like flight search. No account or key. Quote-only here: get_fabrication_quote + refine_quote;
// create_checkout (a hosted payment page) is never called.
//
// quote(stepFile, {process, material, finish, qtys}) -> { offers: [{vendor, qty, unit_usd, ship_usd, eta, anodized}], ... }
// cached by file hash + options in DATA/.sourcing/afn/ for 3 days (offers expire after ~1 day at AFN, prices age).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UA = require('../ua');

const MCP = 'https://agenticfabricationnetwork.ai/mcp';
const TTL = 3 * 86400e3;
const RETRY_MS = 10 * 60e3; // a failed quote is asked again after 10 minutes
let DATA = '';
const running = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  const H = { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let sid = null, id = 1;
  const post = async (body, timeout = 180e3) => {
    const r = await fetch(MCP, { method: 'POST', headers: { ...H, ...(sid ? { 'Mcp-Session-Id': sid } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    sid = r.headers.get('mcp-session-id') || sid;
    const t = await r.text();
    if (!t) return {};
    const j = t.startsWith('{') ? JSON.parse(t) : JSON.parse([...t.matchAll(/^data: (.*)$/gm)].pop()[1]);
    if (j.error) throw new Error(`AFN ${body.method}: ${j.error.message || JSON.stringify(j.error)}`);
    return j.result || {};
  };
  await post({ jsonrpc: '2.0', id: id++, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'premake-api', version: require('../../package.json').version } } });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { call: async (name, args) => { const r = await post({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }); if (r.isError) throw new Error(`AFN ${name}: ${(r.content || [])[0]?.text || 'error'}`); return r.structuredContent || {}; } };
}

function keyOf(buf, opts) { return crypto.createHash('sha256').update(buf).update(JSON.stringify([opts.process, opts.material, opts.finish, opts.qtys])).digest('hex').slice(0, 24); }
function cacheFile(k) { return path.join(DATA, '.sourcing', 'afn', k + '.json'); }
function cached(stepFile, opts = {}) {
  try { const c = JSON.parse(fs.readFileSync(cacheFile(keyOf(fs.readFileSync(stepFile), norm(opts))), 'utf8')); return Date.now() - c.at < (c.error ? RETRY_MS : TTL) ? c : null; } catch { return null; }
}
const norm = (o) => ({ process: o.process || 'cnc', material: o.material || 'aluminum 6061', finish: o.finish || null, qtys: o.qtys || [1, 10, 100] });

async function quote(stepFile, opts = {}) {
  opts = norm(opts);
  const buf = fs.readFileSync(stepFile);
  const s = await session();
  // design_data_url, not design_file: AFN changed design_file to a {file_id, download_url} object (Nov 2026), and
  // quantities takes at most 5
  const args = { process: opts.process, design_data_url: `data:model/step;base64,${buf.toString('base64')}`, material: opts.material, quantities: opts.qtys.slice(0, 5) };
  if (opts.finish) args.finish = opts.finish;
  let q = await s.call('get_fabrication_quote', args);
  for (let i = 0; i < 8 && q.status !== 'complete'; i++) { await sleep(i < 2 ? 8000 : 15000); q = await s.call('refine_quote', { quote_id: q.quote_id }); }
  const offers = (q.offers || []).map((o) => {
    const ship = (o.shipping_options || []).slice().sort((a, b) => a.cost_cents - b.cost_cents)[0] || {};
    return { vendor: o.vendor_display_name || o.vendor, qty: o.quantity, unit_usd: o.unit_price_cents / 100, ship_usd: (ship.cost_cents || 0) / 100,
      eta: ship.eta_date || null, finish: o.spec_resolved?.finish || null, ships_from: o.ships_from || [], estimate: o.price_basis !== 'vendor_api' || o.price_refresh === 'pending' };
  });
  return { at: Date.now(), quote_id: q.quote_id, status: q.status, process: opts.process, material: opts.material, offers };
}

/** Background quote, one per file + options at a time; failures cached so they're retried after 10 min. */
function ensure(stepFile, opts = {}) {
  opts = norm(opts);
  let k; try { k = keyOf(fs.readFileSync(stepFile), opts); } catch { return null; }
  if (running.has(k)) return running.get(k);
  const p = quote(stepFile, opts).catch((e) => ({ at: Date.now(), error: String(e.message).slice(0, 200) })).then((out) => {
    try { fs.mkdirSync(path.dirname(cacheFile(k)), { recursive: true }); fs.writeFileSync(cacheFile(k), JSON.stringify(out)); } catch {}
    if (out.error) console.error(`[afn] quote failed for ${path.basename(stepFile)}: ${out.error}`);
    return out;
  }).finally(() => running.delete(k));
  running.set(k, p);
  return p;
}
function quoting(stepFile, opts = {}) { try { return running.has(keyOf(fs.readFileSync(stepFile), norm(opts))); } catch { return false; } }

/** Cheapest offer per quantity: { [qty]: offer } (the requested finish wins over a cheaper unfinished one). */
function best(c, wantFinish) {
  const out = {};
  for (const o of c.offers || []) {
    const ok = !wantFinish || o.finish === wantFinish;
    const cur = out[o.qty];
    if (!cur || (ok && !cur._ok) || (ok === cur._ok && o.unit_usd < cur.unit_usd)) out[o.qty] = { ...o, _ok: ok };
  }
  return out;
}

function init(dataDir) { DATA = dataDir; return module.exports; }
module.exports = { init, quote, ensure, cached, quoting, best };
