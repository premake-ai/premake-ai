// node --test server/share.test.js   share links (Edit | Make a copy) on a real server.js: who may do what in a shared
// design, copy links fork, stopping sharing revokes, a collaborator's runs use their own quota, and no owner email on a
// public page (pen test A5). No AI runs (CLAUDE_BIN is /usr/bin/false); the server runs from a temp app root (symlinks to
// this code), so this checkout's .env.local is never loaded.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { initials, publicCreator, accessOf } = require('./share');

const P = 'p0p0p0p0p0';
const ALICE = 'alice.mitchell@example.com', BOB = 'bob.builder@example.com', CAROL = 'carol@example.com';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'formery-share-root-'));
  for (const d of ['server', 'web', 'gateway']) fs.symlinkSync(path.join(__dirname, '..', d), path.join(root, d));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'formery-share-data-'));
  const dir = path.join(data, 'projects', P);
  fs.mkdirSync(path.join(dir, 'stl'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'design.py'), '# design\n');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: 'Desk Lamp', description: 'A small lamp.', creator: 'you', owner: ALICE }));
  fs.writeFileSync(path.join(dir, 'bom.json'), JSON.stringify({ parts: [{ name: 'M3 screw', qty_per_unit: 2 }] }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Desk Lamp', parts: [{ name: 'Base', file: 'stl/base.stl' }] }));
  fs.writeFileSync(path.join(dir, 'stl', 'base.stl'), 'solid base\nendsolid base\n');
  fs.writeFileSync(path.join(dir, 'site', 'site.json'), JSON.stringify({ published: false }));
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify([{ role: 'user', text: 'make a lamp', t: 1 }, { role: 'assistant', text: 'Done.', t: 2 }]));
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify({ [P]: ALICE }));
  return { root, data, dir };
}
function start(fx) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gw = crypto.randomBytes(16).toString('hex');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: fx.data, FORMA_GATEWAY_SECRET: gw,
    FORMA_PARTS_PREBUILD: '0', CLAUDE_BIN: '/usr/bin/false', FORMA_RUNS_PER_HOUR: '1', FORMA_ADMIN_EMAILS: 'admin@example.com' };
  const srv = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(fx.root, 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  return { port, gw, srv, log: () => log };
}
async function waitUp(port) {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}
/** user: an email via the gateway, '' = signed out via the gateway. */
function req(s, p, { user = ALICE, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${s.port}`, 'X-Forma-Gateway': s.gw, 'X-Forma-User': user };
    if (body) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: s.port, path: p, method, headers: h }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}
async function idle(s, id, user) {
  for (let i = 0; i < 100; i++) {
    const r = await req(s, `/api/projects/${id}`, { user });
    if (r.status === 200 && !r.json.running) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('run did not finish');
}

test('pure helpers', () => {
  assert.equal(initials('josh.mitchell@x.com'), 'J.M.');
  assert.equal(initials('sam@x.com'), 'S.');
  assert.equal(initials('123@x.com'), 'Someone');
  assert.equal(publicCreator('you'), '');
  assert.equal(publicCreator('alice@example.com'), '');
  assert.equal(publicCreator('  Studio  Nine '), 'Studio Nine');
  assert.equal(accessOf({ remix: false }), 'view', 'old links without remix: view only');
  assert.equal(accessOf({ remix: true }), 'copy');
  assert.equal(accessOf({ access: 'edit' }), 'edit');
});

test('share links on a real server', async (t) => {
  const fx = fixture();
  const s = start(fx);
  t.after(() => { s.srv.kill(); fs.rmSync(fx.root, { recursive: true, force: true }); fs.rmSync(fx.data, { recursive: true, force: true }); });
  await waitUp(s.port);
  const as = (user) => (p, o = {}) => req(s, p, { ...o, user });
  const alice = as(ALICE), bob = as(BOB), carol = as(CAROL), anon = as('');
  let sid;

  await t.test('the owner turns sharing on: Edit by default', async () => {
    const g = await alice(`/api/projects/${P}/share`);
    assert.equal(g.status, 200, s.log());
    assert.equal(g.json.on, false); assert.equal(g.json.access, 'edit');
    const r = await alice(`/api/projects/${P}/share`, { method: 'POST', body: { on: true } });
    assert.equal(r.status, 200);
    assert.equal(r.json.on, true); assert.equal(r.json.access, 'edit');
    sid = r.json.id; assert.match(sid, /^[A-Za-z0-9]{12}$/);
    assert.equal((await alice(`/api/projects/${P}`)).json.role, 'owner');
  });

  await t.test('knowing the project id is not enough: only people who opened the link', async () => {
    assert.equal((await bob(`/api/projects/${P}`)).status, 404);
    assert.equal((await bob(`/files/projects/${P}/manifest.json`)).status, 404);
  });

  await t.test('signed out: the public preview, a sign-in prompt, no owner email (A5)', async () => {
    const page = await anon(`/d/${sid}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /og:title/);
    const p = await anon(`/api/share/${sid}`);
    assert.equal(p.status, 200);
    assert.equal(p.json.authed, false); assert.ok(p.json.signin); assert.equal(p.json.access, 'edit');
    assert.equal(p.json.creator, 'A.M.');
    assert.ok(!/alice|mitchell/i.test(p.text), 'no part of the owner email');
    assert.equal((await anon(`/api/projects/${P}`)).status, 404);
  });

  await t.test('an agent-written email as meta.creator is still never shown (A5)', async () => {
    const mp = path.join(fx.dir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
    fs.writeFileSync(mp, JSON.stringify({ ...meta, creator: ALICE }));
    const p = await anon(`/api/share/${sid}`);
    assert.equal(p.json.creator, 'A.M.');
    assert.ok(!/alice|mitchell/i.test(p.text));
    fs.writeFileSync(mp, JSON.stringify(meta));
  });

  await t.test('signed in: opening the link joins it and opens the studio', async () => {
    const r = await bob(`/d/${sid}`);
    assert.equal(r.status, 302);
    assert.match(r.headers.location, new RegExp(`^/designs/[\\w-]*${P}$`));
    assert.equal((await bob(`/d/${sid}?preview=1`)).status, 200, 'preview=1: the page');
    assert.equal((await alice(`/d/${sid}`)).status, 302, 'the owner just opens it');
    const d = await bob(`/api/projects/${P}`);
    assert.equal(d.status, 200);
    assert.equal(d.json.role, 'edit'); assert.equal(d.json.share.id, sid);
    assert.equal(d.json.owner_name, 'A.M.');
    assert.equal(d.json.messages.length, 2, 'edit links see the chat');
    assert.ok(!d.text.includes(ALICE) && !/alice\.mitchell/i.test(d.text), 'no owner email in the studio payload');
    const list = await bob('/api/projects');
    assert.deepEqual(list.json.map((x) => [x.id, x.shared]), [[P, 'edit']]);
    assert.ok(!list.text.includes(ALICE));
    assert.equal((await bob(`/files/projects/${P}/manifest.json`)).status, 200);
    assert.equal((await bob(`/files/projects/${P}/stl/base.stl`)).status, 200);
    assert.equal((await bob(`/api/projects/${P}/versions`)).status, 200);
  });

  await t.test('owner-only, always: settings, delete, publish / launch, website, ads, app, devices, support', async () => {
    const no = [
      ['GET', 'share'], ['POST', 'share'], ['DELETE', ''], ['PATCH', ''], ['POST', 'deploy'], ['GET', 'launch'], ['POST', 'launch'],
      ['GET', 'site/messages'], ['POST', 'site/messages'], ['POST', 'ads/messages'], ['GET', 'app/messages'], ['POST', 'app/messages'],
      ['GET', 'support'], ['POST', 'support'], ['POST', 'site/stop'],
    ];
    for (const [method, c] of no) {
      const r = await bob(`/api/projects/${P}${c ? '/' + c : ''}`, { method, body: method === 'POST' ? { on: false, text: 'hi' } : undefined });
      assert.equal(r.status, 403, `${method} ${c || '(project)'}`);
    }
    assert.equal((await alice(`/api/projects/${P}/share`)).json.on, true, 'sharing still on');
    assert.equal((await bob(`/api/apps/${P}/devices`)).status, 404, 'devices');
    assert.equal((await bob(`/apps/${P}`)).status, 404, 'companion app');
    assert.equal((await bob(`/api/projects/${P}/site`)).status, 403, 'website');
    for (const a of ['site', 'ads']) assert.equal((await bob(`/api/${a}?project=${P}`)).status, 404, `/api/${a}`);
    assert.equal((await bob(`/api/quote?project=${P}`)).status === 404, false, 'the price is fine');
    for (const f of ['meta.json', 'design.py', 'messages.json', 'bom.json', 'site/site.json']) assert.equal((await bob(`/files/projects/${P}/${f}`)).status, 404, f);
    assert.equal((await carol(`/api/projects/${P}`)).status, 404, 'someone who never opened the link');
  });

  await t.test('edit: a collaborator chats on the design, labelled, on their own run quota', async () => {
    const r = await bob(`/api/projects/${P}/messages`, { method: 'POST', body: { text: 'make it taller' } });
    assert.equal(r.status, 202, r.text + s.log());
    await idle(s, P, BOB);
    const mine = (await bob(`/api/projects/${P}`)).json.messages.filter((m) => m.role === 'user');
    assert.deepEqual(mine.map((m) => m.by), ['Owner', 'You']);
    const own = await alice(`/api/projects/${P}`);
    assert.deepEqual(own.json.messages.filter((m) => m.role === 'user').map((m) => m.by), ['You', 'B.B.']);
    assert.ok(!own.text.includes(BOB) && !own.text.includes('by_h'), 'no collaborator email or hash');
    assert.equal(JSON.parse(fs.readFileSync(path.join(fx.dir, 'meta.json'), 'utf8')).title, 'Desk Lamp', 'not renamed');
    // FORMA_RUNS_PER_HOUR=1: Bob's hour is used up, Alice's is not
    const again = await bob(`/api/projects/${P}/messages`, { method: 'POST', body: { text: 'and wider' } });
    assert.equal(again.status, 429, again.text);
    const a = await alice(`/api/projects/${P}/messages`, { method: 'POST', body: { text: 'shorter' } });
    assert.equal(a.status, 202, a.text);
    await idle(s, P, ALICE);
  });

  await t.test('copy: read-only until the first change, which forks into the viewer\'s own designs', async () => {
    const r = await alice(`/api/projects/${P}/share`, { method: 'POST', body: { on: true, access: 'copy' } });
    assert.equal(r.json.access, 'copy'); assert.equal(r.json.id, sid, 'same link');
    const d = await bob(`/api/projects/${P}`);
    assert.equal(d.json.role, 'copy');
    assert.deepEqual(d.json.messages, [], 'no chats on copy links');
    assert.equal(d.json.history, null);
    const w = await bob(`/api/projects/${P}/messages`, { method: 'POST', body: { text: 'make it red' } });
    assert.equal(w.status, 403); assert.equal(w.json.code, 'fork'); assert.equal(w.json.share, sid);
    for (const c of ['undo', 'rewind', 'restore', 'colors', 'uploads']) assert.equal((await bob(`/api/projects/${P}/${c}`, { method: 'POST', body: {} })).status, 403, c);
    const f = await bob('/api/projects', { method: 'POST', body: { fromShare: sid } });
    assert.ok(f.status >= 200 && f.status < 300, f.text);
    const copy = f.json.id; assert.notEqual(copy, P);
    const c = await bob(`/api/projects/${copy}`);
    assert.equal(c.status, 200); assert.equal(c.json.role, 'owner');
    assert.equal(c.json.meta.title, 'Copy of Desk Lamp');
    assert.deepEqual(c.json.messages, [], "the owner's chat is not copied");
    assert.equal((await alice(`/api/projects/${copy}`)).status, 404, 'the copy is Bob\'s alone');
    assert.equal(JSON.parse(fs.readFileSync(path.join(fx.data, 'owners.json'), 'utf8'))[copy], BOB);
    assert.ok(!fs.existsSync(path.join(fx.data, 'projects', copy, 'site')), "the owner's website is not copied");
  });

  await t.test('stop sharing revokes everyone at once; turning it back on does not restore them', async () => {
    const r = await alice(`/api/projects/${P}/share`, { method: 'POST', body: { on: false } });
    assert.equal(r.json.on, false);
    assert.equal((await bob(`/api/projects/${P}`)).status, 404);
    assert.equal((await bob(`/files/projects/${P}/manifest.json`)).status, 404);
    assert.equal((await bob(`/d/${sid}`)).status, 404);
    assert.equal((await anon(`/api/share/${sid}`)).status, 404);
    assert.ok(!(await bob('/api/projects')).json.some((x) => x.id === P));
    assert.equal((await bob('/api/projects', { method: 'POST', body: { fromShare: sid } })).status, 404, 'no copies either');
    await alice(`/api/projects/${P}/share`, { method: 'POST', body: { on: true, access: 'edit' } });
    assert.equal((await bob(`/api/projects/${P}`)).status, 404, 'must open the link again');
    assert.equal((await bob(`/d/${sid}`)).status, 302);
    assert.equal((await bob(`/api/projects/${P}`)).json.role, 'edit');
  });
});
