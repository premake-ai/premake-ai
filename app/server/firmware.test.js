'use strict';
// firmware: board detection, sketch discovery, pin checks, status/manifest, the zip, and (when arduino-cli and the esp32
// core are installed on this Mac) one real sandboxed compile. Run: node --test server/firmware.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fw = require('./firmware');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fwtest-'));
const DATA = path.join(tmp, 'data');
fw.init({ DATA, APP: path.resolve(__dirname, '..'), send() {} });
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function project(files) {
  const dir = path.join(tmp, 'p' + ++n);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}
const SKETCH = `// Board: ESP32 DevKit (ESP32-WROOM-32)
#include "premake_wifi.h"
const int PIN_LED = 13;
void setup() { PremakeWiFi.begin("Blink", "1.0.0"); pinMode(PIN_LED, OUTPUT); }
void loop() { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(500); }
`;

test('finds the sketch: firmware/<name>/<name>.ino, another .ino name, a loose .ino; none for MicroPython', () => {
  assert.equal(fw.findSketch(project({ 'firmware/blink/blink.ino': SKETCH })).name, 'blink');
  const other = fw.findSketch(project({ 'firmware/blink/main.ino': SKETCH }));
  assert.equal(other.main, 'main.ino');
  assert.equal(fw.sketchFiles(other)[0].rel, 'blink.ino'); // renamed to the folder's name for arduino-cli
  assert.equal(fw.findSketch(project({ 'firmware/thing.ino': SKETCH })).loose, true);
  assert.equal(fw.findSketch(project({ 'firmware/main.py': 'print(1)' })), null);
  assert.equal(fw.findSketch(project({ 'meta.json': {} })), null);
});

test('sketch files: only sources, never build_opt.h, sketch.yaml or a planted premake_wifi.h; no symlinks', () => {
  const dir = project({ 'firmware/b/b.ino': SKETCH, 'firmware/b/util.h': '#pragma once', 'firmware/b/build_opt.h': '-fplugin=x',
    'firmware/b/sketch.yaml': 'x', 'firmware/b/premake_wifi.h': '// fake', 'firmware/b/src/x.cpp': 'int x;', 'firmware/b/notes.txt': 'hi' });
  fs.symlinkSync('/etc/hosts', path.join(dir, 'firmware/b/hosts.h'));
  const rels = fw.sketchFiles(fw.findSketch(dir)).map((f) => f.rel).sort();
  assert.deepEqual(rels, ['b.ino', 'src/x.cpp', 'util.h']);
});

test('board: owner pick > wiring.json board > the sketch Board: line > parts > default DevKit', () => {
  const c3 = { parts: [{ name: 'ESP32-C3 SuperMini', qty_per_unit: 1 }] };
  assert.equal(fw.detectBoard(project({ 'firmware/a/a.ino': 'void setup(){}', 'bom.json': c3 })).board.id, 'esp32c3');
  assert.equal(fw.detectBoard(project({ 'firmware/a/a.ino': '// Board: ESP32-S3 DevKit\n', 'bom.json': c3 })).board.id, 'esp32s3');
  assert.equal(fw.detectBoard(project({ 'firmware/a/a.ino': '// Board: ESP32-S3\n', 'wiring.json': { board: 'esp32', wires: [] } })).board.id, 'esp32');
  assert.equal(fw.detectBoard(project({ 'firmware/a/a.ino': '// Board: ESP32-S3\n', 'meta.json': { firmware_board: 'esp32c3' } })).board.id, 'esp32c3');
  const def = fw.detectBoard(project({ 'firmware/a/a.ino': 'void setup(){}' }));
  assert.equal(def.board.id, 'esp32'); assert.equal(def.from, 'default');
  assert.equal(fw.BOARDS.esp32.fqbn, 'esp32:esp32:esp32');
});

test('pin check: WROOM flash pins (6-11) in code or wiring.json are refused before compiling', async () => {
  const bad = project({ 'firmware/a/a.ino': '// Board: ESP32 DevKit\nconst int PIN_SDA = 6;\nconst int PIN_SCL = 7;\nvoid setup(){ Wire.begin(PIN_SDA, PIN_SCL); }\nvoid loop(){}' });
  const sk = fw.findSketch(bad);
  assert.deepEqual(fw.pinProblems(bad, sk, fw.BOARDS.esp32, fw.sketchFiles(sk)), [6, 7]);
  assert.deepEqual(fw.pinProblems(bad, sk, fw.BOARDS.esp32c3, fw.sketchFiles(sk)), []); // fine on a C3
  const r = await fw.compile('pinbad', bad);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /GPIO 6, 7 .*flash chip/);
  assert.equal(fw.status('pinbad', bad).state, 'failed');
  const wired = project({ 'firmware/a/a.ino': 'void setup(){}', 'wiring.json': { wires: [{ from: { part: 'ESP32 DevKitC', pin: 'GPIO9' }, to: { part: 'LED', pin: '+' } }] } });
  const s2 = fw.findSketch(wired);
  assert.deepEqual(fw.pinProblems(wired, s2, fw.BOARDS.esp32, fw.sketchFiles(s2)), [9]);
});

