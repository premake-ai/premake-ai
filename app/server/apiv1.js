'use strict';
// apiv1: the public sourcing API (docs/business/SOURCING-API-PLAN.md, phase 1). One API over shops, print networks and
// factories: upload a part, ask for quantities, get live offers from every supplier that can make it.
//
//   POST /api/v1/parts          raw STEP/STL body (X-Filename header or ?filename=), or JSON {filename, content_base64}
//                               -> { part_id, filename, format, bbox_mm, volume_mm3, area_mm2, processes, warnings }
//   POST /api/v1/quotes         { parts: [{ part_id, qty (number or list), material }], ship_to_zip? }
//                               -> 202 { quote_id, status: "pending", url, poll }   (suppliers are asked in the background)
//   GET  /api/v1/quotes/:id     -> { status: "pending" | "complete", offers: [...], best, pending, errors, url, order_url }
//   GET  /api/v1/suppliers      -> who we quote, how (live / estimate), processes, materials
//   GET  /q/:id                 read-only comparison page (no orders, no payments)
//
// Suppliers are the existing modules (server/prices/rmfg.js, afn.js, materiam.js; Slant 3D from server/sourcing.js; the
// SendCutSend fab model; the Fusion price model). Their caches (DATA/.sourcing/...) key on file hash + options, so a part
// already quoted in the studio comes back instantly. Supplier tokens never leave the server.
//
// Anonymous: rate-limited per IP (quotes and uploads per day), files up to 50 MB, STEP/STL only. Uploads live in
// DATA/.apiv1/ (mode 600) and are deleted after 30 days, with their quotes. Nothing here orders, pays or emails anyone.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE = 50 * 1024 * 1024;
const KEEP_MS = 30 * 864e5;
const TASK_DEADLINE_MS = 15 * 60e3; // a supplier that hasn't answered by then is reported as not answering
const STD_QTYS = [1, 10, 100, 500]; // the studio's quantities: asking for these reuses its cached supplier quotes
const MAX_QTYS = 6, MAX_PARTS = 10, MAX_QTY = 100000;
const PRINT_MAX_MM = 300;

let C = {}; // see init()
const root = () => path.join(C.DATA, '.apiv1');
const partDir = (id) => path.join(root(), 'parts', id);
const quoteFile = (id) => path.join(root(), 'quotes', id + '.json');
const readJ = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };
const cents = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 100) / 100);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PART_RE = /^prt_[0-9a-f]{20}$/, QUOTE_RE = /^qt_[0-9a-f]{20}$/;
const day = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + Math.round(n)); return day(x); };
const today = () => day(new Date());
const num = (v, d) => { const n = Number(process.env[v]); return Number.isFinite(n) && n > 0 ? n : d; };

// ---------------------------------------------------------------- materials
/** Free text -> { family, label, rmfg, afn, model } (the names each supplier module expects). */
function material(m) {
  const s = String(m || '').toLowerCase().trim();
  if (/stainless|\b30[34]\b|\b316\b/.test(s)) return { family: 'stainless', label: 'Stainless steel 304', rmfg: 'stainless', afn: 'stainless steel 304', model: 'stainless_304' };
  if (/steel|iron|1018|a36|crs/.test(s)) return { family: 'steel', label: 'Mild steel', rmfg: 'steel', afn: 'steel 1018', model: 'steel' };
  if (/acryl|pmma|plexi|perspex/.test(s)) return { family: 'acrylic', label: 'Acrylic', model: 'acrylic_laser' };
  if (/pla\b|petg|abs|asa|nylon|pa12|plastic|resin|print|tpu/.test(s)) return { family: 'plastic', label: 'PETG (3D printed)', model: 'petg_print' };
  return { family: 'aluminium', label: 'Aluminium 6061 / 5052', rmfg: 'aluminium', afn: 'aluminum 6061', model: 'aluminum_6061' };
}
const isMetal = (mat) => ['aluminium', 'steel', 'stainless'].includes(mat.family);

