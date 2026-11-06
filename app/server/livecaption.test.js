// livecaption + livepreview: captions from code and tools, the streamed-JSON decoder and the complete-prefix cut.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const caption = require('./caption');
const lp = require('./livepreview');

test('captions read like a person describing the work', () => {
  assert.strictEqual(caption.phrase(caption.label('camera_window')), 'Cutting the camera window');
  assert.strictEqual(caption.phrase(caption.label('screw_bosses')), 'Adding the screw bosses');
  assert.strictEqual(caption.phrase(caption.label('make_lid')), 'Shaping the lid');
  assert.strictEqual(caption.phrase(caption.label('esp32_board')), 'Placing the ESP32 board');
  assert.strictEqual(caption.label('box'), null); // helpers say nothing
  const code = 'import cadquery as cq\n# ---- vent slots (2 mm)\ndef box(a, b):\n    pass\n\ndef base_plate():\n    return 1\n\ndef parts():\n    return []\n';
  assert.deepStrictEqual(caption.fromCode(code), ['Cutting the vent slots', 'Shaping the base plate', 'Putting the parts together']);
  assert.strictEqual(caption.forTool('Read', { file_path: './uploads/1700000000000-abcdef12.jpg' }), 'Studying your photo');
  assert.strictEqual(caption.forTool('Bash', { command: './build.sh' }), 'Building the parts');
  assert.strictEqual(caption.forBuild(true, 'print estimate: 2 printed parts'), 'Checking it fits the printer');
  assert.strictEqual(caption.forBuild(false), 'Fixing a build problem');
  for (const c of caption.fromCode(code)) assert.ok(!/\bAI\b|agent|Claude/.test(c));
});

test('partialString decodes a streamed JSON string as far as it is complete', () => {
  const src = 'def a():\n    return "x\\\\y"\n\tzé';
  const json = JSON.stringify({ file_path: '/p/design.py', content: src });
  for (let n = 0; n <= json.length; n++) {
    const s = lp.partialString(json.slice(0, n), 'content');
    if (s != null) assert.ok(src.startsWith(s), `cut ${n}: ${JSON.stringify(s)}`);
  }
  assert.strictEqual(lp.partialString(json, 'content'), src);
});

test('completePrefix drops the statement still being typed', () => {
  assert.strictEqual(lp.completePrefix('import cadquery as cq\n\ndef a():\n    return 1\n'), null); // a() may still grow
  assert.strictEqual(lp.completePrefix('import cadquery as cq\n\ndef a():\n    return 1\n\ndef b():\n    ret'), 'import cadquery as cq\n\ndef a():\n    return 1\n\n');
  assert.strictEqual(lp.completePrefix('def a():\n    return 1\n', true), 'def a():\n    return 1\n');
  assert.strictEqual(lp.defCount('def a():\n  pass\ndef b(x):\n  pass\n'), 2);
});

test('a preview session runs one job at a time and keeps only the latest code', () => {
  const writes = [];
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.write = (s) => writes.push(JSON.parse(s).src);
  child.pid = 999999999;
  const parts = [];
  const s = new lp.PreviewSession('/nonexistent-preview-test', { spawnPreview: () => child, onPart: (p) => parts.push(p) });
  s.feed('def a():\n    return 1\n\nX = 1');
  s.feed('def a():\n    return 1\n\ndef b():\n    return 2\n\nY');
  s.feed('def a():\n    return 1\n\ndef b():\n    return 2\n\ndef c():\n    return 3\n\nZ');
  assert.strictEqual(writes.length, 1); // busy: the later prefixes wait, and only the newest is kept
  child.stdout.emit('data', Buffer.from('{"part":{"name":"a","file":"preview/x.stl"}}\n{"done":true}\n'));
  assert.strictEqual(writes.length, 2);
  assert.ok(writes[1].includes('def c()'));
  assert.strictEqual(parts.length, 1);
  s.stop('test');
  s.feed('def a():\n    return 1\n\ndef b():\n    return 2\n\ndef c():\n    return 3\n\ndef d():\n    return 4\n\nW');
  assert.strictEqual(writes.length, 2); // stopped: nothing more
});

test('a crashing function is never run again, and a session that keeps dying stops quietly', () => {
  const { EventEmitter } = require('node:events');
  const writes = []; let spawned = 0;
  const mk = () => { spawned++; const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = new EventEmitter(); c.stdin.write = (s) => writes.push(JSON.parse(s)); c.pid = 999999999; return c; };
  let child;
  const s = new lp.PreviewSession('/nonexistent-preview-test', { spawnPreview: () => (child = mk()), onPart: () => {} });
  s.feed('def a():\n    return 1\n\nX = 1');
  child.stdout.emit('data', Buffer.from('{"trying":"abc"}\n'));
  child.emit('close', 11); // segfault -> quiet exit 11
  assert.strictEqual(spawned, 2); // fresh process for the rest of the job
  assert.deepStrictEqual(writes[1].skip, ['abc']);
  child.emit('close', 11); // dies again before naming anything: that job is not retried
  assert.strictEqual(writes.length, 2);
  let code = 'def a():\n    return 1\n\n';
  for (let i = 0; i < 4 && !s.stopped; i++) { code += `def f${i}():\n    return 1\n\n`; s.feed(code + 'Z'); child.emit('close', 11); }
  assert.ok(s.stopped); // kept crashing: the session ends quietly
});
