'use strict';
// social: comments, likes and the recent-designs strip around public designs.
//
// Only real activity is shown. Comments and likes are what signed-in people post (<DATA>/social/comments.json and
// likes.json; emails stay server-side, pages only get a display name). The strip lists designs the owner really finished
// recently (server/showcase.js: title, thumbnail, price, when it was last built), each linking to its example page.
// The old demo community in data/seed/*.json (fictional makers, comments, counts and orders) is no longer read: made-up
// orders and comments must never be presented as real (FTC rule on fake reviews and social proof).
//
// Routes (handle() returns true when it answered):
//   GET    /build/<slug>/comments.json      public wherever the build guide is: counts, like state, threaded comments
//   GET    /api/social/feed                 { recent: [{ slug, title, thumb, price_each, at }], orders: [] }, public
//   POST   /api/social/comments {slug, text, reply_to?}   signed in
//   DELETE /api/social/comments/<id>        the author, the design's owner, or an admin
//   POST   /api/social/like {slug, on}      signed in
// Also cardStats(slug) -> { likes, comments } for gallery cards (/api/examples), and recent() for the landing page.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TEXT_MAX = 1000;
const COLORS = ['#e8590c', '#2b8a3e', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#5f3dc4', '#e67700', '#495057', '#087f5b'];

function init(ctx) {
  const { DATA, PROJECTS, exDir, showcase, cardStats: designStats, vurl, readJSON, writeJSON, send, isAdmin, ownerOf, canEdit, isShared, allow } = ctx;
  const SOC_DIR = path.join(DATA, 'social');
  const COMMENTS = path.join(SOC_DIR, 'comments.json');
  const LIKES = path.join(SOC_DIR, 'likes.json');

  // ---------------------------------------------------------------- real data
  const realComments = () => readJSON(COMMENTS, {}) || {};
  const realLikes = () => readJSON(LIKES, {}) || {};
  const save = (file, v) => { fs.mkdirSync(SOC_DIR, { recursive: true }); writeJSON(file, v); };

  function exampleMeta(slug) { const d = ID_RE.test(slug) && exDir(slug); return d ? readJSON(path.join(d, 'meta.json'), null) : null; }
  /** The design behind a public build page, or null. { slug, project, creator, created, title } */
  function design(acc, slug) {
    if (!ID_RE.test(slug || '')) return null;
    const pm = readJSON(path.join(PROJECTS, slug, 'meta.json'), null);
    if (pm) return canEdit(acc, slug) || isShared(slug) ? { slug, project: true, creator: '', title: pm.title || 'Untitled' } : null;
    const em = exampleMeta(slug);
    return em ? { slug, project: false, creator: em.creator || '', created: em.created, title: em.title || slug } : null;
  }

  const colorOf = (s) => COLORS[crypto.createHash('sha1').update(String(s)).digest()[0] % COLORS.length];
  /** A public display name from an email: "jane.doe42@x.com" -> "Jane D." (security recheck N5: never the email, and
   *  never a full name read out of it; first word + last initial, like store reviews). */
  function nameOf(email) {
    const words = String(email).split('@')[0].replace(/[0-9]+/g, ' ').split(/[._+\-\s]+/).filter(Boolean).slice(0, 2);
    if (!words.length) return 'Maker';
    const first = words[0][0].toUpperCase() + words[0].slice(1, 12).toLowerCase();
    return words[1] ? `${first} ${words[1][0].toUpperCase()}.` : first;
  }
  const initials = (name) => String(name).split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  function realView(c, d, acc) {
    const team = !!c.team;
    const name = team ? 'Premake' : c.user ? nameOf(c.user) : c.name; // N5: older comments stored a fuller name
    return { id: c.id, name, handle: null, initials: team ? 'F' : initials(name), color: team ? '#1c1917' : colorOf(c.user), text: c.text, at: c.at, likes: 0,
      creator: d.project && ownerOf(d.slug) === c.user, team, reply_to: c.reply_to || null,
      mine: !!acc.user && c.user === acc.user, can_delete: mayDelete(acc, c, d) };
  }
  const mayDelete = (acc, c, d) => !!acc.authed && (isAdmin(acc) || (!!acc.user && (c.user === acc.user || (d.project && ownerOf(d.slug) === acc.user))));

  function counts(slug) {
    return { likes: (realLikes()[slug] || []).length, remixes: 0, builds: 0, comments: (realComments()[slug] || []).length };
  }
  /** Gallery cards: { likes, comments }, or {} when there is nothing to show. */
  function cardStats(slug) {
    const c = counts(slug);
    return c.likes || c.comments ? { likes: c.likes, comments: c.comments } : {};
  }

  function thread(acc, d) {
    const list = (realComments()[d.slug] || []).map((c) => realView(c, d, acc));
    list.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const byId = new Map(list.map((c) => [c.id, { ...c, replies: [] }]));
    const top = [];
    for (const c of byId.values()) { const p = c.reply_to && byId.get(c.reply_to); if (p) p.replies.push(c); else top.push(c); }
    top.reverse(); // newest conversations first, replies oldest first under each
    return top;
  }

  function payload(acc, d) {
    const c = counts(d.slug);
    const me = acc.authed && acc.user ? (isAdmin(acc) ? { name: 'Premake', initials: 'F', color: '#1c1917' } : { name: nameOf(acc.user), initials: initials(nameOf(acc.user)), color: colorOf(acc.user) }) : null;
    return { slug: d.slug, likes: c.likes, liked: !!acc.user && (realLikes()[d.slug] || []).includes(acc.user), remixes: c.remixes, builds: c.builds,
      count: c.comments, comments: thread(acc, d), can_post: !!acc.authed && !!acc.user, me };
  }

  /** Designs really finished lately, newest first: [{ slug, title, thumb, price_each, at }] (at = when it was last built). */
  function recent(limit = 24) {
    const out = [];
    for (const slug of showcase ? showcase.slugs() : []) {
      const dir = exDir(slug), at = showcase.builtAt(slug);
      const meta = dir && readJSON(path.join(dir, 'meta.json'), null);
      const thumb = dir && vurl(dir, 'thumb.png', `/files/examples/${slug}/thumb.png`);
      if (!meta || !at || !thumb) continue;
      const price = designStats(dir).price_each;
      out.push({ slug, title: String(meta.title || slug).slice(0, 120), thumb, price_each: price > 0 ? price : null, at });
      if (out.length >= limit) break;
    }
    return out;
  }

  function cleanText(v) {
    return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXT_MAX) : '';
  }

  // ---------------------------------------------------------------- routing
  async function handle(req, res, { parts, m, acc, readBody }) {
    if (parts[0] === 'build' && parts[2] === 'comments.json' && parts.length === 3) {
      if (m !== 'GET' && m !== 'HEAD') return false;
      const d = design(acc, parts[1]);
      if (!d) { send(res, 404, { error: 'not found' }); return true; }
      send(res, 200, payload(acc, d)); return true;
    }
    if (parts[0] !== 'api' || parts[1] !== 'social') return false;
    const what = parts[2];
    // orders stays [] so an older gateway (which read made-up orders here) shows no strip rather than a broken one
    if (what === 'feed' && !parts[3] && m === 'GET') { send(res, 200, { recent: recent(30), orders: [] }); return true; }
    if (m === 'GET' || m === 'HEAD') { send(res, 404, { error: 'not found' }); return true; }
    if (!acc.authed || !acc.user) { send(res, 401, { error: 'Sign in to join the conversation.', code: 'signin' }); return true; }

    if (what === 'comments' && !parts[3] && m === 'POST') {
      const body = await readBody(req, 2e4);
      const d = design(acc, body.slug);
      if (!d) { send(res, 404, { error: 'not found' }); return true; }
      const text = cleanText(body.text);
      if (!text) { send(res, 400, { error: 'Write something first.' }); return true; }
      if (!isAdmin(acc) && (!allow('comment:' + acc.user, 10, 600e3) || !allow('comment-day:' + acc.user, 60, 86400e3))) { send(res, 429, { error: 'That’s a lot of comments. Try again in a few minutes.' }); return true; }
      const all = realComments();
      const list = all[d.slug] || [];
      let reply = null;
      if (body.reply_to) {
        const id = String(body.reply_to);
        const parent = list.find((c) => c.id === id);
        if (!parent) { send(res, 400, { error: 'That comment is gone.' }); return true; }
        reply = parent.reply_to || parent.id; // one level of replies
      }
      const c = { id: 'c' + crypto.randomBytes(6).toString('hex'), slug: d.slug, user: acc.user, name: nameOf(acc.user), ...(isAdmin(acc) ? { team: true } : {}),
        text, at: new Date().toISOString(), ...(reply ? { reply_to: reply } : {}) };
      all[d.slug] = [...list, c].slice(-500);
      save(COMMENTS, all);
      send(res, 201, { comment: { ...realView(c, d, acc), replies: [] }, count: counts(d.slug).comments }); return true;
    }
    if (what === 'comments' && parts[3] && !parts[4] && m === 'DELETE') {
      const all = realComments();
      for (const [slug, list] of Object.entries(all)) {
        const c = list.find((x) => x.id === parts[3]);
        if (!c) continue;
        const d = design(acc, slug) || { slug, project: !!readJSON(path.join(PROJECTS, slug, 'meta.json'), null) };
        if (!mayDelete(acc, c, d)) { send(res, 403, { error: 'Only the author or the design’s owner can delete this.' }); return true; }
        // deleting a comment takes its replies with it
        all[slug] = list.filter((x) => x.id !== c.id && x.reply_to !== c.id);
        if (!all[slug].length) delete all[slug];
        save(COMMENTS, all);
        send(res, 200, { ok: true, count: counts(slug).comments }); return true;
      }
      send(res, 404, { error: 'comment not found' }); return true;
    }
    if (what === 'like' && !parts[3] && m === 'POST') {
      const body = await readBody(req, 1e4);
      const d = design(acc, body.slug);
      if (!d) { send(res, 404, { error: 'not found' }); return true; }
      if (!allow('like:' + acc.user, 120, 600e3)) { send(res, 429, { error: 'Slow down a little.' }); return true; }
      const all = realLikes();
      const set = new Set(all[d.slug] || []);
      if (body.on === false) set.delete(acc.user); else set.add(acc.user);
      if (set.size) all[d.slug] = [...set]; else delete all[d.slug];
      save(LIKES, all);
      send(res, 200, { liked: set.has(acc.user), likes: counts(d.slug).likes }); return true;
    }
    send(res, 404, { error: 'no such endpoint' }); return true;
  }

  return { handle, cardStats, recent, counts };
}

module.exports = { init };
