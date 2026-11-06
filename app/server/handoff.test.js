// node --test server/handoff.test.js   handoff: "Continue on phone" codes.
//   store    create / peek / redeem / expiry / reuse / regenerate / cap (server/handoff.js)
//   gateway  /phone/<code>: confirm page peeks, POST redeems once and sets the session cookie, cross-site POST refused (gateway/handoff.js)
//   mac      POST /api/projects/<id>/handoff, POST /api/handoff/redeem (gateway only), /phone/<code> on 127.0.0.1 (server/server.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createStore, TOKEN_RE } = require('./handoff');
const gwHandoff = require('../gateway/handoff');

// ---------------------------------------------------------------- store
test('store: a code is random, works once, and only for 2 minutes', () => {
  let t = 1_000_000;
  const s = createStore({ now: () => t });
  const a = s.issue({ who: 'a@example.com', kind: 'gw', project: 'p1', sid: 'gw:a@example.com' });
  assert.match(a.token, TOKEN_RE);
  assert.equal(a.expires, t + 120e3);
  assert.deepEqual(s.peek(a.token), { who: 'a@example.com', kind: 'gw', project: 'p1', sid: 'gw:a@example.com', exp: t + 120e3 });
  assert.ok(s.peek(a.token), 'peeking does not use it up');
  const r = s.redeem(a.token);
  assert.equal(r.who, 'a@example.com'); assert.equal(r.project, 'p1');
  assert.equal(s.redeem(a.token), null, 'reuse is refused');
  assert.equal(s.peek(a.token), null);
  const b = s.issue({ who: 'a@example.com', kind: 'gw', project: 'p1', sid: 'gw:a@example.com' });
  t += 119e3; assert.ok(s.peek(b.token), 'still good at 1:59');
  t += 2e3; assert.equal(s.redeem(b.token), null, 'expired at 2:00');
  assert.equal(s.size(), 0);
});

test('store: regenerate replaces the old code; codes are per session and design; junk is refused', () => {
  const s = createStore();
  const one = s.issue({ who: 'a@example.com', kind: 'local', project: 'p1', sid: 'local' });
  const other = s.issue({ who: 'a@example.com', kind: 'local', project: 'p2', sid: 'local' });
  const two = s.issue({ who: 'a@example.com', kind: 'local', project: 'p1', sid: 'local' });
  assert.equal(s.peek(one.token), null, 'the old code for p1 stops working');
  assert.ok(s.peek(two.token)); assert.ok(s.peek(other.token));
  assert.notEqual(one.token, two.token);
  for (const bad of ['', 'x', two.token + 'a', two.token.slice(0, 21) + '!', null, undefined, 42, { toString: () => two.token }]) assert.equal(s.redeem(bad), null, String(bad));
  assert.throws(() => s.issue({ who: 'a@example.com', kind: 'admin', project: 'p1', sid: 's' }), /bad handoff/);
  assert.throws(() => s.issue({ who: '', kind: 'gw', project: 'p1', sid: 's' }), /bad handoff/);
  s.revokeSession('local');
  assert.equal(s.peek(two.token), null);
  const capped = createStore({ max: 2 });
  capped.issue({ who: 'a', kind: 'gw', project: 'p1', sid: 's1' }); capped.issue({ who: 'a', kind: 'gw', project: 'p1', sid: 's2' });
  assert.throws(() => capped.issue({ who: 'a', kind: 'gw', project: 'p1', sid: 's3' }), (e) => e.code === 503);
});

