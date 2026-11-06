// node --test server/store.test.js   the public store list on a real server.js: examples are listed, the grip trainer
// (looks like a gun in a thumbnail) never is. No AI runs; the server runs from a temp app root (symlinks to this code).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

test('store: examples listed, grip trainer hidden', { skip: 'needs the example designs in data/examples, not in the open-source repo' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'formery-store-root-'));
  for (const d of ['server', 'web', 'gateway']) fs.symlinkSync(path.join(__dirname, '..', d), path.join(root, d));
  fs.mkdirSync(path.join(root, 'data'));
  fs.symlinkSync(path.join(__dirname, '..', 'data', 'examples'), path.join(root, 'data', 'examples'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'formery-store-data-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), FORMA_DATA_DIR: data, FORMA_GATEWAY_SECRET: crypto.randomBytes(16).toString('hex'),
    FORMA_PARTS_PREBUILD: '0', CLAUDE_BIN: '/usr/bin/false' };
  const srv = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(root, 'server', 'server.js')], { env, stdio: 'ignore' });
  t.after(() => { srv.kill(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); });
  let list = null;
  for (let i = 0; i < 80 && !list; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/store`); if (r.ok) list = await r.json(); } catch {}
    if (!list) await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(Array.isArray(list) && list.length > 5, 'store lists the examples');
  const text = JSON.stringify(list);
  assert.ok(!/grip-trainer/.test(text), 'grip trainer is not in the store');
  assert.ok(/arc-desk-lamp/.test(text), 'other examples are');
});
