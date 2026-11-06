// node --test server/devices.test.js   (no real Claude: the CLI spawn is mocked. On macOS, sips runs for real inside the sandbox.)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn, execFileSync } = require('node:child_process');
const devices = require('./devices');

const T0 = Date.parse('2026-10-30T12:00:00Z');
const H = 3600e3;
const PROFILES = {
  monstera: { name: 'Monstera', moisture_min: 30, moisture_max: 60, light_min: 2500, light_max: 20000, temp_min: 18, temp_max: 30, notes: 'Bright, indirect light.' },
  constructor: { name: 'Prototype-named profile', moisture_min: 1 }, // own-property lookups only
};
const ALERTS = { rules: [
  { id: 'thirsty', field: 'moisture', below: 'profile.moisture_min', severity: 'high', message: '{name} needs a drink ({value}{unit})', cooldown_h: 12 },
  { id: 'soggy', field: 'moisture', above: 'profile.moisture_max', severity: 'low', message: '{name} is overwatered', cooldown_h: 24 },
  { id: 'dark', field: 'light', below: 'profile.light_min', sustain_h: 6, severity: 'low', message: '{name} wants more light', cooldown_h: 24 },
  { id: 'battery', field: 'battery', below: 3.45, severity: 'low', message: "{name}'s sensor needs charging", cooldown_h: 48 },
  { id: 'offline', stale_h: 3, severity: 'low', message: "{name}'s sensor is offline ({value}{unit})", cooldown_h: 24 },
  { id: 'temp', field: 'temp', below: 'profile.temp_min', above: 'profile.temp_max', severity: 'high', message: '{name} is at {value}{unit}', cooldown_h: 6 },
  // malformed: ignored, never executed
  { id: 'evil', field: 'moisture', below: 'process.exit(1)', severity: 'high' },
  { id: 'evil2', field: 'moisture', below: { $gt: 1 } },
  { id: 'bad id', field: 'moisture', below: 1 },
  { id: 'huge', field: 'temp', above: 1e9 },
  { id: 'sev', field: 'moisture', below: 50, severity: 'critical' },
  { id: 'stalefield', stale_h: 2, field: 'moisture' },
  'require("child_process").exec("touch /tmp/pwned")',
  { id: 'thirsty', field: 'moisture', below: 99, severity: 'high' }, // duplicate id
] };
const APPJSON = { name: 'Plant Sensor', fields: { moisture: { label: 'Soil moisture', unit: '%' }, light: { label: 'Light', unit: 'lux' }, temp: { label: 'Temperature', unit: '°C' } } };
const ok = { code: 0, stderr: '', timedOut: false, stdout: JSON.stringify({ type: 'result', is_error: false, result: '{"health":"good","summary":"Healthy leaves, no spots.","issues":[],"advice":["Keep the watering routine"]}' }) };

function writeApp(dir, files) { for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'app', f), JSON.stringify(v)); }

/** A fresh data dir, three projects (pa, pc owned by a@x.com; pb by b@x.com), devices.js on a local HTTP server. */
async function setup({ config, claude } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-test-'));
  const DATA = path.join(root, 'data');
  const PROJECTS = path.join(DATA, 'projects');
  const owners = { pa: 'a@x.com', pb: 'b@x.com', pc: 'a@x.com' };
  for (const id of Object.keys(owners)) {
    fs.mkdirSync(path.join(PROJECTS, id, 'app'), { recursive: true });
    fs.writeFileSync(path.join(PROJECTS, id, 'meta.json'), '{}');
    writeApp(path.join(PROJECTS, id), { 'alerts.json': ALERTS, 'profiles.json': PROFILES, 'app.json': APPJSON });
  }
  const clock = { t: T0 };
  const pushed = [];
  const runs = [];
  const runProc = async (cmd, args, opts, ms) => {
    if (cmd === '/usr/bin/sandbox-exec') return devices.runProc(cmd, args, opts, ms); // real sips, sandboxed
    runs.push({ cmd, args, opts, files: fs.readdirSync(opts.cwd) });
    return (claude || (() => ok))({ cmd, args, opts });
  };
  devices.init({
    DATA, PROJECTS, CLAUDE: '/fake/claude', MODEL: 'claude-opus-5-5', runProc, timers: false, config, publicUrl: 'https://premake.ai',
    projDir: (id) => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) ? path.join(PROJECTS, id) : null),
    ownerOf: (id) => (Object.hasOwn(owners, id) ? owners[id] : null),
    agentEnv: (dir) => { fs.mkdirSync(path.join(dir, '.agent-home', 'tmp'), { recursive: true }); return { PATH: '/usr/bin:/bin', HOME: os.homedir(), ANTHROPIC_API_KEY: 'sk-must-be-removed' }; },
    push: { notify: async (...a) => { pushed.push(a); return { sent: 1 }; }, api: async () => false },
    now: () => clock.t,
  });
  const server = http.createServer((req, res) => {
    (async () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/d/ingest') return devices.ingest(req, res);
      if (url.pathname === '/api/d/commands') return devices.commands(req, res, url);
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const user = req.headers['x-test-user'] || '';
      const acc = user ? { authed: true, sid: 'gw:' + user, user } : { authed: false, sid: null, user: '' };
      if (!(await devices.api(req, res, { parts, m: req.method, acc, url }))) { res.writeHead(404); res.end('{"error":"unhandled"}'); }
    })().catch((e) => {
      if (res.headersSent) return res.end();
      res.writeHead(e.code >= 400 && e.code < 600 ? e.code : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, p, { user, body, raw, headers = {} } = {}) {
    const h = { ...headers };
    if (user) h['x-test-user'] = user;
    let data = raw;
    if (body !== undefined) { data = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers: h, body: data });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch {}
    return { status: r.status, json, buf, headers: r.headers };
  }
  const ingest = (key, body, headers = {}) => call('POST', '/api/d/ingest', { raw: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(key ? { authorization: `Device ${key}` } : {}), ...headers } });
  async function addDevice(project = 'pa', user = 'a@x.com', extra = {}) {
    const r = await call('POST', `/api/apps/${project}/devices`, { user, body: { name: 'Fern', ...extra } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return { id: r.json.device.id, key: r.json.key, res: r.json };
  }
  const close = () => { server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); };
  return { root, DATA, PROJECTS, clock, pushed, runs, call, ingest, addDevice, close, devDir: (id) => path.join(fs.realpathSync(DATA), 'devices', id) };
}
const tick = (env, ms = 21e3) => { env.clock.t += ms; };
const quiet = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };

