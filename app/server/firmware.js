'use strict';
// Firmware: compile a design's Arduino sketch (firmware/<name>/<name>.ino) with arduino-cli for the design's board, and
// serve the flashable image to ESP Web Tools ("Flash to my ESP32" in the Assemble tab, web/assemble.js: esptool-js + Improv).
//
// Routes (api(), under /api/projects/<id>/firmware; owner, admin or an edit collaborator):
//   GET  .../firmware                     status: { sketch, board, boards, state, errors, manifest, ... }
//   POST .../firmware/compile {board?}    compile (async; poll the status). board = an owner override, saved in meta.json
//   GET  .../firmware/manifest.json       ESP Web Tools manifest (only once the current sketch compiled)
//   GET  .../firmware/firmware-<hash>.bin the merged image (bootloader + partitions + app, flashed at offset 0)
//   GET  .../firmware/sketch.zip          the sketch with premake_wifi.h, for the Arduino IDE
//
// Compiles run like CAD builds: macOS sandbox (server/sandbox.js) with no network, writes only to their own work dir
// and the shared arduino build cache, a clean env and a timeout, one at a time. Only libraries already installed on
// this Mac are available (installing happens at setup time, never at compile time). Only .ino/.h/.hpp/.c/.cpp files
// are copied from the sketch (no build_opt.h / sketch.yaml: no extra compiler flags from the agent), and premake_wifi.h
// (server/fwlib) is always the server's own copy.
// Storage: <DATA>/firmware/<project>/<hash>/{firmware.bin,result.json} (cached by hash of the sketch + board + helper),
// <DATA>/firmware/<project>/last.json (the latest result, errors included), <DATA>/firmware/.cache (arduino core cache).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sandbox = require('./sandbox');

const HELPER = path.join(__dirname, 'fwlib', 'premake_wifi.h');
const COMPILE_TIMEOUT = Number(process.env.FORMA_FW_TIMEOUT_S || 300) * 1000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SRC_EXT = /\.(ino|h|hpp|c|cpp)$/i;
const MAX_FILE = 512 * 1024, MAX_TOTAL = 2 * 1024 * 1024, MAX_FILES = 40;

/** Boards Premake compiles for. flash: GPIOs wired to the module's flash chip (never usable); i2c: default SDA/SCL. */
const BOARDS = {
  esp32: { id: 'esp32', label: 'ESP32 DevKit (ESP32-WROOM-32)', fqbn: 'esp32:esp32:esp32', chipFamily: 'ESP32', flash: [6, 7, 8, 9, 10, 11], i2c: [21, 22] },
  esp32c3: { id: 'esp32c3', label: 'ESP32-C3 SuperMini', fqbn: 'esp32:esp32:esp32c3:CDCOnBoot=cdc', chipFamily: 'ESP32-C3', flash: [12, 13, 14, 15, 16, 17], i2c: [8, 9] },
  esp32s3: { id: 'esp32s3', label: 'ESP32-S3 DevKit', fqbn: 'esp32:esp32:esp32s3', chipFamily: 'ESP32-S3', flash: [26, 27, 28, 29, 30, 31, 32], i2c: [8, 9] },
};

let C = null; // init() config
const jobs = new Map(); // project id -> { started, board }
let queue = Promise.resolve();

