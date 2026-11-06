// node --test server/supportchat.test.js   "Message us" threads (server/supportchat.js) on a temp data dir, no server:
// a user only ever sees their own thread, context is admin-only, Josh's replies come back unread, rate limit, images.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const S = require('./supportchat');

const ALICE = 'alice@example.com', BOB = 'bob@example.com', JOSH = 'josh@example.com';
const acc = (user) => ({ authed: !!user, user: user || '', sid: user ? 'gw:' + user : null });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'premake-supportchat-'));
const hits = new Map();
const notes = [];
S.init({
  DATA,
  send: (res, code, obj) => { res.code = code; res.body = obj; },
  allow: (key, limit) => { const n = (hits.get(key) || 0) + 1; hits.set(key, n); return n <= limit; },
  isAdmin: (a) => a.user === JOSH,
  notifyAdmin: (title, text) => notes.push({ title, text }),
});

function req(method, headers = {}, body = null) {
  const r = Readable.from(body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
  r.method = method; r.headers = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', ...headers };
  return r;
}
const readBody = (r) => new Promise((ok, no) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch (e) { no(e); } }); });
async function call(user, method, p, body, headers) {
  const url = new URL('http://x' + p);
  const parts = url.pathname.split('/').filter(Boolean);
  const res = { writeHead(code, h) { this.code = code; this.headers = h; }, end(b) { this.raw = b; } };
  const handled = await S.handle(req(method, headers, body), res, { parts, m: method, acc: acc(user), url, readBody });
  return { handled, ...res };
}

test('signed-out visitors are asked to sign in; other paths are not ours', async () => {
  const r = await call('', 'GET', '/api/supportchat');
  assert.equal(r.code, 401); assert.equal(r.body.code, 'signin');
  assert.equal((await call(ALICE, 'GET', '/api/support/inbox')).handled, false);
});

test('a user writes; context is stored for Josh but never sent back to the user; Josh is notified', async () => {
  const ctx = { design: 'p0p0', kind: 'project', title: 'Desk lamp', url: '/designs/p0p0', page: 'studio', viewport: '390x844' };
  const r = await call(ALICE, 'POST', '/api/supportchat', { text: '  The <b>export</b> button is broken  ', context: ctx });
  assert.equal(r.code, 200);
  assert.equal(r.body.message.text, 'The <b>export</b> button is broken', 'stored as plain text (escaped when drawn)');
  assert.equal(r.body.message.ctx, undefined);
  assert.equal(notes.length, 1); assert.equal(notes[0].title, ALICE);
  const own = await call(ALICE, 'GET', '/api/supportchat');
  assert.equal(own.body.messages.length, 1); assert.equal(own.body.messages[0].ctx, undefined);

  const list = await call(JOSH, 'GET', '/api/supportchat/admin');
  assert.equal(list.body.threads.length, 1); assert.equal(list.body.unread, 1);
  const th = list.body.threads[0];
  assert.equal(th.user, ALICE); assert.equal(th.design, 'Desk lamp');
  const t = await call(JOSH, 'GET', '/api/supportchat/admin/' + th.hash);
  const c = t.body.messages[0].ctx;
  assert.equal(c.design, 'p0p0'); assert.equal(c.url, '/designs/p0p0'); assert.equal(c.device, 'Safari 18.1 · iOS 18.1');
  assert.equal((await call(JOSH, 'GET', '/api/supportchat/admin')).body.unread, 0, 'opening the thread marks it read');
});

test('bad context is dropped, not trusted', () => {
  const c = S.cleanContext({ design: '../../etc', url: '//evil.com/x', viewport: '1x1<script>', page: 'x'.repeat(99) }, { headers: {} });
  assert.equal(c.design, null); assert.equal(c.url, null); assert.equal(c.viewport, null); assert.equal(c.page.length, 40);
});