// ---------------------------------------------------------------- part facts
/** STL facts in JS: bbox, volume (divergence theorem), area. */
function stlInfo(buf) {
  const tris = C.readStl(buf);
  if (!tris.length) return { error: 'This STL has no triangles' };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let vol = 0, area = 0;
  for (const [a, b, c] of tris) {
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return { bbox_mm: hi.map((h, k) => cents(h - lo[k])).sort((x, y) => x - y), volume_mm3: cents(Math.abs(vol)), area_mm2: cents(area), triangles: tris.length };
}

/** Likely processes (most likely first) and warnings from the shape facts. */
function processesOf(f, format) {
  const [a, b, c] = f.bbox_mm, warnings = [];
  const wall = f.area_mm2 > 0 ? (2 * f.volume_mm3) / f.area_mm2 : null; // average wall thickness
  const out = [];
  const tube = wall && wall <= 3.5 && b > 0 && Math.abs(b - a) / b < 0.03 && c > b * 1.2 && f.volume_mm3 < a * b * c * 0.5;
  const sheet = wall && wall <= 6.5 && !tube && (f.faces ? f.faces.other <= 2 : true);
  if (tube) out.push('tube_laser');
  if (sheet) out.push(a <= wall * 1.6 ? 'laser_cut' : 'sheet_metal');
  out.push('cnc');
  if (c <= PRINT_MAX_MM) out.push('3d_print');
  if (c > 1500) warnings.push(`Longest side is ${Math.round(c)} mm. Most instant-quote shops stop around 1200 mm.`);
  if (c < 2) warnings.push('This part is under 2 mm long. Check the file is in millimetres.');
  if (f.solids > 1) warnings.push(`The file holds ${f.solids} separate bodies. Shops may quote them as one part or reject it; upload one part per file.`);
  if (format === 'stl') warnings.push('STL is a mesh: metal shops need STEP, so only 3D printing and estimates are quoted. Export STEP for live metal prices.');
  return { processes: out, wall_mm: wall ? cents(wall) : null, warnings };
}

// ---------------------------------------------------------------- Slant 3D (printing), same interface as the other modules
const slantCache = (k) => path.join(C.DATA, '.sourcing', 'slant-api', k + '.json');
const slantRunning = new Map();
let slantChain = Promise.resolve(); // one Slant job at a time (their rate limits)
const slantKey = (buf, o) => crypto.createHash('sha256').update(buf).update(JSON.stringify(['PETG', o.qtys])).digest('hex').slice(0, 24);
const slant = {
  cached(file, o) { try { const c = readJ(slantCache(slantKey(fs.readFileSync(file), o))); return c && Date.now() - c.at < 3 * 864e5 ? c : null; } catch { return null; } },
  quoting(file, o) { try { return slantRunning.has(slantKey(fs.readFileSync(file), o)); } catch { return false; } },
  ensure(file, o) {
    let buf; try { buf = fs.readFileSync(file); } catch { return null; }
    const k = slantKey(buf, o);
    if (slantRunning.has(k)) return slantRunning.get(k);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const p = (slantChain = slantChain.catch(() => {}).then(() => C.slantQuote([{ hash, file_name: 'part.stl', buf }], AbortSignal.timeout(120e3), o.qtys)))
      .then((r) => ({ at: Date.now(), material: r.material, color: r.color, set: r.set, issues: r.parts?.[hash]?.issues || [] }))
      .catch((e) => ({ at: Date.now(), error: String(e?.message || e).slice(0, 200) }))
      .then((out) => { try { writeJ(slantCache(k), out); } catch {} if (out.error) console.error(`[apiv1] Slant 3D quote failed: ${out.error}`); return out; })
      .finally(() => slantRunning.delete(k));
    slantRunning.set(k, p);
    return p;
  },
};

// ---------------------------------------------------------------- suppliers
const SUPPLIERS = [
  { id: 'rmfg', name: 'RMFG', kind: 'live', location: 'Fort Worth, TX, US', processes: ['sheet_metal', 'laser_cut', 'tube_laser'], materials: ['aluminium', 'steel', 'stainless'], needs: 'STEP', url: 'https://www.rmfg.com/', note: 'Laser cut and bent sheet, laser cut tube' },
  { id: 'materiam', name: 'MATERIAM', kind: 'live', location: 'Querétaro, MX (US duty included)', processes: ['sheet_metal', 'laser_cut', 'tube_laser'], materials: ['aluminium', 'steel', 'stainless'], needs: 'STEP', url: 'https://materiam.com/', note: 'Laser cut, bent and welded sheet, cut tube' },
  { id: 'afn', name: 'AFN network', kind: 'live', location: 'US, China, worldwide', processes: ['cnc'], materials: ['aluminium', 'steel', 'stainless'], needs: 'STEP', url: 'https://agenticfabricationnetwork.ai/', note: 'CNC offers from Justway, PCBWay, Craftcloud, Protolabs, RivCut and others' },
  { id: 'slant3d', name: 'Slant 3D', kind: 'live', location: 'US', processes: ['3d_print'], materials: ['plastic'], needs: 'STEP or STL', url: 'https://www.slant3d.com/', note: 'FDM printing in PETG' },
  { id: 'sendcutsend', name: 'SendCutSend', kind: 'estimate', location: 'Reno, NV, US', processes: ['laser_cut', 'sheet_metal'], materials: ['aluminium', 'steel', 'stainless', 'acrylic'], needs: 'STEP or STL', url: 'https://sendcutsend.com/', note: 'Estimate from its published prices; no public quote API' },
  { id: 'premake', name: 'Premake price model', kind: 'estimate', location: 'Local shop price (US)', processes: ['cnc', 'sheet_metal', 'laser_cut', 'tube_laser', '3d_print'], materials: ['aluminium', 'steel', 'stainless', 'plastic', 'acrylic'], needs: 'STEP or STL', url: 'https://premake.ai/', note: 'What a local shop would fairly charge; no shop has quoted it yet' },
  { id: 'amazon', name: 'Amazon', kind: 'link', location: 'US', processes: ['off_the_shelf'], materials: [], needs: 'a part name', url: 'https://www.amazon.com/', note: 'Off-the-shelf parts (screws, electronics). Bill-of-materials quoting comes next; not used for custom parts' },
];
const supplierOn = (id) => {
  const off = String(process.env.API_V1_SUPPLIERS_OFF || '').toLowerCase().split(',').map((s) => s.trim());
  if (off.includes(id)) return false;
  if (id === 'rmfg') return !!C.rmfg?.connected?.();
  if (id === 'materiam') return process.env.MATERIAM_ON === '1'; // off on the Mac: MATERIAM rate-limits this IP (server/prices/materiam.js)
  return true;
};

/** Quantities sent to the suppliers: the studio's set when it covers the request (cache hits), else the request itself. */
function supplierQtys(qtys) {
  if (qtys.every((q) => STD_QTYS.includes(q))) return STD_QTYS;
  return [...new Set([1, ...qtys])].sort((a, b) => a - b).slice(0, MAX_QTYS);
}

/** The background jobs for one quote line: [{supplier, opts}] by material and likely process. */
function tasksFor(part, mat, qtys) {
  const t = [], sq = supplierQtys(qtys);
  const sheetish = part.processes.some((p) => ['sheet_metal', 'laser_cut', 'tube_laser'].includes(p));
  if (part.step && isMetal(mat)) {
    if (sheetish && supplierOn('rmfg')) t.push({ supplier: 'rmfg', file: part.step, opts: { material: mat.rmfg, qtys: sq, name: part.name } });
    if (sheetish && supplierOn('materiam')) t.push({ supplier: 'materiam', file: part.step, opts: { material: mat.rmfg, qtys: sq } });
    if (supplierOn('afn')) t.push({ supplier: 'afn', file: part.step, opts: { process: 'cnc', material: mat.afn, finish: null, qtys: sq } });
  }
  if (mat.family === 'plastic' && part.mesh && part.processes.includes('3d_print') && supplierOn('slant3d')) t.push({ supplier: 'slant3d', file: part.mesh, opts: { qtys: sq } });
  return t;
}
const mod = (id) => ({ rmfg: C.rmfg, materiam: C.materiam, afn: C.afn, slant3d: slant }[id]);

// ---------------------------------------------------------------- offers
function offer(o) {
  const total = o.total_usd != null ? o.total_usd : o.unit_usd != null ? o.unit_usd * o.qty : null;
  return { part_id: o.part_id, qty: o.qty, supplier: o.supplier, via: o.via || null, process: o.process, material: o.material || null,
    unit_usd: cents(o.unit_usd), total_usd: cents(total), shipping_usd: cents(o.shipping_usd),
    ships_by: o.ships_by || null, arrives_by: o.arrives_by || null, arrival_is_estimate: o.arrival_is_estimate !== false,
    live: !!o.live, price_type: o.live ? 'live' : 'estimate', location: o.location || null, notes: (o.notes || []).filter(Boolean), supplier_url: o.supplier_url || null };
}
const leadDaysOf = (s) => { const m = String(s || '').match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*(business\s+)?days?/i); if (!m) return null; const n = Number(m[2] || m[1]); return m[3] ? Math.ceil(n * 7 / 5) : n; };

