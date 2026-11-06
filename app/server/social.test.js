// node --test server/social.test.js   (temp dirs; no server)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const social = require('./social');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-'));
  const APP = path.join(root, 'app'), DATA = path.join(root, 'data');
  const EXAMPLES = path.join(DATA, 'examples'), PROJECTS = path.join(DATA, 'projects'), SHOW = path.join(DATA, 'showcase');
  for (const d of [path.join(APP, 'data', 'seed'), EXAMPLES, PROJECTS, SHOW]) fs.mkdirSync(d, { recursive: true });
  const ex = (slug, m) => { fs.mkdirSync(path.join(EXAMPLES, slug)); fs.writeFileSync(path.join(EXAMPLES, slug, 'meta.json'), JSON.stringify(m)); };
  ex('twist-planter', { title: 'Twist planter', creator: 'Premake', created: '2026-10-01T00:00:00Z' });
  // a made-up community in data/seed must never show up anywhere
  const w = (f, v) => fs.writeFileSync(path.join(APP, 'data', 'seed', f), JSON.stringify(v));
  w('designs.json', [{ seed: true, slug: 'twist-planter', likes: 100, remixes: 9, builds: 20 }]);
  w('comments.json', [{ seed: true, id: 's1', slug: 'twist-planter', handle: '@nora', text: 'Is it watertight?', at: '2026-10-05T00:00:00Z' }]);
  w('orders.json', [{ seed: true, id: 'o1', name: 'Sam', city: 'Austin', slug: 'twist-planter', qty: 1, ago_min: 3 }]);
  // two published owner designs (server/showcase.js snapshots)
  const show = { 'desk-robot': { at: Date.now() - 8 * 60e3, price: 136.2 }, 'old-hook': { at: Date.now() - 3 * 3600e3, price: 0 } };
  for (const [slug] of Object.entries(show)) {
    fs.mkdirSync(path.join(SHOW, slug));
    fs.writeFileSync(path.join(SHOW, slug, 'meta.json'), JSON.stringify({ title: slug === 'desk-robot' ? 'Phone-Face Desk Robot' : 'Old hook' }));
    fs.writeFileSync(path.join(SHOW, slug, 'thumb.png'), 'png');
  }
  const showcase = { slugs: () => Object.keys(show).sort((a, b) => show[b].at - show[a].at), builtAt: (s) => (show[s] ? new Date(show[s].at).toISOString() : null) };
  const exDir = (slug) => { const e = path.join(EXAMPLES, slug); if (fs.existsSync(path.join(e, 'meta.json'))) return e; return show[slug] ? path.join(SHOW, slug) : e; };
  const owners = {}, sharedSet = new Set();
  const proj = (id, owner, shared) => { fs.mkdirSync(path.join(PROJECTS, id)); fs.writeFileSync(path.join(PROJECTS, id, 'meta.json'), JSON.stringify({ title: id })); owners[id] = owner; if (shared) sharedSet.add(id); };
  proj('pub1', 'owner@x.com', true);
  proj('priv1', 'owner@x.com', false);
  const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v));
  const send = (res, code, body) => { res.code = code; res.body = body; };
  const admins = new Set(['josh@x.com']);
  const s = social.init({ APP, DATA, PROJECTS, exDir, showcase, cardStats: (dir) => ({ price_each: show[path.basename(dir)]?.price ?? null }),
    vurl: (dir, rel, url) => url + '?v=1', readJSON, writeJSON, send, isAdmin: (acc) => admins.has(acc.user), ownerOf: (id) => owners[id] || null,
    canEdit: (acc, id) => !!acc.user && owners[id] === acc.user, isShared: (id) => sharedSet.has(id), allow: () => true });
  const call = async (m, url, user, body) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    const res = {};
    const readBody = async () => body || {};
    const acc = user ? { authed: true, user } : { authed: false, user: null };
    const handled = await s.handle(req, res, { parts: url.split('/').filter(Boolean), m, acc, readBody });
    return { handled, ...res };
  };
  return { s, call, DATA };
}

test('no made-up activity: seed counts, comments and orders are never shown', async () => {
  const { s, call } = setup();
  assert.deepEqual(s.cardStats('twist-planter'), {});
  const r = await call('GET', '/build/twist-planter/comments.json', null);
  assert.equal(r.code, 200);
  assert.equal(r.body.count, 0);
  assert.equal(r.body.likes, 0);
  assert.equal(r.body.remixes, 0);
  assert.equal(r.body.builds, 0);
  assert.deepEqual(r.body.comments, []);
  assert.ok(!('sample' in r.body));
  const f = await call('GET', '/api/social/feed', null);
  assert.deepEqual(f.body.orders, [], 'no orders feed (an older gateway reads this key)');
});