test('Josh replies: the user gets an unread reply, reading clears it, resolve and reopen', async () => {
  const h = S.hashOf(ALICE);
  const r = await call(JOSH, 'POST', '/api/supportchat/admin/' + h, { text: 'Fixed, try again' });
  assert.equal(r.code, 200);
  assert.equal((await call(ALICE, 'GET', '/api/supportchat/unread')).body.unread, 1);
  const open = await call(ALICE, 'GET', '/api/supportchat?read=1');
  assert.equal(open.body.messages.at(-1).from, 'josh');
  assert.equal((await call(ALICE, 'GET', '/api/supportchat/unread')).body.unread, 0);
  assert.equal((await call(JOSH, 'POST', `/api/supportchat/admin/${h}/resolve`, { resolved: true })).body.resolved, true);
  await call(ALICE, 'POST', '/api/supportchat', { text: 'Still broken' });
  const th = (await call(JOSH, 'GET', '/api/supportchat/admin')).body.threads.find((x) => x.hash === h);
  assert.equal(th.resolved, false, 'a new user message reopens a resolved thread');
});

test('users only see their own thread; admin endpoints 404 for everyone else', async () => {
  const bob = await call(BOB, 'GET', '/api/supportchat');
  assert.deepEqual(bob.body.messages, []);
  assert.equal((await call(BOB, 'GET', '/api/supportchat/admin')).code, 404);
  assert.equal((await call(BOB, 'GET', '/api/supportchat/admin/' + S.hashOf(ALICE))).code, 404);
  assert.equal((await call(BOB, 'POST', '/api/supportchat/admin/' + S.hashOf(ALICE), { text: 'hi' })).code, 404);
  assert.equal((await call(JOSH, 'GET', '/api/supportchat/admin/..%2F..%2Fowners')).code, 404);
});

test('max length, empty messages, rate limit of 30 an hour', async () => {
  const r = await call(BOB, 'POST', '/api/supportchat', { text: 'a'.repeat(5000) });
  assert.equal(r.body.message.text.length, S.MAX_TEXT);
  assert.equal((await call(BOB, 'POST', '/api/supportchat', { text: '   ' })).code, 400);
  let last;
  for (let i = 0; i < S.MSGS_PER_HOUR; i++) last = await call(BOB, 'POST', '/api/supportchat', { text: 'msg ' + i });
  assert.equal(last.code, 429);
});

test('images: only real images, served to the owner and admins only', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  assert.equal((await call(ALICE, 'POST', '/api/supportchat/image', Buffer.from('<svg onload=alert(1)>xxxxxxxxx'), { 'content-type': 'image/png' })).code, 415);
  assert.equal((await call(ALICE, 'POST', '/api/supportchat/image', png, { 'content-type': 'image/svg+xml' })).code, 415);
  const up = await call(ALICE, 'POST', '/api/supportchat/image', png, { 'content-type': 'image/png' });
  assert.equal(up.code, 200);
  const sent = await call(ALICE, 'POST', '/api/supportchat', { text: '', images: [up.body.id] });
  assert.equal(sent.code, 200); assert.equal(sent.body.message.images[0], up.body.url);
  assert.equal((await call(ALICE, 'POST', '/api/supportchat', { text: 'x', images: ['../../owners.json'] })).code, 400);
  assert.equal((await call(ALICE, 'GET', up.body.url)).code, 200);
  assert.equal((await call(JOSH, 'GET', up.body.url)).code, 200);
  assert.equal((await call(BOB, 'GET', up.body.url)).code, 404);
  assert.equal((await call(BOB, 'POST', '/api/supportchat', { text: 'x', images: [up.body.id] })).code, 400, "can't attach someone else's image");
});

test('pulse reports new user messages since a time', async () => {
  const t0 = Date.now() - 1;
  await call(BOB, 'GET', '/api/supportchat'); // no-op
  hits.clear();
  await call(BOB, 'POST', '/api/supportchat', { text: 'New one' });
  const p = await call(JOSH, 'GET', '/api/supportchat/admin/pulse?since=' + t0);
  assert.ok(p.body.fresh.some((x) => x.user === BOB && x.text === 'New one'));
  assert.ok(p.body.unread >= 1);
});

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));
