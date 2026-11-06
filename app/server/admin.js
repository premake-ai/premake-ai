// Admin panel (/admin) and its API (/api/admin/*). Admins only: everyone else gets the same 404 as any unknown path,
// so the panel's existence never shows. Admin = the gateway's X-Forma-User in FORMA_ADMIN_EMAILS, or this Mac's localhost.
// Also: live support (SSE + polling fallback), user/admin presence, first/last seen per email, rate-limit hit counts.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

let D = null; // deps from server.js (init)
const STARTED = Date.now();
const BOOT = Date.now().toString(36);
const ADMIN_FILES = { 'admin.html': 1, 'admin.js': 1, 'admin.css': 1, 'fulfil.js': 1, 'fulfil.css': 1, 'inbox.js': 1, 'inbox.css': 1 }; // web/ files only admins may load
const ADMIN_ONLINE_MS = 2 * 60e3;
const USER_ONLINE_MS = 45e3;

// ---------------------------------------------------------------- presence
const presence = new Map(); // project id -> { t, user, streams }
let adminSeen = 0;
let adminStreams = 0;
const adminOnline = () => adminStreams > 0 || Date.now() - adminSeen < ADMIN_ONLINE_MS;
function userOnline(id) { const p = presence.get(id); return !!p && (p.streams > 0 || Date.now() - p.t < USER_ONLINE_MS); }

// ---------------------------------------------------------------- users: first_seen / last_seen / active days per email
let USERS_FILE = '';
let users = null; // { email: { first_seen, last_seen, days: ['YYYY-MM-DD', ...] } }
let usersDirty = false;
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function loadUsers() { if (!users) users = D.readJSON(USERS_FILE, {}) || {}; return users; }
function saveUsersSoon() {
  if (usersDirty) return;
  usersDirty = true;
  setTimeout(() => { usersDirty = false; try { D.writeJSON(USERS_FILE, users); } catch {} }, 5000).unref();
}
function touchUser(email) {
  const u = loadUsers();
  const t = Date.now();
  let r = u[email];
  if (!r) { r = u[email] = { first_seen: t, last_seen: t, days: [] }; saveUsersSoon(); }
  const day = dayKey(t);
  if (t - r.last_seen > 60e3 || !r.days.includes(day)) {
    r.last_seen = t;
    if (!r.days.includes(day)) { r.days.push(day); if (r.days.length > 90) r.days.splice(0, r.days.length - 90); }
    saveUsersSoon();
  }
}

/** Every request: presence, first/last seen. Cheap, synchronous. */
function touch(acc, req, parts) {
  if (!acc?.authed || !acc.user) return;
  touchUser(acc.user);
  const admin = D.isAdmin(acc);
  if (admin && (parts[0] === 'admin' || (parts[0] === 'api' && parts[1] === 'admin'))) adminSeen = Date.now();
  if (!admin && parts[0] === 'api' && parts[1] === 'projects' && parts[2] && ['run', 'events', 'warm', 'support'].includes(parts[3])) {
    const id = parts[2];
    const p = presence.get(id) || { t: 0, user: acc.user, streams: 0 };
    p.t = Date.now(); p.user = acc.user;
    presence.set(id, p);
    if (parts[3] === 'events' && req.method === 'GET') {
      p.streams++;
      let done = false;
      req.on('close', () => { if (done) return; done = true; p.streams = Math.max(0, p.streams - 1); p.t = Date.now(); });
    }
  }
}

// ---------------------------------------------------------------- rate-limit hits (allow() refusals)
const rateHits = []; // { t, key }
function rateHit(key) {
  rateHits.push({ t: Date.now(), key: String(key).split(':')[0] });
  if (rateHits.length > 5000) rateHits.splice(0, rateHits.length - 5000);
}

// ---------------------------------------------------------------- live support events (SSE + polling log)
const sseClients = new Set();
let SEQ = 0;
const LOG_MAX = 300;
const log = []; // { seq, type, id, from, t }
function push(ev) {
  ev.seq = ++SEQ;
  log.push(ev);
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) res.write(line);
}
/** Hook from addSupportMessage (server.js). */
function onSupport(id, msg) { push({ type: 'support', id, from: msg.from, t: msg.t }); }

