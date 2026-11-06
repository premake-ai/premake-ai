// node --test server/showcase.test.js   (temp dirs; no server)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const showcase = require('./showcase');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-'));
  const DATA = path.join(root, 'data'), PROJECTS = path.join(DATA, 'projects'), EXAMPLES = path.join(root, 'examples');
  for (const d of [PROJECTS, EXAMPLES]) fs.mkdirSync(d, { recursive: true });
  const owners = {}, busy = new Set(), price = {};
  let clock = Date.now() - 3600e3;
  function proj(id, { title, owner = 'josh@x.com', parts = 2, thumb = true, failed = false, cost = 20, tags = [], extra = {} } = {}) {
    const d = path.join(PROJECTS, id);
    fs.mkdirSync(path.join(d, 'stl'), { recursive: true });
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ title, description: '', creator: 'you', tags, owner, created: '2026-11-01T00:00:00Z', referred_by: 'x', ...extra }));
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ parts: Array.from({ length: parts }, (_, i) => ({ file: `stl/p${i}.stl` })) }));
    fs.writeFileSync(path.join(d, 'stl', 'p0.stl'), 'solid');
    fs.writeFileSync(path.join(d, 'design.py'), '# code');
    fs.writeFileSync(path.join(d, 'bom.json'), '{}');
    fs.writeFileSync(path.join(d, 'build_log.txt'), failed ? 'BUILD FAILED: x' : 'ok');
    fs.writeFileSync(path.join(d, 'messages.json'), '[{"role":"user","text":"private chat"}]');
    fs.writeFileSync(path.join(d, 'runs.jsonl'), '{}');
    fs.mkdirSync(path.join(d, '.versions'));
    if (thumb) fs.writeFileSync(path.join(d, 'thumb.png'), 'png');
    clock += 60e3;
    fs.utimesSync(path.join(d, 'manifest.json'), clock / 1000, clock / 1000);
    owners[id] = owner; price[d] = cost;
  }
  const readJSON = (f, dflt = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v));
  const mk = () => showcase.init({ DATA, PROJECTS, EXAMPLES, OWNERS: new Set(['josh@x.com']), readJSON, writeJSON, ownerOf: (id) => owners[id],
    busy: (id) => busy.has(id), priceOf: (dir) => price[dir] });
  return { DATA, PROJECTS, EXAMPLES, proj, busy, mk, readJSON };
}

test('publishes the owner\'s finished designs and only those', () => {
  const t = setup();
  t.proj('a1', { title: 'Phone-Face Desk Robot', tags: ['kickstarter', 'desk'] });
  t.proj('a2', { title: 'Someone else\'s lamp', owner: 'eve@x.com' });
  t.proj('a3', { title: 'Broken shelf', failed: true });
  t.proj('a4', { title: 'No parts', parts: 0 });
  t.proj('a5', { title: 'No thumb', thumb: false });
  t.proj('a6', { title: 'No price', cost: null });
  t.proj('a7', { title: 'Untitled' });
  t.proj('a8', { title: 'Adjustable grip trainer' });
  t.proj('a9', { title: 'Tactical turret mount' });
  t.proj('b1', { title: 'Remix of Grip door wedge' });
  t.proj('b2', { title: 'Building now' });
  t.proj('b3', { title: 'Hidden', extra: { showcase: false } });
  t.proj('b4', { title: 'Design a product based on this' });
  t.busy.add('b2');
  const s = t.mk();
  const r = s.sync();
  assert.deepEqual(r.published, ['phone-face-desk-robot']);
  assert.deepEqual(s.slugs(), ['phone-face-desk-robot']);
  const d = s.dir('phone-face-desk-robot');
  assert.deepEqual(fs.readdirSync(d).sort(), ['bom.json', 'design.py', 'manifest.json', 'meta.json', 'stl', 'thumb.png'], 'allowlisted files only (runs.jsonl only when it has design runs)');
  const meta = t.readJSON(path.join(d, 'meta.json'));
  assert.equal(meta.title, 'Phone-Face Desk Robot');
  assert.equal(meta.creator, 'Premake');
  assert.deepEqual(meta.tags, ['desk'], 'internal tags dropped');
  assert.ok(!('owner' in meta) && !('referred_by' in meta), 'no owner data');
  assert.ok(s.builtAt('phone-face-desk-robot'));
  assert.equal(s.dir('../projects'), null);
});