/** Offers from one finished supplier job, for the requested quantities. */
function offersFromTask(task, res, line, part) {
  const out = [], base = { part_id: part.id, material: line.material_label };
  if (task.supplier === 'rmfg') {
    const std = (res.lead?.production || []).find((p) => p.speed === 'standard') || (res.lead?.production || [])[0];
    const stock = (res.stock || []).map((s) => s.stock).join(', ');
    for (const q of line.qtys) {
      const row = (res.prices || []).find((p) => p.qty === q);
      if (!row || row.unit_usd == null) continue;
      out.push(offer({ ...base, qty: q, supplier: 'RMFG', process: (res.stock || [])[0]?.process === 'tube' ? 'tube_laser' : 'sheet_metal', live: true,
        unit_usd: row.unit_usd, total_usd: row.total_usd, ships_by: std?.estimated_ship_date || null,
        arrives_by: std?.estimated_ship_date ? addDays(std.estimated_ship_date, 4) : null, location: 'Fort Worth, TX, US', supplier_url: 'https://www.rmfg.com/quote/sheet',
        notes: [stock, 'shipping priced at checkout', std && q !== line.qtys[0] ? 'ship date is for the first quantity' : '', ...(res.findings || [])] }));
    }
  } else if (task.supplier === 'materiam') {
    for (const q of line.qtys) {
      const row = (res.prices || []).find((p) => p.qty === q);
      if (!row) continue;
      out.push(offer({ ...base, qty: q, supplier: 'MATERIAM', process: /tube/i.test(res.kind || '') ? 'tube_laser' : 'sheet_metal', live: true,
        unit_usd: row.unit_usd, total_usd: row.total_usd, ships_by: row.ships_by, arrives_by: row.ships_by ? addDays(row.ships_by, 5) : null,
        location: 'Querétaro, MX', supplier_url: 'https://materiam.com/', notes: [(res.stock || []).join(', '), 'US import duty included', ...(res.findings || [])] }));
    }
  } else if (task.supplier === 'afn') {
    for (const q of line.qtys) {
      const offers = (res.offers || []).filter((o) => o.qty === q).sort((a, b) => a.unit_usd - b.unit_usd);
      const seen = new Set();
      for (const o of offers) {
        if (seen.has(o.vendor) || seen.size >= 4) continue; // the cheapest offer per shop, top 4 shops
        seen.add(o.vendor);
        out.push(offer({ ...base, qty: q, supplier: o.vendor, via: 'AFN', process: 'cnc', live: !o.estimate, unit_usd: o.unit_usd, shipping_usd: o.ship_usd,
          arrives_by: o.eta || null, arrival_is_estimate: false, location: (o.ships_from || []).join('/') || null,
          supplier_url: res.quote_id ? `https://agenticfabricationnetwork.ai/quotes/${encodeURIComponent(res.quote_id)}` : 'https://agenticfabricationnetwork.ai/',
          notes: [`machined from ${task.opts.material}`, !o.finish || o.finish === 'standard' || o.finish === 'as_machined' ? 'unfinished (no anodize)' : o.finish, o.estimate ? 'the shop\'s own estimate, refreshed on order' : ''] }));
      }
    }
  } else if (task.supplier === 'slant3d') {
    for (const q of line.qtys) {
      const s = res.set?.[q];
      if (!s) continue;
      const lead = leadDaysOf(s.lead_time);
      const shipsBy = lead ? addDays(new Date(), lead) : null;
      out.push(offer({ ...base, qty: q, supplier: 'Slant 3D', process: '3d_print', material: `${res.material || 'PETG'}${res.color ? ' ' + res.color : ''}`, live: true,
        unit_usd: s.subtotal_usd != null ? s.subtotal_usd / q : s.unit_usd, total_usd: s.subtotal_usd, ships_by: shipsBy, arrives_by: shipsBy ? addDays(shipsBy, 4) : null,
        location: 'US', supplier_url: 'https://www.slant3d.com/', notes: [s.lead_time && `lead time ${s.lead_time}`, s.setup_usd ? `includes $${s.setup_usd} setup` : '', ...(res.issues || []).map((i) => i.title)] }));
    }
  }
  return out;
}

