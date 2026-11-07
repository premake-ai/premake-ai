'use strict';
// makefiles: the studio's Make tab (web/launch.js renderLaunch). Downloads for one design, owner or admin only for a
// project, anyone for an example. Nothing is generated here: it zips the files the build already wrote.
//
//   GET /api/make/<id>                    -> { title, parts: [{ name, process, bbox, stl, step, dxf }], bought: [...], print: {...} }
//   GET /api/make/<id>/all.zip            every made part (printed + fabricated) as STL, plus STEP where the build wrote
//                                         one, bom.json and shopping-list.csv
//   GET /api/make/<id>/print.zip          the printed parts as STL (a 3MF instead when the project has one)
//   GET /api/make/<id>/shopping-list.csv  bought parts: qty, unit price, line total, supplier, link
//   GET /api/make/<id>/part/<file>        one part file: <name>.stl or <name>.step, or <name>.dxf for a flat cut part
//                                         (laser, or sheet without bends: its outline from the STL, server/sourcing.js plateDxf)
//                                         (the 3D viewer's part menu, web/partmenu.js, offers these per part)
//   GET /api/make/<id>/bambu.3mf          the printed parts laid flat on 256 mm plates (cadlib/bambu3mf.py), for Bambu Studio
//   POST /api/make/<id>/open-bambu        local installs: the same file, opened in Bambu Studio on this computer
const fs = require('node:fs');
const path = require('node:path');
const { makeZip } = require('./guide');

let C = {}; // init(): { projDir, exDir, canEdit, send, allow, clientIp, readJSON, bambu3mf, openBambu }
const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i;
const FILE_RE = /^[\w.-]{1,120}\.(stl|step|dxf|3mf)$/i;

function fileBuf(dir, rel) {
  let root, real;
  try { root = fs.realpathSync(dir); real = fs.realpathSync(path.join(dir, rel)); } catch { return null; }
  if (!real.startsWith(root + path.sep)) return null;
  try { const st = fs.statSync(real); return st.isFile() && st.size < 200e6 ? { data: fs.readFileSync(real), mtime: st.mtime } : null; } catch { return null; }
}
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const slugOf = (title, id) => (String(title || '').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 48)) || id;

/** A flat part's DXF outline (server/sourcing.js plateDxf), or null when the STL is not one flat plate (pockets, bends).
 *  Cached by file and mtime: the listing checks every laser / sheet part. */
const dxfCache = new Map();
function dxfOf(dir, rel) {
  const f = path.join(dir, rel);
  let st; try { st = fs.statSync(f); } catch { return null; }
  const k = f + ':' + st.mtimeMs, hit = dxfCache.get(k);
  if (hit !== undefined) return hit;
  const b = fileBuf(dir, rel);
  let d = null; try { d = b ? require('./sourcing').plateDxf(b.data) : null; } catch { d = null; }
  if (dxfCache.size > 200) dxfCache.clear();
  dxfCache.set(k, d?.dxf || null);
  return d?.dxf || null;
}

