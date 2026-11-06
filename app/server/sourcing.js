// "Where to source it": for every part line of a design, the best places to get it, with live prices where a
// public no-key source exists and clearly labelled estimates everywhere else.
//
//   GET /api/sourcing?project=<id> | ?example=<slug>        same access rules as /api/quote (hook in server.js: "sourcing:")
//     200 { status: "ready", ... }   or   202 { status: "quoting", ... } while the Slant 3D quote runs (poll again)
//   GET /api/sourcing?project=<id>&dxf=<bom fabricated file>  flat DXF outline of a laser-cut part (from its STL)
//
// Only shops on server/prices/config.js ALLOWED_SUPPLIERS are offered (default Amazon, SendCutSend, Slant 3D); the others
// below come back when the list is widened. Bought lines are normalised first (server/prices/suppliers.js).
//
// Sources (checked 2026-10):
//   LIVE      Slant 3D  public MCP at https://www.slant3d.com/mcp (Streamable HTTP JSON-RPC, no key, browser UA required).
//                       Only the quoting tools below are ever called. Never quote_checkout / shipping / anything that orders.
//   ESTIMATE  Premake print price (from quote()), fabricated parts (server/pricing_fab.js), bought parts (bom unit_cost_usd).
//   LINK      Craftcloud (API is behind a Cloudflare challenge, not documented for public use), JLC3DP, SendCutSend,
//             OSHCut, Ponoko, Misumi, OpenBuilds, Xometry, JLCCNC, PCBWay (no public no-key quote APIs), and supplier
//             searches (Amazon, McMaster, DigiKey, Mouser, LCSC, AliExpress: all need API keys for live prices).
//
// Cache: <DATA>/.sourcing/projects/<id>/cache.json and <DATA>/.sourcing/examples/<slug>/. Never inside the project dir:
// the design agent and design.py can write there, and these prices go to Stripe (security recheck N2).
// Keyed by material + the sha256 of every printed STL, so a rebuild that changes a part re-quotes; otherwise 7 days.
'use strict';
const fs = require('node:fs');
// colours: hex -> filament name (server.js FILAMENTS, the studio's hover swatches)
const FILAMENT_NAMES = { '#1c1c1c': 'black', '#f4f4f1': 'white', '#8a8f98': 'grey', '#e8590c': 'orange', '#c92a2a': 'red', '#1f5fbf': 'blue', '#2f9e44': 'green', '#f2c12e': 'yellow' };
const path = require('node:path');
const crypto = require('node:crypto');
const pricingFab = require('./pricing_fab');
const sup = require('./prices/suppliers'); // only shops on ALLOWED_SUPPLIERS are offered (Amazon, SendCutSend, Slant 3D)
const stock = require('./prices/stock'); // small parts we keep in NYC (config.STOCK): ordered kits get them from our shelf
const rmfg = require('./prices/rmfg');
const materiam = require('./prices/materiam'); // materiam: live sheet-metal / tube quotes from MATERIAM's public MCP (Querétaro, MX)
const { makeZip } = require('./guide'); // zero-dependency zip writer (also the Make tab's downloads)
const premakeApi = require('./prices/premakeapi'); // premake-api: live RMFG / MATERIAM / AFN quotes via premake.ai/api/v1 (direct modules = fallback)
const afn = require('./prices/afn'); // afn: multi-shop CNC quotes (display only, never an order price) // rmfg: live metal quotes (sheet + tube) from a part's STEP file (cadlib/build.py step/)

const SLANT_URL = 'https://www.slant3d.com/mcp';
/** Shops switched off for now: never called, never shown (code kept). MATERIAM rate-limits uploads (Josh, 5 Nov); the
 * premake-api service has API_V1_SUPPLIERS_OFF=materiam too. Remove from the set to bring it back. */
const HIDDEN_SHOPS = new Set(['MATERIAM']);
/** SendCutSend's own upload-and-quote page (their site's "Get instant quote" button), not the marketing homepage. */
const SCS_QUOTE = 'https://app.sendcutsend.com/customer#/quote?action=builder';
const OSHCUT_QUOTE = 'https://app.oshcut.com/';
const SLANT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// quoting only: nothing that ships, pays or orders (set_quantity + shipping_options price an exact order, see slantOrder)
const SLANT_TOOLS = new Set(['quote_upload_part', 'quote_raw_pricing', 'quote_set_quantity', 'quote_shipping_options']);
const MATERIAL = 'PETG';
const QTYS = [1, 10, 100, 500];
const JOB_TIMEOUT_MS = 90e3;
const CALL_TIMEOUT_MS = 45e3;
const CACHE_TTL_MS = 7 * 864e5;
const RETRY_AFTER_FAIL_MS = 10 * 60e3;
const MAX_PRINTED = 25;
const MAX_STL_BYTES = 40e6;

const cents = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const enc = encodeURIComponent;