/** Instant estimates (no outside call): SendCutSend's published-price model for sheet parts, Premake's local-shop model. */
function estimates(line, part, mat) {
  const out = [], base = { part_id: part.id, material: line.material_label, live: false };
  const wall = part.wall_mm || 1.5;
  const flatish = part.processes.includes('laser_cut') || part.processes.includes('sheet_metal');
  if (flatish && (isMetal(mat) || mat.family === 'acrylic') && supplierOn('sendcutsend')) {
    const bent = part.processes.includes('sheet_metal');
    const f = C.fabModel.features({ material: mat.family, thickness_mm: wall, area_cm2: part.area_mm2 / 2 / 100, bends: bent ? 2 : 0 });
    const cal = C.fabModel.calibration();
    const p1 = C.fabModel.piece1(f).usd, lead = bent ? cal.lead_days?.bent || 10 : cal.lead_days?.cut || 8;
    for (const q of line.qtys) {
      const total = Math.max(cal.order_min_usd || 0, p1 * C.fabModel.discount(q) * q);
      out.push(offer({ ...base, qty: q, supplier: 'SendCutSend', process: bent ? 'sheet_metal' : 'laser_cut', unit_usd: total / q, total_usd: total,
        arrives_by: addDays(new Date(), lead), location: 'Reno, NV, US', supplier_url: 'https://sendcutsend.com/',
        notes: [`estimate from SendCutSend's published prices (${wall.toFixed(1)} mm${bent ? ', bends guessed' : ''})`, total === cal.order_min_usd ? `$${cal.order_min_usd} order minimum` : '', 'upload the file on sendcutsend.com for the real price'] }));
    }
  }
  if (supplierOn('premake')) {
    for (const q of line.qtys) {
      const e = C.estimatePart({ bbox_mm: part.bbox_mm, volume_mm3: part.volume_mm3, area_mm2: part.area_mm2, material: mat.model, qty: q });
      if (e.error) continue;
      out.push(offer({ ...base, qty: q, supplier: 'Local shop', via: 'Premake estimate', process: e.process === 'print' ? '3d_print' : e.process === 'tube' ? 'tube_laser' : e.process === 'sheet_bent' ? 'sheet_metal' : e.process === 'sheet' || e.process === 'laser' ? 'laser_cut' : e.process,
        unit_usd: e.each_usd, total_usd: e.total_usd, arrives_by: addDays(new Date(), e.lead_days + 2), location: 'US',
        notes: [`Premake price model ${e.model}: ${e.why}`, 'no shop has quoted this yet'] }));
    }
  }
  return out;
}

/** Status + offers for a stored quote, from the supplier caches. Restarts a job lost to a server restart. */
function evaluate(q) {
  const offers = [], pending = [], errors = [];
  const age = Date.now() - Date.parse(q.created_at);
  for (const line of q.lines) {
    const part = readJ(path.join(partDir(line.part_id), 'part.json'));
    if (!part) { errors.push({ part_id: line.part_id, supplier: null, message: 'part expired' }); continue; }
    const P = { ...part, id: line.part_id, step: part.step && path.join(partDir(line.part_id), part.step), mesh: part.mesh && path.join(partDir(line.part_id), part.mesh) };
    const mat = material(line.material);
    for (const t of line.tasks) {
      const M = mod(t.supplier), file = path.join(partDir(line.part_id), t.file);
      const name = SUPPLIERS.find((s) => s.id === t.supplier)?.name || t.supplier;
      const res = M.cached(file, t.opts);
      if (res && res.error) { errors.push({ part_id: line.part_id, supplier: name, message: res.error }); continue; }
      if (res) { offers.push(...offersFromTask(t, res, line, P)); continue; }
      if (age > TASK_DEADLINE_MS) { errors.push({ part_id: line.part_id, supplier: name, message: 'no answer in 15 minutes' }); continue; }
      if (!M.quoting(file, t.opts)) M.ensure(file, t.opts); // lost to a restart: ask again (the module dedupes)
      pending.push({ part_id: line.part_id, supplier: name });
    }
    offers.push(...estimates(line, P, mat));
  }
  return { offers, pending, errors, status: pending.length ? 'pending' : 'complete' };
}