// ---------------------------------------------------------------- data helpers
const projectIds = () => { try { return fs.readdirSync(D.PROJECTS).filter((id) => D.projDir(id) && D.exists(path.join(D.projDir(id), 'meta.json'))); } catch { return []; } };
const metaOf = (id) => D.readJSON(path.join(D.projDir(id), 'meta.json'), {}) || {};
const thumbOf = (id) => D.vurl(D.projDir(id), 'thumb.png', `/files/projects/${id}/thumb.png`);
function allRuns() {
  const out = [];
  for (const id of projectIds()) {
    const raw = D.readText(path.join(D.projDir(id), 'runs.jsonl'));
    if (!raw) continue;
    for (const l of raw.split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (r && Number.isFinite(r.t)) out.push({ ...r, id: r.id || id }); } catch {} }
  }
  return out.sort((a, b) => b.t - a.t);
}
function orders() {
  const o = D.readJSON(D.ORDERS, []);
  return (Array.isArray(o) ? o : []).filter((x) => x && x.status && x.status !== 'demo_received');
}
const PAID = new Set(['paid', 'printing', 'shipped']);
const orderMs = (o) => Date.parse(o.paid_at || o.created) || 0;
const orderEmail = (o) => String(o.customer_email || o.email || o.user || '').toLowerCase();
const orderAmount = (o) => (Number.isFinite(o.amount_total) ? o.amount_total / 100 : Number(o.total) || 0);
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

/** first_seen per email, backfilled from the earliest project they own and their earliest run. */
function userTable() {
  const u = loadUsers();
  const owners = D.owners();
  const rows = new Map();
  const row = (e) => { if (!rows.has(e)) rows.set(e, { email: e, first_seen: null, last_seen: null, projects: 0, runs_today: 0, runs_7d: 0, runs: 0, orders: 0, paid: 0, days: [] }); return rows.get(e); };
  for (const [e, r] of Object.entries(u)) { const x = row(e); x.first_seen = r.first_seen; x.last_seen = r.last_seen; x.days = r.days || []; }
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const wk = Date.now() - 7 * 864e5;
  for (const id of projectIds()) {
    const e = owners[id]; if (!e) continue;
    const x = row(e); x.projects++;
    const c = Date.parse(metaOf(id).created) || null;
    if (c && (!x.first_seen || c < x.first_seen)) x.first_seen = c;
  }
  for (const r of allRuns()) {
    const e = owners[r.id]; if (!e) continue;
    const x = row(e), ms = r.t * 1000; x.runs++;
    if (ms >= midnight.getTime()) x.runs_today++;
    if (ms >= wk) x.runs_7d++;
    if (!x.first_seen || ms < x.first_seen) x.first_seen = ms;
    if (!x.last_seen || ms > x.last_seen) x.last_seen = ms;
  }
  for (const o of orders()) { const e = orderEmail(o); if (!e || !e.includes('@')) continue; const x = row(e); x.orders++; if (PAID.has(o.status)) x.paid += orderAmount(o); }
  return [...rows.values()];
}

