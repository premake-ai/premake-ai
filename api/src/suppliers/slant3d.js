'use strict';
// slant3d: live FDM print quotes from Slant 3D's public MCP (https://www.slant3d.com/mcp, no account or key).
// Only the quoting tools below are ever called; nothing that ships, pays or orders.
//
// quote([{hash, file_name, buf}], signal, qtys) -> { quote_id, material, color, set: { [qty]: {unit_usd, setup_usd,
// subtotal_usd, lead_time} }, parts: { [hash]: {price_usd, volume_cm3, issues} } }
const UA = require('../ua');

const SLANT_URL = 'https://www.slant3d.com/mcp';
const SLANT_TOOLS = new Set(['quote_upload_part', 'quote_raw_pricing']);
const MATERIAL = 'PETG';
const QTYS = [1, 10, 100, 500];
const CALL_TIMEOUT_MS = 45e3;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

async function call(name, args, signal) {
  if (!SLANT_TOOLS.has(name)) throw new Error(`refusing Slant tool ${name}`);
  const r = await fetch(SLANT_URL, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Slant 3D ${r.status}`);
  let msg = null;
  if (/^\s*\{/.test(text)) msg = JSON.parse(text);
  else for (const l of text.split('\n')) if (l.startsWith('data:')) { try { msg = JSON.parse(l.slice(5)); } catch {} }
  if (!msg) throw new Error('Slant 3D: empty response');
  if (msg.error) throw new Error(`Slant 3D: ${msg.error.message || 'error'}`);
  const res = msg.result || {};
  let out = res.structuredContent;
  if (!out) { try { out = JSON.parse(res.content?.[0]?.text || ''); } catch { out = null; } }
  if (res.isError || !out) throw new Error(`Slant 3D: ${String(res.content?.[0]?.text || 'tool error').slice(0, 200)}`);
  return out;
}

/** One Slant quote holding every part, priced at qtys. parts = [{hash, file_name, buf}] */
async function quote(parts, signal, qtys = QTYS) {
  let quoteId = null;
  const byHash = {};
  for (const p of parts) {
    const r = await call('quote_upload_part', { file_name: p.file_name, file_content: p.buf.toString('base64'), material: MATERIAL,
      ...(quoteId ? { quote_id: quoteId } : {}) }, signal);
    quoteId = r.quote_id || quoteId;
    if (!quoteId) throw new Error('Slant 3D: no quote_id');
    const line = (r.parts || []).find((x) => x.name === p.file_name);
    byHash[p.hash] = {
      file_name: p.file_name, price_usd: num(line?.price_usd), volume_cm3: num(r.volume_cm3),
      issues: (r.print_feedback?.issues || []).slice(0, 6).map((i) => ({ severity: str(i.severity), title: str(i.title), message: str(i.message), suggestion: str(i.suggestion) })),
    };
  }
  const raw = await call('quote_raw_pricing', { quote_id: quoteId, quantities: qtys }, signal);
  const set = {};
  for (const row of raw.pricing || []) {
    const c = row.computed || {};
    if (!qtys.includes(Number(row.quantity))) continue;
    set[row.quantity] = { unit_usd: num(c.unit_price_usd), setup_usd: num(c.setup_fee_usd) || 0, subtotal_usd: num(c.subtotal_usd), lead_time: str(c.lead_time) };
  }
  for (const p of raw.parts || []) {
    const h = Object.keys(byHash).find((k) => byHash[k].file_name === p.name);
    if (h && byHash[h].price_usd == null) byHash[h].price_usd = num(p.price_usd);
  }
  if (!Object.keys(set).length) throw new Error('Slant 3D: no pricing returned');
  return { quote_id: quoteId, material: raw.material || MATERIAL, color: raw.color || '', set_price_usd: num(raw.set_price_usd), set, parts: byHash };
}

module.exports = { quote, QTYS };