/** A small valid RGB PNG. */
function png(w = 8, h = 8) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([40, 160, 60], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (buf, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;

// ---------------------------------------------------------------- ingest
test('ingest: auth header, body limits, validation, interval reply, stored line', async () => {
  const env = await setup();
  try {
    const { id, key, res } = await env.addDevice();
    assert.match(key, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(key, 'base64url').length, 32);
    assert.equal(res.ingest, 'https://premake.ai/api/d/ingest');
    assert.match(id, /^dv_[0-9a-f]{10}$/);
    const rec = JSON.parse(fs.readFileSync(env.devDir(id) + '.json', 'utf8'));
    assert.ok(!JSON.stringify(rec).includes(key), 'the key itself is never stored');
    assert.equal(rec.key_hash, require('node:crypto').createHash('sha256').update(key).digest('hex'));

    const good = { r: { moisture: 41.2, light: 830, temp: 21.4, humidity: 48, battery: 3.92 }, fw: '1.0.0' };
    assert.equal((await env.ingest(null, good)).status, 401);
    assert.equal((await env.ingest('A'.repeat(43), good)).status, 401);
    assert.equal((await env.call('POST', '/api/d/ingest', { raw: JSON.stringify(good), headers: { authorization: `Bearer ${key}` } })).status, 401);
    assert.equal((await env.call('POST', '/api/d/ingest', { raw: JSON.stringify(good), headers: { authorization: `Device ${key}x` } })).status, 401);
    assert.equal((await env.call('GET', '/api/d/ingest')).status, 405);
    assert.equal((await env.ingest(key, JSON.stringify({ r: { a: 1 }, pad: 'x'.repeat(2100) }))).status, 413);

    const bad = ['not json', '[]', '{"r":[]}', '{"r":{}}', '{"r":{"a":1},"x":1}', '{"r":{"Moisture":1}}', '{"r":{"1a":1}}',
      `{"r":{"${'a'.repeat(25)}":1}}`, '{"r":{"a":"41"}}', '{"r":{"a":true}}', '{"r":{"a":null}}', '{"r":{"a":1e7}}', '{"r":{"a":-1e7}}',
      '{"r":{"a":1},"fw":"12345678901234567"}', '{"r":{"a":1},"fw":"1.0 0"}', '{"r":{"a":1},"fw":5}', '{"fw":"1"}',
      `{"r":{${Array.from({ length: 17 }, (_, i) => `"f${i}":1`).join(',')}}}`, '{"r":{"__proto__":1}}'];
    for (const b of bad) {
      tick(env); // 422s count against the per-device rate limit too
      const r = await env.ingest(key, b);
      assert.equal(r.status, 422, b);
      assert.match(r.json.error, /^bad body/);
    }
    tick(env);
    const r = await env.ingest(key, good);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, interval: 1800 });
    const lines = fs.readFileSync(path.join(env.devDir(id), 'readings.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { t: new Date(env.clock.t).toISOString(), r: good.r });
    assert.equal(lines[0], JSON.stringify({ t: new Date(env.clock.t).toISOString(), r: good.r }));
    tick(env);
    const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`f${i}`, i === 0 ? 9999999.9 : -i]));
    assert.equal((await env.ingest(key, { r: { ...many, constructor: 1 } })).status, 422, '17 fields');
    tick(env);
    assert.equal((await env.ingest(key, { r: { ...Object.fromEntries(Object.entries(many).slice(0, 15)), constructor: 2 }, fw: '' })).status, 200);
    const dev = (await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json;
    assert.equal(dev.last.r.constructor, 2);
    assert.equal(dev.fw, null, 'an empty fw clears it');
    assert.equal(dev.battery, null, 'the last reading had no battery');
  } finally { env.close(); }
});

test('ingest: 1 per 20 s per device, a global cap, and a separate cap for bad keys', async () => {
  const env = await setup({ config: { ingestPerMin: 3, badKeyPerMin: 2 } });
  try {
    const a = await env.addDevice();
    const reading = { r: { moisture: 40 } };
    assert.equal((await env.ingest(a.key, reading)).status, 200);
    tick(env, 5e3);
    const r = await env.ingest(a.key, reading);
    assert.equal(r.status, 429);
    assert.equal(r.json.error, 'too soon');
    assert.equal(r.headers.get('retry-after'), '15');
    tick(env, 14.9e3);
    assert.equal((await env.ingest(a.key, reading)).status, 429);
    tick(env, 0.1e3);
    assert.equal((await env.ingest(a.key, reading)).status, 200, 'exactly 20 s later');
    // global cap: 3 accepted-key ingests per minute in this config (2 used above)
    const b = await env.addDevice(), c = await env.addDevice();
    assert.equal((await env.ingest(b.key, reading)).status, 200);
    const capped = await env.ingest(c.key, reading);
    assert.equal(capped.status, 429);
    assert.equal(capped.json.error, 'busy, try again later');
    // bad keys have their own counter, so they can't use up the real one
    tick(env, 61e3);
    assert.equal((await env.ingest('B'.repeat(43), reading)).status, 401);
    assert.equal((await env.ingest('C'.repeat(43), reading)).status, 401);
    assert.equal((await env.ingest('D'.repeat(43), reading)).status, 429);
    assert.equal((await env.ingest(c.key, reading)).status, 200, 'a real device still gets in');
  } finally { env.close(); }
});

test('key auth: rotation replaces the key, deletion revokes it', async () => {
  const env = await setup();
  try {
    const { id, key } = await env.addDevice();
    const r = await env.call('POST', `/api/devices/${id}/rotate-key`, { user: 'a@x.com' });
    assert.equal(r.status, 200);
    assert.notEqual(r.json.key, key);
    assert.equal((await env.ingest(key, { r: { a: 1 } })).status, 401, 'old key');
    assert.equal((await env.ingest(r.json.key, { r: { a: 1 } })).status, 200, 'new key');
    assert.equal((await env.call('DELETE', `/api/devices/${id}`, { user: 'a@x.com' })).json.ok, true);
    tick(env);
    assert.equal((await env.ingest(r.json.key, { r: { a: 1 } })).status, 401, 'deleted device');
    assert.ok(!fs.existsSync(env.devDir(id)) && !fs.existsSync(env.devDir(id) + '.json'));
  } finally { env.close(); }
});