function init(cfg) {
  const home = os.homedir();
  C = {
    DATA: cfg.DATA, APP: cfg.APP, readJSON: cfg.readJSON, writeJSON: cfg.writeJSON, send: cfg.send, emit: cfg.emit || (() => {}),
    CLI: process.env.FORMA_ARDUINO_CLI || ['/opt/homebrew/bin/arduino-cli', '/usr/local/bin/arduino-cli'].find((p) => fs.existsSync(p)) || 'arduino-cli',
    ARDUINO_DATA: process.env.FORMA_ARDUINO_DATA || path.join(home, 'Library', 'Arduino15'),
    ARDUINO_USER: process.env.FORMA_ARDUINO_USER || path.join(home, 'Documents', 'Arduino'),
    // the core's gen_esp32part.py runs as `python3`; /usr/bin/python3 is an Xcode shim the sandbox can't load, so a real one
    PYTHON: process.env.FORMA_FW_PYTHON || ['/opt/homebrew/bin/python3', '/usr/local/bin/python3'].find((p) => fs.existsSync(p)) || '',
  };
  C.ROOT = path.join(C.DATA, 'firmware');
  C.CACHE = path.join(C.ROOT, '.cache');
  C.WORK = path.join(C.ROOT, '.work');
  try { fs.rmSync(C.WORK, { recursive: true, force: true }); } catch {} // leftovers from a crash
  return module.exports;
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJ(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, f); }
const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };

/** The design's Arduino sketch: firmware/<name>/<name>.ino (or a lone firmware/<name>.ino). null when there is none
 * (no firmware, or MicroPython main.py). Symlinks are never followed. */
function findSketch(dir) {
  const fw = path.join(dir, 'firmware');
  if (!isDir(fw)) return null;
  let names = [];
  try { names = fs.readdirSync(fw).sort(); } catch { return null; }
  for (const n of names) {
    if (n.startsWith('.') || !isDir(path.join(fw, n))) continue;
    if (isFile(path.join(fw, n, n + '.ino'))) return { name: n, dir: path.join(fw, n), rel: `firmware/${n}/${n}.ino` };
  }
  for (const n of names) { // a sketch folder whose .ino has another name
    if (n.startsWith('.') || !isDir(path.join(fw, n))) continue;
    const ino = (() => { try { return fs.readdirSync(path.join(fw, n)).filter((f) => /\.ino$/i.test(f)).sort(); } catch { return []; } })();
    if (ino.length) return { name: n, dir: path.join(fw, n), main: ino[0], rel: `firmware/${n}/${ino[0]}` };
  }
  const lone = names.filter((n) => /\.ino$/i.test(n) && isFile(path.join(fw, n)));
  if (lone.length) { const n = lone[0].replace(/\.ino$/i, ''); return { name: n.replace(/[^A-Za-z0-9_]/g, '_') || 'sketch', dir: fw, main: lone[0], loose: true, rel: `firmware/${lone[0]}` }; }
  return null;
}

/** The sketch's source files: [{ rel, data }] (regular files only, capped). */
function sketchFiles(sk) {
  const out = [];
  let total = 0;
  const add = (abs, rel) => {
    if (!SRC_EXT.test(rel) || /(^|\/)build_opt\.h$/i.test(rel) || /(^|\/)premake_wifi\.h$/i.test(rel)) return;
    let st; try { st = fs.lstatSync(abs); } catch { return; }
    if (!st.isFile() || st.size > MAX_FILE || total + st.size > MAX_TOTAL || out.length >= MAX_FILES) return;
    total += st.size;
    out.push({ rel, data: fs.readFileSync(abs) });
  };
  let names = [];
  try { names = fs.readdirSync(sk.dir).sort(); } catch {}
  for (const n of names) {
    if (n.startsWith('.')) continue;
    if (sk.loose && !SRC_EXT.test(n)) continue;
    const abs = path.join(sk.dir, n);
    if (!sk.loose && n === 'src' && isDir(abs)) { // Arduino compiles src/ (one level) too
      for (const m of (() => { try { return fs.readdirSync(abs).sort(); } catch { return []; } })()) if (!m.startsWith('.')) add(path.join(abs, m), `src/${m}`);
      continue;
    }
    add(abs, sk.main && n === sk.main ? `${sk.name}.ino` : n);
  }
  return out;
}

/** Which board this design is for: the owner's pick (meta.firmware_board), then wiring.json "board", then the sketch's
 * "Board:" comment, then the controller named in wiring.json / bom.json. Default: the ESP32 DevKit. */