/** The made parts (printed, then fabricated), each with its STL and, when the build wrote one, its STEP. */
function madeParts(dir, bom) {
  const out = [], seen = new Set();
  const add = (p, process) => {
    const rel = String(p.file || '');
    if (!/^stl\/[\w.-]+\.stl$/i.test(rel) || seen.has(rel)) return;
    seen.add(rel);
    const base = path.basename(rel, path.extname(rel));
    const step = exists(path.join(dir, 'step', base + '.step')) ? `step/${base}.step` : null;
    const flat = process === 'laser' || (process === 'sheet' && !(Number(p.params?.bends) > 0)); // same rule as the Order tab's DXF
    const stl = exists(path.join(dir, rel)) ? rel : null;
    out.push({ name: p.name || base, process, bbox: Array.isArray(p.bbox) ? p.bbox : null, stl, step, dxf: !!(flat && stl && dxfOf(dir, stl)), base });
  };
  for (const p of bom.printed || []) add(p, 'print');
  for (const f of bom.fabricated || []) add(f, f.process || 'fab');
  return out.filter((p) => p.stl || p.step);
}
const boughtParts = (bom) => (bom.parts || []).filter((p) => !p.fabricated).map((p) => ({
  name: p.name, qty: p.qty_per_unit ?? 1, unit_usd: p.unit_cost_usd ?? null, supplier: p.supplier || '', url: /^https?:\/\//.test(p.url || '') ? p.url : '', notes: p.notes || '' }));
const shoppingCsv = (bom) => csv([['Part', 'Qty', 'Unit cost $', 'Line total $', 'Supplier', 'Link', 'Notes'],
  ...boughtParts(bom).map((p) => [p.name, p.qty, p.unit_usd ?? '', p.unit_usd == null ? '' : Math.round(p.qty * p.unit_usd * 100) / 100, p.supplier, p.url, p.notes])]);
/** A 3MF the build (or a later step) wrote for printing: print.3mf or the first *.3mf at the project root. */
function find3mf(dir) {
  try { const f = fs.readdirSync(dir).find((n) => /^[\w.-]+\.3mf$/i.test(n)); return f || null; } catch { return null; }
}

function sendDownload(res, name, type, buf) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
}

function source(acc, id) {
  if (!ID_RE.test(id || '')) return null;
  const pd = C.projDir(id);
  if (pd && exists(path.join(pd, 'meta.json'))) return C.canEdit(acc, id) ? { dir: pd, id } : null;
  const ed = C.exDir(id);
  return ed && exists(path.join(ed, 'meta.json')) ? { dir: ed, id } : null;
}

/** Returns false when the path is not ours. */
async function handle(req, res, { parts, m, acc }) {
  if (parts[0] !== 'api' || parts[1] !== 'make') return false;
  const openReq = m === 'POST' && parts[3] === 'open-bambu' && parts.length === 4;
  if (m !== 'GET' && m !== 'HEAD' && !openReq) { C.send(res, 405, { error: 'GET only' }); return true; }
  const src = source(acc, parts[2]);
  if (!src) { C.send(res, 404, { error: 'not found' }); return true; }
  const bom = C.readJSON(path.join(src.dir, 'bom.json'), {}) || {};
  const meta = C.readJSON(path.join(src.dir, 'meta.json'), {}) || {};
  const P = slugOf(meta.title, src.id);
  const made = madeParts(src.dir, bom);
  const f = parts[3];
  if (!f && parts.length === 3) {
    const printed = made.filter((p) => p.process === 'print');
    C.send(res, 200, { id: src.id, title: meta.title || src.id, has_model: exists(path.join(src.dir, 'manifest.json')),
      parts: made.map(({ name, process, bbox, stl, step, dxf }) => ({ name, process, bbox, stl: !!stl, step: !!step, dxf, file: path.basename(stl || step, path.extname(stl || step)) })),
      bought: boughtParts(bom), print: { count: printed.length, threemf: find3mf(src.dir) } });
    return true;
  }
  if (!C.allow('make-dl:' + (acc.user || C.clientIp(req)), 300, 3600e3)) { C.send(res, 429, { error: 'Too many downloads. Try again later.' }); return true; }
  if (f === 'all.zip' && parts.length === 4) {
    const files = [];
    const add = (name, rel) => { const b = fileBuf(src.dir, rel); if (b) files.push({ name, ...b }); };
    for (const p of made) { if (p.stl) add(`${P}/stl/${p.base}.stl`, p.stl); if (p.step) add(`${P}/step/${p.base}.step`, p.step); }
    if (!files.length) { C.send(res, 404, { error: 'Build the model first' }); return true; }
    add(`${P}/bom.json`, 'bom.json');
    if (boughtParts(bom).length) files.push({ name: `${P}/shopping-list.csv`, data: Buffer.from(shoppingCsv(bom)) });
    sendDownload(res, `${P}-parts.zip`, 'application/zip', makeZip(files)); return true;
  }
  if (f === 'print.zip' && parts.length === 4) {
    const t = find3mf(src.dir);
    if (t) { const b = fileBuf(src.dir, t); if (b) { sendDownload(res, `${P}.3mf`, 'model/3mf', b.data); return true; } }
    const files = [];
    for (const p of made) if (p.process === 'print' && p.stl) { const b = fileBuf(src.dir, p.stl); if (b) files.push({ name: `${P}/${p.base}.stl`, ...b }); }
    if (!files.length) { C.send(res, 404, { error: 'No printed parts' }); return true; }
    sendDownload(res, `${P}-print.zip`, 'application/zip', makeZip(files)); return true;
  }
  if ((f === 'bambu.3mf' || openReq) && parts.length === 4) { // Bambu Studio: printed parts laid flat on plates
    if (!made.some((p) => p.process === 'print' && p.stl)) { C.send(res, 404, { error: 'No printed parts' }); return true; }
    let r; try { r = await C.bambu3mf(src.dir, src.id, meta.title || P); } catch (e) { C.send(res, 500, { error: e.message }); return true; }
    if (!openReq) { const b = fileBuf(path.dirname(r.file), path.basename(r.file)); if (!b) { C.send(res, 500, { error: 'Could not make the file' }); return true; } sendDownload(res, `${P}.3mf`, 'model/3mf', b.data); return true; }
    const opened = await C.openBambu(r.file);
    C.send(res, 200, { ...r.summary, opened: opened === true, why: opened === true ? null : opened, file: undefined }); return true;
  }
  if (f === 'shopping-list.csv' && parts.length === 4) {
    if (!boughtParts(bom).length) { C.send(res, 404, { error: 'Nothing to buy' }); return true; }
    sendDownload(res, `${P}-shopping-list.csv`, 'text/csv; charset=utf-8', Buffer.from(shoppingCsv(bom))); return true;
  }
  if (f === 'part' && parts.length === 5 && FILE_RE.test(parts[4] || '')) {
    const ext = path.extname(parts[4]).toLowerCase(), base = path.basename(parts[4], ext);
    const p = made.find((x) => x.base === base);
    if (ext === '.dxf') { // flat cut part: its outline, made from the STL now
      const d = p?.dxf && dxfOf(src.dir, p.stl);
      if (!d) { C.send(res, 404, { error: 'not found' }); return true; }
      sendDownload(res, `${P}-${base}.dxf`, 'application/dxf', Buffer.from(d)); return true;
    }
    const rel = p && (ext === '.stl' ? p.stl : ext === '.step' ? p.step : null);
    const b = rel && fileBuf(src.dir, rel);
    if (!b) { C.send(res, 404, { error: 'not found' }); return true; }
    sendDownload(res, `${P}-${base}${ext}`, ext === '.stl' ? 'model/stl' : 'model/step', b.data); return true;
  }
  C.send(res, 404, { error: 'not found' }); return true;
}

function init(ctx) { C = ctx; return { handle }; }
module.exports = { init, madeParts, shoppingCsv, slugOf };