test('status: stale before a compile; hash changes with the code and the board', () => {
  const dir = project({ 'firmware/blink/blink.ino': SKETCH });
  const s = fw.status('st1', dir);
  assert.equal(s.state, 'stale'); assert.equal(s.board, 'esp32'); assert.equal(s.uses_wifi_helper, true); assert.equal(s.wifi_hardcoded, false);
  fs.appendFileSync(path.join(dir, 'firmware/blink/blink.ino'), '// x\n');
  assert.notEqual(fw.status('st1', dir).hash, s.hash);
  const files = fw.sketchFiles(fw.findSketch(dir));
  assert.notEqual(fw.hashOf(fw.BOARDS.esp32, files), fw.hashOf(fw.BOARDS.esp32c3, files));
  const old = project({ 'firmware/o/o.ino': 'const char* S="x";\nvoid setup(){ WiFi.begin(S, "pw"); }\nvoid loop(){}' });
  assert.equal(fw.status('st2', old).wifi_hardcoded, true);
});

test('compile errors become short lines; a missing library says which ones exist', () => {
  const errs = fw.errorLines('blink.ino:3:10: fatal error: Foo.h: No such file or directory\nsomething fine\nblink.ino:9:1: error: expected \';\'\n');
  assert.equal(errs.length, 2);
  assert.match(errs[0], /library not installed on Premake; use only: ESP32Servo/);
  assert.match(fw.fixPrompt({ board: 'esp32', errors: errs }), /ESP32 DevKit.*\n[\s\S]*- blink\.ino:9:1/);
});

test('zip: a valid store-only archive (unzip -t)', () => {
  const z = fw.zip([{ name: 'a/a.ino', data: Buffer.from(SKETCH) }, { name: 'a/premake_wifi.h', data: fs.readFileSync(fw.HELPER) }]);
  const f = path.join(tmp, 't.zip'); fs.writeFileSync(f, z);
  const out = execFileSync('/usr/bin/unzip', ['-t', f]).toString();
  assert.match(out, /No errors detected/);
});

test('api: manifest 404 until compiled; compile needs write access; bad bin names 404', async () => {
  const dir = project({ 'firmware/blink/blink.ino': SKETCH });
  const res = () => { const r = { code: 0, headers: {}, body: '' }; r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); }; r.end = (b) => { r.body = b || ''; }; return r; };
  const sent = [];
  fw.init({ DATA, APP: path.resolve(__dirname, '..'), send: (r, code, body) => { sent.push({ code, body }); } });
  await fw.api({}, res(), { id: 'api1', dir, sub: 'manifest.json', m: 'GET' });
  assert.equal(sent.pop().code, 404);
  await fw.api({}, res(), { id: 'api1', dir, sub: 'compile', m: 'POST', readBody: async () => ({}), canWrite: false });
  assert.equal(sent.pop().code, 403);
  await fw.api({}, res(), { id: 'api1', dir, sub: 'firmware-../../x.bin', m: 'GET' });
  assert.equal(sent.pop().code, 404);
  const z = res();
  await fw.api({}, z, { id: 'api1', dir, sub: 'sketch.zip', m: 'GET' });
  assert.equal(z.headers['Content-Type'], 'application/zip');
  fw.init({ DATA, APP: path.resolve(__dirname, '..'), send() {} });
});

const CLI = ['/opt/homebrew/bin/arduino-cli', '/usr/local/bin/arduino-cli'].find((p) => fs.existsSync(p));
const CORE = path.join(os.homedir(), 'Library', 'Arduino15', 'packages', 'esp32', 'hardware', 'esp32');
test('a real sandboxed compile for the ESP32 DevKit gives a merged image and an ESP Web Tools manifest', { skip: !CLI || !fs.existsSync(CORE) || process.env.FORMA_FW_TEST_COMPILE === '0' ? 'arduino-cli / esp32 core not installed' : false, timeout: 400e3 }, async () => {
  const dir = project({ 'firmware/blink/blink.ino': SKETCH, 'meta.json': { title: 'Blink' } });
  const r = await fw.compile('real1', dir);
  assert.equal(r.ok, true, JSON.stringify(r.errors || r));
  const s = fw.status('real1', dir);
  assert.equal(s.state, 'ready');
  const bin = fs.readFileSync(path.join(DATA, 'firmware', 'real1', s.hash, 'firmware.bin'));
  assert.equal(bin.length, 4 * 1024 * 1024); // merged and padded to the 4 MB flash, flashed at 0
  assert.equal(bin[0x1000], 0xe9); // the bootloader image header sits at 0x1000 on the ESP32
  assert.equal(bin[0x10000], 0xe9); // the app at 0x10000
  const again = await fw.compile('real1', dir);
  assert.equal(again.cached, true);
  let man = null;
  const r2 = { writeHead() {}, end(b) { man = JSON.parse(b); } };
  await fw.api({}, r2, { id: 'real1', dir, sub: 'manifest.json', m: 'GET' });
  assert.deepEqual(man.builds, [{ chipFamily: 'ESP32', parts: [{ path: `firmware-${s.hash}.bin`, offset: 0 }] }]);
  assert.equal(man.name, 'Blink');
});
