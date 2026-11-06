'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { AutoBuild, prepareShadow, DIR } = require('./autobuild');

function proj() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'autobuild-'));
  fs.writeFileSync(path.join(d, 'design.py'), 'x = 1\n');
  fs.writeFileSync(path.join(d, 'bom.json'), '{}');
  fs.writeFileSync(path.join(d, 'manifest.json'), '{"parts":[{"name":"old"}]}');
  fs.writeFileSync(path.join(d, 'messages.json'), '[]');
  fs.mkdirSync(path.join(d, 'stl')); fs.mkdirSync(path.join(d, 'firmware')); fs.mkdirSync(path.join(d, '.agent-home'));
  return d;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('prepareShadow copies inputs, links folders, never the model, chats or dot dirs', () => {
  const d = proj(), sh = prepareShadow(d);
  assert.equal(sh, path.join(d, DIR));
  assert.equal(fs.readFileSync(path.join(sh, 'design.py'), 'utf8'), 'x = 1\n');
  assert.ok(fs.existsSync(path.join(sh, 'bom.json')));
  for (const n of ['manifest.json', 'messages.json', 'stl', '.agent-home', DIR]) assert.ok(!fs.existsSync(path.join(sh, n)), n);
  assert.ok(fs.lstatSync(path.join(sh, 'firmware')).isSymbolicLink());
  fs.writeFileSync(path.join(sh, 'manifest.json'), '{}'); // last round's model goes
  prepareShadow(d);
  assert.ok(!fs.existsSync(path.join(sh, 'manifest.json')));
});

function fakeSpawn(log, ok = true) {
  return (sh) => {
    const c = new EventEmitter(); c.pid = 999999; c.kill = () => { c.killed = true; setImmediate(() => c.emit('close', null)); };
    log.push(c);
    setTimeout(() => { if (c.killed) return; if (ok) fs.writeFileSync(path.join(sh, 'manifest.json'), JSON.stringify({ t: log.length, parts: [{ name: 'a' }] })); c.emit('close', ok ? 0 : 1); }, 30);
    return c;
  };
}

test('a burst of edits is one build; the model is reported', async () => {
  const d = proj(), spawned = [], models = [];
  const a = new AutoBuild({ dir: d, spawnBuild: fakeSpawn(spawned), onModel: (m) => models.push(m), debounceMs: 20 });
  a.edited(); a.edited(); a.edited();
  await wait(120);
  assert.equal(spawned.length, 1);
  assert.equal(models.length, 1);
  a.stop();
});

test('edits during a build run it once more after; a failed build is silent', async () => {
  const d = proj(), spawned = [], models = [];
  const a = new AutoBuild({ dir: d, spawnBuild: fakeSpawn(spawned), onModel: (m) => models.push(m), debounceMs: 10 });
  a.edited(); await wait(20); a.edited(); a.edited(); await wait(150);
  assert.equal(spawned.length, 2); assert.equal(models.length, 2);
  const b = new AutoBuild({ dir: d, spawnBuild: fakeSpawn([], false), onModel: (m) => models.push(m), debounceMs: 10 });
  b.edited(); await wait(80);
  assert.equal(models.length, 2);
});

test("the agent's own build wins: skipped while it runs, an auto build in flight is dropped", async () => {
  const d = proj(), spawned = [], models = [];
  let building = true;
  const a = new AutoBuild({ dir: d, spawnBuild: fakeSpawn(spawned), onModel: (m) => models.push(m), agentBuilding: () => building, debounceMs: 10 });
  a.edited(); await wait(40);
  assert.equal(spawned.length, 0);
  building = false; a.edited(); await wait(15); a.agentBuildStarted(); await wait(60);
  assert.equal(spawned.length, 1); assert.ok(spawned[0].killed); assert.equal(models.length, 0);
});