function detectBoard(dir, sk = findSketch(dir)) {
  const meta = readJ(path.join(dir, 'meta.json'), {}) || {};
  if (BOARDS[meta.firmware_board]) return { board: BOARDS[meta.firmware_board], from: 'owner' };
  const wiring = readJ(path.join(dir, 'wiring.json'), {}) || {};
  const byText = (t) => {
    t = String(t || '');
    if (/esp32[\s_-]*c3/i.test(t)) return BOARDS.esp32c3;
    if (/esp32[\s_-]*s3/i.test(t)) return BOARDS.esp32s3;
    if (/esp32|wroom|esp-wroom/i.test(t)) return BOARDS.esp32;
    return null;
  };
  if (typeof wiring.board === 'string' && (BOARDS[wiring.board] || byText(wiring.board))) return { board: BOARDS[wiring.board] || byText(wiring.board), from: 'wiring' };
  if (sk) {
    const main = readText(path.join(sk.dir, sk.main || sk.name + '.ino')) || '';
    const m = /^\s*\/\/\s*Board:\s*(.+)$/im.exec(main.slice(0, 4000));
    if (m && byText(m[1])) return { board: byText(m[1]), from: 'sketch' };
  }
  const names = [];
  for (const w of Array.isArray(wiring.wires) ? wiring.wires : []) for (const e of [w?.from, w?.to]) if (e && typeof e.part === 'string') names.push(e.part);
  const bom = readJ(path.join(dir, 'bom.json'), {}) || {};
  for (const p of Array.isArray(bom.parts) ? bom.parts : []) if (p && typeof p.name === 'string') names.push(p.name);
  for (const n of names) { const b = byText(n); if (b && b !== BOARDS.esp32) return { board: b, from: 'parts' }; }
  for (const n of names) { const b = byText(n); if (b) return { board: b, from: 'parts' }; }
  return { board: BOARDS.esp32, from: 'default' };
}

/** Pins the sketch uses that can't work on this board (the flash pins). From `const int PIN_X = 6;`, `#define PIN_X 6`,
 * Wire.begin(6, 7) and wiring.json "GPIO6" pins. */