/** Per part and quantity: the cheapest (price incl. known shipping) and the fastest (earliest arrival). */
function rank(offers) {
  const best = {};
  const cost = (o) => (o.total_usd ?? Infinity) + (o.shipping_usd || 0);
  for (const o of offers) {
    const k = `${o.part_id}:${o.qty}`;
    const b = best[k] || (best[k] = { part_id: o.part_id, qty: o.qty, cheapest: null, fastest: null, cheapest_live: null });
    if (!b.cheapest || cost(o) < cost(b.cheapest)) b.cheapest = o;
    if (o.live && (!b.cheapest_live || cost(o) < cost(b.cheapest_live))) b.cheapest_live = o;
    if (o.arrives_by && (!b.fastest || o.arrives_by < b.fastest.arrives_by || (o.arrives_by === b.fastest.arrives_by && cost(o) < cost(b.fastest)))) b.fastest = o;
  }
  return Object.values(best);
}

function quoteBody(q, base) {
  const ev = evaluate(q);
  const ord = (o) => [o.part_id, o.qty, o.live ? 0 : 1, (o.total_usd ?? 1e12) + (o.shipping_usd || 0)];
  ev.offers.sort((a, b) => { const x = ord(a), y = ord(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; });
  const url = `${base}/q/${q.id}`;
  for (const o of ev.offers) o.order_url = url;
  if (ev.status === 'complete' && !q.logged) { // the price model's training data: every finished quote, once
    q.logged = true; writeJ(quoteFile(q.id), q);
    try { fs.appendFileSync(path.join(root(), 'log.jsonl'), JSON.stringify({ t: Date.now(), quote_id: q.id, lines: q.lines.map((l) => ({ part_id: l.part_id, material: l.material, qtys: l.qtys })), offers: ev.offers.map(({ notes, order_url, supplier_url, ...o }) => o) }) + '\n', { mode: 0o600 }); } catch {}
  }
  return {
    quote_id: q.id, status: ev.status, created_at: q.created_at, expires_at: new Date(Date.parse(q.created_at) + KEEP_MS).toISOString(),
    url, order_url: url, ship_to_zip: q.ship_to_zip || null,
    parts: q.lines.map((l) => ({ part_id: l.part_id, name: l.name, material: l.material_label, qtys: l.qtys })),
    offers: ev.offers, best: rank(ev.offers), pending: ev.pending, errors: ev.errors,
    notice: 'Premake never places orders or takes payment through this API. "estimate" prices are our models, not a shop\'s quote. Open the url to compare and order.',
  };
}

// ---------------------------------------------------------------- request helpers
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (len > limit) { reject(Object.assign(new Error(`File too large (limit ${Math.round(limit / 1048576)} MB)`), { code: 413 })); return; }
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error(`File too large (limit ${Math.round(limit / 1048576)} MB)`), { code: 413 })); req.pause(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function formatOf(buf) {
  const head = buf.subarray(0, 400).toString('latin1');
  if (/ISO-10303-21/.test(head)) return 'step';
  if (buf.length >= 84 && buf.length === 84 + buf.readUInt32LE(80) * 50 && buf.readUInt32LE(80) > 0) return 'stl';
  if (/^\s*solid\b/.test(head) && /facet\s+normal/.test(buf.subarray(0, 4000).toString('latin1'))) return 'stl';
  return null;
}
const safeName = (s) => String(s || 'part').split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'part';
function parseQtys(v) {
  const list = (Array.isArray(v) ? v : String(v ?? '1').split(',')).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 1 && x <= MAX_QTY);
  return [...new Set(list)].sort((a, b) => a - b).slice(0, MAX_QTYS);
}

