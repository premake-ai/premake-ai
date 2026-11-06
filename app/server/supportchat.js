// "Message us": one written support thread per signed-in user, answered by Josh from the Inbox on /admin.
// Short polling only (SSE doesn't get through the tunnel). Nothing here runs an agent.
//
// Signed-in user (their own thread only):
//   GET  /api/supportchat[?read=1]                -> { messages, unread, resolved }   (read=1: the thread is on screen)
//   GET  /api/supportchat/unread                  -> { unread }                       (the bubble's dot)
//   POST /api/supportchat {text, images?, context?} -> { message, messages }
//   POST /api/supportchat/image  raw PNG/JPEG/WebP/GIF -> { id, url }                (same checks as server/uploads.js)
//   GET  /api/supportchat/img/<hash>/<file>       the image (owner of that thread, or an admin)
// Admins (everyone else gets 404):
//   GET  /api/supportchat/admin                   -> { threads, unread }              (newest first)
//   GET  /api/supportchat/admin/pulse?since=<ms>  -> { unread, fresh: [...] }         (polled by every /admin page)
//   GET  /api/supportchat/admin/<hash>            -> thread with context; marks it read
//   POST /api/supportchat/admin/<hash> {text}     -> reply as Josh
//   POST /api/supportchat/admin/<hash>/resolve {resolved}
//
// Storage: <DATA>/.support/<hash>.json, images in <DATA>/.support/img/<hash>/. hash = sha256 of the email (no email in
// file names). Context (design, page, browser/OS) is saved on each user message and shown to admins only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sniff, MAX_BYTES } = require('./uploads');

const MAX_TEXT = 4000;
const MAX_MSGS = 2000;
const MAX_IMAGES_PER_MSG = 4;
const MAX_IMAGES_PER_USER = 200;
const MSGS_PER_HOUR = 30;
const IMAGES_PER_HOUR = 30;
const REPLIES_PER_HOUR = 600;
const IMG_RE = /^\d{13}-[a-f0-9]{8}\.(png|jpg|webp|gif)$/;
const HASH_RE = /^[a-f0-9]{24}$/;
const IMG_TYPE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

let D = null; // deps from server.js: { DATA, send, allow, isAdmin, notifyAdmin? }
let DIR = '';

const hashOf = (email) => crypto.createHash('sha256').update('premake-support\0' + String(email).trim().toLowerCase()).digest('hex').slice(0, 24);
const fileOf = (hash) => path.join(DIR, hash + '.json');
const imgDir = (hash) => path.join(DIR, 'img', hash);
const imgUrl = (hash, file) => `/api/supportchat/img/${hash}/${file}`;
const now = () => (D && D.now ? D.now() : Date.now());
const clip = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n) : '');

function load(hash) {
  try { const t = JSON.parse(fs.readFileSync(fileOf(hash), 'utf8')); return t && Array.isArray(t.messages) ? t : null; } catch { return null; }
}
function save(t) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const f = fileOf(t.hash);
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(t, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
const fresh = (user) => ({ hash: hashOf(user), user, created: now(), updated: now(), resolved: false, user_read: 0, josh_read: 0, messages: [] });

/** "Safari 18 · iOS 18.1" from a User-Agent (a rough label for Josh, not a security check). */
function uaLabel(ua) {
  ua = String(ua || '');
  let b = 'Unknown browser', o = 'unknown OS', m;
  if ((m = ua.match(/Edg\/(\d+)/))) b = 'Edge ' + m[1];
  else if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) b = 'Chrome ' + m[1];
  else if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) b = 'Firefox ' + m[1];
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) b = 'Safari ' + m[1].split('.').slice(0, 2).join('.');
  if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/))) o = (/iPad/.test(ua) ? 'iPadOS ' : 'iOS ') + m[1] + '.' + m[2];
  else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) o = 'Android ' + m[1];
  else if (/Mac OS X/.test(ua)) o = 'macOS';
  else if (/Windows/.test(ua)) o = 'Windows';
  else if (/CrOS/.test(ua)) o = 'ChromeOS';
  else if (/Linux/.test(ua)) o = 'Linux';
  return `${b} · ${o}`;
}

/** What the browser says the user was looking at, cleaned. Only admins ever see it. */
function cleanContext(c, req) {
  c = c && typeof c === 'object' ? c : {};
  const url = clip(c.url, 300);
  const vp = clip(c.viewport, 20);
  return {
    design: /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(String(c.design || '')) ? String(c.design) : null,
    kind: c.kind === 'example' ? 'example' : c.design ? 'project' : null,
    title: clip(c.title, 120) || null,
    url: url.startsWith('/') && !url.startsWith('//') ? url : null,
    page: clip(c.page, 40) || null,
    viewport: /^\d{2,5}x\d{2,5}$/.test(vp) ? vp : null,
    device: uaLabel(req.headers['user-agent']),
    ua: clip(String(req.headers['user-agent'] || ''), 300),
  };
}

