// node --test server/apps.test.js   companion apps: serving and isolation of /apps/* on a real server.js, plus the pure
// pieces (bridge validation, demo data, QR encoder, inlining, icons). No AI runs, no real secrets: the server runs from a
// temp app root (symlinks to this code), so this checkout's .env.local is never loaded.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const B = require('../web/apps/bridge.js');
const Demo = require('../web/apps/demo.js');
const QR = require('../web/apps/qr.js');
const apps = require('./apps');

// The contract's header, written out here on purpose: the server must send exactly this.
const UI_CSP = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'";
const A = 'a0a0a0a0a0', BID = 'b0b0b0b0b0', C = 'c0c0c0c0c0', D = 'd0d0d0d0d0';
const ALICE = 'alice@example.com', BOB = 'bob@example.com';

// ---------------------------------------------------------------- fixture: projects on disk + a real server
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buildery-apps-root-'));
  for (const d of ['server', 'web', 'gateway']) fs.symlinkSync(path.join(__dirname, '..', d), path.join(root, d));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'buildery-apps-data-'));
  const P = path.join(data, 'projects');
  const mk = (id, title, bom) => {
    fs.mkdirSync(path.join(P, id), { recursive: true });
    fs.writeFileSync(path.join(P, id, 'meta.json'), JSON.stringify({ title, owner: id === C ? BOB : ALICE }));
    fs.writeFileSync(path.join(P, id, 'bom.json'), JSON.stringify(bom || { parts: [] }));
  };
  mk(A, 'Plant Sensor', { parts: [{ name: 'ESP32-C3 SuperMini', qty_per_unit: 1 }] });
  mk(BID, 'Linked app');
  mk(C, 'Bob sensor', { parts: [{ name: 'BME280 temp/humidity module', qty_per_unit: 1 }] });
  mk(D, 'Pen holder', { parts: [{ name: 'M3 screw', qty_per_unit: 4 }] });
  const app = path.join(P, A, 'app');
  fs.mkdirSync(path.join(app, 'img'), { recursive: true });
  fs.writeFileSync(path.join(app, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<script src="/apps/sdk.js"></script><link rel="stylesheet" href="style.css"><script src="app.js" defer></script></head>
<body><main id="m">Hello</main><img src="img/dot.png" alt=""></body></html>`);
  fs.writeFileSync(path.join(app, 'app.js'), "document.getElementById('m').textContent = 'Hi </script> $& ' + typeof buildery;");
  fs.writeFileSync(path.join(app, 'style.css'), 'body { background: url(img/dot.png); }');
  fs.writeFileSync(path.join(app, 'img', 'dot.png'), Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'));
  fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify({ name: 'Plant Sensor', short_name: 'Plants', theme: '#2f7d4f', icon: 'icon.svg', fields: { moisture: { label: 'Soil moisture', unit: '%' } } }));
  fs.writeFileSync(path.join(app, 'profiles.json'), JSON.stringify({ monstera: { name: 'Monstera', moisture_min: 30 } }));
  fs.writeFileSync(path.join(app, 'alerts.json'), JSON.stringify({ rules: [{ id: 'thirsty', field: 'moisture', below: 'profile.moisture_min', severity: 'high', message: '{name} needs a drink' }] }));
  fs.writeFileSync(path.join(app, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>');
  for (const f of ['notes.md', 'data.txt', 'run.sh', '.hidden.js', 'page.php']) fs.writeFileSync(path.join(app, f), 'nope');
  // links out of the app folder (none of these may ever be served)
  const secret = path.join(data, 'secret'); fs.mkdirSync(secret); fs.writeFileSync(path.join(secret, 'x.js'), 'SECRET');
  fs.symlinkSync(path.join(P, A, 'meta.json'), path.join(app, 'link.json'));
  fs.symlinkSync(secret, path.join(app, 'sub'));
  fs.symlinkSync(app, path.join(P, BID, 'app')); // a whole app/ that is a link
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify({ [A]: ALICE, [BID]: ALICE, [C]: BOB, [D]: ALICE }));
  // app-preview: a repo example with an app (public at /apps/ex/<slug>, demo data) and one without
  const ex = path.join(root, 'examples');
  fs.mkdirSync(path.join(ex, 'flag-counter', 'app'), { recursive: true });
  fs.writeFileSync(path.join(ex, 'flag-counter', 'meta.json'), JSON.stringify({ title: 'Flag counter' }));
  fs.writeFileSync(path.join(ex, 'flag-counter', 'app', 'index.html'), '<!doctype html><script src="/apps/sdk.js"></script><script src="app.js"></script><p>Flag</p>');
  fs.writeFileSync(path.join(ex, 'flag-counter', 'app', 'app.js'), 'window.x = 1;');
  fs.writeFileSync(path.join(ex, 'flag-counter', 'app', 'app.json'), JSON.stringify({ name: 'Flag', controls: { angle: { type: 'range', min: 0, max: 180 } } }));
  fs.mkdirSync(path.join(ex, 'no-app'), { recursive: true });
  fs.writeFileSync(path.join(ex, 'no-app', 'meta.json'), JSON.stringify({ title: 'No app' }));
  return { root, data, app };
}
function start(fx) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gw = crypto.randomBytes(16).toString('hex');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: fx.data, FORMA_GATEWAY_SECRET: gw,
    FORMA_PARTS_PREBUILD: '0', CLAUDE_BIN: '/usr/bin/false', FORMA_ADMIN_EMAILS: 'owner@example.com' };
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
/** Raw GET (the path goes out exactly as written: no client-side ../ clean-up). user: an email via the gateway, '' = signed
 *  out via the gateway, null = this Mac's own loopback (admin). */
function req(port, gw, p, { user = ALICE, method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    if (user !== null) { h['X-Forma-Gateway'] = gw; h['X-Forma-User'] = user; }
    if (body) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

test('serving and isolation of /apps on a real server', async (t) => {
  const fx = fixture();
  const s = start(fx);
  t.after(() => { s.srv.kill(); fs.rmSync(fx.root, { recursive: true, force: true }); fs.rmSync(fx.data, { recursive: true, force: true }); });
  await waitUp(s.port);
  const get = (p, o) => req(s.port, s.gw, p, o);

  await t.test('the shell: owner (or admin) only, 404 for anyone else', async () => {
    const r = await get(`/apps/${A}`);
    assert.equal(r.status, 200, s.log());
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.headers['content-security-policy'], /default-src 'none'; script-src 'self';.*frame-ancestors 'self'/);
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(r.headers['cache-control'], 'no-store');
    const html = r.body.toString();
    assert.ok(html.includes(`<iframe id="bxApp" class="bx-frame" sandbox="allow-scripts allow-forms" src="/apps/${A}/ui/index.html"`), 'the contract iframe');
    assert.ok(!/allow-same-origin|allow-top-navigation|allow-popups/.test(html), 'no sandbox escapes');
    assert.ok(html.includes('crossorigin="use-credentials"'), 'manifest fetched with the session');
    const cfg = JSON.parse(/<script type="application\/json" id="bxcfg">([^<]*)<\/script>/.exec(html)[1]);
    assert.equal(cfg.preview, false); assert.equal(cfg.exists, true); assert.equal(cfg.name, 'Plant Sensor'); assert.deepEqual(cfg.profile_keys, ['monstera']);
    assert.deepEqual(cfg.alerts, ['Needs a drink']);
    assert.equal(JSON.parse(/id="bxcfg">([^<]*)</.exec((await get(`/apps/${A}?preview=1`)).body.toString())[1]).preview, true);
    for (const [who, label] of [[BOB, 'another user'], ['', 'signed out']]) assert.equal((await get(`/apps/${A}`, { user: who })).status, 404, label);
    assert.equal((await get(`/apps/${A}?preview=1`, { user: BOB })).status, 404, 'preview too');
    assert.equal((await get('/apps/ffffffffff')).status, 404, 'no such project');
    assert.equal((await get(`/apps/${C}`, { user: BOB })).status, 200, "bob's own project");
    assert.equal((await get(`/apps/${C}`, { user: 'owner@example.com' })).status, 200, 'an admin');
    assert.equal((await get(`/apps/${A}`, { method: 'POST' })).status, 405);
    assert.equal((await get(`/apps/${A}/`)).status, 301);
    const none = JSON.parse(/id="bxcfg">([^<]*)</.exec((await get(`/apps/${D}`)).body.toString())[1]);
    assert.equal(none.exists, false, 'a project without an app still gets the shell, with "not built yet"');
  });

  await t.test('generated files: exactly the contract CSP, nosniff, owner only, the page inlined', async () => {
    const r = await get(`/apps/${A}/ui/index.html`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-security-policy'], UI_CSP);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], undefined, 'XFO would block the sandboxed frame');
    const html = r.body.toString();
    assert.ok(html.includes('window.buildery = {'), 'the SDK is inline');
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no script is fetched by the sandboxed page');
    assert.ok(!/<link[^>]*stylesheet/i.test(html), 'no stylesheet is fetched');
    assert.ok(html.includes("'Hi <\\/script> $& '"), 'app code inline, </script> escaped, $& untouched');
    assert.ok(html.indexOf("getElementById('m')") > html.indexOf('<main'), 'a deferred script runs after the body');
    assert.ok(html.includes('url("data:image/png;base64,') && html.includes('<img src="data:image/png;base64,'), 'images inline');
    for (const who of [BOB, '']) assert.equal((await get(`/apps/${A}/ui/index.html`, { user: who })).status, 404);
    const js = await get(`/apps/${A}/ui/app.js`);
    assert.equal(js.status, 200); assert.match(js.headers['content-type'], /^text\/javascript/); assert.equal(js.headers['content-security-policy'], UI_CSP);
    assert.equal((await get(`/apps/${A}/ui/app.json`)).status, 200);
    assert.equal((await get(`/apps/${A}/ui/img/dot.png`)).headers['content-type'], 'image/png');
  });

  await t.test('traversal, dot files and odd paths are refused', async () => {
    for (const p of ['/ui/../meta.json', '/ui/%2e%2e/meta.json', '/ui/..%2fmeta.json', '/ui/..%2Fmeta.json', '/ui/img/../../meta.json', '/ui/%2e%2e%2f%2e%2e%2fowners.json',
      '/ui/.hidden.js', '/ui/img/%2e%2e/%2e%2e/bom.json', '/ui/index.html%00.js', '/ui/', '/ui', '/ui/%5c..%5cmeta.json', '/ui/img%2f..%2f..%2fmeta.json']) {
      const r = await get(`/apps/${A}${p}`);
      assert.ok(r.status === 404 || r.status === 400 || r.status === 301, `${p}: ${r.status}`);
      assert.ok(!r.body.toString().includes('"owner"'), `${p} leaked meta.json`);
    }
  });

  await t.test('symlinks are never followed', async () => {
    assert.equal((await get(`/apps/${A}/ui/link.json`)).status, 404, 'a file link');
    assert.equal((await get(`/apps/${A}/ui/sub/x.js`)).status, 404, 'a folder link');
    assert.equal((await get(`/apps/${BID}/ui/index.html`)).status, 404, 'app/ itself a link');
    assert.equal((await get(`/apps/${BID}/ui/app.js`)).status, 404);
  });

  await t.test('only whitelisted types; SVG only as an image', async () => {
    for (const f of ['notes.md', 'data.txt', 'run.sh', 'page.php']) assert.equal((await get(`/apps/${A}/ui/${f}`)).status, 404, f);
    assert.equal((await get(`/apps/${A}/ui/icon.svg`, { headers: { 'Sec-Fetch-Dest': 'document' } })).status, 404);
    assert.equal((await get(`/apps/${A}/ui/icon.svg`, { headers: { 'Sec-Fetch-Dest': 'iframe' } })).status, 404);
    const img = await get(`/apps/${A}/ui/icon.svg`, { headers: { 'Sec-Fetch-Dest': 'image' } });
    assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/svg+xml'); assert.equal(img.headers['content-security-policy'], UI_CSP);
  });

  await t.test('manifest, icons, SDK and service worker', async () => {
    const m = await get(`/apps/${A}/manifest.webmanifest`);
    assert.equal(m.status, 200); assert.match(m.headers['content-type'], /manifest\+json/);
    const j = JSON.parse(m.body);
    assert.equal(j.start_url, `/apps/${A}`); assert.equal(j.display, 'standalone'); assert.equal(j.short_name, 'Plants');
    assert.ok(j.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    assert.equal((await get(`/apps/${A}/manifest.webmanifest`, { user: BOB })).status, 404);
    const ic = await get(`/apps/${A}/icon-192.png`);
    assert.equal(ic.status, 200); assert.equal(ic.headers['content-type'], 'image/png');
    assert.equal(ic.body.readUInt32BE(16), 192); assert.equal(ic.body.readUInt32BE(20), 192);
    assert.equal((await get(`/apps/${A}/icon-64.png`)).status, 404, 'only the listed sizes');
    const sdk = await get('/apps/sdk.js');
    assert.equal(sdk.status, 200); assert.ok(sdk.body.toString().includes('window.buildery'));
    const sw = await get('/apps/sw.js');
    assert.equal(sw.status, 200); assert.equal(sw.headers['service-worker-allowed'], '/apps/');
    assert.ok(/notificationclick/.test(sw.body) && /showNotification/.test(sw.body));
    for (const f of ['shell.js', 'shell.css', 'bridge.js', 'demo.js', 'qr.js']) assert.equal((await get(`/apps/${f}`)).status, 200, f);
    assert.equal((await get('/apps/server.js')).status, 404);
    assert.equal((await get('/apps/..%2fserver%2fserver.js')).status, 404);
  });

  await t.test('studio: App tab info and the app chat API are owner only', async () => {
    const pa = JSON.parse((await get(`/api/projects/${A}`)).body);
    assert.deepEqual([pa.app.show, pa.app.exists, pa.app.electronics, pa.app_running], [true, true, true, false]);
    const pc = JSON.parse((await get(`/api/projects/${C}`, { user: BOB })).body);
    assert.deepEqual([pc.app.show, pc.app.exists], [true, false], 'a sensor in the bom shows the tab');
    const pd = JSON.parse((await get(`/api/projects/${D}`)).body);
    assert.equal(pd.app.show, false, 'no electronics, no app: no tab');
    const msgs = await get(`/api/projects/${A}/app/messages`);
    assert.equal(msgs.status, 200); assert.deepEqual(JSON.parse(msgs.body).messages, []);
    assert.equal((await get(`/api/projects/${A}/app/messages`, { user: BOB })).status, 404);
    assert.equal((await get(`/api/projects/${A}/app/messages`, { user: BOB, method: 'POST', body: { text: 'hi' } })).status, 404);
    assert.equal((await get(`/api/projects/${A}/app/stop`, { user: BOB, method: 'POST', body: {} })).status, 404);
    assert.equal((await get(`/api/projects/${A}/versions?kind=app`)).status, 200);
  });

  await t.test('app-preview: phone preview links are owner-made, demo only, expire and can be turned off', async () => {
    const link = (method, o = {}) => get(`/api/apps/${A}/link`, { method, ...o });
    assert.deepEqual(JSON.parse((await link('GET')).body), { link: null });
    for (const who of [BOB, '']) for (const m of ['GET', 'POST', 'DELETE']) {
      const st = (await link(m, { user: who })).status;
      assert.ok(st === 404 || (!who && st === 401), `${m} ${who || 'signed out'}: ${st}`);
    }
    assert.equal((await get(`/api/apps/${D}/link`, { method: 'POST' })).status, 409, 'no app yet: no link');
    const made = JSON.parse((await link('POST')).body).link;
    assert.match(made.token, /^[A-Za-z0-9]{22}$/);
    assert.equal(made.url, `/apps/t/${made.token}`);
    const hours = (Date.parse(made.expires) - Date.parse(made.created)) / 3600e3;
    assert.equal(hours, 24);
    assert.equal(JSON.parse((await link('GET')).body).link.token, made.token, 'the owner sees the same link again');
    // anyone with the link (signed out here) gets the shell, always the demo, with the app's files under the token
    const shell = await get(made.url, { user: '' });
    assert.equal(shell.status, 200);
    assert.equal(shell.headers['referrer-policy'], 'no-referrer');
    const html = shell.body.toString();
    const cfg = JSON.parse(/id="bxcfg">([^<]*)</.exec(html)[1]);
    assert.deepEqual([cfg.preview, cfg.kind, cfg.at, cfg.studio], [true, 'link', made.url, null]);
    assert.ok(html.includes(`src="${made.url}/ui/index.html"`) && html.includes('/apps/demo.js'), 'demo shell, app under the token');
    assert.ok(!html.includes('use-credentials'));
    assert.equal(JSON.parse(/id="bxcfg">([^<]*)</.exec((await get(made.url + '?preview=0', { user: '' })).body.toString())[1]).preview, true, 'no way out of the demo');
    const ui = await get(`${made.url}/ui/index.html`, { user: '' });
    assert.equal(ui.status, 200); assert.equal(ui.headers['content-security-policy'], UI_CSP);
    assert.ok(ui.body.toString().includes('window.buildery = {'));
    assert.equal((await get(`${made.url}/manifest.webmanifest`, { user: '' })).status, 200);
    assert.equal(JSON.parse((await get(`${made.url}/manifest.webmanifest`, { user: '' })).body).start_url, made.url);
    assert.equal((await get(`${made.url}/icon-192.png`, { user: '' })).status, 200);
    // nothing else of the project through the link
    for (const p of ['/ui/../meta.json', '/ui/%2e%2e/meta.json', '/ui/notes.md', '/ui/link.json', '/meta.json', '/messages.json']) assert.equal((await get(made.url + p, { user: '' })).status, 404, p);
    assert.equal((await get(`/api/devices`, { user: '' })).status, 404);
    // a new link replaces the old one; turning it off ends it; unknown tokens 404
    const again = JSON.parse((await link('POST')).body).link;
    assert.notEqual(again.token, made.token);
    assert.equal((await get(made.url, { user: '' })).status, 404, 'the old link stopped working');
    assert.equal((await get(again.url, { user: '' })).status, 200);
    assert.deepEqual(JSON.parse((await link('DELETE')).body), { link: null });
    assert.equal((await get(again.url, { user: '' })).status, 404, 'turned off');
    assert.equal((await get('/apps/t/AAAAAAAAAAAAAAAAAAAAAA', { user: '' })).status, 404);
    assert.equal((await get('/apps/t/short', { user: '' })).status, 404);
    // the file on disk: server-only, 0600; an expired entry is dead even if still listed
    const third = JSON.parse((await link('POST')).body).link;
    const f = path.join(fx.data, 'app_links.json');
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    const all = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(all[third.token].owner, ALICE);
  });

  await t.test('app-preview: an example with an app is public at /apps/ex/<slug>, demo only', async () => {
    const r = await get('/apps/ex/flag-counter', { user: '' });
    assert.equal(r.status, 200, s.log());
    const cfg = JSON.parse(/id="bxcfg">([^<]*)</.exec(r.body.toString())[1]);
    assert.deepEqual([cfg.preview, cfg.kind, cfg.at, cfg.name], [true, 'example', '/apps/ex/flag-counter', 'Flag']);
    assert.deepEqual(cfg.controls, { angle: { type: 'range', label: 'angle', min: 0, max: 180, step: 1 } });
    assert.equal((await get('/apps/ex/flag-counter/ui/index.html', { user: '' })).status, 200);
    assert.equal((await get('/apps/ex/flag-counter/ui/../meta.json', { user: '' })).status, 404);
    assert.equal((await get('/apps/ex/no-app', { user: '' })).status, 404);
    assert.equal((await get('/apps/ex/..', { user: '' })).status, 404);
    const ex = JSON.parse((await get('/api/examples/flag-counter', { user: '' })).body);
    assert.deepEqual(ex.app, { exists: true, name: 'Flag', url: '/apps/ex/flag-counter' });
    assert.equal(JSON.parse((await get('/api/examples/no-app', { user: '' })).body).app, null);
  });
});

// ---------------------------------------------------------------- the bridge (pure)
test('bridge: only well-formed requests for known methods get through', () => {
  const ok = B.parseRequest({ bx: 1, id: 7, method: 'readings', params: { device: 'dv_0123456789', range: 'week' } });
  assert.deepEqual(ok, { id: 7, method: 'readings', params: { device: 'dv_0123456789', range: 'week' }, ui: false });
  assert.equal(B.parseRequest({ bx: 1, id: 1, method: 'readings', params: { device: 'dv_0123456789' } }).params.range, 'day');
  assert.equal(B.parseRequest({ bx: 1, id: 2, method: 'addDevice' }).ui, true);
  // not ours: ignored
  for (const m of [null, 'x', [], { bx: 2, id: 1, method: 'devices' }, { bx: 1, event: 'reading' }, { bx: 1, id: 1, result: [] }]) assert.equal(B.parseRequest(m), null);
  // unanswerable ids
  for (const id of [undefined, -1, 1.5, '7', 2 ** 60]) assert.equal(B.parseRequest({ bx: 1, id, method: 'devices' }).id, null);
  // unknown methods, including prototype names
  for (const method of ['eval', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'DEVICES', '', 42]) {
    assert.equal(B.parseRequest({ bx: 1, id: 3, method }).error, 'Unknown method', String(method));
  }
  const err = (params, method = 'readings') => B.parseRequest({ bx: 1, id: 4, method, params }).error;
  assert.equal(err([1]), 'params must be an object');
  assert.match(err({ device: 'dv_0123456789', range: 'day', extra: 1 }), /Unexpected parameter/);
  for (const device of ['dv_012345678', 'dv_0123456789a', 'DV_0123456789', 'dv_012345678g', '../dv_01234567', 7, null]) assert.equal(err({ device }), 'Unknown device', String(device));
  assert.match(err({ device: 'dv_0123456789', range: 'year' }), /range/);
  assert.match(err({ device: 'dv_0123456789', range: { toString: () => 'day' } }), /range/);
  assert.match(err({ device: 'dv_0123456789', name: '' }, 'rename'), /1 to 40/);
  assert.match(err({ device: 'dv_0123456789', name: 'x'.repeat(41) }, 'rename'), /1 to 40/);
  assert.equal(B.parseRequest({ bx: 1, id: 5, method: 'rename', params: { device: 'dv_0123456789', name: '  Kitchen‮ \n fern\u0007 ' } }).params.name, 'Kitchen fern');
  assert.equal(err({ device: 'dv_0123456789', profile: 'Bad Key' }, 'setProfile'), 'Unknown profile');
  assert.equal(B.parseRequest({ bx: 1, id: 6, method: 'setProfile', params: { device: 'dv_0123456789', profile: null } }).params.profile, null);
  // the device must be this project's, the profile must exist
  assert.equal(B.checkDevice({ device: 'dv_0123456789' }, new Set(['dv_0123456789'])), null);
  assert.equal(B.checkDevice({ device: 'dv_9999999999' }, ['dv_0123456789']), 'Unknown device');
  assert.equal(B.checkProfile({ profile: 'fern' }, { monstera: {} }), 'Unknown profile');
  assert.equal(B.checkProfile({ profile: 'toString' }, { monstera: {} }), 'Unknown profile', 'no prototype keys');
  assert.equal(B.checkProfile({ profile: 'monstera' }, { monstera: {} }), null);
});

test('bridge: answers carry only known fields, never a key', () => {
  const d = B.device({ id: 'dv_0123456789', name: 'Fern', profile: 'fern', created: '2026-10-01T00:00:00Z', key: 'SECRET', key_hash: 'abc', owner: ALICE,
    last: { t: '2026-10-30T10:00:00Z', r: { moisture: 41.2, light: Infinity, 'bad key': 1, temp: '21' } }, status: 'alert', battery: 3.9 });
  assert.deepEqual(d, { id: 'dv_0123456789', name: 'Fern', profile: 'fern', created: '2026-10-01T00:00:00Z', last: { t: '2026-10-30T10:00:00Z', r: { moisture: 41.2 } }, status: 'alert', battery: 3.9,
    fw: null, alerts: [] });
  const fired = B.device({ id: 'dv_0123456789', fw: '1.0.0', alerts: [{ id: 'thirsty', severity: 'high', message: 'Fern needs a drink', since: '2026-10-30T09:00:00Z', key: 'x' }, 'junk'] });
  assert.deepEqual([fired.fw, fired.alerts], ['1.0.0', [{ id: 'thirsty', severity: 'high', message: 'Fern needs a drink', since: '2026-10-30T09:00:00Z' }]]);
  assert.equal(B.device({ id: 'dv_0123456789', fw: '<script>' }).fw, null);
  assert.equal(B.device({ id: 'nope' }), null);
  assert.equal(B.device({ id: 'dv_0123456789', status: 'hacked' }).status, 'offline');
  assert.deepEqual(B.devices([{ id: 'dv_0123456789' }, null, 'x']).length, 1);
  const r = B.readings({ fields: ['moisture', 'Bad'], points: [['2026-10-30T10:00:00Z', { moisture: 40, x: 'y' }], 'junk', [5, {}]] });
  assert.deepEqual(r, { fields: ['moisture'], points: [['2026-10-30T10:00:00Z', { moisture: 40 }]] });
  const a = B.analysis({ health: 'great', summary: 'ok', issues: ['a', 5], advice: 'no', image: 'javascript:alert(1)', extra: 1 });
  assert.deepEqual(a, { id: null, t: null, health: 'watch', summary: 'ok', issues: ['a'], advice: [] });
  assert.equal(B.analysis({ image: 'data:image/jpeg;base64,QUJD' }).image, 'data:image/jpeg;base64,QUJD');
  assert.equal(B.photos([{ id: 'p', image: 'data:text/html;base64,PHA+' }])[0].image, undefined);
});

test('bridge: controls are typed, commands checked against them, control state sanitised', () => {
  const c = B.cleanControls({ angle: { type: 'range', min: 0, max: 180, step: 5, label: 'Flag\n angle' }, lamp: { type: 'toggle' }, led: { type: 'color' },
    mode: { type: 'choice', options: ['wave', 'still', '<b>', 'wave'] }, go: { type: 'button' }, bad: { type: 'eval' }, Bad: { type: 'toggle' },
    flat: { type: 'range', min: 5, max: 5 }, none: { type: 'choice', options: [] }, toString: { type: 'toggle' } });
  assert.deepEqual(Object.keys(c), ['angle', 'lamp', 'led', 'mode', 'go']);
  assert.deepEqual(c.angle, { type: 'range', label: 'Flag angle', min: 0, max: 180, step: 5 });
  assert.deepEqual(c.mode.options, ['wave', 'still']);
  assert.deepEqual(B.checkCommand({ angle: 93, led: '#ABCDEF', go: true }, c), { set: { angle: 95, led: '#abcdef', go: true } });
  for (const bad of [{ angle: -1 }, { angle: NaN }, { lamp: 1 }, { led: '#abc' }, { mode: 'x' }, { go: false }, { nope: 1 }, { toString: true }, {}, null])
    assert.ok(B.checkCommand(bad, c).error, JSON.stringify(bad));
  const ok = B.parseRequest({ bx: 1, id: 9, method: 'command', params: { device: 'dv_0123456789', set: { angle: 5 } } });
  assert.deepEqual(ok.params, { device: 'dv_0123456789', set: { angle: 5 } });
  for (const set of [{}, { a: {} }, { 'A b': 1 }, Object.fromEntries([...Array(9)].map((_, i) => [`f${i}`, 1])), 'x'])
    assert.match(B.parseRequest({ bx: 1, id: 9, method: 'command', params: { device: 'dv_0123456789', set } }).error, /set is/);
  const d = B.device({ id: 'dv_0123456789', control: { set: { angle: 90, x: { y: 1 } }, seq: 3, delivered: true, polled: '2026-11-02T10:00:00Z', key: 'k' } });
  assert.deepEqual(d.control, { set: {}, seq: 3, delivered: true, polled: '2026-11-02T10:00:00Z' }, 'a bad value drops the whole set');
  assert.deepEqual(B.device({ id: 'dv_0123456789', control: { set: { angle: 90 }, seq: 1 } }).control, { set: { angle: 90 }, seq: 1, delivered: false, polled: null });
  // the demo answers commands at once and a same-named reading follows a range control
  const demo = Demo.create({ id: 'x', fields: { angle: { label: 'Angle' } }, controls: c, now: Date.parse('2026-11-02T12:00:00Z'), clock: () => Date.parse('2026-11-02T12:00:00Z') });
  const id = demo.devices()[0].id;
  const after = demo.command(id, { angle: 30, go: true });
  assert.deepEqual([after.control.set.angle, after.control.set.go, after.control.seq, after.control.delivered, after.last.r.angle], [30, 1, 1, true, 30]);
});

test('bridge: rate limit and ranges', () => {
  const l = B.limiter(3, 1);
  assert.deepEqual([l.take(0), l.take(0), l.take(0), l.take(0)], [true, true, true, false]);
  assert.equal(l.take(1100), true, 'refills');
  const q = B.rangeQuery('week', Date.parse('2026-10-30T12:00:00Z'));
  assert.deepEqual(q, { from: '2026-10-23T12:00:00.000Z', to: '2026-10-30T12:00:00.000Z', bucket: 3600 });
  assert.equal(B.rangeQuery('bogus', 0).bucket, 900);
});

// ---------------------------------------------------------------- demo data
test('demo: three believable devices with 30 days of history, no randomness', () => {
  const profiles = { monstera: { name: 'Monstera', moisture_min: 30, moisture_max: 60 }, fern: { name: 'Boston fern', moisture_min: 45 }, snake: { name: 'Snake plant', moisture_min: 15 } };
  const now = Date.parse('2026-10-30T15:00:00Z');
  const d = Demo.create({ id: 'a0a0a0a0a0', profiles, now, clock: () => now });
  const list = d.devices();
  assert.equal(list.length, 3);
  for (const x of list) { assert.match(x.id, B.DEVICE_RE); assert.ok(x.last && x.last.r.moisture >= 0 && x.last.r.moisture <= 100); assert.ok(B.device(x)); }
  assert.ok(new Set(list.map((x) => x.status)).size >= 2, 'not everything is fine');
  assert.deepEqual(Demo.create({ id: 'a0a0a0a0a0', profiles, now, clock: () => now }).devices(), list, 'deterministic');
  for (const [range, n] of [['day', 96], ['week', 168], ['month', 180]]) {
    const r = d.readings(list[0].id, range);
    assert.ok(Math.abs(r.points.length - n) <= 1, `${range}: ${r.points.length}`);
    assert.deepEqual(r.fields, ['moisture', 'light', 'temp', 'humidity', 'battery']);
  }
  const light = d.readings(list[0].id, 'day').points.map((p) => p[1].light);
  assert.ok(Math.min(...light) < 60 && Math.max(...light) > 2000, 'day and night');
  const moist = d.readings(list[1].id, 'month').points.map((p) => p[1].moisture);
  assert.ok(Math.max(...moist) - Math.min(...moist) > 30, 'watering saw-tooth');
  const nd = d.createDevice('Hall fern');
  assert.equal(nd.device.last, null); assert.equal(nd.key.length, 43);
  assert.ok(['good', 'watch'].includes(d.photo(list[0].id).health));
  assert.throws(() => d.readings('dv_9999999999', 'day'), /Unknown device/);
  // an app whose fields have their own names (the firmware's): thresholds are <field>_min, statuses still vary
  const fields = { soil: { label: 'Soil', unit: '%' }, lux: { label: 'Light', unit: 'lux' }, hum: { label: 'Humidity', unit: '%' }, batt: { label: 'Battery', unit: 'V' } };
  const own = Demo.create({ id: 'a0a0a0a0a0', fields, profiles: { monstera: { name: 'Monstera', soil_min: 30 }, fern: { name: 'Fern', soil_min: 45 }, snake: { name: 'Snake', soil_min: 15 } }, now, clock: () => now });
  const ol = own.devices();
  assert.ok(new Set(ol.map((x) => x.status)).size >= 2, ol.map((x) => x.status).join());
  assert.deepEqual(Object.keys(ol[0].last.r), ['soil', 'lux', 'hum', 'batt']);
  assert.ok(ol.some((x) => x.alerts.some((a) => a.id === 'thirsty')), 'the alerting device says why');
});

// ---------------------------------------------------------------- QR, inlining, icons, agent helpers
test('qr: a sensor key fits a version 4 code with finder patterns', () => {
  const key = crypto.randomBytes(32).toString('base64url');
  const q = QR.encode(key);
  assert.equal(q.version, 4); assert.equal(q.ecl, 'M'); assert.equal(q.size, 33);
  const finder = (x0, y0) => [0, 1, 2, 3, 4, 5, 6].every((i) => q.modules[y0][x0 + i] && q.modules[y0 + 6][x0 + i] && q.modules[y0 + i][x0] && q.modules[y0 + i][x0 + 6]);
  assert.ok(finder(0, 0) && finder(26, 0) && finder(0, 26));
  assert.deepEqual(QR.encode(key).modules, q.modules, 'deterministic');
  assert.throws(() => QR.encode('x'.repeat(400)), /too long/);
});

test('apps helpers: references, app.json, alerts, firmware fields, icons, agent rules', () => {
  const { localRel, cleanApp, alertLines, firmwareFields, iconPng, crc32 } = apps._test;
  assert.equal(localRel('app.js', 'abc'), 'app.js');
  assert.equal(localRel('./css/x.css', 'abc'), 'css/x.css');
  assert.equal(localRel('/apps/abc/ui/app.js', 'abc'), 'app.js');
  for (const r of ['/apps/other/ui/app.js', 'https://cdn.example/x.js', '//x.example/a.js', '../meta.json', '/api/projects', 'data:text/js,1']) assert.equal(localRel(r, 'abc'), null, r);
  const a = cleanApp({ name: '<b>Plants</b>'.repeat(9), theme: 'red', icon: '../x.svg', fields: { Moisture: {}, light: { label: 'Light', unit: 'lux' } } }, 'T');
  assert.equal(a.name.length, 40); assert.equal(a.theme, '#e8590c'); assert.equal(a.icon, null); assert.deepEqual(Object.keys(a.fields), ['light']);
  assert.deepEqual(alertLines({ rules: [{ message: "{name}'s sensor needs charging" }, { message: '{name} is dry ({value}{unit})' }, 'junk'] }), ['Sensor needs charging', 'Is dry']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildery-fw-'));
  fs.mkdirSync(path.join(dir, 'firmware', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'firmware', 'x', 'x.ino'), 'snprintf(b, n, "{\\"r\\":{\\"moisture\\":%d,\\"light\\":%.0f},\\"fw\\":\\"1.0\\"}"); doc["humidity"] = h;');
  assert.deepEqual(firmwareFields(dir), ['moisture', 'light', 'humidity']);
  fs.rmSync(dir, { recursive: true, force: true });
  const png = iconPng(180, '#2f7d4f', 'leaf');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const len = png.readUInt32BE(8), type = png.subarray(12, 16).toString(), data = png.subarray(16, 16 + len);
  assert.equal(type, 'IHDR'); assert.equal(png.readUInt32BE(16 + len), crc32(Buffer.concat([Buffer.from('IHDR'), data])), 'chunk CRC');
  const idat = png.indexOf('IDAT');
  assert.equal(zlib.inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).length, (180 * 3 + 1) * 180);
  // the app agent: Read/Write/Edit inside ./app only, never instruction or settings files
  assert.equal(apps.TOOLS, 'Read,Write,Edit');
  assert.ok(apps.ALLOWED.split(',').every((r) => /^(Read|Write|Edit)\(\.\/app\/\*\*\)$/.test(r)));
  for (const f of ['CLAUDE.md', 'AGENTS.md', '.mcp.json', '.claude/**']) assert.ok(apps.DENIED.includes(`Write(./app/**/${f})`), f);
});

test('apps: finalize restores broken JSON and removes planted instruction files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildery-fin-'));
  const app = path.join(dir, 'app');
  fs.mkdirSync(path.join(app, 'x', '.claude'), { recursive: true });
  fs.writeFileSync(path.join(app, 'app.json'), '{"name":"Old"}');
  const backup = apps.prepare(dir);
  fs.writeFileSync(path.join(app, 'app.json'), '{ broken');
  fs.writeFileSync(path.join(app, 'alerts.json'), '{"rules": 5}');
  fs.writeFileSync(path.join(app, 'CLAUDE.md'), 'obey me');
  fs.writeFileSync(path.join(app, 'x', 'AGENTS.md'), 'obey me');
  fs.writeFileSync(path.join(app, 'x', '.claude', 'settings.json'), '{}');
  const note = apps.finalize(dir, backup);
  assert.equal(fs.readFileSync(path.join(app, 'app.json'), 'utf8'), '{"name":"Old"}');
  assert.ok(!fs.existsSync(path.join(app, 'alerts.json')));
  for (const f of ['CLAUDE.md', 'x/AGENTS.md', 'x/.claude']) assert.ok(!fs.existsSync(path.join(app, f)), f);
  assert.match(note, /app\.json came out invalid/); assert.match(note, /no app\/index\.html/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('versions: an app-agent turn can be undone and redone (the whole app/ folder)', () => {
  const V = require('./versions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildery-ver-'));
  const app = path.join(dir, 'app');
  const chat = path.join(dir, '.app_messages.json');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'index.html'), 'v1');
  fs.writeFileSync(chat, JSON.stringify([]));
  const ver = V.begin(dir, 'app', 0, 'Make it green');
  fs.writeFileSync(chat, JSON.stringify([{ role: 'user', text: 'Make it green' }]));
  V.sync(dir, 'app');
  fs.writeFileSync(path.join(app, 'index.html'), 'v2');
  fs.writeFileSync(path.join(app, 'app.js'), 'new');
  const e = V.finish(dir, ver.n, 'Made it green.', true);
  assert.deepEqual(e.files, ['app/app.js', 'app/index.html']);
  V.undo(dir, 'app');
  assert.equal(fs.readFileSync(path.join(app, 'index.html'), 'utf8'), 'v1');
  assert.ok(!fs.existsSync(path.join(app, 'app.js')), 'files the turn added are gone');
  assert.equal(JSON.parse(fs.readFileSync(chat, 'utf8'))[0].rewound, true);
  V.redo(dir, 'app');
  assert.equal(fs.readFileSync(path.join(app, 'app.js'), 'utf8'), 'new');
  assert.equal(V.history(dir, 'app').versions.length, 1);
  assert.equal(V.history(dir, 'design').versions.length, 0, 'kinds stay apart');
  fs.rmSync(dir, { recursive: true, force: true });
});
