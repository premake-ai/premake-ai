// node --test server/sections.test.js  (Parts panel sections: cache key, design-set sections, the model's answer)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./sections');

test('keyOf: same parts in any order give the same key; a renamed or added part changes it', () => {
  const k = S.keyOf(['Frame', 'Y motor', 'X rod']);
  assert.equal(k, S.keyOf(['X rod', ' Frame ', 'Y motor', 'Frame']));
  assert.notEqual(k, S.keyOf(['Frame', 'Y motor', 'X rods']));
  assert.notEqual(k, S.keyOf(['Frame', 'Y motor', 'X rod', 'Z motor']));
  assert.match(k, /^[0-9a-f]{16}$/);
});

test('fromManifest: the design\'s own sections, parts without one in Other (last); null when none set', () => {
  assert.equal(S.fromManifest({ parts: [{ name: 'A' }, { name: 'B' }] }), null);
  const r = S.fromManifest({ parts: [{ name: 'Rail', section: 'frame' }, { name: 'Screw' }, { name: 'Y motor', section: 'Y axis' }, { name: 'Plate', section: 'Frame' }] });
  assert.deepEqual(r.order, ['Frame', 'Y axis', 'Other']);
  assert.deepEqual(r.map, { Rail: 'Frame', Screw: 'Other', 'Y motor': 'Y axis', Plate: 'Frame' });
});

test('prompt: numbered part names with the product title', () => {
  const p = S.prompt({ title: 'CNC router', names: ['Frame plate', 'Y motor'] });
  assert.match(p, /Product: CNC router/);
  assert.match(p, /1\. Frame plate\n2\. Y motor/);
});

test('parseResult: indices -> names, duplicates and bad indices ignored, the rest in Other', () => {
  const names = ['Plate', 'Rail', 'Y motor', 'Y rod', 'Board', 'Screw'];
  const r = S.parseResult({ sections: [{ name: 'frame', parts: [1, 2, 99] }, { name: 'Y axis', parts: [3, 4, 1] }, { name: 'Electronics', parts: [5] }] }, names);
  assert.deepEqual(r.order, ['Frame', 'Y axis', 'Electronics', 'Other']);
  assert.equal(r.map.Plate, 'Frame');
  assert.equal(r.map['Y rod'], 'Y axis');
  assert.equal(r.map.Screw, 'Other');
  assert.equal(S.parseResult({ sections: [{ name: 'Frame', parts: [1] }] }, names), null); // mostly unassigned
  assert.equal(S.parseResult(null, names), null);
  assert.equal(S.parseResult({ sections: 'x' }, names), null);
});

test('cacheFits: only a cache for the same parts', () => {
  const c = { key: 'abc', map: { A: 'Frame' }, order: ['Frame'] };
  assert.ok(S.cacheFits(c, 'abc'));
  assert.ok(!S.cacheFits(c, 'abd'));
  assert.ok(!S.cacheFits(null, 'abc'));
});

// ---- web/sections.js: the Parts panel's grouping
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const web = () => import(pathToFileURL(path.join(__dirname, '..', 'web', 'sections.js')).href);
const parts = [
  { name: 'Plate', group: 'case' }, { name: 'Y motor', group: 'component' }, { name: 'Board', group: 'component' },
  { name: 'Y rod', group: 'component' }, { name: 'Bracket', group: 'case' }, { name: 'New part', group: 'case' },
];
const sec = { map: { Plate: 'Frame', Bracket: 'Frame', 'Y motor': 'Y axis', 'Y rod': 'Y axis', Board: 'Electronics' }, order: ['Frame', 'Y axis', 'Electronics'] };

test('web groupBySection: build order, parts not in the map (added since) in Other, last', async () => {
  const W = await web();
  const g = W.groupBySection(parts, sec);
  assert.deepEqual(g.map((x) => x.label), ['Frame', 'Y axis', 'Electronics', 'Other']);
  assert.deepEqual(g[0].parts.map((p) => p.name), ['Plate', 'Bracket']);
  assert.deepEqual(g[3].parts.map((p) => p.name), ['New part']);
});

test('web sectionOf: the part\'s own section beats the classified one', async () => {
  const W = await web();
  assert.equal(W.sectionOf(sec, { name: 'Plate', section: 'Base' }), 'Base');
  assert.equal(W.sectionOf(sec, { name: 'Plate' }), 'Frame');
  assert.equal(W.sectionOf(null, { name: 'Plate' }), 'Other');
});

test('web treeGroups: By section by default when sections exist, By type when chosen or when there are none', async () => {
  const W = await web();
  let t = W.treeGroups(parts, sec, null);
  assert.equal(t.mode, 'section'); assert.ok(t.can);
  t = W.treeGroups(parts, sec, 'type');
  assert.equal(t.mode, 'type');
  assert.deepEqual(t.groups.map((g) => [g.label, g.parts.length]), [['Printed', 3], ['Bought', 3]]);
  t = W.treeGroups(parts, null, 'section');
  assert.equal(t.mode, 'type'); assert.ok(!t.can);
  t = W.treeGroups(parts.map((p) => ({ ...p, section: 'Frame' })), null, null); // one section only: not worth a switch
  assert.ok(!t.can);
  assert.deepEqual(W.sectionList(parts, sec), ['Frame', 'Y axis', 'Electronics', 'Other']);
});