/** Image ids for this user's thread: existing files only, deduped, at most 4. Throws 400 on a bad list. */
function pickImages(hash, list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw Object.assign(new Error('images must be a list'), { code: 400 });
  const ids = [...new Set(list.map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean))];
  if (ids.length > MAX_IMAGES_PER_MSG) throw Object.assign(new Error(`Attach at most ${MAX_IMAGES_PER_MSG} images per message.`), { code: 400 });
  for (const f of ids) if (!IMG_RE.test(f) || !fs.existsSync(path.join(imgDir(hash), f))) throw Object.assign(new Error('An attached image is missing. Remove it and attach it again.'), { code: 400 });
  return ids;
}

const forUser = (t, m) => ({ id: m.id, from: m.from, text: m.text, t: m.t, images: (m.images || []).map((f) => imgUrl(t.hash, f)) });
const forAdmin = (t, m) => ({ ...forUser(t, m), ctx: m.from === 'user' ? m.ctx || null : undefined });
const unreadFor = (t, who) => t.messages.filter((m) => (who === 'user' ? m.from === 'josh' && m.t > (t.user_read || 0) : m.from === 'user' && m.t > (t.josh_read || 0))).length;

function addMessage(t, from, text, images, ctx) {
  if (t.messages.length >= MAX_MSGS) throw Object.assign(new Error('This thread is full. Start a video call instead.'), { code: 400 });
  const msg = { id: crypto.randomBytes(6).toString('hex'), from, text, t: Math.max(now(), (t.messages.at(-1)?.t || 0) + 1), images };
  if (ctx) msg.ctx = ctx;
  t.messages.push(msg);
  t.updated = msg.t;
  if (from === 'user') { t.resolved = false; t.user_read = msg.t; } else t.josh_read = Math.max(t.josh_read || 0, msg.t);
  save(t);
  return msg;
}