test('owner isolation: everyone but the owner gets 404', async () => {
  const env = await setup();
  try {
    const { id } = await env.addDevice('pa', 'a@x.com');
    const other = await env.addDevice('pb', 'b@x.com');
    const routes = [['GET', `/api/apps/pa/devices`], ['POST', `/api/apps/pa/devices`, { name: 'x' }], ['GET', `/api/devices/${id}`],
      ['PATCH', `/api/devices/${id}`, { name: 'Mine now' }], ['DELETE', `/api/devices/${id}`], ['POST', `/api/devices/${id}/rotate-key`],
      ['GET', `/api/devices/${id}/readings`], ['GET', `/api/devices/${id}/photos`], ['POST', `/api/devices/${id}/photo`, { image: dataUrl(png()) }],
      ['GET', `/api/devices/${id}/photos/ph_000000000000`], ['GET', '/api/apps/nope/devices'], ['GET', '/api/apps/constructor/devices'],
      ['GET', '/api/devices/dv_0000000000'], ['GET', '/api/devices/dv_..%2F..%2Fetc']];
    for (const user of ['b@x.com', '', 'A@X.COM']) {
      for (const [m, p, body] of routes) {
        const r = await env.call(m, p, { user, body });
        assert.equal(r.status, 404, `${user || 'anonymous'} ${m} ${p}`);
        assert.deepEqual(r.json, { error: 'not found' });
      }
    }
    // a@x.com sees exactly their own device, per project
    const list = (await env.call('GET', '/api/apps/pa/devices', { user: 'a@x.com' })).json;
    assert.deepEqual(list.map((d) => d.id), [id]);
    assert.deepEqual((await env.call('GET', '/api/apps/pc/devices', { user: 'a@x.com' })).json, []);
    assert.deepEqual((await env.call('GET', '/api/apps/pb/devices', { user: 'b@x.com' })).json.map((d) => d.id), [other.id]);
    assert.equal(list[0].name, 'Fern', 'b could not rename it');
    assert.deepEqual(Object.keys(list[0]).sort(), ['alerts', 'battery', 'created', 'fw', 'id', 'last', 'name', 'profile', 'status']);
  } finally { env.close(); }
});