// ---------------------------------------------------------------- Slant 3D MCP client (quoting tools only)
async function slantCall(name, args, signal) {
  if (!SLANT_TOOLS.has(name)) throw new Error(`refusing Slant tool ${name}`);
  const r = await fetch(SLANT_URL, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
    headers: { 'User-Agent': SLANT_UA, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
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

/** One Slant quote holding every printed part; then set pricing at qtys (default QTYS). parts = [{hash, file_name, buf}]
 * Also used by the sourcing API (server/apiv1.js) for single uploaded parts. */
async function slantQuote(parts, signal, qtys = QTYS) {
  let quoteId = null;
  const byHash = {};
  for (const p of parts) {
    const r = await slantCall('quote_upload_part', { file_name: p.file_name, file_content: p.buf.toString('base64'), material: MATERIAL,
      ...(quoteId ? { quote_id: quoteId } : {}) }, signal);
    quoteId = r.quote_id || quoteId;
    if (!quoteId) throw new Error('Slant 3D: no quote_id');
    const line = (r.parts || []).find((x) => x.name === p.file_name);
    byHash[p.hash] = {
      file_name: p.file_name, price_usd: num(line?.price_usd), volume_cm3: num(r.volume_cm3),
      issues: (r.print_feedback?.issues || []).slice(0, 6).map((i) => ({ severity: str(i.severity), title: str(i.title), message: str(i.message), suggestion: str(i.suggestion) })),
    };
  }
  const raw = await slantCall('quote_raw_pricing', { quote_id: quoteId, quantities: qtys }, signal);
  const set = {};
  for (const row of raw.pricing || []) {
    const c = row.computed || {};
    if (!qtys.includes(Number(row.quantity))) continue;
    set[row.quantity] = { unit_usd: num(c.unit_price_usd), setup_usd: num(c.setup_fee_usd) || 0, subtotal_usd: num(c.subtotal_usd), lead_time: str(c.lead_time) };
  }
  for (const p of raw.parts || []) { // fill per-part prices from the raw listing when the upload replies missed one
    const h = Object.keys(byHash).find((k) => byHash[k].file_name === p.name);
    if (h && byHash[h].price_usd == null) byHash[h].price_usd = num(p.price_usd);
  }
  if (!Object.keys(set).length) throw new Error('Slant 3D: no pricing returned');
  return { quote_id: quoteId, material: raw.material || MATERIAL, color: raw.color || '', set_price_usd: num(raw.set_price_usd), set, parts: byHash };
}

// ---------------------------------------------------------------- flat DXF from a laser-cut part's STL
function readStl(buf) {
  const tris = [];
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (buf.length === 84 + n * 50 && n > 0) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50, f = (k) => buf.readFloatLE(o + k * 4);
      tris.push([[f(3), f(4), f(5)], [f(6), f(7), f(8)], [f(9), f(10), f(11)]]);
    }
    return tris;
  }
  const v = [...buf.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < v.length; i += 3) tris.push([v[i], v[i + 1], v[i + 2]]);
  return tris;
}

/** Outline (outer edge + holes) of the top face of a flat plate, as DXF R12 LINE entities in mm. Null if not a plate. */
function plateDxf(buf) {
  const tris = readStl(buf);
  if (!tris.length || tris.length > 400000) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const ext = hi.map((h, k) => h - lo[k]);
  const ax = ext.indexOf(Math.min(...ext));
  const [u, v] = [0, 1, 2].filter((k) => k !== ax);
  if (!(ext[ax] > 0) || ext[ax] > 0.2 * Math.min(ext[u], ext[v])) return null; // not thin enough to be a sheet
  const tol = Math.max(1e-3, ext[ax] * 0.02);
  const key = (p) => `${p[u].toFixed(3)},${p[v].toFixed(3)}`;
  const edges = new Map();
  for (const t of tris) {
    if (!t.every((p) => hi[ax] - p[ax] < tol)) continue; // triangles lying in the top face
    for (let i = 0; i < 3; i++) {
      const a = key(t[i]), b = key(t[(i + 1) % 3]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  const lines = [...edges].filter(([, c]) => c === 1).map(([k]) => k.split('|').map((s) => s.split(',').map(Number)));
  if (lines.length < 3) return null;
  const ox = lo[u], oy = lo[v];
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const [[x1, y1], [x2, y2]] of lines) {
    out.push('0', 'LINE', '8', 'CUT', '10', (x1 - ox).toFixed(3), '20', (y1 - oy).toFixed(3), '30', '0', '11', (x2 - ox).toFixed(3), '21', (y2 - oy).toFixed(3), '31', '0');
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return { dxf: out.join('\n') + '\n', thickness_mm: cents(ext[ax]), size_mm: [cents(ext[u]), cents(ext[v])], segments: lines.length };
}

// ---------------------------------------------------------------- supplier links
const HARDWARE_RE = /\b(screw|bolt|nut|washer|insert|standoff|spacer|rod|shaft|bearing|magnet|spring|pin|rivet|hinge|bumper|feet|foot|t-nut|tnut|bracket|dowel|threaded|o-ring|grommet|zip tie|velcro|hook|clip|m[2-8]\b|m[2-8] x)/i;
const ELECTRONIC_RE = /\b(esp32|esp8266|arduino|raspberry|pico|resistor|capacitor|diode|transistor|mosfet|led|ws2812|neopixel|encoder|switch|button|sensor|module|buck|boost|regulator|driver|tmc|a4988|usb|connector|jst|dupont|header|wire|cable|pcb|ic\b|oled|lcd|display|battery|li-?ion|lipo|charger|motor|nema|servo|stepper|relay|buzzer|speaker|microphone|potentiometer|thermistor)/i;
const MODULE_RE = /\b(module|esp32|esp8266|supermini|devkit|buck|boost|driver|oled|lcd|display|sensor|charger|tp4056|ws2812|strip)/i;

const searchTerm = sup.searchTerm;
/** Every shop is offered: the Order tab links out to buy, so more places to buy is better (Josh, 5 Nov). */
const onList = () => true;

function boughtLinks(p) {
  const q = searchTerm(p), name = str(p.name);
  const out = [];
  const add = (service, url, note) => out.push({ service, kind: 'link', url, note });
  const isHw = HARDWARE_RE.test(name), isEl = !isHw && ELECTRONIC_RE.test(name); // "button head screw" is hardware
  if (isHw) add('McMaster-Carr', `https://www.mcmaster.com/${enc(q.toLowerCase().replace(/\s+/g, '-'))}/`, 'Fast US shipping, sold in packs');
  if (isEl) {
    add('DigiKey', `https://www.digikey.com/en/products/result?keywords=${enc(q)}`, 'Single units, live stock');
    add('Mouser', `https://www.mouser.com/c/?q=${enc(q)}`, null);
    add('LCSC', `https://www.lcsc.com/search?q=${enc(q)}`, 'Cheapest for passives, ships from China');
  }
  add('Amazon', sup.amazonSearchUrl(q), isHw ? 'Prime only. Assortment packs' : 'Prime only');
  if (MODULE_RE.test(name) || (!isHw && !isEl)) add('AliExpress', `https://www.aliexpress.com/wholesale?SearchText=${enc(q)}`, 'Lowest price, 1–3 weeks');
  return out.filter(onList);
}

// 3D print shops and networks, after Slant 3D: upload the STL for a quote
const PRINT_SHOPS = [
  { service: 'Craftcloud', kind: 'link', url: 'https://craftcloud3d.com/upload', upload: 'STL', note: 'Compares 150+ print shops in one quote' },
  { service: 'JLC3DP', kind: 'link', url: 'https://jlc3dp.com/3d-printing-quote', upload: 'STL', note: 'Cheap SLA resin and MJF nylon, ships from China in 1–2 weeks' },
  { service: 'PCBWay', kind: 'link', url: 'https://www.pcbway.com/rapid-prototyping/3d-printing/', upload: 'STL', note: 'FDM, SLA, MJF and metal printing, ships from China' },
  { service: 'Xometry', kind: 'link', url: 'https://www.xometry.com/quoting/home/', upload: 'STL or STEP', note: 'Instant quote, US network, industrial materials' },
  { service: 'Protolabs Network', kind: 'link', url: 'https://www.hubs.com/3d-printing/', upload: 'STL or STEP', note: 'Formerly Hubs, global print network' },
  { service: 'Treatstock', kind: 'link', url: 'https://www.treatstock.com/', upload: 'STL', note: 'Marketplace of local and online print shops' },
];

// ---------------------------------------------------------------- fabricated: where to send each process
const NONMETAL_RE = /acrylic|ply|wood|mdf|hardboard|cardboard|delrin|acetal|polycarbonate|hdpe|uhmw|abs|phenolic|garolite|\bg-?10\b|fr-?4|nylon|pom\b|petg|pla\b|foam|rubber|cork|felt|leather/i;
const MISUMI_PN = { '2020': 'HFS5-2020', '2040': 'HFS5-2040', '2060': 'HFS5-2060', '2080': 'HFS5-2080', '3030': 'HFS6-3030', '4040': 'HFS8-4040' };

function fabServices(f) {
  const all = fabServicesAll(f).filter(onList);
  if (all.length) return all;
  return [{ service: 'SendCutSend', kind: 'link', url: SCS_QUOTE, upload: 'DXF or STEP', note: 'Laser, CNC routing, bending' }];
}
function fabServicesAll(f) {
  const proc = str(f.process).toLowerCase(), p = f.params || {};
  const mat = str(p.material);
  const S = (service, url, upload, note) => ({ service, kind: 'link', url, upload, note });
  if (proc === 'sheet') return [
    S('SendCutSend', SCS_QUOTE, 'Flat-pattern DXF, or STEP for bent parts', 'Instant quote, free US shipping, ~2–6 days'),
    S('OSHCut', OSHCUT_QUOTE, 'STEP (auto flat pattern) or DXF', 'Instant quote with bending, ~3–7 days'),
  ];
  if (proc === 'laser') return NONMETAL_RE.test(mat) ? [
    S('Ponoko', 'https://www.ponoko.com/laser-cutting', 'DXF or SVG outline', 'Acrylic and plywood, instant quote'),
    S('SendCutSend', SCS_QUOTE, 'DXF outline', 'Check their material list for this stock'),
  ] : [
    S('SendCutSend', SCS_QUOTE, 'DXF outline', 'Instant quote, free US shipping'),
    S('OSHCut', OSHCUT_QUOTE, 'DXF or STEP', 'Instant quote'),
  ];
  if (proc === 'extrusion') {
    const prof = str(p.profile) || '2020', key = prof.replace(/[^0-9]/g, '').slice(0, 4);
    const len = Math.round(Number(p.length_mm) || 0);
    const pn = MISUMI_PN[key] || `${key} extrusion`;
    const a = sup.amazonExtrusion(prof, len, Number(p.tapped_ends) || 0);
    // Order tab: extrusion is a bought part, Amazon pre-cut first with its estimate (never metal shops: they quote sheet)
    const amz = S('Amazon', a ? a.url : sup.amazonSearchUrl(`${prof} aluminum extrusion`), null, a ? `Prime, pre-cut ${a.how}` : 'Prime, pre-cut packs');
    if (a) { amz.kind = 'estimate'; amz.prices = Object.fromEntries(QTYS.map((q) => [q, a.usd])); }
    return [
      amz,
      S('Misumi', `https://us.misumi-ec.com/vona2/result/?Keyword=${enc(pn)}`, `Part ${pn}, length ${len || '?'} mm`, 'Cut to length to 0.5 mm; tapped ends are an option'),
      S('OpenBuilds', 'https://openbuildspartstore.com/', `V-Slot ${prof}, ${len || '?'} mm`, 'Cut to length, US stock'),
    ];
  }
  if (/cnc|machin|mill|lathe|turn/.test(proc)) return [
    S('SendCutSend', SCS_QUOTE, 'DXF outline', 'CNC routing of sheet stock'),
    S('Xometry', 'https://www.xometry.com/quoting/home/', 'STEP', 'Instant CNC quote, US network'),
    S('JLCCNC', 'https://jlccnc.com/cnc-machining-quote', 'STEP', 'Low cost, ships from China'),
    S('PCBWay', 'https://www.pcbway.com/rapid-prototyping/manufacture/', 'STEP', 'CNC and sheet, ships from China'),
  ];
  return [S('Xometry', 'https://www.xometry.com/quoting/home/', 'STEP', 'Instant quote')];
}

// ---------------------------------------------------------------- live metal options from Premake's quoting service
const METAL_SHOPS = [
  { key: 'RMFG', service: 'RMFG', url: 'https://www.rmfg.com/quote/sheet' },
  { key: 'MATERIAM', service: 'MATERIAM', url: 'https://materiam.com/' },
  { key: 'AFN', service: 'AFN · CNC', url: 'https://agenticfabricationnetwork.ai/' },
];
/** premake-api: a cached quote entry (server/prices/premakeapi.js) -> Order-tab options for RMFG, MATERIAM and AFN, plus
 * SendCutSend's estimate prices (scs). Shops the service didn't ask are left out; while nothing is back yet all three
 * show as quoting. -> { opts, scs } */
function metalOptionsFrom(c, quoting) {
  const shops = premakeApi.shopsOf(c), opts = [];
  const waiting = !c || (c.status === 'pending' && !(c.offers || []).length && !(c.pending || []).length);
  for (const S of METAL_SHOPS) {
    if (HIDDEN_SHOPS.has(S.key)) continue;
    const r = shops[S.key];
    if (r && r.state === 'live' && Object.keys(r.prices).length) {
      const note = S.key === 'AFN'
        ? [`Cheapest of ${r.vendors.join(', ')}`, r.material, r.unfinished ? 'cheapest offers are unfinished (no anodize)' : '', 'prices before shipping'].filter(Boolean).join(' · ')
        : S.key === 'MATERIAM' ? [...r.notes, r.ships_by ? `ships by ${r.ships_by} (1 unit)` : '', 'from Querétaro, MX'].filter(Boolean).join(' · ')
        : [...r.notes.filter((n) => !/ship date is for/.test(n)), r.ships_by ? `ships by ${r.ships_by}` : ''].filter(Boolean).join(' · ');
      opts.push({ service: S.service, kind: 'live', source: `${S.key} via Premake`, fetched_at: c.at, url: r.url || S.url, upload: 'STEP', prices: r.prices, note });
    } else if ((r && r.state === 'pending') || (waiting && (quoting || (c && c.status === 'pending')))) {
      opts.push({ service: S.service, kind: 'pending', url: S.url, note: 'Getting a live quote…' });
    } else if (r && r.state === 'error') {
      opts.push({ service: S.service, kind: 'link', url: S.url, upload: 'STEP', note: `Live quote unavailable (${r.error})` });
    } else if (c && c.error) {
      opts.push({ service: S.service, kind: 'link', url: S.url, upload: 'STEP', note: `Live quote unavailable (${c.error})` });
    }
  }
  const scs = shops.SendCutSend && Object.keys(shops.SendCutSend.prices).length ? shops.SendCutSend.prices : null;
  return { opts, scs };
}
/** SendCutSend has no quote API: put the service's estimate from its published prices on its link ("about $X"). */
function withEstimate(services, scs) {
  if (!scs) return services;
  return services.map((o) => o.service === 'SendCutSend' && !o.prices
    ? { ...o, kind: 'estimate', prices: { ...scs }, note: [o.note, 'about price from its published rates'].filter(Boolean).join(' · ') } : o);
}

// ---------------------------------------------------------------- module
/** Where the Order tab's live Slant shipping is priced to before the customer types an address: the ship-from address in
 * .env.local (BUILDERY_SHIP_FROM_*, our NYC address), else a public midtown address. The key is state + 3-digit zip. */
function shipRegion() {
  const e = process.env;
  const a = { name: e.BUILDERY_SHIP_FROM_NAME || 'Premake', street1: e.BUILDERY_SHIP_FROM_LINE1 || '350 5th Ave', city: e.BUILDERY_SHIP_FROM_CITY || 'New York',
    state: e.BUILDERY_SHIP_FROM_STATE || 'NY', postal_code: e.BUILDERY_SHIP_FROM_POSTAL_CODE || '10118', country: 'US' };
  return { key: `${a.state}-${String(a.postal_code).slice(0, 3)}`, args: a, label: `${a.city}, ${a.state}` };
}

/** One exact order on an existing Slant quote: set the quantity, then rate shipping. Slant's own numbers, nothing added. */
async function slantOrderAt(quoteId, q, region, signal) {
  const r = await slantCall('quote_set_quantity', { quote_id: quoteId, quantity: q }, signal);
  const sel = r.selected || {};
  const s = await slantCall('quote_shipping_options', { quote_id: quoteId, ...region.args }, signal);
  const pr = s.pricing || sel;
  const opts = (s.shipping_options || []).map((o) => ({ carrier: str(o.carrier), service: str(o.service), rate_usd: num(o.rate_usd), days: num(o.delivery_days) }))
    .filter((o) => o.rate_usd != null && o.rate_usd >= 0).sort((a, b) => a.rate_usd - b.rate_usd);
  const ship = opts[0] || null;
  const subtotal = num(pr.subtotal_usd ?? sel.subtotal_usd);
  if (subtotal == null) throw new Error('Slant 3D: no price for this quantity');
  return { quantity: q, unit_usd: num(pr.unit_price_usd ?? sel.unit_price_usd), setup_usd: num(pr.setup_fee_usd ?? sel.setup_fee_usd) || 0, subtotal_usd: subtotal,
    lead_time: str(pr.lead_time || sel.lead_time), ship_usd: ship ? ship.rate_usd : null, ship_days: ship ? ship.days : null,
    ship_service: ship ? `${ship.carrier} ${ship.service}`.trim() : '', boxes: num(s.boxes), region: region.key };
}

function init({ DATA, projDir, exDir, exists, readJSON, writeJSON, send, quote }) {
  const jobs = new Map(); // srcKey -> { started, promise }
  // Slant rate limits: at most one Slant job (a design's upload, or a batch of exact-quantity quotes) runs at a time.
  // Two queues: someone looking at an Order tab ('hi') goes before background work like the designs list's prices ('lo').
  let busy = 0; const waiting = { hi: [], lo: [] };
  const slot = (pri = 'hi', ticket = {}) => new Promise((r) => {
    if (busy < 1) { busy++; r(); return; }
    Object.assign(ticket, { r, pri: pri === 'lo' ? 'lo' : 'hi' }); waiting[ticket.pri].push(ticket);
  });
  const release = () => { const nx = waiting.hi.shift() || waiting.lo.shift(); if (nx) nx.r(); else busy--; };
  /** A queued background job someone is now waiting for: move it to the front queue. */
  const promote = (ticket) => {
    if (!ticket || ticket.pri !== 'lo') return;
    const i = waiting.lo.indexOf(ticket);
    if (i >= 0) { waiting.lo.splice(i, 1); ticket.pri = 'hi'; waiting.hi.push(ticket); }
  };
  const hashMemo = new Map(); // abs path -> { sig, hash, size }
  rmfg.init(DATA); afn.init(DATA); materiam.init(DATA); premakeApi.init(DATA);

  /** premake-api: the live metal options (RMFG, MATERIAM, AFN) for a metal part with a STEP, from Premake's quoting service,
   * plus SendCutSend's published-price estimate. -> { opts: [...], scs: {qty: unit} | null } | null (no STEP), or
   * { fallback: true } when the service can't be reached (the direct supplier modules are used instead). */
  function liveMetal(src, { file, name }) {
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && ((file && x.file === file) || (name && x.name === name)));
    if (!mp || !inDir(src.dir, mp.step)) return null;
    const step = path.join(src.dir, mp.step);
    const m = String(mp.material || '').toLowerCase();
    const opts = { material: /stainless/.test(m) ? 'stainless' : /steel/.test(m) ? 'steel' : 'aluminium', qtys: QTYS, name: mp.name };
    premakeApi.ensure(step, opts);
    const c = premakeApi.cached(step, opts);
    if (c && c.unreachable) return { fallback: true };
    return metalOptionsFrom(c, premakeApi.quoting(step, opts));
  }

  /** afn: the cheapest CNC offer per quantity across AFN's shops for a metal part with a STEP file (live / quoting). */
  function afnOption(src, { file, name }) {
    if (!sup.isAllowed('AFN')) return null;
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && ((file && x.file === file) || (name && x.name === name)));
    if (!mp || !inDir(src.dir, mp.step)) return null;
    const step = path.join(src.dir, mp.step);
    const m = String(mp.material || '').toLowerCase();
    const opts = { process: 'cnc', material: /stainless/.test(m) ? 'stainless steel 304' : /steel/.test(m) ? 'steel 1018' : 'aluminum 6061', qtys: QTYS };
    const c = afn.cached(step, opts);
    if (c && !c.error && (c.offers || []).length) {
      const b = afn.best(c, null);
      const shops = [...new Set(c.offers.map((o) => o.vendor))];
      const raw = Object.values(b).some((o) => !o.finish || o.finish === 'standard');
      return { service: 'AFN · CNC', kind: 'live', source: `AFN (${shops.length} shops)`, fetched_at: c.at, url: `https://agenticfabricationnetwork.ai/quotes/${encodeURIComponent(c.quote_id)}`, upload: 'STEP',
        prices: Object.fromEntries(Object.entries(b).map(([q, o]) => [q, cents(o.unit_usd)])),
        note: [`Cheapest of ${shops.join(', ')}`, `machined from ${opts.material}`, raw ? 'cheapest offers are unfinished (no anodize)' : '', 'prices before shipping'].filter(Boolean).join(' · ') };
    }
    if (!c || Date.now() - c.at > 10 * 60e3) afn.ensure(step, opts);
    if (afn.quoting(step, opts)) return { service: 'AFN · CNC', kind: 'pending', url: 'https://agenticfabricationnetwork.ai/', note: 'Asking several machine shops…' };
    return c?.error ? { service: 'AFN · CNC', kind: 'link', url: 'https://agenticfabricationnetwork.ai/', upload: 'STEP', note: `Live quote unavailable (${c.error})` } : null;
  }

  /** materiam: MATERIAM's live price per quantity for a metal part with a STEP file (laser cut + bent sheet, cut tube). */
  function materiamOption(src, { file, name }) {
    if (HIDDEN_SHOPS.has('MATERIAM') || !sup.isAllowed('MATERIAM')) return null;
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && ((file && x.file === file) || (name && x.name === name)));
    if (!mp || !inDir(src.dir, mp.step)) return null;
    const step = path.join(src.dir, mp.step);
    const m = String(mp.material || '').toLowerCase();
    const opts = { material: /stainless/.test(m) ? 'stainless' : /steel/.test(m) ? 'steel' : 'aluminium', qtys: QTYS };
    const url = 'https://materiam.com/';
    const c = materiam.cached(step, opts);
    if (c && !c.error) {
      return { service: 'MATERIAM', kind: 'live', source: 'MATERIAM', fetched_at: c.at, url: c.project_url || url, upload: 'STEP',
        prices: Object.fromEntries((c.prices || []).map((p) => [p.qty, cents(p.unit_usd)])),
        note: [(c.stock || []).join(', '), c.ships_by && `ships by ${c.ships_by} (1 unit)`, 'from Querétaro, MX, US duty included', ...(c.findings || [])].filter(Boolean).join(' · '),
        warn: (c.findings || []).some((f) => !/radii adjusted/i.test(f)) };
    }
    if (!c || Date.now() - c.at > 10 * 60e3) materiam.ensure(step, opts); // failures retried after 10 min
    if (materiam.quoting(step, opts)) return { service: 'MATERIAM', kind: 'pending', url, note: 'Getting a live quote…' };
    return c?.error ? { service: 'MATERIAM', kind: 'link', url, upload: 'STEP', note: `Live quote unavailable (${c.error})` } : null;
  }

  /** A bought line whose manifest part is modelled as made metal (sheet, laser, CNC, tube), not a bought component or an
   * extrusion: only these get the metal shops (RMFG / AFN / MATERIAM). */
  function madeMetal(src, name) {
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && x.name === name);
    return !!mp && !['bought', 'extrusion', 'print', 'printed', 'component'].includes(String(mp.process || '').toLowerCase()) && !NONMETAL_RE.test(String(mp.material || ''));
  }
  /** The part's STEP (manifest.json parts[].step), as a download for shops that quote from STEP (Order tab). */
  function stepDl(src, { file, name }) {
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && ((file && x.file === file) || (name && x.name === name)));
    if (!mp || !inDir(src.dir, mp.step) || !exists(path.join(src.dir, mp.step))) return null;
    return { label: 'STEP', href: `/files/${src.kind}/${encodeURIComponent(src.id)}/` + String(mp.step).split('/').map(encodeURIComponent).join('/') };
  }
  /** rmfg: the RMFG option for a metal part that has a STEP file (manifest part by STL file, else by name): live prices
   * from the cache, or "Quoting…" while a background quote runs. Null when RMFG isn't connected or there is no STEP. */
  function rmfgOption(src, { file, name }) {
    if (!sup.isAllowed('RMFG') || !rmfg.connected()) return null;
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const mp = (man.parts || []).find((x) => x.step && ((file && x.file === file) || (name && x.name === name)));
    if (!mp || !inDir(src.dir, mp.step)) return null;
    const step = path.join(src.dir, mp.step);
    const m = String(mp.material || '').toLowerCase();
    const opts = { material: /stainless/.test(m) ? 'stainless' : /steel/.test(m) ? 'steel' : 'aluminium', qtys: QTYS, name: mp.name };
    const c = rmfg.cached(step, opts);
    if (c && !c.error) {
      return { service: 'RMFG', kind: 'live', source: 'RMFG', fetched_at: c.at, url: 'https://www.rmfg.com/quote/sheet', upload: 'STEP',
        prices: Object.fromEntries((c.prices || []).filter((p) => p.unit_usd != null).map((p) => [p.qty, cents(p.unit_usd)])),
        note: [c.stock?.map((s) => s.stock).join(', '), ...(c.findings || [])].filter(Boolean).join(' · '),
        warn: (c.findings || []).length > 0 };
    }
    if (!c || Date.now() - c.at > 10 * 60e3) rmfg.ensure(step, opts); // failures retried after 10 min
    if (rmfg.quoting(step, opts)) return { service: 'RMFG', kind: 'pending', url: 'https://www.rmfg.com/quote/sheet', note: 'Getting a live quote…' };
    return { service: 'RMFG', kind: 'link', url: 'https://www.rmfg.com/quote/sheet', upload: 'STEP', note: c?.error ? `Live quote unavailable (${c.error})` : 'Upload the STEP file for a quote' };
  }

  /** Live metal options for one part: Premake's quoting service, else (service unreachable) the direct supplier modules. */
  function metalOpts(src, part) {
    const lm = liveMetal(src, part);
    if (lm && !lm.fallback) return lm.opts.length || lm.scs ? lm : null;
    if (!lm) return null;
    const opts = [rmfgOption(src, part), materiamOption(src, part), afnOption(src, part)].filter(Boolean);
    return opts.length ? { opts, scs: null } : null;
  }

  function fileHash(abs) {
    let st; try { st = fs.statSync(abs); } catch { return null; }
    const sig = `${st.mtimeMs}:${st.size}`;
    const m = hashMemo.get(abs);
    if (m && m.sig === sig) return m;
    if (st.size > MAX_STL_BYTES) return null;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    const v = { sig, hash, size: st.size };
    hashMemo.set(abs, v);
    return v;
  }
  /** A regular file inside dir: no symlinks, realpath-contained (N3: its bytes are uploaded to Slant 3D). */
  const inDir = (dir, rel) => {
    try {
      const root = fs.realpathSync(dir), abs = path.resolve(root, String(rel || ''));
      if (!abs.startsWith(root + path.sep) || !fs.lstatSync(abs).isFile()) return null;
      const real = fs.realpathSync(abs);
      return real.startsWith(root + path.sep) ? real : null;
    } catch { return null; }
  };

  /** Cut parts (fabricated, not extrusion), one file each for the zip: a flat part's DXF, else its STEP, else its STL. */
  function cutFiles(src, bom, preferStep = false) {
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const out = [], seen = new Set();
    for (const f of bom.fabricated || []) {
      if (!f || typeof f !== 'object' || f.process === 'extrusion' || !f.file || seen.has(f.file)) continue;
      seen.add(f.file);
      const abs = inDir(src.dir, f.file);
      if (!abs) continue;
      const base = path.basename(abs).replace(/\.stl$/i, '');
      const p = f.params || {};
      const flat = f.process === 'laser' || (f.process === 'sheet' && !(Number(p.bends) > 0));
      try {
        const st = fs.statSync(abs);
        if (st.size > MAX_STL_BYTES) continue;
        const mp = (man.parts || []).find((x) => x.step && x.file === f.file);
        const step = mp && inDir(src.dir, mp.step);
        if (step && preferStep) { out.push({ name: `${base}.step`, data: fs.readFileSync(step), mtime: fs.statSync(step).mtime }); continue; }
        const d = flat ? plateDxf(fs.readFileSync(abs)) : null;
        if (d) { out.push({ name: `${base}.dxf`, data: Buffer.from(d.dxf), mtime: st.mtime }); continue; }
        if (step) { out.push({ name: `${base}.step`, data: fs.readFileSync(step), mtime: fs.statSync(step).mtime }); continue; }
        out.push({ name: `${base}.stl`, data: fs.readFileSync(abs), mtime: st.mtime });
      } catch {}
    }
    return out;
  }

  function source(url) {
    const pid = url.searchParams.get('project'), ex = url.searchParams.get('example');
    if (pid) { const dir = projDir(pid); return dir && exists(dir) ? withSaved({ kind: 'projects', id: pid, dir, cache: path.join(DATA, '.sourcing', 'projects', pid, 'cache.json') }) : null; }
    if (ex) { const dir = exDir(ex); return dir && exists(dir) ? withSaved({ kind: 'examples', id: ex, dir, cache: path.join(DATA, '.sourcing', 'examples', ex, 'cache.json') }) : null; }
    return null;
  }
  /** An example (or a design copied from one) carries its saved quotes (quotes.json, scripts/import-quotes.py): the
   *  starting cache, so a fresh install prices it without asking a shop. A changed part set has a new key and re-quotes. */
  function withSaved(src) {
    if (!exists(src.cache) && exists(path.join(src.dir, 'quotes.json'))) {
      try { fs.mkdirSync(path.dirname(src.cache), { recursive: true }); fs.copyFileSync(path.join(src.dir, 'quotes.json'), src.cache); } catch {}
    }
    return src;
  }

  /** Printed parts with their STL hash. */
  function printedOf(src, bom) {
    return (bom.printed || []).slice(0, MAX_PRINTED).map((p, i) => {
      const abs = p && inDir(src.dir, p.file);
      const h = abs && /\.stl$/i.test(abs) ? fileHash(abs) : null;
      return { i, p: p || {}, abs, hash: h?.hash || null };
    });
  }
  const setKeyOf = (printed) => crypto.createHash('sha256').update(MATERIAL + '|' + printed.map((x) => x.hash || '-').join(',')).digest('hex').slice(0, 24);

  function startSlant(src, printed, key, pri = 'hi') {
    const k = `${src.kind}:${src.id}`;
    if (jobs.has(k)) { if (pri === 'hi') promote(jobs.get(k).ticket); return; }
    const ac = new AbortController();
    let timer = null;
    const job = { started: Date.now(), ticket: {} };
    jobs.set(k, job);
    job.promise = (async () => {
      await slot(pri, job.ticket);
      timer = setTimeout(() => ac.abort(new Error('Slant 3D quote timed out')), JOB_TIMEOUT_MS); // from the start of the upload, not the queue
      let cache = readJSON(src.cache, {}) || {};
      try {
        const parts = printed.filter((x) => x.hash).map((x) => ({ hash: x.hash, file_name: `${x.i + 1}-${path.basename(x.abs)}`, buf: fs.readFileSync(x.abs) }));
        const r = await slantQuote(parts, ac.signal);
        cache = readJSON(src.cache, {}) || {}; // exact-quantity quotes may have landed meanwhile
        cache.slant = { key, fetched_at: Date.now(), ...r, orders: {} }; // a new quote id: exact-quantity prices start over
      } catch (e) {
        cache.slant = { key, failed_at: Date.now(), error: String(e?.message || e).slice(0, 200), prev: cache.slant?.set ? cache.slant : cache.slant?.prev || null };
        console.error(`[sourcing ${k}] Slant 3D quote failed: ${cache.slant.error}`);
      } finally {
        clearTimeout(timer);
        try { fs.mkdirSync(path.dirname(src.cache), { recursive: true }); writeJSON(src.cache, cache); } catch (e) { console.error(`[sourcing ${k}] cache write failed: ${e.message}`); }
        jobs.delete(k);
        release();
      }
    })();
  }

  function build(src, bom, cache, quoting) {
    bom = sup.normalizeBom(bom || {});
    const files = `/files/${src.kind}/${encodeURIComponent(src.id)}/`;
    const q = quote(bom, 'assembled', src.dir, { force_print: 'inhouse' }); // prices: "Premake print" = our in-house cost model
    const tiers = (q.tiers || []).filter((t) => QTYS.includes(t.qty));
    const printed = printedOf(src, bom);
    const key = setKeyOf(printed);
    let slant = cache.slant && cache.slant.key === key && cache.slant.set ? cache.slant : null;
    const failed = cache.slant && cache.slant.key === key && cache.slant.error ? cache.slant : null;
    const lines = [];

    // printed parts
    const grams = printed.reduce((s, x) => s + (Number(x.p.grams) || 0), 0) || 1;
    const hours = printed.reduce((s, x) => s + (Number(x.p.print_hours) || 0), 0) || 1;
    const slantSum = slant ? Object.values(slant.parts || {}).reduce((s, p) => s + (p.price_usd || 0), 0) : 0;
    for (const x of printed) {
      const p = x.p, options = [];
      const sp = slant && x.hash ? slant.parts?.[x.hash] : null;
      if (sp && slantSum > 0) {
        const share = (sp.price_usd || 0) / slantSum;
        options.push({ service: 'Slant 3D', kind: 'live', source: 'Slant 3D', fetched_at: slant.fetched_at, url: 'https://www.slant3d.com/',
          material: `${slant.material}${slant.color ? ' ' + slant.color : ''}`,
          prices: Object.fromEntries(QTYS.filter((n) => slant.set[n]).map((n) => [n, cents(slant.set[n].unit_usd * share)])),
          lead: Object.fromEntries(QTYS.filter((n) => slant.set[n]).map((n) => [n, slant.set[n].lead_time])),
          setup: Object.fromEntries(QTYS.filter((n) => slant.set[n]).map((n) => [n, slant.set[n].setup_usd])),
          note: 'Share of the whole-set quote; setup fee is per order' });
      } else if (quoting && x.hash) {
        options.push({ service: 'Slant 3D', kind: 'pending', url: 'https://www.slant3d.com/', note: 'Getting a live quote…' });
      } else {
        options.push({ service: 'Slant 3D', kind: 'link', url: 'https://www.slant3d.com/', upload: 'STL',
          note: failed ? `Live quote unavailable (${failed.error})` : !x.hash ? 'STL missing' : 'Upload the STL for a quote' });
      }
      // Premake's own print price: this part's share of filament + printer time, with Premake's margin
      const bp = {};
      for (const t of tiers) {
        const u = t.unit || {}, cost = (t.unit_price || 0) - (u.margin || 0) - (u.handling || 0);
        const mRate = cost > 0 ? (u.margin || 0) / cost : 0;
        bp[t.qty] = cents(((u.material || 0) * (Number(p.grams) || 0) / grams + (u.printing || 0) * (Number(p.print_hours) || 0) / hours) * (1 + mRate));
      }
      options.push({ service: 'Premake print', kind: 'estimate', source: 'Premake', compare: true, prices: bp,
        lead: Object.fromEntries(tiers.map((t) => [t.qty, t.lead_time_days <= 1 ? 'next day' : `${t.lead_time_days} days`])), note: 'PETG, printed and checked by us' });
      for (const o of PRINT_SHOPS) if (onList(o)) options.push(o);
      const colour = FILAMENT_NAMES[String(p.color || '').toLowerCase()] || ''; // colours: the customer's pick from the studio
      lines.push({ id: `printed:${x.i}`, type: 'printed', name: str(p.name) || `Part ${x.i + 1}`, qty_per_unit: 1, ...(colour ? { color: colour } : {}),
        detail: [Number(p.grams) ? `${Math.round(p.grams)} g` : '', Number(p.print_hours) ? `${(+p.print_hours).toFixed(1)} h` : '', 'PETG', colour ? `colour: ${colour}` : ''].filter(Boolean).join(' · '),
        downloads: x.abs ? [{ label: 'STL', href: files + String(p.file).split('/').map(encodeURIComponent).join('/') }] : [],
        feedback: sp?.issues || [], options });
    }

    // fabricated parts (identical pieces grouped)
    const groups = new Map();
    for (const f of (bom.fabricated || [])) {
      if (!f || typeof f !== 'object') continue;
      const k = `${f.name}|${f.process}|${JSON.stringify(f.params || {})}`;
      if (groups.has(k)) groups.get(k).n++; else groups.set(k, { f, n: 1 });
    }
    let gi = 0;
    for (const { f, n } of groups.values()) {
      const est = ['extrusion', 'sheet', 'laser'].includes(f.process) ? pricingFab.priceLine(f) : null;
      const options = [];
      if (est) options.push({ service: 'Premake shop model', kind: 'estimate', source: 'Premake',
        prices: Object.fromEntries(QTYS.map((qq) => [qq, cents(est.piece_usd + est.setup_usd_per_batch / qq)])),
        note: `Our cost model: ${est.detail}` });
      const metal = f.process !== 'extrusion' && !NONMETAL_RE.test(JSON.stringify(f.params || {})); // extrusion: Amazon pre-cut, Misumi, OpenBuilds only
      const lm = metal ? metalOpts(src, { file: f.file, name: f.name }) : null; // live metal prices beat our estimate
      if (lm) options.unshift(...lm.opts);
      options.push(...withEstimate(fabServices(f), lm?.scs));
      const p = f.params || {};
      const flat = f.process === 'laser' || (f.process === 'sheet' && !(Number(p.bends) > 0));
      const dl = [];
      if (f.file && inDir(src.dir, f.file)) {
        dl.push({ label: 'STL', href: files + String(f.file).split('/').map(encodeURIComponent).join('/') });
        if (flat) dl.push({ label: 'DXF', href: `/api/sourcing?${src.kind === 'projects' ? 'project' : 'example'}=${enc(src.id)}&dxf=${enc(f.file)}` });
      }
      const fs1 = stepDl(src, { file: f.file, name: f.name }); if (fs1) dl.push(fs1); // Order tab: STEP for RMFG / MATERIAM / AFN uploads
      lines.push({ id: `fab:${gi++}`, type: 'fabricated', process: str(f.process), name: str(f.name) || 'Fabricated part', qty_per_unit: n,
        detail: est?.detail || [p.material, p.thickness_mm && `${p.thickness_mm} mm`, p.profile, p.length_mm && `${p.length_mm} mm`].filter(Boolean).join(' · '),
        downloads: dl, feedback: [], options });
    }

    // bought parts (stop-gap "fabricated": true lines dropped when real fabricated pricing exists)
    const bought = (pricingFab.withoutStopgap(bom).parts || []).filter((p) => p && typeof p === 'object' && str(p.name));
    bought.forEach((p, i) => {
      const options = [];
      const qpu = Number(p.qty_per_unit) || 1;
      // A real checked price (fields another tool may add): price_usd + price_source + a timestamp
      const listedAt = p.price_checked_at || p.price_updated_at || p.price_fetched_at;
      if (num(p.price_usd) != null && str(p.price_source) && listedAt) {
        const t = typeof listedAt === 'number' ? (listedAt < 1e12 ? listedAt * 1000 : listedAt) : Date.parse(listedAt);
        options.push({ service: str(p.price_source), kind: 'listed', source: str(p.price_source), fetched_at: Number.isFinite(t) ? t : null,
          url: str(p.price_url) || str(p.url) || null, prices: Object.fromEntries(QTYS.map((qq) => [qq, cents(num(p.price_usd))])) });
      }
      if (/^https?:\/\//i.test(str(p.url))) {
        let host = ''; try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch {}
        options.push({ service: str(p.supplier) || host || 'Supplier', kind: 'link', url: str(p.url),
          note: sup.isAmazonProduct(p.url) ? 'Listed in the parts list' : sup.isAmazonUrl(p.url) ? 'Prime only' : 'Listed in the parts list' });
      }
      if (/^https?:\/\//i.test(str(p.ref_url)) && !options.some((o) => o.url === p.ref_url)) { // the parts list's own shop (normalizeBom moved it to ref_url)
        let host = ''; try { host = new URL(p.ref_url).hostname.replace(/^www\./, ''); } catch {}
        options.push({ service: str(p.supplier_note) || host || 'Supplier', kind: 'link', url: str(p.ref_url), note: 'Listed in the parts list' });
      }
      const links = boughtLinks(p);
      const listed = str(p.supplier).toLowerCase();
      if (listed) links.sort((a, b) => (b.service.toLowerCase() === listed) - (a.service.toLowerCase() === listed)); // listed supplier first
      for (const l of links) if (!options.some((o) => o.service === l.service)) options.push(l);
      // metal shops only for a part modelled as made metal (sheet / tube), never a bought component like a T-slot table
      const made = madeMetal(src, str(p.name));
      const lm = made ? metalOpts(src, { name: str(p.name) }) : null; // a modelled metal part listed as bought (e.g. a slotted tube)
      if (lm) options.unshift(...lm.opts);
      const unit = num(p.unit_cost_usd);
      // Premake stock: an ordered kit gets this from our NYC shelf at the bulk per-piece cost; the shop links stay (where
      // we restock it, and where someone building it themselves can buy it)
      const sc = stock.classify(p);
      const stocked = sc.stocked ? { stocked: true, stock_unit_usd: stock.bulkUnit(p, sc.cat).unit_usd } : {};
      lines.push({ id: `bought:${i}`, type: 'bought', name: str(p.name), qty_per_unit: qpu, detail: str(p.notes), ...stocked,
        supplier: str(p.supplier), ...(p.supplier_note ? { supplier_note: str(p.supplier_note) } : {}), ...(sup.isManual(p) ? { manual_order: true } : {}), search: searchTerm(p), // agentbrain: a shop we don't auto-order
        estimate: unit != null ? { unit_usd: unit, source: 'Parts list estimate' } : null, downloads: lm?.opts.length ? [stepDl(src, { name: str(p.name) })].filter(Boolean) : [], feedback: [], options });
    });

    // Make it yourself: cheapest outside supplier per part (Premake's own print price only when none is priced), per unit, at each qty (+ Slant setup per order spread over qty)
    const diy = {};
    for (const qq of QTYS) {
      let live = 0, est = 0, unpriced = 0;
      for (const l of lines) {
        let priced = l.options.filter((o) => o.prices && o.prices[qq] != null && !o.compare); // outside suppliers, not Premake's own print
        if (!priced.length) priced = l.options.filter((o) => o.prices && o.prices[qq] != null);
        const best = priced.sort((a, b) => a.prices[qq] - b.prices[qq])[0];
        const each = best ? best.prices[qq] : l.estimate ? l.estimate.unit_usd : null;
        if (each == null) { unpriced++; continue; }
        const v = each * l.qty_per_unit;
        if (best && (best.kind === 'live' || best.kind === 'listed')) live += v; else est += v;
      }
      const slantUsed = !!slant && lines.some((l) => l.type === 'printed' && l.options[0]?.kind === 'live' && l.options[0].prices[qq] != null);
      const setup = slantUsed && slant.set[qq] ? slant.set[qq].setup_usd / qq : 0;
      live += setup;
      const b = tiers.find((t) => t.qty === qq);
      diy[qq] = { unit_usd: cents(live + est), live_usd: cents(live), estimate_usd: cents(est), setup_per_unit_usd: cents(setup), unpriced,
        buildery_unit_usd: b ? b.unit_price : null };
    }

    return {
      status: quoting ? 'quoting' : 'ready', material: MATERIAL, qtys: QTYS, generated_at: Date.now(),
      slant: slant ? { fetched_at: slant.fetched_at, set: slant.set, set_price_usd: slant.set_price_usd, material: slant.material, color: slant.color }
        : failed ? { error: failed.error, failed_at: failed.failed_at } : quoting ? { quoting: true } : null,
      diy, lines,
      cut_zip: lines.some((l) => l.type === 'fabricated' && l.process !== 'extrusion') ? `/api/sourcing?${src.kind === 'projects' ? 'project' : 'example'}=${enc(src.id)}&zip=cut` : null,
      printed_zip: printed.some((x) => x.abs) ? `/api/sourcing?${src.kind === 'projects' ? 'project' : 'example'}=${enc(src.id)}&zip=printed` : null,
      sources: {
        live: ['Slant 3D (public MCP quote API)', 'RMFG, MATERIAM and AFN (via Premake\'s quoting service, premake.ai/api/v1)'],
        estimate: ['Premake print and shop cost models', 'Parts list unit_cost_usd'],
        link_only: `${['Craftcloud', 'JLC3DP', 'SendCutSend', 'OSHCut', 'Ponoko', 'Misumi', 'OpenBuilds', 'Xometry', 'JLCCNC', 'PCBWay', 'McMaster', 'DigiKey', 'Mouser', 'LCSC', 'Amazon', 'AliExpress'].filter((x) => sup.isAllowed(x)).join(', ')}: no public no-key price API`,
      },
    };
  }

  async function handle(req, res, url) {
    const src = source(url);
    if (!src) return send(res, 404, { error: 'not found' });
    const bom = readJSON(path.join(src.dir, 'bom.json'), {}) || {};
    if (url.searchParams.get('zip') === 'printed') { // Order tab: every printed part's STL in one zip, for the print shop
      const files = [];
      for (const x of printedOf(src, bom)) {
        if (!x.abs || !/\.stl$/i.test(x.abs)) continue;
        try { const st = fs.statSync(x.abs); if (st.size <= MAX_STL_BYTES) files.push({ name: `${x.i + 1}-${path.basename(x.abs)}`, data: fs.readFileSync(x.abs), mtime: st.mtime }); } catch {}
      }
      if (!files.length) return send(res, 404, { error: 'No printed parts' });
      const slug = String(src.id).replace(/[^\w-]+/g, '').slice(0, 48) || 'design';
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${slug}-printed-parts.zip"`, 'Cache-Control': 'no-store' });
      return res.end(makeZip(files));
    }
    if (url.searchParams.get('zip') === 'cut') { // Order tab: every cut part's file in one zip for SendCutSend (DXF when flat, else STEP, else STL)
      const files = cutFiles(src, bom, url.searchParams.get('want') === 'step'); // want=step: live metal shops quote from STEP
      if (!files.length) return send(res, 404, { error: 'No cut parts' });
      const slug = String(src.id).replace(/[^\w-]+/g, '').slice(0, 48) || 'design';
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${slug}-cut-parts.zip"`, 'Cache-Control': 'no-store' });
      return res.end(makeZip(files));
    }
    const dxfFile = url.searchParams.get('dxf');
    if (dxfFile != null) {
      const f = (bom.fabricated || []).find((x) => x && x.file === dxfFile);
      const abs = f && inDir(src.dir, f.file);
      if (!abs || !exists(abs)) return send(res, 404, { error: 'not found' });
      const out = plateDxf(fs.readFileSync(abs));
      if (!out) return send(res, 422, { error: 'This part is not a flat sheet, so there is no DXF. Upload the STEP or STL instead.' });
      const name = path.basename(abs).replace(/\.stl$/i, '') + '.dxf';
      res.writeHead(200, { 'Content-Type': 'application/dxf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      return res.end(out.dxf);
    }
    const cache = readJSON(src.cache, {}) || {};
    const printed = printedOf(src, bom);
    const key = setKeyOf(printed);
    const c = cache.slant;
    const fresh = c && c.key === key && ((c.set && Date.now() - c.fetched_at < CACHE_TTL_MS) || (c.error && Date.now() - c.failed_at < RETRY_AFTER_FAIL_MS));
    const want = printed.some((x) => x.hash);
    const k = `${src.kind}:${src.id}`;
    if (want && !fresh) startSlant(src, printed, key);
    const quoting = jobs.has(k);
    // While a re-quote runs, show the previous live prices only when they are for the same parts (key match)
    const body = build(src, bom, quoting && c?.key === key && c?.set ? cache : quoting ? {} : readJSON(src.cache, {}) || {}, quoting);
    // premake-api: live metal quotes still coming back count as quoting too, so the Order tab keeps polling
    const metalPending = body.lines.some((l) => l.options.some((o) => o.kind === 'pending'));
    if (metalPending) body.status = 'quoting';
    return send(res, quoting || metalPending ? 202 : 200, body);
  }

  /** prices: the cached Slant quote for a design dir, for the main quote. Sync; starts a background re-quote when the
   * cache is missing, stale (7 days) or for different STLs. -> { status: "live" | "quoting" | "failed" | "none", ... } */
  function slantState(dir, kind, opts = {}) {
    const u = new URL('http://x/');
    u.searchParams.set(kind === 'examples' ? 'example' : 'project', path.basename(path.resolve(dir)));
    const src = source(u);
    if (!src) return { status: 'none', error: 'design not found' };
    const bom = readJSON(path.join(src.dir, 'bom.json'), {}) || {};
    const printed = printedOf(src, bom);
    if (!printed.some((x) => x.hash)) return { status: 'none', error: 'STL files missing' };
    const key = setKeyOf(printed);
    const c = (readJSON(src.cache, {}) || {}).slant;
    const fresh = c && c.key === key && ((c.set && Date.now() - c.fetched_at < CACHE_TTL_MS) || (c.error && Date.now() - c.failed_at < RETRY_AFTER_FAIL_MS));
    if (!fresh && !(opts.background && process.env.PREMAKE_LIST_QUOTES === '0')) startSlant(src, printed, key, opts.background ? 'lo' : 'hi'); // local installs: no uploads for list prices
    const quoting = jobs.has(`${src.kind}:${src.id}`);
    const live = c && c.key === key && c.set ? c : null;
    if (live) return { status: 'live', set: live.set, parts: live.parts, byIndex: printed.map((x) => (x.hash ? live.parts?.[x.hash] || null : null)),
      fetched_at: live.fetched_at, material: live.material, color: live.color, refreshing: quoting };
    if (quoting) return { status: 'quoting' };
    return { status: 'failed', error: c && c.key === key ? c.error : 'no quote yet' };
  }

  // ---------------------------------------------------------------- exact orders (Order tab, checkout)
  // Slant prices an exact quantity (quote_set_quantity) and its shipping (quote_shipping_options) on the design's quote.
  // Cached in the design's sourcing cache under slant.orders["<qty>|<region>"] for 7 days (failures retried after 10 min).
  // Requests are debounced per design (400 ms) and batched: one Slant job runs at a time across all designs.
  const ojobs = new Map(); // srcKey -> { pending: Set<qty>, timer, running }
  const srcOf = (dir, kind) => {
    const u = new URL('http://x/');
    u.searchParams.set(kind === 'examples' ? 'example' : 'project', path.basename(path.resolve(dir)));
    return source(u);
  };
  function writeOrder(src, key, okey, v) {
    const cache = readJSON(src.cache, {}) || {};
    if (!cache.slant || cache.slant.key !== key) return;
    cache.slant.orders = { ...(cache.slant.orders || {}), [okey]: v };
    try { fs.mkdirSync(path.dirname(src.cache), { recursive: true }); writeJSON(src.cache, cache); } catch (e) { console.error(`[sourcing] order cache write failed: ${e.message}`); }
  }
  async function runOrders(src, printed, key) {
    const k = `${src.kind}:${src.id}`, j = ojobs.get(k);
    if (!j) return;
    j.timer = null; j.running = true;
    try {
      while (j.pending.size) {
        // the design's quote first (uploads every STL once); a running upload is awaited, not repeated
        let c = (readJSON(src.cache, {}) || {}).slant;
        if (!(c && c.key === key && c.quote_id)) {
          startSlant(src, printed, key, j.pri); // starts it, or moves a queued background upload up
          await jobs.get(k)?.promise;
          c = (readJSON(src.cache, {}) || {}).slant;
        }
        const region = shipRegion();
        const qs = [...j.pending].slice(0, 6);
        for (const q of qs) j.pending.delete(q);
        if (!(c && c.key === key && c.quote_id)) {
          for (const q of qs) writeOrder(src, key, `${q}|${region.key}`, { error: c?.error || 'no Slant quote', at: Date.now() });
          continue;
        }
        await slot(j.pri, j.ticket = {});
        try {
          for (const q of qs) {
            const okey = `${q}|${region.key}`;
            try {
              const v = await slantOrderAt(c.quote_id, q, region, AbortSignal.timeout(JOB_TIMEOUT_MS));
              writeOrder(src, key, okey, { ...v, at: Date.now() });
            } catch (e) {
              console.error(`[sourcing ${k}] Slant 3D order quote (${q}) failed: ${e.message}`);
              writeOrder(src, key, okey, { error: String(e?.message || e).slice(0, 200), at: Date.now() });
              if (/quote/i.test(e.message) && /not found|expired|invalid|unknown/i.test(e.message)) { // the quote id expired: upload again next round
                const cache = readJSON(src.cache, {}) || {};
                if (cache.slant?.key === key) { delete cache.slant.quote_id; writeJSON(src.cache, cache); }
                for (const x of qs) j.pending.add(x);
                break;
              }
            }
          }
        } finally { release(); }
      }
    } finally {
      j.running = false;
      if (j.pending.size) j.timer = setTimeout(() => runOrders(src, printed, key), 400); else ojobs.delete(k);
    }
  }
  /** prices: Slant's exact price for `q` sets of a design's printed parts, with shipping to shipRegion(). Sync, from cache;
   * a miss queues a live quote. -> { status: "live", subtotal_usd, ship_usd, lead_time, ... } | { status: "quoting" | "failed" | "none" } */
  function slantOrder(dir, kind, q, opts = {}) {
    const src = srcOf(dir, kind);
    if (!src) return { status: 'none', error: 'design not found' };
    const bom = readJSON(path.join(src.dir, 'bom.json'), {}) || {};
    const printed = printedOf(src, bom);
    if (!printed.some((x) => x.hash)) return { status: 'none', error: 'STL files missing' };
    const key = setKeyOf(printed), region = shipRegion(), okey = `${q}|${region.key}`;
    const c = (readJSON(src.cache, {}) || {}).slant;
    if (c && c.key === key && c.error && !c.set && Date.now() - c.failed_at < RETRY_AFTER_FAIL_MS) return { status: 'failed', error: c.error };
    const hit = c && c.key === key ? c.orders?.[okey] : null;
    if (hit && !hit.error && Date.now() - hit.at < CACHE_TTL_MS) return { status: 'live', ...hit, fetched_at: hit.at, material: c.material, color: c.color, region_label: region.label };
    if (hit && hit.error && Date.now() - hit.at < RETRY_AFTER_FAIL_MS) return { status: 'failed', error: hit.error };
    if (opts.background && process.env.PREMAKE_LIST_QUOTES === '0') return { status: 'none' }; // local installs: no uploads for list prices
    const k = `${src.kind}:${src.id}`;
    const pri = opts.background ? 'lo' : 'hi';
    if (!ojobs.has(k)) ojobs.set(k, { pending: new Set(), timer: null, running: false, pri });
    const j = ojobs.get(k);
    if (pri === 'hi' && j.pri !== 'hi') { j.pri = 'hi'; promote(j.ticket); promote(jobs.get(k)?.ticket); }
    j.pending.add(q);
    if (!j.running && !j.timer) j.timer = setTimeout(() => runOrders(src, printed, key), 400);
    return { status: 'quoting' };
  }

  /** fulfilment: the same per-part lines for an order's source ({project} | {example}), from cache only (no new quote). */
  function linesFor(from) {
    const u = new URL('http://x/');
    if (from?.project) u.searchParams.set('project', from.project); else if (from?.example) u.searchParams.set('example', from.example); else return null;
    const src = source(u);
    if (!src) return null;
    const bom = sup.normalizeBom(readJSON(path.join(src.dir, 'bom.json'), {}) || {});
    return { dir: src.dir, kind: src.kind, id: src.id, bom, ...build(src, bom, readJSON(src.cache, {}) || {}, false) };
  }

  return { handle, plateDxf, linesFor, slantState, slantOrder, shipRegion, _slantCall: slantCall };
}

module.exports = { init, plateDxf, readStl, slantQuote, boughtLinks, fabServices, searchTerm, QTYS, shipRegion, slantOrderAt, metalOptionsFrom, withEstimate, NONMETAL_RE, HIDDEN_SHOPS, SCS_QUOTE };