test('store: only a hash of the code is kept', () => {
  const s = createStore();
  const { token } = s.issue({ who: 'a@example.com', kind: 'gw', project: 'p1', sid: 's' });
  const src = fs.readFileSync(path.join(__dirname, 'handoff.js'), 'utf8');
  assert.match(src, /live\.set\(hash\(token\)/);
  assert.ok(!JSON.stringify(s.peek(token)).includes(token));
});

// ---------------------------------------------------------------- gateway
function fakeRes() {
  const r = { status: 0, headers: {}, body: '', writeHead(c, h = {}) { r.status = c; Object.assign(r.headers, h); }, end(b = '') { r.body += b; } };
  return r;
}
function gateway({ macStore, allowed = () => true } = {}) {
  const calls = [];
  const fetch = async (u, o) => {
    const body = JSON.parse(o.body);
    calls.push({ url: String(u), headers: o.headers, body });
    assert.equal(o.headers['x-forma-gateway'], 'sec');
    const r = body.peek ? macStore.peek(body.token) : macStore.redeem(body.token);
    return { status: r ? 200 : 410, json: async () => (r ? { email: r.who, path: '/designs/desk-lamp-' + r.project, title: 'Desk Lamp' } : { error: 'gone' }) };
  };
  const pages = [];
  const g = gwHandoff.init({
    getTarget: () => new URL('https://abc.trycloudflare.com'), secret: 'sec', base: 'https://premake.ai', fetch, clientIp: () => '1.2.3.4',
    rateOk: () => true, emailOk: allowed, safeNext: (p) => (String(p).startsWith('/') && !String(p).startsWith('//') ? p : '/'),
    page: (res, code, title, body) => { pages.push(body); res.writeHead(code, { 'Content-Type': 'text/html' }); res.end(body); },
    esc: (s) => String(s).replace(/[&<>"']/g, ''), log: () => {}, sessionCookie: (e) => `__Host-forma_gw=sealed(${e}); Path=/; HttpOnly; SameSite=Lax; Secure`,
  });
  return { g, calls, pages };
}
const req = (method, headers = {}) => ({ method, headers });
const U = (p) => new URL(p, 'https://premake.ai');

test('gateway: GET shows a confirm page without using the code; POST signs in once and opens the design', async () => {
  const macStore = createStore();
  const { token } = macStore.issue({ who: 'josh@example.com', kind: 'local', project: 'p1', sid: 'local' });
  const { g, calls } = gateway({ macStore });
  assert.equal(await g.handle(req('GET'), fakeRes(), U('/designs/x')), false, 'other paths pass through');
  const page = fakeRes();
  assert.equal(await g.handle(req('GET'), page, U('/phone/' + token)), true);
  assert.equal(page.status, 200); assert.match(page.body, /Continue on this phone/); assert.match(page.body, /josh@example\.com/);
  assert.match(page.body, new RegExp(`action="/phone/${token}"`)); assert.ok(!page.headers['Set-Cookie']);
  assert.ok(macStore.peek(token), 'still unused after GET (link previews can’t burn it)');
  const evil = fakeRes();
  await g.handle(req('POST', { origin: 'https://evil.example' }), evil, U('/phone/' + token));
  assert.equal(evil.status, 403, 'login CSRF: cross-site POST refused');
  const xs = fakeRes();
  await g.handle(req('POST', { 'sec-fetch-site': 'cross-site' }), xs, U('/phone/' + token));
  assert.equal(xs.status, 403);
  assert.ok(macStore.peek(token), 'refused POSTs did not use it');
  const ok = fakeRes();
  await g.handle(req('POST', { origin: 'https://premake.ai', 'sec-fetch-site': 'same-origin' }), ok, U('/phone/' + token));
  assert.equal(ok.status, 303); assert.equal(ok.headers.Location, '/designs/desk-lamp-p1');
  assert.match(ok.headers['Set-Cookie'], /sealed\(josh@example\.com\)/);
  const again = fakeRes();
  await g.handle(req('POST', { origin: 'https://premake.ai' }), again, U('/phone/' + token));
  assert.equal(again.status, 410, 'second use refused'); assert.ok(!again.headers['Set-Cookie']);
  assert.equal(calls.filter((c) => !c.body.peek).length, 2);
  assert.ok(calls.every((c) => c.url === 'https://abc.trycloudflare.com/api/handoff/redeem'));
});

test('gateway: blocked emails, unknown codes and bad paths get no session', async () => {
  const macStore = createStore();
  const { token } = macStore.issue({ who: 'blocked@example.com', kind: 'gw', project: 'p1', sid: 's' });
  const { g } = gateway({ macStore, allowed: (e) => e !== 'blocked@example.com' });
  const r = fakeRes();
  await g.handle(req('POST', { origin: 'https://premake.ai' }), r, U('/phone/' + token));
  assert.equal(r.status, 410); assert.ok(!r.headers['Set-Cookie']);
  const u = fakeRes();
  await g.handle(req('GET'), u, U('/phone/' + 'A'.repeat(22)));
  assert.equal(u.status, 410);
  assert.equal(await g.handle(req('GET'), fakeRes(), U('/phone/short')), false);
  assert.equal(await g.handle(req('GET'), fakeRes(), U('/phone/' + 'A'.repeat(22) + '/x')), false);
});

// ---------------------------------------------------------------- Mac server
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rawReq(port, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const c = []; res.on('data', (d) => c.push(d));
      res.on('end', () => { const text = Buffer.concat(c).toString(); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject); r.end(body);
  });
}
test('Mac server: make a code, redeem it through the gateway once, and on 127.0.0.1', async (t) => {
  const APP = path.join(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'premake-ho-root-'));
  for (const d of ['server', 'web', 'gateway', 'cadlib']) fs.symlinkSync(path.join(APP, d), path.join(root, d));
  const ltok = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(root, '.env.local'), `FORMA_LOCAL_TOKEN=${ltok}\n`);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'premake-ho-data-'));
  const P = 'p1p1p1p1p1', OWNER = 'alice@example.com';
  fs.mkdirSync(path.join(data, 'projects', P), { recursive: true });
  fs.writeFileSync(path.join(data, 'projects', P, 'meta.json'), JSON.stringify({ title: 'Desk Lamp' }));
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify({ [P]: OWNER }));
  const port = 20000 + Math.floor(Math.random() * 20000), gw = crypto.randomBytes(16).toString('hex');
  const srv = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(root, 'server', 'server.js')], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: data, FORMA_GATEWAY_SECRET: gw, FORMA_PARTS_PREBUILD: '0',
      FORMA_ADMIN_EMAILS: 'admin@example.com', FORMA_LOCAL_USER: 'admin@example.com', FORMA_POOL_MAX: '0', FORMA_SANDBOX: '0', CLAUDE_BIN: '/usr/bin/false' },
    stdio: 'ignore' });
  t.after(() => { srv.kill(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch {} await sleep(120); }
  const via = (user, p, o = {}) => rawReq(port, p, { ...o, headers: { 'X-Forma-Gateway': gw, 'X-Forma-User': user, 'X-Forwarded-Host': 'premake.ai', 'Content-Type': 'application/json', ...(o.headers || {}) } });
  const H = { 'X-Forma-Local': ltok };

  // making a code
  assert.equal((await rawReq(port, `/api/projects/${P}/handoff`, { method: 'POST' })).status, 401, 'signed-out local guest');
  assert.equal((await via('', `/api/projects/${P}/handoff`, { method: 'POST' })).status, 401, 'signed out online');
  assert.equal((await via('mallory@example.com', `/api/projects/${P}/handoff`, { method: 'POST' })).status, 404, 'not your design');
  assert.equal((await via(OWNER, `/api/projects/${P}/handoff`)).status, 405);
  const mk = await via(OWNER, `/api/projects/${P}/handoff`, { method: 'POST' });
  assert.equal(mk.status, 200);
  assert.match(mk.json.url, /^https:\/\/premake\.ai\/phone\/[A-Za-z0-9_-]{22}$/);
  assert.ok(mk.json.ttl_s > 100 && mk.json.ttl_s <= 120);
  const code = mk.json.path.split('/').pop();

  // redeeming: gateway secret only
  assert.equal((await rawReq(port, '/api/handoff/redeem', { method: 'POST', body: JSON.stringify({ token: code }) })).status, 404, 'not from a browser on this Mac');
  assert.equal((await rawReq(port, '/api/handoff/redeem', { method: 'POST', headers: { 'X-Forma-Gateway': 'wrong' }, body: JSON.stringify({ token: code }) })).status, 404);
  const peek = await via('', '/api/handoff/redeem', { method: 'POST', body: JSON.stringify({ token: code, peek: true }) });
  assert.equal(peek.status, 200); assert.equal(peek.json.email, OWNER); assert.equal(peek.json.path, `/designs/desk-lamp-${P}`);
  const red = await via('', '/api/handoff/redeem', { method: 'POST', body: JSON.stringify({ token: code }) });
  assert.equal(red.status, 200); assert.equal(red.json.email, OWNER);
  assert.equal((await via('', '/api/handoff/redeem', { method: 'POST', body: JSON.stringify({ token: code }) })).status, 410, 'used once');
  assert.ok(!JSON.stringify(red.json).includes(ltok) && !JSON.stringify(red.json).includes(gw), 'no secrets in the answer');

  // an online user's code can't sign a browser in on 127.0.0.1
  const mk2 = await via(OWNER, `/api/projects/${P}/handoff`, { method: 'POST' });
  const code2 = mk2.json.path.split('/').pop();
  assert.equal((await rawReq(port, '/phone/' + code2)).status, 409);
  assert.equal((await rawReq(port, '/phone/' + code2, { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 410);

  // the local admin: the code maps to FORMA_LOCAL_USER online, and sets the local admin cookie on 127.0.0.1
  const mk3 = await rawReq(port, `/api/projects/${P}/handoff`, { method: 'POST', headers: H });
  assert.equal(mk3.status, 200);
  assert.ok(!mk3.text.includes(ltok));
  const code3 = mk3.json.path.split('/').pop();
  const pg = await rawReq(port, '/phone/' + code3);
  assert.equal(pg.status, 200); assert.match(pg.text, /Continue on this phone/); assert.match(pg.text, /admin@example\.com/); assert.match(pg.text, /Desk Lamp/);
  assert.equal((await rawReq(port, '/phone/' + code3, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const go = await rawReq(port, '/phone/' + code3, { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', Origin: `http://127.0.0.1:${port}` } });
  assert.equal(go.status, 303); assert.equal(go.headers.location, `/designs/desk-lamp-${P}`);
  const ck = [].concat(go.headers['set-cookie']).find((c) => c.startsWith('forma_local='));
  assert.ok(ck); assert.ok(!ck.includes(ltok), 'the cookie is a derived value, not the token');
  assert.equal((await rawReq(port, '/api/auth', { headers: { Cookie: ck.split(';')[0] } })).json.admin, true);
  assert.equal((await rawReq(port, '/phone/' + code3, { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 410, 'used once');
  const mk4 = await rawReq(port, `/api/projects/${P}/handoff`, { method: 'POST', headers: H });
  const r4 = await via('', '/api/handoff/redeem', { method: 'POST', body: JSON.stringify({ token: mk4.json.path.split('/').pop() }) });
  assert.equal(r4.json.email, 'admin@example.com', 'online, the local admin continues as FORMA_LOCAL_USER');

  // rate limit: 10 codes per user per 10 minutes
  let last;
  for (let i = 0; i < 12; i++) last = await via(OWNER, `/api/projects/${P}/handoff`, { method: 'POST' });
  assert.equal(last.status, 429);
});