test('duplicates show once (newest), slugs stay, deleted or opted-out designs go, failed builds keep the last good copy', () => {
  const t = setup();
  t.proj('c1', { title: 'Tapered Handle Cup' });
  t.proj('c2', { title: 'Tapered handled mug' });
  t.proj('c3', { title: 'Wall hook' });
  const s = t.mk();
  s.sync();
  assert.deepEqual(s.slugs().sort(), ['tapered-handled-mug', 'wall-hook']);
  // a newer retry of the same design takes over the slug
  t.proj('c4', { title: 'Tapered Handle Cup' });
  s.sync();
  assert.deepEqual(s.slugs().sort(), ['tapered-handled-mug', 'wall-hook']);
  assert.equal(t.readJSON(path.join(s.dir('tapered-handled-mug'), 'meta.json')).title, 'Tapered Handle Cup');
  // latest build failed: the last good snapshot stays
  fs.writeFileSync(path.join(t.PROJECTS, 'c3', 'build_log.txt'), 'BUILD FAILED');
  s.sync();
  assert.ok(s.dir('wall-hook'));
  // opt out: removed
  const mp = path.join(t.PROJECTS, 'c3', 'meta.json');
  fs.writeFileSync(mp, JSON.stringify({ ...t.readJSON(mp), showcase: false }));
  s.sync();
  assert.equal(s.dir('wall-hook'), null);
  // project deleted: removed
  fs.rmSync(path.join(t.PROJECTS, 'c4'), { recursive: true });
  fs.rmSync(path.join(t.PROJECTS, 'c2'), { recursive: true });
  fs.rmSync(path.join(t.PROJECTS, 'c1'), { recursive: true });
  s.sync();
  assert.deepEqual(s.slugs(), []);
  assert.deepEqual(fs.readdirSync(path.join(t.DATA, 'showcase')), []);
});

test('a repo example with the same title wins; slugs never clash with repo examples', () => {
  const t = setup();
  fs.mkdirSync(path.join(t.EXAMPLES, 'wall-hook'));
  fs.writeFileSync(path.join(t.EXAMPLES, 'wall-hook', 'meta.json'), JSON.stringify({ title: 'Bike hook' }));
  fs.mkdirSync(path.join(t.EXAMPLES, 'plant-sensor'));
  fs.writeFileSync(path.join(t.EXAMPLES, 'plant-sensor', 'meta.json'), JSON.stringify({ title: 'Wi-Fi Plant Sensor' }));
  t.proj('d1', { title: 'Wall Hook' });
  t.proj('d2', { title: 'Wi-Fi Plant Sensor' });
  const s = t.mk();
  s.sync();
  assert.deepEqual(s.slugs(), ['wall-hook-2']);
});

test('weapon and filler filters', () => {
  for (const x of ['Slingshot', 'hyraxoptics turret', 'Adjustable grip trainer', 'Pistol grip', 'Knife block']) assert.ok(showcase.WEAPON_RE.test(x), x);
  for (const x of ['Magnetic Phone Grip Stand', 'Telescopic Camping Light', 'Desk lamp', 'Plywood Spice Rack']) assert.ok(!showcase.WEAPON_RE.test(x), x);
  for (const x of ['Untitled', 'New design', 'test', 'This', 'x']) assert.ok(showcase.FILLER_RE.test(x), x);
  assert.ok(!showcase.FILLER_RE.test('Phone Stand'));
});
