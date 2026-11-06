// node --test server/apiv1.test.js   the public sourcing API (server/apiv1.js) on a real server.js: upload STEP and STL,
// quote, poll, the /q page, rate limits, size limits, the 30-day sweep. No outside supplier is called (live suppliers
// are switched off with API_V1_SUPPLIERS_OFF and RMFG has no token in the temp data dir), so only estimates come back.
// The server runs from a temp app root (symlinks to this code), so this checkout's .env.local is never loaded.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const v1 = require('./apiv1');

const APP = path.join(__dirname, '..');
const PY = path.join(APP, '.venv', 'bin', 'python');

/** Binary STL of an axis-aligned box (12 triangles, outward winding). */
function boxStl(x, y, z) {
  const v = (i) => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0];
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const tris = faces.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((k, j) => v(k).forEach((val, n) => buf.writeFloatLE(val, 84 + i * 50 + 12 + j * 12 + n * 4))));
  return buf;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'premake-v1-root-'));
  for (const d of ['server', 'web', 'gateway', 'cadlib']) fs.symlinkSync(path.join(APP, d), path.join(root, d));
  if (fs.existsSync(path.join(APP, '.venv'))) fs.symlinkSync(path.join(APP, '.venv'), path.join(root, '.venv'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'premake-v1-data-'));
  fs.mkdirSync(path.join(data, 'projects'), { recursive: true });
  return { root, data };
}
function start(fx, extra = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gw = crypto.randomBytes(16).toString('hex');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: fx.data, FORMA_GATEWAY_SECRET: gw,
    FORMA_PARTS_PREBUILD: '0', CLAUDE_BIN: '/usr/bin/false', API_V1_SUPPLIERS_OFF: 'rmfg,materiam,afn,slant3d', API_V1_QUOTES_PER_DAY: '3', ...extra };
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
/** Signed out, through the gateway (how the public reaches it), from client IP `ip`. */
function req(s, p, { method = 'GET', body, raw, headers = {}, ip = '203.0.113.7' } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${s.port}`, 'X-Forma-Gateway': s.gw, 'X-Forma-User': '', 'X-Forma-Client-Ip': ip, ...headers };
    if (body) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: s.port, path: p, method, headers: h, agent: false }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on('error', (e) => (e.code === 'EPIPE' || e.code === 'ECONNRESET' ? resolve({ status: 413, text: '', json: null }) : reject(e)));
    r.end(raw || (body ? JSON.stringify(body) : undefined));
  });
}

test('pure helpers', () => {
  assert.equal(v1.material('Aluminium 6061').family, 'aluminium');
  assert.equal(v1.material('').family, 'aluminium', 'default: aluminium');
  assert.equal(v1.material('304 stainless').family, 'stainless');
  assert.equal(v1.material('mild steel').afn, 'steel 1018');
  assert.equal(v1.material('PETG').family, 'plastic');
  assert.deepEqual(v1.parseQtys('100,1,10,10'), [1, 10, 100]);
  assert.deepEqual(v1.parseQtys([5, 0, -1, 'x', 2.4]), [2, 5]);
  assert.deepEqual(v1.parseQtys('1,2,3,4,5,6,7,8'), [1, 2, 3, 4, 5, 6], 'at most 6 quantities');
  assert.deepEqual(v1.supplierQtys([1, 10]), [1, 10, 100, 500], 'the studio set when it covers the request (cache hits)');
  assert.deepEqual(v1.supplierQtys([20]), [1, 20]);
  assert.equal(v1.formatOf(Buffer.from('ISO-10303-21;\nHEADER;')), 'step');
  assert.equal(v1.formatOf(boxStl(1, 2, 3)), 'stl');
  assert.equal(v1.formatOf(Buffer.from('solid x\n facet normal 0 0 1\n')), 'stl');
  assert.equal(v1.formatOf(Buffer.from('<html>')), null);
  const plate = { bbox_mm: [2, 50, 80], volume_mm3: 8000, area_mm2: 8000 + 2 * 2 * 130, solids: 1, faces: { planar: 6, cylindrical: 0, other: 0 } };
  assert.deepEqual(v1.processesOf(plate, 'step').processes, ['laser_cut', 'cnc', '3d_print']);
  const block = { bbox_mm: [30, 40, 50], volume_mm3: 60000, area_mm2: 9400, solids: 1 };
  assert.deepEqual(v1.processesOf(block, 'step').processes, ['cnc', '3d_print']);
  assert.match(v1.processesOf(block, 'stl').warnings.join(' '), /STEP/);
  assert.match(v1.processesOf({ ...block, solids: 3 }, 'step').warnings.join(' '), /3 separate bodies/);
  const ranked = v1.rank([
    { part_id: 'a', qty: 1, total_usd: 10, shipping_usd: 20, arrives_by: '2026-11-20', live: true },
    { part_id: 'a', qty: 1, total_usd: 25, shipping_usd: 0, arrives_by: '2026-11-10', live: false },
  ]);
  assert.equal(ranked[0].cheapest.total_usd, 25, 'cheapest counts known shipping');
  assert.equal(ranked[0].fastest.arrives_by, '2026-11-10');
  assert.equal(ranked[0].cheapest_live.total_usd, 10);
  assert.ok(v1.SUPPLIERS.some((s) => s.id === 'amazon' && s.kind === 'link'));
});

test('stlInfo: box size, volume and area', () => {
  // stlInfo needs readStl from sourcing.js, wired by init; call it through a minimal init
  v1.init({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'premake-v1-unit-')), readStl: require('./sourcing').readStl });
  const f = v1.stlInfo(boxStl(10, 20, 30));
  assert.deepEqual(f.bbox_mm, [10, 20, 30]);
  assert.equal(f.volume_mm3, 6000);
  assert.equal(f.area_mm2, 2200);
});

test('sourcing API on a real server', async (t) => {
  const fx = fixture();
  const s = start(fx);
  t.after(() => { s.srv.kill(); fs.rmSync(fx.root, { recursive: true, force: true }); fs.rmSync(fx.data, { recursive: true, force: true }); });
  await waitUp(s.port);
  let stlPart, stepPart, quoteId;

  await t.test('suppliers list, no secrets', async () => {
    const r = await req(s, '/api/v1/suppliers');
    assert.equal(r.status, 200, s.log());
    const ids = r.json.suppliers.map((x) => x.id);
    for (const id of ['rmfg', 'materiam', 'afn', 'slant3d', 'sendcutsend', 'premake', 'amazon']) assert.ok(ids.includes(id), id);
    assert.equal(r.json.suppliers.find((x) => x.id === 'rmfg').available, false, 'RMFG not connected in the temp data dir');
    assert.ok(!/token|secret|bearer/i.test(r.text));
  });

  await t.test('upload an STL (raw body)', async () => {
    const r = await req(s, '/api/v1/parts?filename=cube.stl', { method: 'POST', raw: boxStl(20, 20, 20), headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.part_id, /^prt_[0-9a-f]{20}$/);
    assert.deepEqual(r.json.bbox_mm, [20, 20, 20]);
    assert.equal(r.json.volume_mm3, 8000);
    assert.ok(r.json.processes.includes('3d_print'));
    assert.match(r.json.warnings.join(' '), /STEP/);
    stlPart = r.json.part_id;
    const st = fs.statSync(path.join(fx.data, '.apiv1', 'parts', stlPart, 'part.stl'));
    assert.equal(st.mode & 0o077, 0, 'stored privately (600)');
  });

  await t.test('upload a STEP (JSON base64), read in the sandbox', { skip: !fs.existsSync(PY) && 'no .venv' }, async () => {
    const step = path.join(fx.data, 'plate.step');
    execFileSync(PY, ['-c', `import cadquery as cq; cq.exporters.export(cq.Workplane().box(80, 50, 2).faces('>Z').workplane().hole(6), ${JSON.stringify(step)})`]);
    const r = await req(s, '/api/v1/parts', { method: 'POST', body: { filename: '../../etc/plate.step', content_base64: fs.readFileSync(step).toString('base64') } });
    assert.equal(r.status, 201, r.text + s.log());
    assert.deepEqual(r.json.bbox_mm, [2, 50, 80]);
    assert.ok(Math.abs(r.json.volume_mm3 - (8000 - Math.PI * 9 * 2)) < 2);
    assert.equal(r.json.processes[0], 'laser_cut');
    assert.equal(r.json.filename, 'plate.step', 'no path in the stored name');
    stepPart = r.json.part_id;
    assert.ok(fs.existsSync(path.join(fx.data, '.apiv1', 'parts', stepPart, 'mesh.stl')), 'mesh for print quotes');
  });

  await t.test('bad uploads', async () => {
    assert.equal((await req(s, '/api/v1/parts', { method: 'POST', raw: Buffer.from('<html>hi</html>') })).status, 415);
    assert.equal((await req(s, '/api/v1/parts', { method: 'POST', raw: Buffer.alloc(0) })).status, 400);
    const big = await req(s, '/api/v1/parts', { method: 'POST', raw: Buffer.alloc(10), headers: { 'Content-Length': String(51 * 1024 * 1024) } });
    assert.equal(big.status, 413);
  });

  await t.test('quote: pending -> complete, estimates labelled, order_url to /q', async () => {
    const parts = [{ part_id: stlPart, qty: '1,10', material: 'PETG' }];
    if (stepPart) parts.push({ part_id: stepPart, qty: [1, 10], material: 'aluminium' });
    const r = await req(s, '/api/v1/quotes', { method: 'POST', body: { parts, ship_to_zip: '10001' } });
    assert.equal(r.status, 202, r.text);
    quoteId = r.json.quote_id;
    assert.match(quoteId, /^qt_[0-9a-f]{20}$/);
    assert.match(r.json.url, new RegExp(`/q/${quoteId}$`));
    const g = await req(s, `/api/v1/quotes/${quoteId}`);
    assert.equal(g.status, 200);
    assert.equal(g.json.status, 'complete', 'no live suppliers on: estimates only, done at once');
    assert.equal(g.json.ship_to_zip, '10001');
    assert.ok(g.json.offers.length >= 2);
    for (const o of g.json.offers) {
      assert.equal(o.live, false); assert.equal(o.price_type, 'estimate');
      assert.ok(o.unit_usd > 0 && o.total_usd > 0);
      assert.equal(o.order_url, g.json.url);
      assert.ok(o.arrives_by);
    }
    if (stepPart) assert.ok(g.json.offers.some((o) => o.part_id === stepPart && o.supplier === 'SendCutSend'), 'sheet part: SendCutSend estimate');
    assert.ok(g.json.best.some((b) => b.part_id === stlPart && b.qty === 10 && b.cheapest));
    assert.ok(fs.readFileSync(path.join(fx.data, '.apiv1', 'log.jsonl'), 'utf8').includes(quoteId), 'logged for the price model');
  });

  await t.test('the comparison page: read-only, estimates marked, no slop', async () => {
    const r = await req(s, `/q/${quoteId}`);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.text, /Estimate/);
    assert.match(r.text, /never orders/);
    assert.ok(!/<form|<script/i.test(r.text), 'no forms, no scripts');
    assert.ok(!/gradient|font-style:\s*italic|text-transform:\s*uppercase|letter-spacing:\s*-/i.test(r.text));
    assert.equal((await req(s, '/q/qt_00000000000000000000')).status, 404);
    assert.notEqual((await req(s, '/q/something-else')).status, 200, 'other /q/ paths are left to the existing routing');
  });

  await t.test('bad quotes', async () => {
    assert.equal((await req(s, '/api/v1/quotes', { method: 'POST', body: { parts: [{ part_id: 'prt_ffffffffffffffffffff', qty: 1 }] } })).status, 404);
    assert.equal((await req(s, '/api/v1/quotes', { method: 'POST', body: { parts: [{ part_id: stlPart, qty: 0 }] } })).status, 400);
    assert.equal((await req(s, '/api/v1/quotes', { method: 'POST', body: {} })).status, 400);
    assert.equal((await req(s, '/api/v1/quotes/nope')).status, 404);
  });

  await t.test('rate limit: quotes per IP per day', async () => {
    const body = { parts: [{ part_id: stlPart, qty: 1, material: 'pla' }] };
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await req(s, '/api/v1/quotes', { method: 'POST', body, ip: '198.51.100.9' })).status);
    assert.deepEqual(codes, [202, 202, 202, 429]);
    assert.equal((await req(s, '/api/v1/quotes', { method: 'POST', body, ip: '198.51.100.10' })).status, 202, 'another IP is not limited');
  });

  await t.test('sweep deletes uploads and quotes after 30 days', () => {
    const n = v1.init({ DATA: fx.data }).sweep(Date.now() + 31 * 864e5);
    assert.ok(n >= 2);
    assert.equal(fs.readdirSync(path.join(fx.data, '.apiv1', 'parts')).length, 0);
    assert.equal(fs.readdirSync(path.join(fx.data, '.apiv1', 'quotes')).length, 0);
  });
});