// ---------------------------------------------------------------- sections
function overview() {
  const DAYS = 14;
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime() - (DAYS - 1) * 864e5;
  const idx = (ms) => { if (!ms || ms < start) return -1; return Math.min(DAYS - 1, Math.floor((ms - start) / 864e5)); };
  const series = () => new Array(DAYS).fill(0);
  const m = { signups: series(), active: series(), designs: series(), runs: series(), failed: series(), orders: series(), revenue: series() };
  const users = userTable();
  const activeSets = Array.from({ length: DAYS }, () => new Set());
  const dayIdx = new Map(Array.from({ length: DAYS }, (_, i) => [dayKey(start + i * 864e5 + 3600e3), i]));
  for (const u of users) {
    const i = idx(u.first_seen); if (i >= 0) m.signups[i]++;
    for (const d of u.days) if (dayIdx.has(d)) activeSets[dayIdx.get(d)].add(u.email);
  }
  for (const id of projectIds()) { const i = idx(Date.parse(metaOf(id).created)); if (i >= 0) m.designs[i]++; }
  const owners = D.owners();
  const runs = allRuns();
  for (const r of runs) {
    const i = idx(r.t * 1000); if (i < 0) continue;
    m.runs[i]++; if (r.ok === false && !r.stopped) m.failed[i]++;
    if (owners[r.id]) activeSets[i].add(owners[r.id]);
  }
  activeSets.forEach((s, i) => { m.active[i] = s.size; });
  for (const o of orders()) {
    const i0 = idx(Date.parse(o.created)); if (i0 >= 0) m.orders[i0]++;
    if (PAID.has(o.status)) { const i = idx(orderMs(o)); if (i >= 0) m.revenue[i] += orderAmount(o); }
  }
  const sum = (a, n) => a.slice(-n).reduce((x, y) => x + y, 0);
  const wkActive = new Set(); activeSets.slice(-7).forEach((s) => s.forEach((e) => wkActive.add(e)));
  const metrics = Object.entries(m).map(([key, s]) => ({ key, today: key === 'revenue' ? Math.round(s[DAYS - 1] * 100) / 100 : s[DAYS - 1],
    d7: key === 'active' ? wkActive.size : key === 'revenue' ? Math.round(sum(s, 7) * 100) / 100 : sum(s, 7), series: s }));
  const recent = runs.filter((r) => r.kind === 'design' || !r.kind).slice(0, 200);
  const timing = ['first_token', 'first_model', 'end'].map((k) => { const v = recent.map((r) => r[k]).filter(Number.isFinite); return { key: k, n: v.length, p50: pct(v, 50), p90: pct(v, 90) }; });
  return { days: Array.from({ length: DAYS }, (_, i) => dayKey(start + i * 864e5 + 3600e3)), metrics, timing, totals: { users: users.length, projects: projectIds().length, runs: runs.length, orders: orders().length } };
}

function usersList() {
  return userTable().map(({ days, ...x }) => ({ ...x, paid: Math.round(x.paid * 100) / 100 }))
    .sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
}

