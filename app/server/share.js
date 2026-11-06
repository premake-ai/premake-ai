'use strict';
// Share links: the owner shares a design and picks "Anyone with the link can: Edit | Make a copy" (new links: Edit).
//   edit: a signed-in visitor who opens the link joins the design: the full studio, chatting with the design agent (their
//         changes land on the shared design, labelled with their initials, on their own run quota), versions, order.
//   copy: a signed-in visitor joins read-only: the studio shows the model, and the first change (or Make a copy) copies
//         the design into their own projects and carries on there. No chats.
//   view: legacy links made before modes existed with "Allow remix" off: the public page only, never the studio.
// Owner-only, always: sharing settings, website / ads / launch / publish, the companion app and devices, support chat.
// Signed-out visitors (and link unfurlers) get the public page /d/<id> with a sign-in button.
//
// Routes (handle() returns true when it answered):
//   GET  /d/<shareId>                      public page, server-rendered <head> with Open Graph tags (unfurls in iMessage, X, Slack)
//   GET  /d/<shareId>/manifest.json        the model the page loads (only while sharing is on)
//   GET  /d/<shareId>/stl/<file>.stl
//   GET  /d/<shareId>/thumb.png            og:image
//   GET  /api/share/<shareId>              page payload (JSON)
//   GET  /api/share/<shareId>/quote?mode=  price tiers for the Order button
//   GET  /api/projects/<id>/share          owner/admin: current state (called from server.js after its canEdit check)
//   POST /api/projects/<id>/share {on, access: 'edit' | 'copy'}   (old clients: {on, remix})
// Joining: GET /d/<shareId> signed in (edit / copy links) records the visitor in the link's members and redirects to the
// studio (/designs/<slug>-<id>); ?preview=1 shows the public page instead. Access is by membership, never by knowing a
// project id, and it ends for every member the moment sharing is turned off (members are cleared).
// <shareId>: projects get 12 random base62 chars, made the first time sharing is turned on and kept for later. Examples
// are always public under the fixed id ex-<slug>.
// Storage: <DATA>/shares.json { shareId: { project, on, access, members: { email: { joined, seen } } } } is the authority
// (server-only; agents can rewrite meta.json). meta.json.share mirrors { id, on, access, remix } for display (no members).
// Turning sharing off makes every /d/<id> URL 404 at once. Member emails never leave the server: chats show initials.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { designPath } = require('./approutes');

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHARE_RE = /^[A-Za-z0-9]{10,24}$/;
const EX_RE = /^ex-([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/;
const STL_RE = /^stl\/[\w.-]+\.stl$/;
const MODES = ['edit', 'copy'];
const MEMBERS_MAX = 500; // per link
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** The link's mode. Entries made before modes: remix on = copy, remix off = view. */
const accessOf = (e) => (MODES.includes(e?.access) || e?.access === 'view' ? e.access : e?.remix === false ? 'view' : 'copy');
/** "josh.mitchell@x.com" -> "J.M.", "sam@x.com" -> "S.": a public label that never shows the address itself. */
function initials(email) {
  const words = String(email || '').split('@')[0].split(/[._+\-\d]+/).filter((w) => /^[a-z]/i.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase() + '.').join('') || 'Someone';
}

/** meta.creator as a public name: '' when it is unset, the default "you", or holds anything that looks like an email
 *  address (pen test A5: a public page never shows an owner's address, or a name taken from it). */
function publicCreator(creator) {
  const c = String(creator || '').replace(/\s+/g, ' ').trim();
  return !c || /^you$/i.test(c) || c.includes('@') || EMAIL_RE.test(c) ? '' : c.slice(0, 60);
}

function newShareId(n = 12) {
  const out = []; // rejection sampling: no modulo bias
  while (out.length < n) for (const b of crypto.randomBytes(n * 2)) { if (b < 248 && out.length < n) out.push(B62[b % 62]); }
  return out.join('');
}

function init(ctx) {
  const { DATA, PROJECTS, EXAMPLES, readJSON, writeJSON, exists, send, serveFile, escHtml, allow, hitCount, clientIp, quote,
    designDims, viaGateway, ownerOf, cardStats, canEdit, orderPriceQuery } = ctx;
  const FILE = path.join(DATA, 'shares.json');
  let index = readJSON(FILE, {}) || {};
  const save = () => { fs.mkdirSync(DATA, { recursive: true }); writeJSON(FILE, index); };
  const projDir = (id) => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id || '') ? path.join(PROJECTS, id) : null);
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  /** shareId -> { kind, id, dir, project, shareId, access, remix } while it is shared, else null. */
  function resolve(shareId) {
    const ex = EX_RE.exec(shareId || '');
    if (ex) {
      const dir = ctx.exDir ? ctx.exDir(ex[1]) : path.join(EXAMPLES, ex[1]); // showcase: repo examples and the owner's published designs
      return exists(path.join(dir, 'meta.json')) ? { kind: 'examples', id: ex[1], dir, project: false, shareId, access: 'copy', remix: true } : null;
    }
    if (!SHARE_RE.test(shareId || '')) return null;
    const e = own(index, shareId) ? index[shareId] : null;
    if (!e || !e.on) return null;
    const dir = projDir(e.project);
    if (!dir || !exists(path.join(dir, 'meta.json'))) return null;
    const access = accessOf(e);
    return { kind: 'projects', id: e.project, dir, project: true, shareId, access, remix: access !== 'view' };
  }
  const entryFor = (pid) => { for (const [sid, e] of Object.entries(index)) if (e.project === pid) return [sid, e]; return [null, null]; };

  /** Owner/admin state for the share sheet. A design never shared yet reports the default mode (edit). */
  function state(pid) {
    const [sid, e] = entryFor(pid);
    const access = e ? accessOf(e) : 'edit';
    return { on: !!e?.on, access, remix: access !== 'view', id: e?.on ? sid : null, url: e?.on ? `/d/${sid}` : null,
      members: e?.on ? Object.keys(e.members || {}).length : 0 };
  }
  function setShare(pid, dir, { on, access, remix }) {
    let [sid, e] = entryFor(pid);
    if (!sid) { if (!on) return state(pid); do sid = newShareId(); while (index[sid]); e = { project: pid, on: false, access: 'edit', created: new Date().toISOString() }; }
    e.access = accessOf(e);
    e.on = !!on;
    if (MODES.includes(access)) e.access = access;
    else if (typeof remix === 'boolean') e.access = remix ? (e.access === 'view' ? 'copy' : e.access) : 'view'; // old clients
    e.remix = e.access !== 'view'; // guide.js and older readers
    if (!e.on) e.members = {}; // stop sharing: everyone who joined loses access at once
    e.updated = new Date().toISOString();
    index[sid] = e; save();
    const meta = readJSON(path.join(dir, 'meta.json'), {}) || {};
    meta.share = { id: sid, on: e.on, access: e.access, remix: e.remix };
    writeJSON(path.join(dir, 'meta.json'), meta);
    return state(pid);
  }
  /** Record a signed-in visitor of a live edit / copy link (never the owner). Returns their role, or null. */
  function join(src, acc) {
    if (!src?.project || !acc?.authed || !acc.user || !MODES.includes(src.access) || ownerOf(src.id) === acc.user) return null;
    const e = own(index, src.shareId) ? index[src.shareId] : null;
    if (!e?.on) return null;
    if (!e.members || typeof e.members !== 'object') e.members = {};
    const now = new Date().toISOString();
    if (!own(e.members, acc.user)) {
      if (Object.keys(e.members).length >= MEMBERS_MAX) return null;
      e.members[acc.user] = { joined: now, seen: now }; save();
    } else if (Date.now() - (Date.parse(e.members[acc.user].seen) || 0) > 3600e3) { e.members[acc.user].seen = now; save(); }
    return src.access;
  }
  /** What a signed-in non-owner may do in a project: { role: 'edit' | 'copy', shareId } while they are a member of its live
   *  edit / copy link, else null. Owners and admins pass server.js's canEdit before this is asked. */
  function roleFor(acc, pid) {
    if (!acc?.authed || !acc.user) return null;
    const [sid, e] = entryFor(pid);
    if (!e?.on || !own(e.members, acc.user)) return null;
    const access = accessOf(e);
    return MODES.includes(access) ? { role: access, shareId: sid } : null;
  }
  /** Projects shared with this user, for their projects list: [{ project, role, shareId }]. */
  function sharedWith(user) {
    if (!user) return [];
    const out = [];
    for (const [sid, e] of Object.entries(index)) {
      if (!e?.on || !own(e.members, user) || ownerOf(e.project) === user) continue;
      const access = accessOf(e);
      if (MODES.includes(access)) out.push({ project: e.project, role: access, shareId: sid });
    }
    return out;
  }
  /** Chat labels for the viewer: once anyone but the owner has written in a chat, user messages carry by = 'You' |
   *  'Owner' | the writer's initials. The stored by_h (a salted hash of the writer's email) never leaves the server. */
  const writerHash = (email) => crypto.createHash('sha256').update('formery-share:' + String(email || '').toLowerCase()).digest('hex').slice(0, 16);
  function labelChat(msgs, acc, pid) {
    const list = Array.isArray(msgs) ? msgs : [];
    const shared = list.some((m) => m && m.by_h);
    const me = acc?.user ? writerHash(acc.user) : null;
    const ownerIsMe = !!acc?.user && ownerOf(pid) === acc.user;
    return list.map((m) => {
      if (!m || typeof m !== 'object') return m;
      const { by_h, by, ...rest } = m;
      if (!shared || m.role !== 'user') return rest;
      if (by_h) return { ...rest, by: by_h === me ? 'You' : String(by || 'Someone').slice(0, 12) };
      return { ...rest, by: ownerIsMe ? 'You' : 'Owner' };
    });
  }
  /** Stored on a collaborator's chat message (labelChat turns it into a label). */
  const writerTag = (acc) => ({ by_h: writerHash(acc.user), by: initials(acc.user) });
  /** meta.json for anyone but the owner: no owner email, no referral data, nothing that looks like an address. */
  function publicMeta(meta) {
    const out = {};
    for (const [k, v] of Object.entries(meta || {})) {
      if (['owner', 'referred_by', 'referred_at', 'remix_of_share'].includes(k)) continue;
      if (typeof v === 'string' && EMAIL_RE.test(v)) continue;
      out[k] = v;
    }
    if (out.share && typeof out.share === 'object') out.share = { id: out.share.id, on: out.share.on, access: out.share.access };
    return out;
  }

  /** Project dir a signed-in user may copy (POST /api/projects {fromShare}), or null. Edit and copy links both allow it. */
  function remixSource(shareId) {
    const s = resolve(shareId);
    return s && s.remix ? s : null;
  }
  /** Checkout hook: a shared project may be ordered by anyone who has its link. */
  const isShared = (pid) => { const [, e] = entryFor(pid); return !!e?.on; };

  function origin(req) {
    if (viaGateway(req)) {
      const h = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() === 'http' ? 'http' : 'https';
      if (/^[a-z0-9.-]+(:\d+)?$/i.test(h)) return `${proto}://${h}`;
    }
    const h = String(req.headers.host || 'localhost');
    return /^[a-z0-9.-]+(:\d+)?$/i.test(h) ? `http://${h}` : 'http://localhost';
  }
  function mtime(file) { try { return Math.floor(fs.statSync(file).mtimeMs); } catch { return null; } }
  /** The public "by" line: the name the design carries (meta.creator), else the owner's initials. Never more of an email
   *  address than its initials (pen test A5). */
  function creatorOf(src, meta) {
    const c = publicCreator(meta.creator);
    if (c) return c;
    const o = src.project ? ownerOf(src.id) : null;
    return o ? initials(o) : 'A Premake maker';
  }
  function guideUrl(src) {
    if (!src.project) return `/build/${src.id}`;
    const g = readJSON(path.join(src.dir, 'guide', 'guide.json'), {}) || {};
    return g.share ? `/build/${src.id}` : null;
  }

  function payload(src, acc) {
    const meta = readJSON(path.join(src.dir, 'meta.json'), {}) || {};
    const man = readJSON(path.join(src.dir, 'manifest.json'));
    const bom = readJSON(path.join(src.dir, 'bom.json'), {}) || {};
    const t = mtime(path.join(src.dir, 'thumb.png'));
    const parts = man?.parts || [];
    return {
      id: src.shareId, kind: src.project ? 'project' : 'example',
      title: String(meta.title || 'Untitled design').slice(0, 120),
      creator: creatorOf(src, meta),
      description: String(meta.description || '').slice(0, 400),
      parts: parts.length,
      printed: parts.filter((p) => p.group !== 'component').length,
      size_mm: designDims(src.dir, man),
      has_model: parts.length > 0,
      base: `/d/${src.shareId}/`,
      thumb: t ? `/d/${src.shareId}/thumb.png?v=${t}` : null,
      remix: !!src.remix,
      access: src.access, // edit | copy | view (examples: copy)
      guide: guideUrl(src),
      orderable: !!(bom.parts || []).length,
      order: src.project ? { project: src.id } : { example: src.id },
      authed: !!acc.authed,
      signin: acc.authed ? null : '/auth/signin',
      // signed in: open it in the studio (/d/<id> joins edit / copy links, then redirects). Examples: their studio page.
      studio: src.project ? (acc.authed && MODES.includes(src.access) ? `/d/${src.shareId}` : null) : `/examples/${encodeURIComponent(src.id)}`,
      ...(cardStats ? cardStats(src.dir) : {}), // card-stats: price_each, design_minutes, print_hours
    };
  }

  function pageHtml(req, src, p) {
    const o = origin(req);
    const desc = (p.description || `A ${p.parts}-part design made with Premake. View it in 3D, remix it or order one.`).replace(/\s+/g, ' ').slice(0, 200);
    const title = `${p.title} · Premake`;
    const url = `${o}/d/${p.id}`;
    const img = p.thumb ? o + p.thumb : null;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}">
<link rel="canonical" href="${escHtml(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Premake">
<meta property="og:title" content="${escHtml(p.title)}"><meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(url)}">
${img ? `<meta property="og:image" content="${escHtml(img)}"><meta property="og:image:alt" content="${escHtml(p.title)}">` : ''}
<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escHtml(p.title)}">
<meta name="twitter:description" content="${escHtml(desc)}">${img ? `<meta name="twitter:image" content="${escHtml(img)}">` : ''}
${src.project ? '<meta name="robots" content="noindex">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/checkout.css"><link rel="stylesheet" href="/share.css">
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/", "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/", "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.7.8/src/index.js", "three-gpu-pathtracer": "https://cdn.jsdelivr.net/npm/three-gpu-pathtracer@0.0.23/src/index.js" } }</script>
</head><body class="sh-page" data-share-id="${escHtml(p.id)}">
<div id="shareRoot" class="sh-root"><noscript><h1>${escHtml(p.title)}</h1><p>${escHtml(desc)}</p></noscript></div>
<div class="modal-wrap" id="modal" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" id="modalBox"></div></div>
<script type="module" src="/share.js"></script></body></html>`;
  }
  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Premake</title><body style="font:16px/1.5 Inter,system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 16px;color:#1b1a17;background:#fff"><h1 style="font-size:24px">This design isn’t shared</h1><p>The link may be wrong, or the owner turned sharing off.</p><p><a href="/" style="color:#e8590c">Go to Premake</a></p></body>');
  }
  /** Lookup rate limit: 240 per 10 min per IP, and at most 40 unknown ids (no enumerating). */
  function limited(req, res, acc, html) {
    const who = acc.user || clientIp(req);
    if (hitCount('share-miss:' + who, 600e3) >= 40 || !allow('share:' + who, 240, 600e3)) {
      if (html) { res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '600' }); res.end('Too many requests. Try again in a few minutes.'); }
      else send(res, 429, { error: 'Too many requests. Try again in a few minutes.' });
      return true;
    }
    return false;
  }
  const miss = (req, acc) => allow('share-miss:' + (acc.user || clientIp(req)), Infinity, 600e3);

  async function handle(req, res, { parts, m, acc, url, readBody }) {
    // public page + its files
    if (parts[0] === 'd' && (m === 'GET' || m === 'HEAD')) {
      const f = parts.slice(2).join('/');
      if (!f) { // the page counts as a lookup
        if (limited(req, res, acc, true)) return true;
        const src = resolve(parts[1]);
        if (!src || parts.length > 2) { miss(req, acc); notFound(res); return true; }
        // Signed in on an edit / copy link: join it and open the studio (the owner just opens it). ?preview=1: the page.
        if (src.project && acc.authed && acc.user && MODES.includes(src.access) && url?.searchParams?.get('preview') !== '1') {
          const mine = canEdit ? canEdit(acc, src.id) : ownerOf(src.id) === acc.user;
          if (mine || join(src, acc)) {
            const meta = readJSON(path.join(src.dir, 'meta.json'), {}) || {};
            res.writeHead(302, { Location: designPath(src.id, meta.title || ''), 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
            res.end(); return true;
          }
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(m === 'HEAD' ? undefined : pageHtml(req, src, payload(src, acc)));
        return true;
      }
      if (!allow('share-file:' + (acc.user || clientIp(req)), 4000, 600e3)) { send(res, 429, { error: 'Too many requests' }); return true; }
      const src = resolve(parts[1]);
      if (!src || !(f === 'manifest.json' || f === 'thumb.png' || STL_RE.test(f))) { send(res, 404, { error: 'not found' }); return true; }
      await serveFile(res, src.dir, f, { noCache: true, sandbox: true });
      return true;
    }
    if (parts[0] === 'api' && parts[1] === 'share' && m === 'GET' && parts[2] && parts.length <= 4) {
      if (limited(req, res, acc, false)) return true;
      const src = resolve(parts[2]);
      if (!src) { miss(req, acc); send(res, 404, { error: 'This design isn’t shared.' }); return true; }
      if (!parts[3]) { send(res, 200, payload(src, acc)); return true; }
      if (parts[3] === 'quote') {
        const op = orderPriceQuery && orderPriceQuery(url, readJSON(path.join(src.dir, 'bom.json'), {}) || {}, src.dir); // order tab: at-cost price for a quantity
        if (op) { send(res, op.error ? 400 : 200, op); return true; }
        const mode = url.searchParams.get('mode') === 'kit' ? 'kit' : 'assembled';
        send(res, 200, quote(readJSON(path.join(src.dir, 'bom.json'), {}) || {}, mode, src.dir)); return true; // prices: dir = print source
      }
      send(res, 404, { error: 'not found' }); return true;
    }
    return false;
  }

  /** /api/projects/<id>/share. server.js has already checked the project exists and acc may edit it (owner or admin). */
  async function api(req, res, { id, dir, m, readBody, onChange }) {
    if (m === 'GET') return send(res, 200, state(id));
    if (m === 'POST') {
      const body = await readBody(req, 1e4);
      const st = setShare(id, dir, { on: !!body.on, access: MODES.includes(body.access) ? body.access : undefined,
        remix: typeof body.remix === 'boolean' ? body.remix : undefined });
      try { onChange?.(st); } catch {}
      return send(res, 200, st);
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  return { handle, api, resolve, remixSource, isShared, state, newShareId, join, roleFor, sharedWith, labelChat, writerTag, publicMeta };
}

module.exports = { init, newShareId, initials, publicCreator, accessOf, MODES };