function pinProblems(dir, sk, board, files) {
  const bad = new Set();
  const flash = new Set(board.flash);
  for (const f of files) {
    if (!/\.(ino|h|hpp|cpp|c)$/i.test(f.rel)) continue;
    const s = f.data.toString('utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of s.matchAll(/\b(?:const\s+)?(?:int|uint8_t|int8_t|gpio_num_t|byte|unsigned)\s+(?:\w+\s+)?(\w*PIN\w*|\w*_(?:SDA|SCL|SERVO|LED|BTN|BUTTON)\w*)\s*=\s*(\d+)\s*;/gi)) if (flash.has(+m[2])) bad.add(+m[2]);
    for (const m of s.matchAll(/^\s*#define\s+(\w*(?:PIN|SDA|SCL)\w*)\s+\(?(\d+)\)?\s*$/gim)) if (flash.has(+m[2])) bad.add(+m[2]);
    for (const m of s.matchAll(/Wire1?\.begin\(\s*(\d+)\s*,\s*(\d+)/g)) for (const p of [+m[1], +m[2]]) if (flash.has(p)) bad.add(p);
  }
  const wiring = readJ(path.join(dir, 'wiring.json'), {}) || {};
  for (const w of Array.isArray(wiring.wires) ? wiring.wires : []) for (const e of [w?.from, w?.to]) {
    const m = /^(?:GPIO|IO|D)?\s*(\d+)$/i.exec(String(e?.pin || '').trim());
    if (m && /esp32|wroom|devkit|c3|s3/i.test(String(e?.part || '')) && flash.has(+m[1])) bad.add(+m[1]);
  }
  return [...bad].sort((a, b) => a - b);
}

function hashOf(board, files) {
  const h = crypto.createHash('sha256').update('premake-fw-1\0' + board.fqbn + '\0').update(readText(HELPER) || '');
  for (const f of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) h.update('\0' + f.rel + '\0').update(f.data);
  return h.digest('hex').slice(0, 20);
}

function projRoot(id) { return path.join(C.ROOT, id); }

/** Where the design's firmware stands right now (cheap: reads files, never compiles). */
function status(id, dir) {
  const sk = findSketch(dir);
  const base = `/api/projects/${encodeURIComponent(id)}/firmware`;
  const boards = Object.values(BOARDS).map((b) => ({ id: b.id, label: b.label }));
  if (!sk) {
    const py = isFile(path.join(dir, 'firmware', 'main.py'));
    return { sketch: null, micropython: py, state: 'none', boards };
  }
  const files = sketchFiles(sk);
  const { board, from } = detectBoard(dir, sk);
  const hash = hashOf(board, files);
  const out = { sketch: sk.rel, name: sk.name, board: board.id, board_label: board.label, board_from: from, chip: board.chipFamily, boards, hash,
    uses_wifi_helper: files.some((f) => /#\s*include\s*[<"]premake_wifi\.h[">]/.test(f.data.toString('utf8'))), zip: `${base}/sketch.zip` };
  out.wifi_hardcoded = !out.uses_wifi_helper && files.some((f) => /\bWiFi\.begin\s*\(\s*[A-Za-z_"]/.test(f.data.toString('utf8'))); // the old way: a name and password in the code
  const done = readJ(path.join(projRoot(id), hash, 'result.json'), null);
  const job = jobs.get(id);
  if (done?.ok && isFile(path.join(projRoot(id), hash, 'firmware.bin'))) {
    Object.assign(out, { state: 'ready', manifest: `${base}/manifest.json?h=${hash}`, size: done.size, usage: done.usage, compiled: done.t, seconds: done.seconds, warnings: done.warnings || [] });
  } else if (job) {
    Object.assign(out, { state: 'compiling', since: job.started });
  } else {
    const last = readJ(path.join(projRoot(id), 'last.json'), null);
    if (last && last.hash === hash && !last.ok) Object.assign(out, { state: 'failed', errors: last.errors || [], log: last.log || '', compiled: last.t });
    else Object.assign(out, { state: 'stale' }); // never compiled, or the sketch / board changed since
  }
  return out;
}

/** Turn arduino-cli output into short error lines with paths relative to the sketch. */
function cleanLog(text, work) {
  let t = String(text || '');
  const w = work && fs.existsSync(work) ? fs.realpathSync(work) : work;
  for (const p of [w, work].filter(Boolean)) t = t.split(p + '/sketch/').join('').split(p + '/').join('').split(p).join('');
  t = t.split(C.CACHE).join('<cache>').split(C.ARDUINO_DATA).join('<arduino>').split(C.ARDUINO_USER).join('<libraries>').split(os.homedir()).join('~');
  return t;
}
function errorLines(log) {
  const lines = log.split('\n');
  const errs = [];
  for (const l of lines) {
    if (/(^|\s)(fatal )?error:/i.test(l) || /undefined reference to/.test(l) || /^Error during build/i.test(l) || /No such file or directory/.test(l)) {
      let s = l.trim();
      const miss = /fatal error: ([\w./-]+\.h): No such file or directory/.exec(s);
      if (miss) s += ` (library not installed on Premake; use only: ${LIBRARIES.join(', ')})`;
      if (!errs.includes(s)) errs.push(s);
    }
    if (errs.length >= 25) break;
  }
  return errs;
}
const LIBRARIES = ['ESP32Servo', 'Adafruit SSD1306', 'Adafruit GFX', 'Adafruit BusIO', 'DHT sensor library', 'Adafruit Unified Sensor', 'Adafruit NeoPixel', 'FastLED', 'AccelStepper', 'LiquidCrystal I2C',
  'plus the ESP32 core (WiFi, HTTPClient, WiFiClientSecure, WebServer, Preferences, Wire, SPI, BLE, ESPmDNS, Update)'];

function run(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    const keep = (d) => { out = (out + d).slice(-60000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    child.on('error', (e) => { out += '\n' + String(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}

/** Compile (or reuse the cached image). Resolves to { ok, hash, board, errors?, cached? }. One compile at a time. */
function compile(id, dir, { board: pick } = {}) {
  if (!ID_RE.test(id)) return Promise.resolve({ ok: false, errors: ['bad project id'] });
  if (pick !== undefined) {
    const mf = path.join(dir, 'meta.json'), meta = readJ(mf, null);
    if (meta) {
      if (pick && BOARDS[pick]) meta.firmware_board = pick; else delete meta.firmware_board;
      writeJ(mf, meta);
    }
  }
  const sk = findSketch(dir);
  if (!sk) return Promise.resolve({ ok: false, errors: ['This design has no Arduino firmware (firmware/<name>/<name>.ino).'] });
  const files = sketchFiles(sk);
  const { board } = detectBoard(dir, sk);
  const hash = hashOf(board, files);
  const out = path.join(projRoot(id), hash);
  if (readJ(path.join(out, 'result.json'), null)?.ok && isFile(path.join(out, 'firmware.bin'))) return Promise.resolve({ ok: true, hash, board: board.id, cached: true });
  const bad = pinProblems(dir, sk, board, files);
  if (bad.length) {
    const r = { ok: false, hash, board: board.id, t: new Date().toISOString(),
      errors: [`GPIO ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} wired to the ${board.label}'s flash chip and can't be used. Move ${bad.length > 1 ? 'them' : 'it'} to free pins${board.id === 'esp32' ? ' (I2C: SDA 21, SCL 22; PWM/servo: 13, 14, 25, 26, 27, 32, 33)' : ''}, or pick the board this design was made for.`] };
    writeJ(path.join(projRoot(id), 'last.json'), r);
    return Promise.resolve(r);
  }
  if (jobs.has(id)) return jobs.get(id).promise;
  const job = { started: new Date().toISOString(), board: board.id };
  job.promise = (queue = queue.then(() => doCompile(id, sk, files, board, hash), () => doCompile(id, sk, files, board, hash))).finally(() => { jobs.delete(id); C.emit(id, { type: 'firmware_updated' }); });
  jobs.set(id, job);
  C.emit(id, { type: 'firmware_updated' });
  return job.promise;
}

async function doCompile(id, sk, files, board, hash) {
  const t0 = Date.now();
  // A stable sketch path per design (compiles are one at a time): arduino-cli keys its build folder in the cache by the
  // sketch path, so a recompile is incremental and the core is compiled once per board, not per compile.
  const work = path.join(C.WORK, id);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  const skDir = path.join(work, 'sketch', sk.name);
  const home = path.join(work, 'home');
  const finish = (r) => { try { writeJ(path.join(projRoot(id), 'last.json'), r); } catch {} try { fs.rmSync(work, { recursive: true, force: true }); } catch {} return r; };
  try {
    for (const f of files) { const p = path.join(skDir, f.rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }
    fs.copyFileSync(HELPER, path.join(skDir, 'premake_wifi.h'));
    fs.mkdirSync(path.join(home, 'tmp'), { recursive: true });
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    let pyReal = '';
    if (C.PYTHON) { pyReal = fs.realpathSync(C.PYTHON); fs.symlinkSync(pyReal, path.join(bin, 'python3')); }
    fs.mkdirSync(C.CACHE, { recursive: true });
    const outDir = path.join(work, 'out');
    const args = ['compile', '--fqbn', board.fqbn, '--output-dir', outDir,
      '--no-color', '--warnings', 'default', skDir];
    const env = sandbox.cleanEnv(home, { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      ARDUINO_DIRECTORIES_DATA: C.ARDUINO_DATA, ARDUINO_DIRECTORIES_USER: C.ARDUINO_USER, ARDUINO_BUILD_CACHE_PATH: C.CACHE,
      ARDUINO_BUILD_CACHE_TTL: '72h', ARDUINO_UPDATER_ENABLE_NOTIFICATION: 'false', ARDUINO_LOGGING_LEVEL: 'error' });
    const cli = fs.existsSync(C.CLI) ? fs.realpathSync(C.CLI) : C.CLI;
    const [cmd, argv] = sandbox.wrap(cli, args, { dir: work, app: C.APP, extraReads: [C.ARDUINO_DATA, C.ARDUINO_USER, path.dirname(cli), pyReal && path.resolve(pyReal, '..', '..')].filter((p) => p).filter((p) => fs.existsSync(p)), extraWrites: [C.CACHE],
      symlinks: true }); // the core's esptool is a PyInstaller binary that unpacks (with symlinks) into TMPDIR; the work dir is ours alone and deleted after
    const r = await run(cmd, argv, { cwd: work, env }, COMPILE_TIMEOUT);
    const log = cleanLog(r.out, work).slice(-20000);
    const merged = path.join(outDir, `${sk.name}.ino.merged.bin`);
    if (r.code !== 0 || r.timedOut || !isFile(merged)) {
      const errors = r.timedOut ? [`The compile took longer than ${COMPILE_TIMEOUT / 1000} s and was stopped.`] : errorLines(log);
      if (!errors.length) errors.push(isFile(merged) || r.code !== 0 ? (log.trim().split('\n').slice(-3).join(' ') || `arduino-cli exited with code ${r.code}`) : 'The compile finished without a flashable image.');
      return finish({ ok: false, hash, board: board.id, t: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), errors, log: log.slice(-6000) });
    }
    const dst = path.join(projRoot(id), hash);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(merged, path.join(dst, 'firmware.bin'));
    const app = path.join(outDir, `${sk.name}.ino.bin`);
    const usage = (/Sketch uses .*$/m.exec(log) || [''])[0].trim();
    const warnings = log.split('\n').filter((l) => /warning:/.test(l)).slice(0, 10).map((l) => l.trim());
    const res = { ok: true, hash, board: board.id, fqbn: board.fqbn, chipFamily: board.chipFamily, name: sk.name, size: isFile(app) ? fs.statSync(app).size : null, usage, warnings,
      t: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) };
    writeJ(path.join(dst, 'result.json'), res);
    prune(id, hash);
    return finish(res);
  } catch (e) {
    return finish({ ok: false, hash, board: board.id, t: new Date().toISOString(), errors: ['Compile failed: ' + e.message] });
  }
}

/** Keep the 3 newest images per design (each is up to 4 MB). */
function prune(id, keep) {
  const root = projRoot(id);
  let ds = [];
  try { ds = fs.readdirSync(root).filter((n) => /^[0-9a-f]{20}$/.test(n)).map((n) => ({ n, t: fs.statSync(path.join(root, n)).mtimeMs })); } catch { return; }
  ds.sort((a, b) => b.t - a.t);
  for (const d of ds.slice(3)) if (d.n !== keep) try { fs.rmSync(path.join(root, d.n), { recursive: true, force: true }); } catch {}
}

/** A tiny store-only zip (no deps) of the sketch folder, premake_wifi.h included. */
function zip(entries) {
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunks = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), data = e.data, c = crc(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    chunks.push(h, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...chunks, cd, end]);
}

/** /api/projects/<id>/firmware[/...]. sub = the path after "firmware" ('' | 'compile' | 'manifest.json' | 'firmware-<hash>.bin' | 'sketch.zip'). */
async function api(req, res, { id, dir, sub, m, readBody, canWrite }) {
  const send = C.send;
  if (!sub && m === 'GET') return send(res, 200, status(id, dir));
  if (sub === 'compile' && m === 'POST') {
    if (!canWrite) return send(res, 403, { error: 'Only the owner can do that.' });
    const body = await readBody(req, 2e3).catch(() => ({}));
    const board = typeof body?.board === 'string' ? (BOARDS[body.board] ? body.board : '') : undefined;
    const p = compile(id, dir, { board });
    if (body?.wait) { const r = await p; return send(res, 200, { ...status(id, dir), result: r }); }
    p.catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    return send(res, 202, status(id, dir));
  }
  if (sub === 'manifest.json' && (m === 'GET' || m === 'HEAD')) {
    const st = status(id, dir);
    if (st.state !== 'ready') return send(res, 404, { error: 'The firmware is not compiled yet.' });
    const meta = readJ(path.join(dir, 'meta.json'), {}) || {};
    const man = { name: String(meta.title || st.name).slice(0, 80), version: st.hash.slice(0, 8), new_install_prompt_erase: true,
      builds: [{ chipFamily: st.chip, parts: [{ path: `firmware-${st.hash}.bin`, offset: 0 }] }] };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(m === 'HEAD' ? undefined : JSON.stringify(man));
  }
  const bin = /^firmware-([0-9a-f]{20})\.bin$/.exec(sub || '');
  if (bin && (m === 'GET' || m === 'HEAD')) {
    const f = path.join(projRoot(id), bin[1], 'firmware.bin');
    if (!readJ(path.join(projRoot(id), bin[1], 'result.json'), null)?.ok || !isFile(f)) return send(res, 404, { error: 'not found' });
    const size = fs.statSync(f).size;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'private, max-age=86400, immutable',
      'Content-Disposition': `attachment; filename="${id}-${bin[1].slice(0, 8)}.bin"`, 'X-Content-Type-Options': 'nosniff' });
    if (m === 'HEAD') return res.end();
    return fs.createReadStream(f).pipe(res);
  }
  if (sub === 'sketch.zip' && m === 'GET') {
    const sk = findSketch(dir);
    if (!sk) return send(res, 404, { error: 'not found' });
    const entries = sketchFiles(sk).map((f) => ({ name: `${sk.name}/${f.rel}`, data: f.data }));
    entries.push({ name: `${sk.name}/premake_wifi.h`, data: fs.readFileSync(HELPER) });
    const z = zip(entries);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': z.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${sk.name}.zip"` });
    return res.end(z);
  }
  return send(res, 404, { error: 'not found' });
}

/** Text for the design agent's fix turn after a failed compile. */
function fixPrompt(r) {
  const errs = (r.errors || []).slice(0, 15).map((e) => `- ${e}`).join('\n');
  return `The firmware didn't compile for the ${BOARDS[r.board]?.label || r.board} (arduino-cli, ESP32 Arduino core ${CORE_VERSION()}). Fix the sketch so it compiles; change nothing else unless the fix needs it.\n\nCompiler errors:\n${errs || '(no error lines; see the log)'}`;
}
let coreVersion = null;
function CORE_VERSION() {
  if (coreVersion) return coreVersion;
  try { coreVersion = fs.readdirSync(path.join(C.ARDUINO_DATA, 'packages', 'esp32', 'hardware', 'esp32')).sort().pop() || '3.x'; } catch { coreVersion = '3.x'; }
  return coreVersion;
}

/** A sketch fingerprint (files only, board-independent): did a design run change the firmware? */
function sketchSig(dir) {
  const sk = findSketch(dir);
  if (!sk) return null;
  const h = crypto.createHash('sha1');
  for (const f of sketchFiles(sk)) h.update(f.rel + '\0').update(f.data);
  return h.digest('hex');
}

module.exports = { init, BOARDS, findSketch, sketchFiles, detectBoard, pinProblems, hashOf, status, compile, api, fixPrompt, sketchSig, errorLines, zip, CORE_VERSION, HELPER };