async function createPart(req, res, ip) {
  if (!C.allow('v1-part:' + ip, num('API_V1_PARTS_PER_DAY', 60), 864e5)) return C.send(res, 429, { error: 'Upload limit reached for today. Try again tomorrow.' });
  let buf, filename;
  const ct = String(req.headers['content-type'] || '');
  if (/application\/json/.test(ct)) {
    const raw = await readRaw(req, Math.ceil(MAX_FILE * 1.37) + 4096);
    let j; try { j = JSON.parse(raw.toString('utf8')); } catch { return C.send(res, 400, { error: 'invalid JSON' }); }
    if (typeof j.content_base64 !== 'string') return C.send(res, 400, { error: 'Send the file as the raw body, or JSON {filename, content_base64}' });
    buf = Buffer.from(j.content_base64, 'base64'); filename = j.filename;
    if (buf.length > MAX_FILE) return C.send(res, 413, { error: 'File too large (limit 50 MB)' });
  } else {
    buf = await readRaw(req, MAX_FILE);
    filename = req.headers['x-filename'] || new URL(req.url, 'http://x').searchParams.get('filename');
  }
  if (!buf.length) return C.send(res, 400, { error: 'Empty file' });
  const format = formatOf(buf);
  if (!format) return C.send(res, 415, { error: 'Send a STEP (.step, .stp) or STL file. DXF support is coming.' });
  const id = 'prt_' + crypto.randomBytes(10).toString('hex');
  const dir = partDir(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = safeName(filename).replace(/\.(step|stp|stl)$/i, '');
  const file = format === 'step' ? 'part.step' : 'part.stl';
  fs.writeFileSync(path.join(dir, file), buf, { mode: 0o600 });
  let facts;
  if (format === 'step') {
    const r = await C.analyzeStep(dir, file, 'mesh.stl');
    if (r.error) { fs.rmSync(dir, { recursive: true, force: true }); return C.send(res, 422, { error: `Could not read this STEP file: ${r.error}` }); }
    facts = r;
  } else {
    facts = stlInfo(buf);
    if (facts.error) { fs.rmSync(dir, { recursive: true, force: true }); return C.send(res, 422, { error: facts.error }); }
  }
  const pr = processesOf(facts, format);
  const part = { id, name, filename: safeName(filename), format, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    created_at: new Date().toISOString(), ip_hash: crypto.createHash('sha256').update('apiv1|' + ip).digest('hex').slice(0, 16),
    step: format === 'step' ? file : null, mesh: format === 'stl' ? file : facts.mesh ? 'mesh.stl' : null,
    bbox_mm: facts.bbox_mm, volume_mm3: facts.volume_mm3, area_mm2: facts.area_mm2, solids: facts.solids ?? null, faces: facts.faces || null,
    wall_mm: pr.wall_mm, processes: pr.processes, warnings: pr.warnings };
  writeJ(path.join(dir, 'part.json'), part);
  return C.send(res, 201, { part_id: id, filename: part.filename, format, bytes: part.bytes, bbox_mm: part.bbox_mm, volume_mm3: part.volume_mm3,
    area_mm2: part.area_mm2, average_wall_mm: part.wall_mm, processes: part.processes, warnings: part.warnings,
    expires_at: new Date(Date.now() + KEEP_MS).toISOString() });
}

async function createQuote(req, res, ip, base) {
  const raw = await readRaw(req, 64e3);
  let body; try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { return C.send(res, 400, { error: 'invalid JSON' }); }
  const items = Array.isArray(body.parts) ? body.parts : [];
  if (!items.length) return C.send(res, 400, { error: 'parts: [{part_id, qty, material}] is required' });
  if (items.length > MAX_PARTS) return C.send(res, 400, { error: `At most ${MAX_PARTS} parts per quote` });
  const lines = [];
  for (const it of items) {
    const pid = String(it?.part_id || '');
    const part = PART_RE.test(pid) ? readJ(path.join(partDir(pid), 'part.json')) : null;
    if (!part) return C.send(res, 404, { error: `Unknown part_id ${pid.slice(0, 40)}. Upload it with POST /api/v1/parts first.` });
    const qtys = parseQtys(it.qty);
    if (!qtys.length) return C.send(res, 400, { error: `qty must be a whole number from 1 to ${MAX_QTY}, or a list of them` });
    const mat = material(it.material);
    const P = { ...part, step: part.step && path.join(partDir(pid), part.step), mesh: part.mesh && path.join(partDir(pid), part.mesh) };
    const tasks = tasksFor(P, mat, qtys).map((t) => ({ supplier: t.supplier, file: path.basename(t.file), opts: t.opts }));
    lines.push({ part_id: pid, name: part.name, material: String(it.material || mat.family).slice(0, 40), material_label: mat.label, qtys, tasks });
  }
  // rate limits only once the request is valid: per IP, and a daily cap across everyone (live quotes cost suppliers work)
  if (!C.allow('v1-quote:' + ip, num('API_V1_QUOTES_PER_DAY', 20), 864e5)) return C.send(res, 429, { error: 'Free quote limit reached for today (20 a day). Try again tomorrow.' });
  if (!C.allow('v1-quote-all', num('API_V1_QUOTES_ALL_PER_DAY', 500), 864e5)) return C.send(res, 503, { error: 'The quote service is busy today. Try again later.' });
  const zip = String(body.ship_to_zip || '').trim();
  const q = { id: 'qt_' + crypto.randomBytes(10).toString('hex'), created_at: new Date().toISOString(), ship_to_zip: /^[A-Za-z0-9 -]{3,10}$/.test(zip) ? zip : null,
    ip_hash: crypto.createHash('sha256').update('apiv1|' + ip).digest('hex').slice(0, 16), lines };
  writeJ(quoteFile(q.id), q);
  for (const l of lines) for (const t of l.tasks) mod(t.supplier).ensure(path.join(partDir(l.part_id), t.file), t.opts);
  const url = `${base}/q/${q.id}`;
  return C.send(res, 202, { quote_id: q.id, status: 'pending', url, order_url: url, poll: `${base}/api/v1/quotes/${q.id}`,
    suppliers_asked: [...new Set(lines.flatMap((l) => l.tasks.map((t) => SUPPLIERS.find((s) => s.id === t.supplier).name)))] });
}

// ---------------------------------------------------------------- the comparison page
const money = (n) => (n == null ? '–' : `$${Number(n).toFixed(2)}`);
const nice = (d) => { if (!d) return '–'; const x = new Date(d + 'T12:00:00Z'); return x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const PROC = { cnc: 'CNC machined', sheet_metal: 'Sheet metal', laser_cut: 'Laser cut', tube_laser: 'Laser cut tube', '3d_print': '3D printed' };
function page(res, code, title, body, refresh) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="6">' : ''}
<meta name="robots" content="noindex"><title>${esc(title)} · Premake</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f5f2;--panel:#fff;--panel-2:#f6f5f2;--line:#e5e3dd;--text:#1b1a17;--text-2:#4a4945;--muted:#75736d;--accent:#e8590c;--warn:#9a6400;--link:#c2410c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:0 16px 48px}.top{display:flex;align-items:center;height:56px}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:16px;color:inherit;text-decoration:none}.mark{width:18px;height:18px;border-radius:5px;background:var(--accent)}
h1{font-size:26px;font-weight:650;margin:18px 0 4px}h2{font-size:18px;font-weight:600;margin:0 0 2px}.sub{color:var(--muted);margin:0 0 22px}
.part{background:var(--panel);border-radius:14px;padding:18px 18px 8px;margin:0 0 16px;box-shadow:0 1px 2px rgba(28,25,23,.06)}
.meta{color:var(--muted);font-size:13.5px;margin:0 0 12px}.picks{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.pick{flex:1 1 260px;background:var(--panel-2);border-radius:10px;padding:10px 12px;font-size:14px}.pick b{font-weight:600}
.scroll{overflow-x:auto;margin:0 -4px}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-weight:600;color:var(--text-2);padding:8px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.est{color:var(--warn);font-size:13px}.live{color:#2b7a3d;font-size:13px}.note{color:var(--muted);font-size:12.5px;margin-top:2px}a{color:var(--link)}
.qty{font-weight:600;margin:14px 0 4px}.msg{background:var(--panel);border-radius:12px;padding:14px 16px;margin:0 0 16px;color:var(--text-2);font-size:14px}
.warn{color:var(--warn)}td.k{white-space:nowrap}footer{color:var(--muted);font-size:13px;margin-top:24px}
</style></head><body><div class="wrap"><div class="top"><a class="brand" href="/"><span class="mark"></span>Premake</a></div>${body}</div></body></html>`);
}
function renderQuote(res, body) {
  const pending = body.status === 'pending';
  const parts = body.parts.map((p) => {
    const offers = body.offers.filter((o) => o.part_id === p.part_id);
    const facts = readJ(path.join(partDir(p.part_id), 'part.json'), {}) || {};
    const groups = p.qtys.map((q) => {
      const os = offers.filter((o) => o.qty === q);
      const b = body.best.find((x) => x.part_id === p.part_id && x.qty === q);
      const picks = b ? `<div class="picks">${b.cheapest ? `<div class="pick">Cheapest: <b>${esc(b.cheapest.supplier)}</b>, ${money(b.cheapest.total_usd)}${b.cheapest.shipping_usd ? ` + ${money(b.cheapest.shipping_usd)} shipping` : ''}${b.cheapest.live ? '' : ' (estimate)'}</div>` : ''}${b.fastest ? `<div class="pick">Fastest: <b>${esc(b.fastest.supplier)}</b>, arrives ${b.fastest.arrival_is_estimate ? 'about ' : ''}${nice(b.fastest.arrives_by)}${b.fastest.live ? '' : ' (estimate)'}</div>` : ''}</div>` : '';
      const rows = os.map((o) => `<tr><td>${o.supplier_url ? `<a href="${esc(o.supplier_url)}" rel="noopener noreferrer" target="_blank">${esc(o.supplier)}</a>` : esc(o.supplier)}${o.via ? ` <span class="note">via ${esc(o.via)}</span>` : ''}<div class="note">${esc([PROC[o.process] || o.process, o.location].filter(Boolean).join(' · '))}</div>${o.notes.length ? `<div class="note">${esc(o.notes.join(' · '))}</div>` : ''}</td>
<td class="n">${money(o.unit_usd)}</td><td class="n">${money(o.total_usd)}${o.shipping_usd ? `<div class="note">+ ${money(o.shipping_usd)} ship</div>` : ''}</td><td class="n">${nice(o.arrives_by)}${o.arrival_is_estimate && o.arrives_by ? '<div class="note">approx.</div>' : ''}</td><td class="k">${o.live ? '<span class="live">Live quote</span>' : '<span class="est">Estimate</span>'}</td></tr>`).join('');
      return `<div class="qty">${q} piece${q === 1 ? '' : 's'}</div>${picks}<div class="scroll"><table><thead><tr><th>Supplier</th><th style="text-align:right">Each</th><th style="text-align:right">Total</th><th style="text-align:right">Arrives</th><th>Price</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="note">No offers yet</td></tr>'}</tbody></table></div>`;
    }).join('');
    const size = (facts.bbox_mm || []).map((x) => Math.round(x * 10) / 10).join(' × ');
    return `<section class="part" id="${esc(p.part_id)}"><h2>${esc(p.name)}</h2><p class="meta">${esc(p.material)}${size ? ` · ${esc(size)} mm` : ''}${facts.format ? ` · ${esc(facts.format.toUpperCase())}` : ''}</p>
${(facts.warnings || []).map((w) => `<p class="meta warn">${esc(w)}</p>`).join('')}${groups}</section>`;
  }).join('');
  const waiting = pending ? `<div class="msg">Still asking ${esc([...new Set(body.pending.map((x) => x.supplier))].join(', '))}. This page refreshes itself.</div>` : '';
  const errs = body.errors.length ? `<div class="msg">No price from ${esc(body.errors.map((e) => `${e.supplier || 'a supplier'} (${e.message})`).join('; '))}.</div>` : '';
  return page(res, 200, 'Quote', `<h1>Where to get it made</h1><p class="sub">Live quotes and estimates from ${new Set(body.offers.map((o) => o.supplier)).size} suppliers${body.ship_to_zip ? `, shipping to ${esc(body.ship_to_zip)}` : ''}. Prices in USD.</p>
${waiting}${parts}${errs}<footer>Premake never orders or charges anything from this page. To order, open a supplier's link and upload your file there. Estimates are our price models, not a shop's quote. This quote and its files are deleted on ${esc(day(body.expires_at))}.</footer>`, pending);
}

