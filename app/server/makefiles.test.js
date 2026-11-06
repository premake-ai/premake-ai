'use strict';
// makefiles: the Make tab's downloads (server/makefiles.js), against a throwaway project dir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const makefiles = require('./makefiles');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'));
  const dir = path.join(root, 'p1');
  fs.mkdirSync(path.join(dir, 'stl'), { recursive: true }); fs.mkdirSync(path.join(dir, 'step'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: 'Desk Lamp' }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(dir, 'stl', 'base.stl'), 'solid base');
  fs.writeFileSync(path.join(dir, 'stl', 'plate.stl'), 'solid plate');
  fs.writeFileSync(path.join(dir, 'step', 'plate.step'), 'ISO-10303-21;');
  fs.writeFileSync(path.join(dir, 'bom.json'), JSON.stringify({
    printed: [{ file: 'stl/base.stl', name: 'Base', bbox: [140, 140, 32] }],
    fabricated: [{ file: 'stl/plate.stl', name: 'Plate', process: 'sheet', bbox: [134, 134, 3] }],
    parts: [{ name: 'LED ring, 24', qty_per_unit: 2, unit_cost_usd: 6, supplier: 'Amazon', url: 'https://example.com/x' }],
  }));
  return { root, dir };
}
function call(h, url, acc = { authed: true, user: 'me' }) {
  return new Promise((resolve) => {
    const res = { code: 0, headers: {}, body: null,
      writeHead(c, hd) { this.code = c; this.headers = hd; }, end(b) { this.body = b; resolve(this); } };
    const send = (r, c, o) => { r.writeHead(c, {}); r.end(Buffer.from(JSON.stringify(o))); };
    h.send = send;
    const parts = url.split('/').filter(Boolean);
    h.mod.handle({ headers: {} }, res, { parts, m: 'GET', acc });
  });
}
function setup(owner = 'me') {
  const { root, dir } = fixture();
  const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const h = {};
  h.mod = makefiles.init({ projDir: (id) => path.join(root, id), exDir: () => null, canEdit: (acc) => acc.user === owner,
    send: (...a) => h.send(...a), allow: () => true, clientIp: () => '1', readJSON });
  return { h, dir };
}

test('lists made parts with STL/STEP flags and the shopping list', async () => {
  const { h } = setup();
  const r = await call(h, '/api/make/p1');
  const d = JSON.parse(r.body);
  assert.equal(r.code, 200);
  assert.deepEqual(d.parts.map((p) => [p.name, p.process, p.stl, p.step]), [['Base', 'print', true, false], ['Plate', 'sheet', true, true]]);
  assert.equal(d.bought[0].qty, 2);
  assert.equal(d.print.count, 1);
});

test('all.zip has every STL, the STEP, bom.json and the CSV', async () => {
  const { h } = setup();
  const r = await call(h, '/api/make/p1/all.zip');
  assert.equal(r.code, 200);
  const s = r.body.toString('latin1');
  for (const n of ['desk-lamp/stl/base.stl', 'desk-lamp/stl/plate.stl', 'desk-lamp/step/plate.step', 'desk-lamp/bom.json', 'desk-lamp/shopping-list.csv']) assert.ok(s.includes(n), n);
});

test('print.zip has only printed parts; csv quotes commas', async () => {
  const { h } = setup();
  const z = (await call(h, '/api/make/p1/print.zip')).body.toString('latin1');
  assert.ok(z.includes('base.stl') && !z.includes('plate.stl'));
  const c = (await call(h, '/api/make/p1/shopping-list.csv')).body.toString();
  assert.match(c, /"LED ring, 24",2,6,12,Amazon/);
});

test('single part downloads, and no path tricks', async () => {
  const { h } = setup();
  assert.equal((await call(h, '/api/make/p1/part/plate.step')).body.toString(), 'ISO-10303-21;');
  assert.equal((await call(h, '/api/make/p1/part/base.step')).code, 404);
  assert.equal((await call(h, '/api/make/p1/part/..%2Fmeta.json')).code, 404);
});

test('someone else\'s project is a 404', async () => {
  const { h } = setup('owner@x');
  assert.equal((await call(h, '/api/make/p1')).code, 404);
  assert.equal((await call(h, '/api/make/p1/all.zip')).code, 404);
});
