// node --test server/versions.test.js   (no Claude, no build: simulates agent runs with plain file edits)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const V = require('./versions');

const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const write = (d, f, s) => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), s); };
const msgs = (d, kind = 'design') => JSON.parse(read(d, kind === 'site' ? 'site/messages.json' : 'messages.json'));

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-v-'));
  dirs.push(d);
  write(d, 'design.py', 'v0');
  write(d, 'bom.json', '{"parts":[]}');
  write(d, 'meta.json', '{"title":"T"}');
  write(d, 'messages.json', '[]');
  return d;
}
/** One simulated agent run: same call order as startAgent in server.js. */
function run(d, text, edits, kind = 'design') {
  const file = kind === 'site' ? 'site/messages.json' : 'messages.json';
  const list = fs.existsSync(path.join(d, file)) ? JSON.parse(read(d, file)) : [];
  const ver = V.begin(d, kind, list.length, text);
  list.push({ role: 'user', text }); write(d, file, JSON.stringify(list));
  V.sync(d, kind);
  for (const [f, s] of Object.entries(edits)) s === null ? fs.rmSync(path.join(d, f)) : write(d, f, s);
  const l2 = JSON.parse(read(d, file)); l2.push({ role: 'assistant', text: `Done: ${text}\nmore` }); write(d, file, JSON.stringify(l2));
  V.finish(d, ver.n, `Done: ${text}\nmore`, true);
  return ver;
}

test('undo, redo, rewind and restore move files and flag messages', () => {
  const d = project();
  run(d, 'one', { 'design.py': 'v1' });
  run(d, 'two', { 'design.py': 'v2', 'bom.json': '{"parts":[1]}' });
  run(d, 'three', { 'design.py': 'v3' });
  let h = V.history(d, 'design');
  assert.equal(h.current_v, 3); assert.ok(h.can_undo); assert.ok(!h.can_redo);
  assert.deepEqual(h.versions[1].files, ['bom.json', 'design.py']);
  assert.equal(h.versions[0].summary, 'Done: three');

  assert.equal(V.undo(d, 'design').label, 'Rewound to v2');
  assert.equal(read(d, 'design.py'), 'v2');
  assert.deepEqual(msgs(d).map((m) => !!m.rewound), [false, false, false, false, true, true]);
  assert.ok(V.history(d, 'design').can_redo);

  assert.equal(V.redo(d, 'design').label, 'Restored v3');
  assert.equal(read(d, 'design.py'), 'v3');
  assert.ok(msgs(d).every((m) => !m.rewound));

  assert.equal(V.rewindTo(d, 'design', 2).label, 'Rewound to v1'); // before "two"
  assert.equal(read(d, 'design.py'), 'v1'); assert.equal(read(d, 'bom.json'), '{"parts":[]}');
  assert.deepEqual(msgs(d).map((m) => !!m.rewound), [false, false, true, true, true, true]);

  // a new message after a rewind carries a one-shot note for the agent and branches off v1
  const ver = run(d, 'four', { 'design.py': 'v4' });
  assert.match(ver.note, /BEFORE their message "two"/);
  assert.equal(V.begin(d, 'design', 99, 'x').note, ''); // consumed
});

test('restore an old branch, the original, and a site run keeps waitlist/launch/published', () => {
  const d = project();
  run(d, 'a', { 'design.py': 'A' });
  run(d, 'b', { 'design.py': 'B' });
  V.undo(d, 'design');
  run(d, 'c', { 'design.py': 'C' }); // branch: a -> c ; b is rewound
  assert.equal(V.restoreTo(d, 'design', 2).label, 'Restored v2'); // b
  assert.equal(read(d, 'design.py'), 'B');
  assert.deepEqual(msgs(d).filter((m) => m.role === 'user').map((m) => !!m.rewound), [false, false, true]);
  assert.equal(V.restoreTo(d, 'design', 0).label, 'Rewound to the original');
  assert.equal(read(d, 'design.py'), 'v0');

  write(d, 'site/site.json', '{"copy":{"tagline":"old"}}');
  write(d, 'site/waitlist.json', '[1]');
  write(d, 'site/launch.json', '{"site":1}');
  run(d, 'darker', { 'site/site.json': '{"copy":{"tagline":"new"}}', 'site/theme.css': 'body{}' }, 'site');
  assert.deepEqual(V.history(d, 'site').versions[0].files, ['site/site.json', 'site/theme.css']);
  write(d, 'site/site.json', '{"copy":{"tagline":"new"},"published":true}'); // user publishes after the run
  write(d, 'site/waitlist.json', '[1,2]');
  V.undo(d, 'site');
  assert.equal(JSON.parse(read(d, 'site/site.json')).copy.tagline, 'old');
  assert.equal(JSON.parse(read(d, 'site/site.json')).published, true);
  assert.ok(!fs.existsSync(path.join(d, 'site/theme.css')));
  assert.equal(read(d, 'site/waitlist.json'), '[1,2]');
  assert.equal(read(d, 'site/launch.json'), '{"site":1}');
  assert.equal(read(d, 'design.py'), 'v0'); // design untouched by site undo
});

test('errors: nothing to undo/redo, unknown message', () => {
  const d = project();
  assert.throws(() => V.undo(d, 'design'), /Nothing to undo/);
  run(d, 'a', { 'design.py': 'A' });
  assert.throws(() => V.redo(d, 'design'), /Nothing to redo/);
  assert.throws(() => V.rewindTo(d, 'design', 5), /no saved version/);
});

test('builtOk: a run cut off after a good build left a valid design', () => {
  const d = project();
  assert.equal(V.builtOk([{ ok: true }], d), false); // no manifest yet
  write(d, 'manifest.json', '{}');
  assert.equal(V.builtOk([{ ok: false }, { ok: true }], d), true);
  assert.equal(V.builtOk([{ ok: true }, { ok: false }], d), false);
  assert.equal(V.builtOk([], d), false);
  assert.equal(V.builtOk(undefined, d), false);
});