function projectsList(owner) {
  const owners = D.owners();
  const out = [];
  for (const id of projectIds()) {
    if (owner && owners[id] !== owner) continue;
    const dir = D.projDir(id), meta = metaOf(id);
    let versions = 0; try { versions = D.historyPayload(dir, 'design').versions?.length || 0; } catch {}
    const sup = D.readJSON(path.join(dir, 'support', 'messages.json'), null);
    out.push({ id, title: meta.title || 'Untitled', owner: owners[id] || null, created: meta.created || null, updated: D.projectUpdated(dir),
      running: D.runs.has(id), site_running: D.siteRuns.has(id), ads_running: D.adsRuns.has(id), shared: !!D.isShared(id), published: D.isPublished(dir),
      versions, support: Array.isArray(sup) ? sup.length : 0, online: userOnline(id), thumb: thumbOf(id) });
  }
  return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

function runsList(q) {
  const owners = D.owners();
  const n = Math.min(1000, Math.max(1, Number(q.get('n')) || 200));
  const user = (q.get('user') || '').toLowerCase(), project = q.get('project') || '', kind = q.get('kind') || '', ok = q.get('ok') || '';
  const titles = new Map();
  const title = (id) => { if (!titles.has(id)) titles.set(id, D.projDir(id) ? metaOf(id).title || id : id); return titles.get(id); };
  const all = allRuns().filter((r) => (!user || String(owners[r.id] || '').includes(user)) && (!project || r.id === project) && (!kind || (r.kind || 'design') === kind)
    && (!ok || (ok === 'failed' ? r.ok === false && !r.stopped : ok === 'stopped' ? !!r.stopped : r.ok !== false)));
  return { total: all.length, runs: all.slice(0, n).map((r) => ({ t: r.t, id: r.id, title: title(r.id), user: owners[r.id] || null, kind: r.kind || 'design', model: r.model || null,
    effort: r.effort || null, ok: r.ok !== false, stopped: !!r.stopped, warm: !!r.warm, denied: Number(r.denied) || 0, first_model: r.first_model ?? null, end: r.end ?? null,
    turns: r.turns ?? null, builds: (r.builds || []).length, failed_builds: (r.builds || []).filter((b) => !b.ok).length, error: r.error ? String(r.error).slice(0, 200) : null })) };
}

let duCache = { t: 0, v: null };
function du(dir) {
  return new Promise((resolve) => execFile('/usr/bin/du', ['-sk', dir], { timeout: 15e3 }, (err, out) => resolve(err ? null : Number(String(out).split(/\s/)[0]) * 1024 || 0)));
}
async function diskUsage() {
  if (duCache.v && Date.now() - duCache.t < 60e3) return duCache.v;
  let subs = []; try { subs = fs.readdirSync(D.DATA, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch {}
  const parts = await Promise.all(subs.map(async (name) => ({ name, bytes: await du(path.join(D.DATA, name)) })));
  const total = await du(D.DATA);
  let free = null; try { const s = fs.statfsSync(D.DATA); free = s.bavail * s.bsize; } catch {}
  duCache = { t: Date.now(), v: { total, free, parts: parts.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)) } };
  return duCache.v;
}
async function gatewayHealth() {
  if (!D.GATEWAY_URL) return { configured: false };
  const t0 = Date.now();
  try {
    const r = await fetch(D.GATEWAY_URL + '/healthz', { signal: AbortSignal.timeout(4000) });
    const j = await r.json().catch(() => ({}));
    return { configured: true, ok: r.ok && !!j.ok, target: !!j.target, google: !!j.google, ms: Date.now() - t0 };
  } catch { return { configured: true, ok: false, ms: Date.now() - t0 }; }
}
async function system() {
  const t = Date.now();
  const hits24 = rateHits.filter((h) => t - h.t < 864e5);
  const byKey = {}; for (const h of hits24) byKey[h.key] = (byKey[h.key] || 0) + 1;
  const [disk, gateway] = await Promise.all([diskUsage(), gatewayHealth()]);
  return {
    uptime_s: Math.round((t - STARTED) / 1000), started: STARTED, node: process.version, rss: process.memoryUsage().rss, load: os.loadavg().map((x) => Math.round(x * 100) / 100),
    host_uptime_s: Math.round(os.uptime()), online: !!D.ONLINE,
    concurrency: { active: D.activeAgents(), max: D.MAX_CONCURRENT, design: D.runs.size, site: D.siteRuns.size, ads: D.adsRuns.size, ads_jobs: D.adsJobs.size, sketches: D.sketchJobs.size },
    pool: [...D.pool.values()].map((p) => ({ id: p.id, title: metaOf(p.id).title || p.id, owner: p.owner || null, busy: !!p.run, effort: p.effort || 'default',
      age_s: Math.round((t - p.spawnedAt) / 1000), idle_s: Math.round((t - p.lastUsed) / 1000) })),
    workers: [...D.workers].map(([id, w]) => ({ id, title: D.projDir(id) ? metaOf(id).title || id : id, owner: w.owner || null, age_s: Math.round((t - w.startedAt) / 1000), idle_s: Math.round((t - w.lastUsed) / 1000) })),
    limits: D.limits,
    rate_hits: { last_hour: hits24.filter((h) => t - h.t < 3600e3).length, last_24h: hits24.length, by_kind: byKey },
    presence: { admin_online: adminOnline(), admin_streams: adminStreams, users_online: [...presence.keys()].filter(userOnline).length },
    gateway, disk,
  };
}

function conversations() {
  const owners = D.owners();
  const u = loadUsers();
  return D.supportInbox().map((c) => ({ ...c, owner: owners[c.id] || null, email: c.email || owners[c.id] || '', online: userOnline(c.id),
    last_seen: u[c.email || owners[c.id]]?.last_seen || null, thumb: thumbOf(c.id) }));
}
function thread(id) {
  const dir = D.projDir(id);
  if (!dir || !D.exists(path.join(dir, 'meta.json'))) return null;
  D.markSupportRead(dir, 'josh');
  const meta = metaOf(id);
  let hist = {}; try { hist = D.historyPayload(dir, 'design'); } catch {}
  const owner = D.owners()[id] || null;
  return { id, messages: D.readJSON(path.join(dir, 'support', 'messages.json'), []) || [], online: userOnline(id),
    project: { title: meta.title || 'Untitled', owner, thumb: thumbOf(id), current_v: hist.current_v ?? null, versions: hist.versions?.length || 0, updated: D.projectUpdated(dir),
      running: D.runs.has(id), last_seen: loadUsers()[owner]?.last_seen || null } };
}

// ---------------------------------------------------------------- routing
const notFound = (res) => D.send(res, 404, { error: 'not found' });
/** Returns true if it answered. Called for every request after access() (and after the bare-tunnel check). */
async function handle(req, res, { parts, m, acc, url, readBody }) {
  const isPage = parts[0] === 'admin';
  const isApi = parts[0] === 'api' && parts[1] === 'admin';
  const isFile = parts.length === 1 && ADMIN_FILES[parts[0]];
  if (!isPage && !isApi && !isFile) return false;
  const admin = D.isAdmin(acc);
  if (!admin) { if (isApi) D.send(res, 404, { error: 'no such endpoint' }); else notFound(res); return true; }
  if (!D.allow('admin:' + (acc.user || 'local'), 1200, 600e3)) { D.send(res, 429, { error: 'Too many admin requests. Wait a minute.' }); return true; }

  if (isFile || isPage) {
    if (m !== 'GET' && m !== 'HEAD') { D.send(res, 405, { error: 'method not allowed' }); return true; }
    // /admin, /admin/ -> the page; /admin/admin.js|css (or the bare /admin.* files) -> the assets
    const rel = isFile ? parts[0] : parts[1] && ADMIN_FILES[parts[1]] ? parts[1] : parts.length <= 1 ? 'admin.html' : null;
    if (!rel) { notFound(res); return true; }
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex');
    await D.serveFile(res, D.WEB, rel, { noCache: true });
    return true;
  }

  const [, , a, b, c] = parts;
  const q = url.searchParams;
  if (a === 'events' && !b && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'hello', boot: BOOT, seq: SEQ })}\n\n`);
    sseClients.add(res); adminStreams++;
    const ping = setInterval(() => res.write('data: {"type":"ping"}\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); if (sseClients.delete(res)) adminStreams = Math.max(0, adminStreams - 1); adminSeen = Date.now(); });
    return true;
  }
  if (a === 'poll' && !b && m === 'GET') {
    const since = Number(q.get('since'));
    const reset = q.get('boot') !== BOOT || !Number.isFinite(since) || (log.length && log[0].seq > since + 1);
    D.send(res, 200, { boot: BOOT, seq: SEQ, reset, events: reset ? [] : log.filter((e) => e.seq > since) });
    return true;
  }
  if (a === 'heartbeat' && !b && m === 'POST') { D.send(res, 200, { ok: true }); return true; }
  if (a === 'support' && !b && m === 'GET') { D.send(res, 200, { conversations: conversations(), admin_online: adminOnline() }); return true; }
  if (a === 'support' && b && !c && m === 'GET') { const t = thread(b); if (!t) notFound(res); else D.send(res, 200, t); return true; }
  if (a === 'support' && b && !c && m === 'POST') {
    const dir = D.projDir(b);
    if (!dir || !D.exists(path.join(dir, 'meta.json'))) { notFound(res); return true; }
    if (!D.allow('admin-reply:' + (acc.user || 'local'), 300, 3600e3)) { D.send(res, 429, { error: 'That is a lot of replies this hour.' }); return true; }
    const body = await readBody(req, 2e4);
    const msg = D.addSupportMessage(b, dir, acc, { text: body.text });
    D.send(res, 200, { ok: true, message: msg, ...thread(b) });
    return true;
  }
  if (a === 'overview' && !b && m === 'GET') { D.send(res, 200, overview()); return true; }
  if (a === 'users' && !b && m === 'GET') { D.send(res, 200, usersList()); return true; }
  if (a === 'projects' && !b && m === 'GET') { D.send(res, 200, projectsList((q.get('owner') || '').toLowerCase() || null)); return true; }
  if (a === 'runs' && !b && m === 'GET') { D.send(res, 200, runsList(q)); return true; }
  if (a === 'system' && !b && m === 'GET') { D.send(res, 200, await system()); return true; }
  if (a === 'fulfilment' && D.fulfilment) { await D.fulfilment.adminApi(req, res, { rest: parts.slice(3), m, acc, readBody }); return true; } // fulfilment: server/fulfilment
  D.send(res, 404, { error: 'no such endpoint' });
  return true;
}

function init(deps) {
  D = deps;
  USERS_FILE = path.join(D.DATA, 'users.json');
  return module.exports;
}

module.exports = { init, handle, touch, rateHit, onSupport, adminOnline, userOnline };
