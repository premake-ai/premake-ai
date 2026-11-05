'use strict';
// materiam: live sheet-metal quotes from MATERIAM (materiam.com, own plant in Querétaro, Mexico: laser cut, CNC bent,
// MIG/TIG welded, powder coated; ships to the US with import duty included). Public MCP at materiam.com/mcp, no account
// or key (llms.txt, Nov 2026). Quote-only: upload_part -> get_upload_status -> get_project (bending simulation, design
// findings) -> set_file_quantity + get_quote per quantity. Orders happen on materiam.com from project_url, never here.
//
// quote(stepFile, {material, qtys}) -> { prices: [{qty, unit_usd, total_usd, ships_by}], stock, kind, findings, project_url }
// cached by file hash + options in DATA/.sourcing/materiam/ for 3 days. MATERIAM deletes unclaimed projects after 7 days.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const UA = require('../ua');

const MCP = 'https://materiam.com/mcp';
const TTL = 3 * 86400e3;
let DATA = '';
const running = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  const H = { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let sid = null, id = 1;
  const post = async (body, timeout = 120e3) => {
    const r = await fetch(MCP, { method: 'POST', headers: { ...H, ...(sid ? { 'Mcp-Session-Id': sid } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    sid = r.headers.get('mcp-session-id') || sid;
    const t = await r.text();
    if (!t) return {};
    const j = t.trim().startsWith('{') ? JSON.parse(t) : JSON.parse([...t.matchAll(/^data: (.*)$/gm)].pop()[1]);
    if (j.error) throw new Error(`MATERIAM ${body.method}: ${j.error.message || JSON.stringify(j.error)}`);
    return j.result || {};
  };
  await post({ jsonrpc: '2.0', id: id++, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'premake-api', version: require('../../package.json').version } } });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { call: async (name, args) => {
    const r = await post({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
    const text = (r.content || [])[0]?.text || '';
    if (r.isError) throw new Error(`MATERIAM ${name}: ${text.slice(0, 200) || 'error'}`);
    if (r.structuredContent) return r.structuredContent;
    try { return JSON.parse(text); } catch { return {}; }
  } };
}

const norm = (o) => ({ material: String(o.material || 'aluminium').toLowerCase(), qtys: (o.qtys || [1, 10, 100]).slice(0, 6) });
function keyOf(buf, opts) { return crypto.createHash('sha256').update(buf).update(JSON.stringify([opts.material, opts.qtys])).digest('hex').slice(0, 24); }
function cacheFile(k) { return path.join(DATA, '.sourcing', 'materiam', k + '.json'); }
function cached(stepFile, opts = {}) {
  try { const c = JSON.parse(fs.readFileSync(cacheFile(keyOf(fs.readFileSync(stepFile), norm(opts))), 'utf8')); return Date.now() - c.at < TTL ? c : null; } catch { return null; }
}

// Our material words -> MATERIAM alloy groups. Aluminium keeps MATERIAM's own pick (5052-H32 at the closest gauge).
const ALLOY = { steel: /^Cold Rolled Steel$/, stainless: /^Stainless Steel 304 2B$/ };
/** Same gauge (or plate size) as MATERIAM's automatic pick, in the alloy we asked for. */
async function setAlloy(s, tok, part, material) {
  const want = /stainless/.test(material) ? ALLOY.stainless : /steel/.test(material) ? ALLOY.steel : null;
  if (!want || !/sheet/i.test(part.kind || '')) return;
  const o = await s.call('get_part_options', { project_token: tok, part_id: part.part_id });
  const group = (o.materials_by_alloy || []).find((g) => want.test(g.alloy));
  if (!group) return;
  const size = (String(o.current_material?.name || '').match(/(\d+ Ga\.|\d+\/\d+"|\d+")$/) || [])[0];
  const m = group.materials.find((x) => size && x.name.endsWith(size)) || group.materials[0];
  if (m && m.material_id !== o.current_material?.material_id) await s.call('configure_part', { project_token: tok, part_id: part.part_id, material_id: m.material_id });
}

async function quote(stepFile, opts = {}) {
  opts = norm(opts);
  const buf = fs.readFileSync(stepFile);
  const s = await session();
  const name = path.basename(stepFile).replace(/[^\w.-]+/g, '-').replace(/\.(stp|step)$/i, '') + '.step'; // MATERIAM checks the extension
  const up = await s.call('upload_part', { filename: name, content_base64: zlib.gzipSync(buf, { level: 9 }).toString('base64') });
  const tok = up.project_token;
  if (!tok) throw new Error('MATERIAM: no project token');
  let st = {};
  for (let i = 0; i < 40; i++) {
    st = await s.call('get_upload_status', { project_token: tok });
    if (st.all_done || !/QUEUED|PROCESSING/.test(JSON.stringify(st.uploads || []))) break;
    await sleep(3000);
  }
  const bad = (st.uploads || []).find((u) => /FAILED|TIMEOUT/.test(u.status));
  if (bad) throw new Error(`MATERIAM could not read the file (${bad.status})`);
  const proj = await s.call('get_project', { project_token: tok });
  const parts = proj.parts || [];
  if (!parts.length) throw new Error('MATERIAM found no parts in the file');
  for (const p of parts) await setAlloy(s, tok, p, opts.material);
  const stock = [...new Set(((await s.call('get_project', { project_token: tok })).parts || parts).map((p) => p.material?.name).filter(Boolean))];
  const findings = [];
  for (const p of parts) {
    const mf = p.manufacturability || {};
    if (p.not_recognized) findings.push(`${p.name}: not recognised as sheet metal or tube (${p.not_recognized})`);
    if (p.not_quoted) findings.push(`${p.name}: not quoted (${p.not_quoted})`);
    if (mf.bending && mf.bending.feasible === false) findings.push(`${p.name}: can't be bent as drawn${mf.bending.reason ? ` (${mf.bending.reason})` : ''}`);
    if (mf.design_blockers) findings.push(`${p.name}: ${mf.design_blockers} design problem${mf.design_blockers > 1 ? 's' : ''} to fix before ordering`);
    if (mf.bend_radii === 'RADII_ADJUSTED') findings.push('Bend radii adjusted to MATERIAM\'s press-brake dies');
  }
  const prices = []; let last = {};
  for (const q of opts.qtys) {
    await s.call('set_file_quantity', { project_token: tok, quantity: q });
    last = await s.call('get_quote', { project_token: tok, ship_to: 'US' });
    if (last.total == null) continue;
    prices.push({ qty: q, unit_usd: Math.round((last.total / q) * 100) / 100, total_usd: last.total, ships_by: last.lead_time?.ships_by || null });
  }
  if (!prices.length) throw new Error('MATERIAM returned no price');
  return { at: Date.now(), supplier: 'MATERIAM', material: opts.material, project_url: last.project_url || null,
    stock, kind: parts.map((p) => p.kind).filter(Boolean)[0] || '',
    prices, ships_by: prices[0].ships_by, // the smallest quantity's date; bigger batches take longer (each price has its own)
    findings: [...new Set(findings)].slice(0, 6) };
}

/** Background quote, one per file + options at a time; failures are cached too (retried after 10 min by callers). */
function ensure(stepFile, opts = {}) {
  opts = norm(opts);
  let k; try { k = keyOf(fs.readFileSync(stepFile), opts); } catch { return null; }
  if (running.has(k)) return running.get(k);
  const p = quote(stepFile, opts).catch((e) => ({ at: Date.now(), error: String(e.message).slice(0, 200) })).then((out) => {
    try { fs.mkdirSync(path.dirname(cacheFile(k)), { recursive: true }); fs.writeFileSync(cacheFile(k), JSON.stringify(out, null, 1)); } catch {}
    if (out.error) console.error(`[materiam] quote failed for ${path.basename(stepFile)}: ${out.error}`);
    return out;
  }).finally(() => running.delete(k));
  running.set(k, p);
  return p;
}
function quoting(stepFile, opts = {}) { try { return running.has(keyOf(fs.readFileSync(stepFile), norm(opts))); } catch { return false; } }

function init(dataDir) { DATA = dataDir; return module.exports; }
module.exports = { init, quote, ensure, cached, quoting };