// ---------------------------------------------------------------- routing
async function handle(req, res, { parts, m, url }) {
  const ip = C.clientIp(req), base = C.BASE(req);
  if (parts[0] === 'q' && !(parts.length === 2 && QUOTE_RE.test(parts[1]))) return false; // not ours: existing routing carries on
  if (parts[0] === 'q' && (m === 'GET' || m === 'HEAD')) {
    if (!C.allow('v1-read:' + ip, 600, 3600e3)) return page(res, 429, 'Slow down', '<h1>Too many requests</h1><p class="sub">Try again in a few minutes.</p>');
    const q = readJ(quoteFile(parts[1]));
    if (!q) return page(res, 404, 'Quote not found', '<h1>Quote not found</h1><p class="sub">Quotes are deleted after 30 days.</p>');
    return renderQuote(res, quoteBody(q, base));
  }
  if (parts[0] !== 'api' || parts[1] !== 'v1') return false;
  const P = parts.slice(2);
  if (P[0] === 'suppliers' && P.length === 1 && m === 'GET') {
    return C.send(res, 200, { suppliers: SUPPLIERS.map((s) => ({ ...s, available: supplierOn(s.id) })),
      notes: 'live = the shop\'s own price for your file; estimate = our model of its price; link = we point you there.' });
  }
  try {
    if (P[0] === 'parts' && P.length === 1 && m === 'POST') return await createPart(req, res, ip);
    if (P[0] === 'quotes' && P.length === 1 && m === 'POST') return await createQuote(req, res, ip, base);
  } catch (e) {
    if (e.code !== 413 || res.headersSent) throw e;
    res.setHeader('Connection', 'close'); // don't read the rest of an oversized upload
    return C.send(res, 413, { error: e.message });
  }
  if (P[0] === 'quotes' && P.length === 2 && m === 'GET') {
    if (!C.allow('v1-read:' + ip, 600, 3600e3)) return C.send(res, 429, { error: 'Too many requests. Poll every few seconds at most.' });
    const q = QUOTE_RE.test(P[1]) ? readJ(quoteFile(P[1])) : null;
    if (!q) return C.send(res, 404, { error: 'quote not found (quotes are deleted after 30 days)' });
    return C.send(res, 200, quoteBody(q, base));
  }
  if (P[0] === 'parts' && P.length === 2 && m === 'GET') {
    const part = PART_RE.test(P[1]) ? readJ(path.join(partDir(P[1]), 'part.json')) : null;
    if (!part) return C.send(res, 404, { error: 'part not found' });
    const { ip_hash, sha256, step, mesh, ...pub } = part;
    return C.send(res, 200, { part_id: part.id, ...pub });
  }
  return C.send(res, 404, { error: 'Not found. See GET /api/v1/suppliers, POST /api/v1/parts, POST /api/v1/quotes, GET /api/v1/quotes/:id' });
}