function threads() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => /^[a-f0-9]{24}\.json$/.test(f)); } catch {}
  const out = [];
  for (const f of files) {
    const t = load(f.slice(0, 24));
    if (!t || !t.messages.length) continue;
    const last = t.messages.at(-1);
    const lastUser = [...t.messages].reverse().find((m) => m.from === 'user');
    out.push({ hash: t.hash, user: t.user, updated: t.updated, resolved: !!t.resolved, unread: unreadFor(t, 'josh'), count: t.messages.length,
      last: { from: last.from, text: String(last.text).slice(0, 160) || (last.images?.length ? 'Image' : ''), t: last.t },
      design: lastUser?.ctx?.title || null });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > limit) { req.resume(); return reject(Object.assign(new Error('That image is over 5 MB. Try a smaller one.'), { code: 413 })); }
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('That image is over 5 MB. Try a smaller one.'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Returns true if it answered. parts = ['api', 'supportchat', ...]. */
async function handle(req, res, { parts, m, acc, url, readBody }) {
  if (parts[0] !== 'api' || parts[1] !== 'supportchat') return false;
  const send = (code, obj) => { D.send(res, code, obj); return true; };
  const [, , a, b, c] = parts;
  if (!acc || !acc.authed || !acc.user) return send(401, { error: 'Sign in to message us.', code: 'signin' });
  const admin = D.isAdmin(acc);
  const fail = (e) => send(e.code >= 400 && e.code < 500 ? e.code : 400, { error: e.code ? e.message : 'Bad request' });

  // ---- images (both sides)
  if (a === 'img' && m === 'GET') {
    if (!HASH_RE.test(b || '') || !IMG_RE.test(c || '') || parts.length !== 5) return send(404, { error: 'not found' });
    if (!admin && b !== hashOf(acc.user)) return send(404, { error: 'not found' });
    let buf; try { buf = fs.readFileSync(path.join(imgDir(b), c)); } catch { return send(404, { error: 'not found' }); }
    res.writeHead(200, { 'Content-Type': IMG_TYPE[c.split('.').pop()], 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.end(buf);
    return true;
  }

  // ---- Josh: the Inbox
  if (a === 'admin') {
    if (!admin) return send(404, { error: 'no such endpoint' });
    if (!b && m === 'GET') { const list = threads(); return send(200, { threads: list, unread: list.reduce((n, x) => n + x.unread, 0) }); }
    if (b === 'pulse' && !c && m === 'GET') {
      const since = Number(url.searchParams.get('since')) || 0;
      const list = threads();
      const freshMsgs = since ? list.filter((x) => x.last.from === 'user' && x.last.t > since && x.unread).map((x) => ({ hash: x.hash, user: x.user, text: x.last.text, t: x.last.t })) : [];
      return send(200, { unread: list.reduce((n, x) => n + x.unread, 0), fresh: freshMsgs, now: now() });
    }
    if (!HASH_RE.test(b || '')) return send(404, { error: 'not found' });
    const t = load(b);
    if (!t) return send(404, { error: 'not found' });
    if (!c && m === 'GET') {
      if (url.searchParams.get('read') !== '0') { t.josh_read = Math.max(t.josh_read || 0, t.messages.at(-1)?.t || 0); save(t); }
      return send(200, { hash: t.hash, user: t.user, resolved: !!t.resolved, created: t.created, messages: t.messages.map((x) => forAdmin(t, x)) });
    }
    if (!c && m === 'POST') {
      if (!D.allow('supportreply:' + acc.user, REPLIES_PER_HOUR, 3600e3)) return send(429, { error: 'Too many replies this hour.' });
      let body; try { body = await readBody(req, 2e4); } catch { return send(400, { error: 'Bad request' }); }
      const text = clip(body.text, MAX_TEXT);
      if (!text) return send(400, { error: 'Write a reply first.' });
      try { addMessage(t, 'josh', text, [], null); } catch (e) { return fail(e); }
      return send(200, { ok: true, resolved: !!t.resolved, messages: t.messages.map((x) => forAdmin(t, x)) });
    }
    if (c === 'resolve' && m === 'POST') {
      let body; try { body = await readBody(req, 1e3); } catch { return send(400, { error: 'Bad request' }); }
      t.resolved = body.resolved !== false;
      save(t);
      return send(200, { ok: true, resolved: t.resolved });
    }
    return send(404, { error: 'no such endpoint' });
  }

  // ---- the user's own thread
  const hash = hashOf(acc.user);
  if (!a && m === 'GET') {
    const t = load(hash);
    if (!t) return send(200, { messages: [], unread: 0, resolved: false });
    const unread = unreadFor(t, 'user');
    if (url.searchParams.get('read') === '1' && unread) { t.user_read = t.messages.at(-1).t; save(t); }
    return send(200, { messages: t.messages.map((x) => forUser(t, x)), unread: url.searchParams.get('read') === '1' ? 0 : unread, resolved: !!t.resolved });
  }
  if (a === 'unread' && !b && m === 'GET') {
    const t = load(hash);
    return send(200, { unread: t ? unreadFor(t, 'user') : 0 });
  }
  if (!a && m === 'POST') {
    let body; try { body = await readBody(req, 2e4); } catch { return send(400, { error: 'That message is too long.' }); }
    const text = clip(body.text, MAX_TEXT);
    let images;
    try { images = pickImages(hash, body.images); } catch (e) { return fail(e); }
    if (!text && !images.length) return send(400, { error: 'Write a message first.' });
    if (!D.allow('supportchat:' + acc.user, MSGS_PER_HOUR, 3600e3)) return send(429, { error: 'That’s a lot of messages this hour. Try again later.' });
    const t = load(hash) || fresh(acc.user);
    let msg;
    try { msg = addMessage(t, 'user', text, images, cleanContext(body.context, req)); } catch (e) { return fail(e); }
    try { D.notifyAdmin?.(acc.user, text || 'Sent an image'); } catch {}
    return send(200, { ok: true, message: forUser(t, msg), messages: t.messages.map((x) => forUser(t, x)) });
  }
  if (a === 'image' && !b && m === 'POST') {
    if (!D.allow('supportimg:' + acc.user, IMAGES_PER_HOUR, 3600e3)) { req.resume(); return send(429, { error: 'That’s a lot of images this hour. Try again later.' }); }
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(ct)) { req.resume(); return send(415, { error: 'Only PNG, JPEG, WebP or GIF images can be attached.' }); }
    let buf; try { buf = await readRaw(req, MAX_BYTES); } catch (e) { return fail(e); }
    const ext = sniff(buf);
    if (!ext) return send(415, { error: 'That file is not a PNG, JPEG, WebP or GIF image.' });
    const dir = imgDir(hash);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.readdirSync(dir).filter((f) => IMG_RE.test(f)).length >= MAX_IMAGES_PER_USER) return send(409, { error: 'You’ve sent a lot of images. Describe the rest in words, or start a video call.' });
    const file = `${now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buf, { flag: 'wx', mode: 0o600 });
    return send(200, { id: file, url: imgUrl(hash, file) });
  }
  return send(404, { error: 'no such endpoint' });
}

function init(deps) {
  D = deps;
  DIR = path.join(D.DATA, '.support');
  return module.exports;
}

module.exports = { init, handle, hashOf, uaLabel, cleanContext, threads, MSGS_PER_HOUR, MAX_TEXT };