test('owner API: names, profiles, limits', async () => {
  const env = await setup({ config: { perProject: 2 } });
  try {
    const r0 = await env.call('POST', '/api/apps/pa/devices', { user: 'a@x.com', body: {} });
    assert.equal(r0.json.device.name, 'Sensor 1');
    assert.equal(r0.json.device.status, 'offline', 'no reading yet');
    assert.equal((await env.call('POST', '/api/apps/pa/devices', { user: 'a@x.com', body: { name: 'x'.repeat(61) } })).status, 422);
    assert.equal((await env.call('POST', '/api/apps/pa/devices', { user: 'a@x.com', body: { name: 'Fern', profile: 'cactus' } })).status, 422);
    const r1 = await env.call('POST', '/api/apps/pa/devices', { user: 'a@x.com', body: { name: '  Kitchen\u0000 fern ', profile: 'monstera' } });
    assert.equal(r1.json.device.name, 'Kitchen fern');
    assert.equal(r1.json.device.profile, 'monstera');
    assert.equal((await env.call('POST', '/api/apps/pa/devices', { user: 'a@x.com', body: { name: 'Third' } })).status, 409, 'per-project limit');
    const id = r1.json.device.id;
    assert.equal((await env.call('PATCH', `/api/devices/${id}`, { user: 'a@x.com', body: { name: '' } })).status, 422);
    assert.equal((await env.call('PATCH', `/api/devices/${id}`, { user: 'a@x.com', body: { name: 'New', profile: 'nope' } })).status, 422);
    assert.equal((await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json.name, 'Kitchen fern', 'a refused PATCH changes nothing');
    const p = await env.call('PATCH', `/api/devices/${id}`, { user: 'a@x.com', body: { name: 'Desk fern', profile: null } });
    assert.equal(p.status, 200);
    assert.equal(p.json.name, 'Desk fern');
    assert.equal(p.json.profile, null);
    assert.equal((await env.call('POST', `/api/devices/${id}`, { user: 'a@x.com' })).status, 405);
    assert.equal((await env.call('GET', `/api/devices/${id}/nope`, { user: 'a@x.com' })).status, 404);
  } finally { env.close(); }
});

// ---------------------------------------------------------------- readings
test('readings: binary-searched ranges, bucketed averages, never more than 2000 points', async () => {
  const env = await setup();
  try {
    const { id } = await env.addDevice();
    const start = T0 - 7 * 24 * H;
    const rows = [];
    for (let i = 0; i < 7 * 24 * 60; i++) rows.push({ t: new Date(start + i * 60e3).toISOString(), r: { moisture: i % 60, light: 1000 + (i % 2) } });
    fs.writeFileSync(path.join(env.devDir(id), 'readings.jsonl'), rows.map((x) => JSON.stringify(x) + '\n').join(''));
    const file = path.join(env.devDir(id), 'readings.jsonl');
    // binary search == a naive filter, on exact boundaries and in between
    for (const [f, t] of [[start, start + 59 * 60e3], [start + 30e3, start + 90e3], [start - H, start], [T0 - 60e3, T0 + H], [T0, T0 + H],
      [start + 5000 * 60e3, start + 5000 * 60e3], [start + 3 * 24 * H + 7, start + 4 * 24 * H - 7], [-Infinity, Infinity]]) {
      const got = devices.readRange(file, f, t).map((x) => x.t);
      const want = rows.filter((x) => Date.parse(x.t) >= f && Date.parse(x.t) <= t).map((x) => x.t);
      assert.deepEqual(got, want, `${f}..${t}`);
    }
    const q = (s) => env.call('GET', `/api/devices/${id}/readings?${s}`, { user: 'a@x.com' });
    const iso = (ms) => new Date(ms).toISOString();
    // an hour: raw points
    let r = await q(`from=${iso(T0 - H)}&to=${iso(T0)}`);
    assert.equal(r.json.bucket, 0);
    assert.deepEqual(r.json.fields, ['moisture', 'light']);
    assert.equal(r.json.points.length, 60);
    assert.deepEqual(r.json.points[0], [iso(T0 - H), { moisture: 0, light: 1000 }]);
    // a week: 10080 readings -> bucketed to <= 2000 points
    r = await q(`from=${iso(start)}&to=${iso(T0)}`);
    assert.ok(r.json.points.length <= 2000 && r.json.points.length > 1500, String(r.json.points.length));
    assert.ok(r.json.bucket >= Math.ceil(7 * 24 * 3600 / 1999));
    // too small a bucket for the range is raised; an exact hourly bucket averages 60 readings
    assert.ok((await q(`from=${iso(start)}&to=${iso(T0)}&bucket=60`)).json.points.length <= 2000);
    r = await q(`from=${iso(start)}&to=${iso(T0)}&bucket=3600`);
    assert.equal(r.json.bucket, 3600);
    assert.equal(r.json.points.length, 7 * 24, 'readings run to T0 - 1 min: 168 whole hours');
    assert.deepEqual(r.json.points[0], [iso(start), { moisture: 29.5, light: 1000.5 }]);
    // range shortcut, the default (a day), bad input
    assert.equal((await q('range=day')).json.from, iso(T0 - 24 * H));
    assert.ok((await q('')).json.points.length <= 2000);
    assert.equal((await q('from=yesterday')).status, 422);
    assert.equal((await q(`from=${iso(T0)}&to=${iso(T0 - H)}`)).status, 422);
    assert.equal((await q('bucket=-5')).status, 422);
  } finally { env.close(); }
});

test('readings: retention compacts old data into averages, keeps the file bounded and ordered', async () => {
  const env = await setup({ config: { readingsMax: 2000 } });
  try {
    const { id, key } = await env.addDevice();
    const file = path.join(env.devDir(id), 'readings.jsonl');
    const rows = [];
    for (let t = T0 - 3 * 365 * 24 * H; t < T0 - 2 * 24 * H; t += 6 * H) rows.push({ t: new Date(t).toISOString(), r: { moisture: 50 } });
    for (let t = T0 - 2 * 24 * H; t < T0 - 60e3; t += 60e3) rows.push({ t: new Date(t).toISOString(), r: { moisture: 10, light: 2 } });
    fs.writeFileSync(file, rows.map((x) => JSON.stringify(x) + '\n').join(''));
    await quiet(() => devices.compact(id, T0));
    const after = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(after.length <= 1600, `bounded: ${after.length}`);
    assert.ok(Date.parse(after[0].t) >= T0 - 366 * 24 * H, 'nothing older than a year');
    for (let i = 1; i < after.length; i++) assert.ok(after[i].t > after[i - 1].t, 'time-ordered');
    assert.ok(after.every((x) => x.r.moisture === 50 || x.r.moisture === 10), 'averages of equal values stay equal');
    // through ingest: the file never grows past readingsMax
    const env2 = await setup({ config: { readingsMax: 30 } });
    try {
      const d = await env2.addDevice();
      await quiet(async () => {
        for (let i = 0; i < 45; i++) {
          tick(env2, 3600e3);
          assert.equal((await env2.ingest(d.key, { r: { moisture: i } })).status, 200);
          const n = fs.readFileSync(path.join(env2.devDir(d.id), 'readings.jsonl'), 'utf8').trim().split('\n').length;
          assert.ok(n <= 30, `${n} lines`);
        }
      });
      const last = fs.readFileSync(path.join(env2.devDir(d.id), 'readings.jsonl'), 'utf8').trim().split('\n').pop();
      assert.equal(JSON.parse(last).r.moisture, 44, 'the newest reading is kept as is');
    } finally { env2.close(); }
    assert.ok(key);
  } finally { env.close(); }
});

// ---------------------------------------------------------------- alerts
test('alerts: every rule type, cooldowns, placeholders, severity -> status, malformed rules ignored', async () => {
  const env = await setup();
  try {
    const ignored = [];
    const log = console.log;
    console.log = (...a) => ignored.push(a.join(' '));
    let id, key;
    try { ({ id, key } = await env.addDevice('pa', 'a@x.com', { profile: 'monstera' })); } finally { console.log = log; }
    const send = async (r, ms = 21e3) => { tick(env, ms); const x = await env.ingest(key, { r }); assert.equal(x.status, 200); };
    const dev = async () => (await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json;
    const sent = () => env.pushed.splice(0).map(([owner, app, msg, opts]) => ({ owner, app, ...msg, opts }));
    await send({ moisture: 41, light: 5000, temp: 21, battery: 3.9 });
    assert.ok(ignored.some((l) => /\[alerts pa\] ignored rule 7: below \/ above must be a number.*rule 8.*rule 9: bad id.*rule 10.*rule 11: severity.*rule 12: a stale_h rule.*rule 13: not an object.*rule 14: duplicate id/.test(l)), ignored.join('\n'));
    assert.equal((await dev()).status, 'ok');
    assert.deepEqual(sent(), []);
    // below profile.moisture_min (high): alert + push, with placeholders
    await send({ moisture: 25.04 });
    let d = await dev();
    assert.equal(d.status, 'alert');
    assert.deepEqual(d.alerts.map((a) => [a.id, a.severity, a.message]), [['thirsty', 'high', 'Fern needs a drink (25%)']]);
    let p = sent();
    assert.equal(p.length, 1);
    assert.deepEqual({ owner: p[0].owner, app: p[0].app, title: p[0].title, body: p[0].body, tag: p[0].tag, url: p[0].url, device: p[0].device, rule: p[0].rule, severity: p[0].severity },
      { owner: 'a@x.com', app: 'pa', title: 'Plant Sensor', body: 'Fern needs a drink (25%)', tag: `${id}:thirsty`, url: '/apps/pa', device: id, rule: 'thirsty', severity: 'high' });
    assert.equal(p[0].opts.urgency, 'high');
    assert.match(p[0].opts.topic, /^[A-Za-z0-9_-]{32}$/);
    // still thirsty: no repeat inside cooldown_h (12), a reminder after it
    await send({ moisture: 24 });
    await send({ moisture: 24 }, 11 * H);
    assert.deepEqual(sent(), []);
    await send({ moisture: 23 }, 1 * H);
    assert.deepEqual(sent().map((x) => x.body), ['Fern needs a drink (23%)']);
    // watered: clears; above profile.moisture_max (low): watch
    await send({ moisture: 45 });
    assert.equal((await dev()).status, 'ok');
    await send({ moisture: 65 });
    d = await dev();
    assert.equal(d.status, 'watch');
    assert.deepEqual(sent().map((x) => [x.rule, x.body, x.opts.urgency]), [['soggy', 'Fern is overwatered', 'normal']]);
    // flapping inside the cooldown: no new push
    await send({ moisture: 45 });
    await send({ moisture: 66 });
    assert.deepEqual(sent(), []);
    await send({ moisture: 45 });
    // a plain number threshold
    await send({ battery: 3.3 });
    assert.deepEqual(sent().map((x) => x.body), ["Fern's sensor needs charging"]);
    assert.equal((await dev()).battery, 3.3);
    // sustain_h: dark for 6 hours before it fires
    await send({ light: 1000 });
    await send({ light: 900 }, 3 * H);
    assert.deepEqual(sent(), []);
    await send({ light: 800 }, 3 * H);
    assert.deepEqual(sent().map((x) => x.rule), ['dark']);
    await send({ light: 3000 });
    await send({ light: 1000 });
    await send({ light: 1000 }, 5 * H);
    assert.deepEqual(sent(), [], 'the bright reading reset the 6 hours');
    // below AND above in one rule
    await send({ temp: 35, battery: 3.9, light: 5000 });
    assert.deepEqual(sent().map((x) => x.body), ['Fern is at 35°C']);
    await send({ temp: 21 });
    assert.equal((await dev()).status, 'ok');
    // no profile: profile rules are skipped, number rules still run
    await env.call('PATCH', `/api/devices/${id}`, { user: 'a@x.com', body: { profile: null } });
    await send({ moisture: 5, battery: 3.0 });
    assert.deepEqual(sent().map((x) => x.rule), [], 'battery is inside its 48 h cooldown; thirsty has no profile');
    d = await dev();
    assert.deepEqual(d.alerts.map((a) => a.id), ['battery']);
    assert.equal(d.status, 'watch');
    // a profile named like an Object.prototype key resolves only to its own data
    await env.call('PATCH', `/api/devices/${id}`, { user: 'a@x.com', body: { profile: 'constructor' } });
    await send({ moisture: 0.5, battery: 3.9 }, 13 * H);
    assert.deepEqual(sent().map((x) => x.body), ['Fern needs a drink (0.5%)']);
    // changing the profile re-evaluates the status at once, without a push
    await env.call('PATCH', `/api/devices/${id}`, { user: 'a@x.com', body: { profile: 'monstera' } });
    d = await dev();
    assert.equal(d.status, 'alert');
    assert.deepEqual(sent(), []);
    // alerts.json edited: thresholds apply to the status straight away
    writeApp(path.join(env.PROJECTS, 'pa'), { 'alerts.json': { rules: [{ id: 'thirsty', field: 'moisture', below: 0.1, severity: 'high' }] } });
    assert.equal((await dev()).status, 'ok');
    assert.ok(!fs.existsSync('/tmp/pwned'));
  } finally { env.close(); }
});

test('alerts: stale_h fires from the sweep timer, respects cooldown, clears on a reading', async () => {
  const env = await setup();
  try {
    const { id, key } = await env.addDevice();
    const quietDev = await env.addDevice(); // never reports: never "offline" alerts
    const sent = () => env.pushed.splice(0).map(([, , msg]) => msg);
    assert.equal((await env.ingest(key, { r: { moisture: 40 } })).status, 200);
    tick(env, 1 * H);
    let d = (await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json;
    assert.equal(d.status, 'ok', '1 h < 3 x 30 min');
    tick(env, 1 * H);
    d = (await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json;
    assert.equal(d.status, 'offline', 'no reading for 3 intervals');
    await quiet(() => devices.sweep());
    assert.deepEqual(sent(), []);
    tick(env, 1 * H + 60e3);
    await quiet(() => devices.sweep());
    const s = sent();
    assert.deepEqual(s.map((m) => [m.rule, m.device, m.body]), [['offline', id, "Fern's sensor is offline (3.02h)"]]);
    d = (await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json;
    assert.deepEqual(d.alerts.map((a) => a.id), ['offline']);
    tick(env, 10 * 60e3);
    await quiet(() => devices.sweep());
    assert.deepEqual(sent(), [], 'cooldown_h 24');
    assert.equal((await env.ingest(key, { r: { moisture: 40 } })).status, 200);
    d = (await env.call('GET', `/api/devices/${id}`, { user: 'a@x.com' })).json;
    assert.deepEqual([d.status, d.alerts], ['ok', []]);
    tick(env, 3 * H + 60e3);
    await quiet(() => devices.sweep());
    assert.deepEqual(sent(), [], 'offline again, but still inside the 24 h cooldown');
    tick(env, 21 * H);
    await quiet(() => devices.sweep());
    assert.deepEqual(sent().map((m) => m.rule), ['offline']);
    assert.ok(quietDev.id);
    const state = JSON.parse(fs.readFileSync(path.join(env.devDir(id), 'state.json'), 'utf8'));
    assert.equal(state.rules.offline.active, true);
    assert.ok(!fs.existsSync(path.join(env.devDir(quietDev.id), 'state.json')));
  } finally { env.close(); }
});

test('alert rules are data: cleanRule never accepts code, only numbers or profile.<key>', () => {
  for (const r of [{ id: 'a', field: 'x', below: 'eval("1")' }, { id: 'a', field: 'x', below: 'profile.a.b' }, { id: 'a', field: 'x', below: 'profile.__proto__' },
    { id: 'a', field: 'x', below: [1] }, { id: 'a', field: 'x', below: NaN }, { id: 'a', field: 'x', below: Infinity }, { id: 'a', field: 'x' },
    { id: 'a', field: 'X', below: 1 }, { id: 'a', field: 'x', below: 1, sustain_h: -1 }, { id: 'a', field: 'x', below: 1, cooldown_h: '12' },
    { id: 'a', stale_h: 0 }, { id: 'a', field: 'x', below: 1, message: 5 }, { id: '', field: 'x', below: 1 }, null, [], 'x']) {
    assert.equal(typeof devices.cleanRule(r), 'string', JSON.stringify(r));
  }
  assert.deepEqual(devices.cleanRule({ id: 'ok', field: 'moisture', below: 'profile.moisture_min', cooldown_h: 0 }),
    { id: 'ok', severity: 'low', message: '{name}: ok', cooldown_h: 1, kind: 'threshold', field: 'moisture', below: { p: 'moisture_min' }, above: null, sustain_h: 0 });
  assert.equal(devices.renderMessage('{name} {value}{unit} {other}\n<b>', { name: 'A', value: '1', unit: '%' }), 'A 1% {other} <b>');
});

// ---------------------------------------------------------------- photo checks
test('photo checks: magic bytes, size, sandboxed CLI with Read on one image, parsed result saved next to the photo', async () => {
  let reply = ok;
  const env = await setup({ claude: () => reply });
  try {
    const { id, key } = await env.addDevice('pa', 'a@x.com', { profile: 'monstera' });
    await env.ingest(key, { r: { moisture: 33.3, light: 4000 } });
    const post = (image, user = 'a@x.com') => env.call('POST', `/api/devices/${id}/photo`, { user, body: { image } });
    assert.equal((await post('hello')).status, 422);
    assert.equal((await post('data:text/plain;base64,aGVsbG8=')).status, 422);
    assert.equal((await post(dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png'))).status, 415);
    assert.equal((await post(dataUrl(Buffer.from('GIF89a' + 'x'.repeat(40)), 'image/png'))).status, 415, 'GIF is not accepted');
    assert.equal((await post(dataUrl(Buffer.concat([png(), Buffer.alloc(6 * 1024 * 1024)])))).status, 413);
    assert.equal(env.runs.length, 0, 'nothing reached the CLI');

    const r = await post(dataUrl(png()));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.id, /^ph_[0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(r.json).sort(), ['advice', 'health', 'id', 'issues', 'summary', 't']);
    assert.deepEqual([r.json.health, r.json.summary, r.json.issues, r.json.advice], ['good', 'Healthy leaves, no spots.', [], ['Keep the watering routine']]);
    const run = env.runs[0];
    assert.equal(run.cmd, '/fake/claude');
    assert.deepEqual(run.files, [process.platform === 'darwin' ? 'photo.jpg' : 'photo.png'], 'the cwd holds the one image (re-encoded by sandboxed sips on macOS)');
    const arg = (k) => run.args[run.args.indexOf(k) + 1];
    assert.equal(arg('--tools'), 'Read');
    assert.equal(arg('--allowedTools'), 'Read(./photo.*)');
    assert.equal(arg('--permission-mode'), 'dontAsk');
    assert.equal(arg('--setting-sources'), '');
    assert.equal(arg('--model'), 'claude-opus-5-5');
    assert.ok(run.args.includes('--strict-mcp-config') && run.args.includes('--no-session-persistence') && run.args.includes('--disable-slash-commands'));
    for (const f of ['--mcp-config', '--add-dir', '--disallowedTools', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--resume']) assert.ok(!run.args.includes(f), f);
    assert.ok(!('ANTHROPIC_API_KEY' in run.opts.env), 'subscription only');
    const prompt = arg('-p');
    assert.match(prompt, /Read tool: \.\/photo\.(jpg|png)/);
    assert.match(prompt, /"Fern"/);
    assert.match(prompt, /Profile "monstera": .*"moisture_min":30/);
    assert.match(prompt, /Soil moisture \(%\): latest 33\.3/);
    // saved next to the photo; listed; served
    const pdir = path.join(env.devDir(id), 'photos');
    assert.deepEqual(fs.readdirSync(pdir).sort(), [`${r.json.id}.json`, `${r.json.id}.png`]);
    const list = (await env.call('GET', `/api/devices/${id}/photos`, { user: 'a@x.com' })).json;
    assert.deepEqual(list, [{ id: r.json.id, t: r.json.t, health: 'good', summary: 'Healthy leaves, no spots.', url: `/api/devices/${id}/photos/${r.json.id}/image` }]);
    const img = await env.call('GET', list[0].url, { user: 'a@x.com' });
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(img.buf.equals(png()));
    assert.equal((await env.call('GET', list[0].url, { user: 'b@x.com' })).status, 404);
    assert.equal((await env.call('GET', `/api/devices/${id}/photos/${r.json.id}`, { user: 'a@x.com' })).json.health, 'good');
    assert.deepEqual(fs.readdirSync(devices._internal.photoTmp()), [], 'the temp job dir is gone');
    // defensive parsing: fenced JSON with prose; a garbage answer is a 502 and leaves no photo behind
    reply = { ...ok, stdout: JSON.stringify({ is_error: false, result: 'Here you go:\n```json\n{"health":"BAD","summary":"Root rot.\\nSoggy soil","issues":"overwatered","advice":[1,"Let it dry out",""],"growth":"New leaf unfurling","extra":true,}\n```' }) };
    const r2 = await post(dataUrl(png()));
    assert.deepEqual([r2.json.health, r2.json.summary, r2.json.issues, r2.json.advice, r2.json.growth], ['bad', 'Root rot. Soggy soil', ['overwatered'], ['Let it dry out'], 'New leaf unfurling']);
    reply = { ...ok, stdout: JSON.stringify({ is_error: false, result: 'I cannot help with that.' }) };
    assert.equal((await quiet(() => post(dataUrl(png())))).status, 502);
    reply = { ...ok, stdout: '', code: 1 };
    assert.equal((await quiet(() => post(dataUrl(png())))).status, 502);
    reply = { ...ok, timedOut: true };
    assert.equal((await quiet(() => post(dataUrl(png())))).status, 504);
    assert.equal(fs.readdirSync(pdir).filter((f) => f.endsWith('.png')).length, 2, 'failed checks keep no photo');
    // HEIC is stored and analysed as JPEG (macOS only: sips makes the fixture)
    if (process.platform === 'darwin') {
      reply = ok;
      const src = path.join(env.root, 'p.png'), heic = path.join(env.root, 'p.heic');
      fs.writeFileSync(src, png(64, 48));
      let made = false;
      try { execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', src, '--out', heic], { stdio: 'ignore' }); made = fs.existsSync(heic); } catch {}
      if (made) {
        const h = await post(dataUrl(fs.readFileSync(heic), 'image/heic'));
        assert.equal(h.status, 200, JSON.stringify(h.json));
        assert.ok(fs.existsSync(path.join(pdir, `${h.json.id}.jpg`)));
        assert.equal((await env.call('GET', `/api/devices/${id}/photos/${h.json.id}/image`, { user: 'a@x.com' })).headers.get('content-type'), 'image/jpeg');
      }
    }
  } finally { env.close(); }
});

test('photo checks: 10 per user per day, 200 in total, one at a time', async () => {
  let active = 0, most = 0;
  const slow = async () => { active++; most = Math.max(most, active); await new Promise((r) => setTimeout(r, 30)); active--; return ok; };
  const env = await setup({ claude: slow });
  try {
    assert.deepEqual([devices.config().photoPerUser, devices.config().photoPerDay], [10, 200], 'defaults');
    const a = await env.addDevice('pa', 'a@x.com');
    const b = await env.addDevice('pb', 'b@x.com');
    const post = (dev, user) => env.call('POST', `/api/devices/${dev.id}/photo`, { user, body: { image: dataUrl(png()) } });
    const first = await Promise.all([post(a, 'a@x.com'), post(a, 'a@x.com'), post(a, 'a@x.com')]);
    assert.deepEqual(first.map((x) => x.status), [200, 200, 200]);
    assert.equal(most, 1, 'concurrency 1');
    for (let i = 3; i < 10; i++) assert.equal((await post(a, 'a@x.com')).status, 200);
    const over = await post(a, 'a@x.com');
    assert.equal(over.status, 429);
    assert.match(over.json.error, /10 photo checks today/);
    assert.equal((await post(b, 'b@x.com')).status, 200, 'per user');
    env.clock.t += 24 * H;
    assert.equal((await post(a, 'a@x.com')).status, 200, 'a new day');
  } finally { env.close(); }
  const env2 = await setup({ config: { photoPerDay: 3, photoQueue: 2 }, claude: slow });
  try {
    const a = await env2.addDevice('pa', 'a@x.com');
    const b = await env2.addDevice('pb', 'b@x.com');
    const post = (dev, user) => env2.call('POST', `/api/devices/${dev.id}/photo`, { user, body: { image: dataUrl(png()) } });
    const burst = await Promise.all([post(a, 'a@x.com'), post(a, 'a@x.com'), post(a, 'a@x.com')]);
    assert.deepEqual(burst.map((x) => x.status).sort(), [200, 200, 429], 'queue of 2');
    assert.equal((await post(b, 'b@x.com')).status, 200);
    const total = await post(b, 'b@x.com');
    assert.equal(total.status, 429);
    assert.match(total.json.error, /busy today/);
  } finally { env2.close(); }
});

// ---------------------------------------------------------------- storage safety
test('storage refuses symlinks: readings, device dirs, app config, device records', async () => {
  const env = await setup();
  try {
    const { id, key } = await env.addDevice();
    const outside = path.join(env.root, 'outside.jsonl');
    const secret = JSON.stringify({ t: new Date(T0 - 60e3).toISOString(), r: { secret: 42 } }) + '\n';
    fs.writeFileSync(outside, secret);
    fs.symlinkSync(outside, path.join(env.devDir(id), 'readings.jsonl'));
    assert.deepEqual((await env.call('GET', `/api/devices/${id}/readings`, { user: 'a@x.com' })).json.points, []);
    assert.equal((await quiet(() => env.ingest(key, { r: { moisture: 1 } }))).status, 500);
    assert.equal(fs.readFileSync(outside, 'utf8'), secret, 'nothing written through the link');
    // the device dir itself replaced by a link
    fs.rmSync(env.devDir(id), { recursive: true });
    const outDir = path.join(env.root, 'outdir');
    fs.mkdirSync(path.join(outDir, 'photos'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'readings.jsonl'), secret);
    fs.writeFileSync(path.join(outDir, 'photos', 'ph_000000000000.json'), JSON.stringify({ id: 'ph_000000000000', t: 'x', health: 'good' }));
    fs.symlinkSync(outDir, env.devDir(id));
    tick(env);
    assert.deepEqual((await env.call('GET', `/api/devices/${id}/readings`, { user: 'a@x.com' })).json.points, []);
    assert.deepEqual((await env.call('GET', `/api/devices/${id}/photos`, { user: 'a@x.com' })).json, []);
    assert.equal((await quiet(() => env.ingest(key, { r: { moisture: 1 } }))).status, 500);
    assert.equal(fs.readFileSync(path.join(outDir, 'readings.jsonl'), 'utf8'), secret);
    assert.equal((await env.call('DELETE', `/api/devices/${id}`, { user: 'a@x.com' })).status, 200);
    assert.ok(fs.existsSync(path.join(outDir, 'readings.jsonl')), 'delete removed the link, not its target');
    // alerts.json as a link: ignored
    const evil = path.join(env.root, 'rules.json');
    fs.writeFileSync(evil, JSON.stringify({ rules: [{ id: 'x', field: 'moisture', below: 100, severity: 'high' }] }));
    fs.rmSync(path.join(env.PROJECTS, 'pc', 'app', 'alerts.json'));
    fs.symlinkSync(evil, path.join(env.PROJECTS, 'pc', 'app', 'alerts.json'));
    const c = await env.addDevice('pc');
    tick(env);
    await env.ingest(c.key, { r: { moisture: 5 } });
    assert.equal((await env.call('GET', `/api/devices/${c.id}`, { user: 'a@x.com' })).json.status, 'ok');
    // a device record that is a link is not loaded
    const rec = env.devDir(c.id) + '.json';
    fs.renameSync(rec, path.join(env.root, 'rec.json'));
    fs.symlinkSync(path.join(env.root, 'rec.json'), rec);
    await quiet(async () => devices.init({ DATA: env.DATA, PROJECTS: env.PROJECTS, projDir: () => null, ownerOf: () => null, timers: false, push: { notify: async () => ({}) } }));
    assert.equal(devices._internal.devs.size, 0);
  } finally { env.close(); }
});

// ---------------------------------------------------------------- wiring: the gateway and server.js
test('gateway passes exactly POST /api/d/ingest without a session, and still strips identity headers', { skip: 'tests the hosted gateway (gateway/server.js), not in the open-source app' }, async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'gateway', 'server.js'), 'utf8');
  const hop = src.match(/const HOP = new Set\(\[([\s\S]*?)\]\)/)[1];
  for (const h of ['x-forma-gateway', 'x-forma-user', 'x-forwarded-host', 'x-forwarded-for', 'forwarded']) assert.ok(hop.includes(`'${h}'`), h);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'gateway', 'server.js')], {
    env: { PATH: process.env.PATH, PORT: String(port), PUBLIC_HOST: `localhost:${port}`, GATEWAY_SECRET: 'test-secret', SESSION_SECRET: 'test' }, stdio: 'ignore' });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) { try { await fetch(base + '/healthz'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const req = (m, p, h = {}) => fetch(base + p, { method: m, headers: h, redirect: 'manual', body: m === 'POST' ? '{}' : undefined });
    assert.equal((await req('POST', '/api/d/ingest', { authorization: 'Device x' })).status, 503, 'passed the sign-in gate (no Mac registered)');
    assert.equal((await req('GET', '/api/d/ingest')).status, 405);
    for (const p of ['/api/d/ingest/', '/api/d/ingestx', '/api/devices/dv_0123456789/rotate-key', '/api/apps/pa/devices', '/api/push/subscribe', '/api/d/other']) {
      assert.equal((await req('POST', p)).status, 401, p);
    }
    assert.equal((await req('GET', '/api/apps/pa/devices')).status, 302);
    assert.equal((await req('GET', '/api/devices/dv_0123456789/readings')).status, 302);
  } finally { child.kill(); }
});

test('server.js routes ingest before any session or local-admin logic', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const i = src.indexOf("if (url.pathname === '/api/d/ingest') return devices.ingest(req, res);");
  assert.ok(i > 0);
  for (const later of ['if (ONLINE && !viaGateway(req) && !acc.local', 'admin.touch(acc, req, parts)', "if (parts[0] === 'api') {"]) assert.ok(src.indexOf(later) > i, later);
  assert.ok(src.indexOf("if (url.pathname === '/stripe/webhook')") < i);
  assert.match(src, /const SECRET_ENV = \[[^\]]*'VAPID_PRIVATE_KEY'/, 'children never see the push signing key');
  const j = src.indexOf("if (url.pathname === '/api/d/commands') return devices.commands(req, res, url);");
  assert.ok(j > i && j < src.indexOf('admin.touch(acc, req, parts)'), 'commands are routed like ingest');
});

// ---------------------------------------------------------------- controls: app -> server -> device
const CONTROLS = { angle: { type: 'range', label: 'Flag angle', min: 0, max: 180, step: 5 }, lamp: { type: 'toggle', label: 'Lamp' },
  color: { type: 'color', label: 'LED colour' }, mode: { type: 'choice', label: 'Mode', options: ['wave', 'still'] }, wave: { type: 'button', label: 'Wave now' } };
async function withControls(env) {
  writeApp(path.join(env.PROJECTS, 'pa'), { 'app.json': { ...APPJSON, controls: CONTROLS } });
  const d = await env.addDevice('pa');
  const poll = (key, q = '', headers = {}) => env.call('GET', '/api/d/commands' + q, { headers: { ...(key ? { authorization: `Device ${key}` } : {}), ...headers } });
  return { ...d, poll };
}

test('controls: the owner sets typed controls, the device polls the whole desired state with its key', async () => {
  const env = await setup();
  try {
    const d = await withControls(env);
    // before any command: seq 0, empty state; the poll is recorded on the device
    let p = await d.poll(d.key, '?since=0');
    assert.deepEqual([p.status, p.json], [200, { seq: 0, set: {} }]);
    const send = (set, user = 'a@x.com') => env.call('POST', `/api/devices/${d.id}/command`, { user, body: { set } });
    let r = await send({ angle: 92, lamp: true, color: '#FF8800', mode: 'wave' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.control.set, { angle: 90, lamp: true, color: '#ff8800', mode: 'wave' }, 'snapped to the step, colour lower-cased');
    assert.equal(r.json.control.seq, 1); assert.equal(r.json.control.delivered, false);
    assert.equal(r.json.control.polled, new Date(env.clock.t).toISOString());
    tick(env, 3e3);
    p = await d.poll(d.key, '?since=0&wait=25');
    assert.deepEqual(p.json, { seq: 1, set: { angle: 90, lamp: true, color: '#ff8800', mode: 'wave' } }, 'answered at once: seq moved');
    assert.equal((await env.call('GET', `/api/devices/${d.id}`, { user: 'a@x.com' })).json.control.delivered, true);
    // a button is a press counter; later commands merge
    await send({ wave: true }); r = await send({ wave: true, angle: 0 });
    assert.deepEqual([r.json.control.set.wave, r.json.control.set.angle, r.json.control.set.lamp, r.json.control.seq], [2, 0, true, 3]);
    // refused: not declared, wrong type, out of range, bad shapes
    for (const [set, re] of [[{ speed: 1 }, /no control "speed"/], [{ angle: 181 }, /0 to 180/], [{ lamp: 'on' }, /on or off/], [{ color: 'red' }, /colour/],
      [{ mode: 'party' }, /one of/], [{ wave: 1 }, /pressed/], [{}, /1 to 8/], [[1], /1 to 8/]]) {
      r = await send(set); assert.equal(r.status, 422, JSON.stringify(set)); assert.match(r.json.error, re);
    }
    assert.equal((await env.call('POST', `/api/devices/${d.id}/command`, { user: 'a@x.com', body: { set: { lamp: true }, extra: 1 } })).status, 422);
    // owner only: 404 for anyone else, signed out too
    for (const u of ['b@x.com', '']) assert.equal((await send({ lamp: false }, u)).status, 404);
    // an app without controls takes no commands
    const other = await env.addDevice('pc');
    assert.equal((await env.call('POST', `/api/devices/${other.id}/command`, { user: 'a@x.com', body: { set: { lamp: true } } })).status, 422);
  } finally { env.close(); }
});

test('controls: long poll wakes on a command, one poll per device, rate limits, key auth', async () => {
  const env = await setup();
  try {
    const d = await withControls(env);
    assert.equal((await d.poll(null)).status, 401);
    assert.equal((await d.poll('A'.repeat(43))).status, 401);
    assert.equal((await env.call('POST', '/api/d/commands', { headers: { authorization: `Device ${d.key}` } })).status, 405);
    assert.equal((await d.poll(d.key, '?since=0')).json.seq, 0);
    assert.equal((await d.poll(d.key, '?since=0')).status, 429, 'a poll every 2 s at most');
    tick(env, 2500);
    const waiting = d.poll(d.key, '?since=0&wait=25');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal((await env.call('POST', `/api/devices/${d.id}/command`, { user: 'a@x.com', body: { set: { lamp: true } } })).status, 200);
    assert.deepEqual((await waiting).json, { seq: 1, set: { lamp: true } }, 'the open poll answered at once');
    // a newer poll answers the older one (one per device)
    tick(env, 2500);
    const a = d.poll(d.key, '?since=1&wait=25');
    await new Promise((res) => setTimeout(res, 80));
    tick(env, 2500);
    const b = await d.poll(d.key, '?since=1&wait=0');
    assert.deepEqual([(await a).json.seq, b.json.seq], [1, 1]);
    // 40 commands per 10 s per device
    let last;
    for (let i = 0; i < 41; i++) last = await env.call('POST', `/api/devices/${d.id}/command`, { user: 'a@x.com', body: { set: { angle: i } } });
    assert.equal(last.status, 429);
    // rotating the key: the old key stops polling
    const nk = (await env.call('POST', `/api/devices/${d.id}/rotate-key`, { user: 'a@x.com' })).json.key;
    tick(env, 2500);
    assert.equal((await d.poll(d.key)).status, 401);
    assert.equal((await d.poll(nk)).status, 200);
  } finally { env.close(); }
});

test('gateway passes exactly GET /api/d/commands and the app preview paths without a session', { skip: 'tests the hosted gateway (gateway/server.js), not in the open-source app' }, async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'gateway', 'server.js')], {
    env: { PATH: process.env.PATH, PORT: String(port), PUBLIC_HOST: `localhost:${port}`, GATEWAY_SECRET: 'test-secret', SESSION_SECRET: 'test' }, stdio: 'ignore' });
  try {
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) { try { await fetch(base + '/healthz'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const req = (m, p) => fetch(base + p, { method: m, redirect: 'manual', body: m === 'POST' ? '{}' : undefined });
    assert.equal((await req('GET', '/api/d/commands?since=3&wait=25')).status, 503, 'passed the sign-in gate (no Mac registered)');
    assert.equal((await req('POST', '/api/d/commands')).status, 405);
    for (const p of ['/apps/t/AAAAAAAAAAAAAAAAAAAAAA', '/apps/t/AAAAAAAAAAAAAAAAAAAAAA/ui/index.html', '/apps/ex/wi-fi-plant-sensor', '/apps/shell.js', '/apps/qr.js']) {
      assert.equal((await req('GET', p)).status, 503, p);
    }
    for (const p of ['/apps/0123456789', '/apps/0123456789/ui/index.html', '/apps/t/short', '/apps/sw.js', '/api/apps/0123456789/link', '/api/devices/dv_0123456789/command']) {
      assert.equal((await req('GET', p)).status, 302, p);
    }
    assert.equal((await req('POST', '/apps/t/AAAAAAAAAAAAAAAAAAAAAA')).status, 401);
    assert.equal((await req('POST', '/api/devices/dv_0123456789/command')).status, 401);
  } finally { child.kill(); }
});