/** Delete uploads and quotes older than 30 days. */
function sweep(now = Date.now()) {
  let n = 0;
  for (const kind of ['parts', 'quotes']) {
    const d = path.join(root(), kind);
    let names = []; try { names = fs.readdirSync(d); } catch { continue; }
    for (const name of names) {
      const f = path.join(d, name);
      try { if (now - fs.statSync(f).birthtimeMs > KEEP_MS && now - fs.statSync(f).mtimeMs > KEEP_MS) { fs.rmSync(f, { recursive: true, force: true }); n++; } } catch {}
    }
  }
  return n;
}

/** ctx from server.js: { DATA, send, allow, clientIp, viaGateway, renderSpawn, runProc, estimatePart }. Supplier modules
 * and the STEP reader are wired here, so server.js needs one line. Tests may pass any of these directly. */
function init(ctx) {
  C = { ...ctx };
  const lazy = (k, f) => { if (C[k] === undefined) { try { C[k] = f(); } catch (e) { console.error(`[apiv1] ${k}: ${e.message}`); } } };
  lazy('rmfg', () => require('./prices/rmfg').init(C.DATA));
  lazy('afn', () => require('./prices/afn').init(C.DATA));
  lazy('materiam', () => require('./prices/materiam').init(C.DATA));
  lazy('slantQuote', () => require('./sourcing').slantQuote);
  lazy('readStl', () => require('./sourcing').readStl);
  lazy('fabModel', () => require('./prices/fab_model'));
  lazy('estimatePart', () => require('./fusion').estimatePart);
  if (!C.BASE) C.BASE = (req) => (C.viaGateway?.(req) ? (process.env.FORMA_PUBLIC_URL || 'https://premake.ai') : `http://${req.headers.host}`);
  if (!C.analyzeStep && C.renderSpawn && C.runProc) {
    // STEP files are read by cadlib/partinfo.py inside the server's sandbox (no network, writes only the part's folder)
    C.analyzeStep = async (dir, file, mesh) => {
      const [cmd, args, opts] = C.renderSpawn('cadlib.partinfo', [path.join(dir, file), path.join(dir, mesh)], { dir });
      const r = await C.runProc(cmd, args, opts, 120e3);
      let j = null; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
      if (r.timedOut) return { error: 'took too long to read' };
      if (!j) return { error: (r.stderr.trim().split('\n').pop() || `exit ${r.code}`).slice(0, 200) };
      return j;
    };
  }
  sweep();
  setInterval(sweep, 6 * 3600e3).unref();
  return module.exports;
}
module.exports = { init, handle, sweep, material, processesOf, stlInfo, formatOf, parseQtys, supplierQtys, rank, SUPPLIERS };