test('the feed lists designs really finished lately: title, thumbnail, price, when', async () => {
  const { s, call } = setup();
  const f = (await call('GET', '/api/social/feed', null)).body.recent;
  assert.deepEqual(f.map((o) => o.slug), ['desk-robot', 'old-hook'], 'newest first');
  assert.equal(f[0].title, 'Phone-Face Desk Robot');
  assert.equal(f[0].price_each, 136.2);
  assert.equal(f[1].price_each, null);
  assert.equal(f[0].thumb, '/files/examples/desk-robot/thumb.png?v=1');
  assert.ok(Date.now() - Date.parse(f[0].at) < 9 * 60e3);
  assert.deepEqual(Object.keys(f[0]).sort(), ['at', 'price_each', 'slug', 'thumb', 'title'], 'nothing private');
  assert.equal(s.recent(1).length, 1);
});

test('posting, replies, likes and deleting: author, owner, admin only', async () => {
  const { s, call } = setup();
  assert.equal((await call('POST', '/api/social/comments', null, { slug: 'twist-planter', text: 'hi' })).code, 401);
  assert.equal((await call('POST', '/api/social/comments', 'a@x.com', { slug: 'twist-planter', text: '   ' })).code, 400);
  assert.equal((await call('POST', '/api/social/comments', 'a@x.com', { slug: 'twist-planter', text: 'x', reply_to: 's1' })).code, 400, 'seed comments are gone');
  const top = await call('POST', '/api/social/comments', 'a@x.com', { slug: 'twist-planter', text: 'Is it watertight?' });
  assert.equal(top.code, 201);
  const p = await call('POST', '/api/social/comments', 'jane.doe42@x.com', { slug: 'twist-planter', text: 'Printed it in PETG', reply_to: top.body.comment.id });
  assert.equal(p.code, 201);
  assert.equal(p.body.comment.name, 'Jane D.'); // N5: no full name from the email
  assert.ok(!JSON.stringify(p.body).includes('@x.com'), 'never leaks an email');
  const r = await call('GET', '/build/twist-planter/comments.json', 'jane.doe42@x.com');
  const reply = r.body.comments[0].replies.find((c) => c.id === p.body.comment.id);
  assert.ok(reply, 'a reply lands under the top comment');
  assert.equal(reply.can_delete, true);
  assert.equal((await call('DELETE', `/api/social/comments/${p.body.comment.id}`, 'b@x.com')).code, 403);
  assert.equal((await call('DELETE', `/api/social/comments/${p.body.comment.id}`, 'josh@x.com')).code, 200, 'admin can delete');

  // comments work on published owner designs too
  assert.equal((await call('POST', '/api/social/comments', 'a@x.com', { slug: 'desk-robot', text: 'Love the face' })).code, 201);

  // project owner can delete someone else's comment on their shared design
  const q = await call('POST', '/api/social/comments', 'c@x.com', { slug: 'pub1', text: 'How long did it print?' });
  assert.equal(q.code, 201);
  assert.equal((await call('DELETE', `/api/social/comments/${q.body.comment.id}`, 'owner@x.com')).code, 200);

  const l = await call('POST', '/api/social/like', 'a@x.com', { slug: 'twist-planter', on: true });
  assert.deepEqual(l.body, { liked: true, likes: 1 });
  assert.equal((await call('POST', '/api/social/like', 'a@x.com', { slug: 'twist-planter', on: false })).body.likes, 0);
  assert.equal(s.counts('twist-planter').comments, 1);
  assert.deepEqual(s.cardStats('twist-planter'), { likes: 0, comments: 1 });
});

test('private projects are invisible: no thread, no posting, no likes', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/build/priv1/comments.json', 'b@x.com')).code, 404);
  assert.equal((await call('POST', '/api/social/comments', 'b@x.com', { slug: 'priv1', text: 'x' })).code, 404);
  assert.equal((await call('POST', '/api/social/like', 'b@x.com', { slug: 'priv1' })).code, 404);
  assert.equal((await call('GET', '/build/priv1/comments.json', 'owner@x.com')).code, 200, 'the owner sees it');
  assert.equal((await call('GET', '/build/../comments.json', null)).code, 404);
  assert.equal((await call('GET', '/build/twist-planter', null)).handled, false, 'the guide page itself is left to guide.js');
});
