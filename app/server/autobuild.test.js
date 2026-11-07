'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AutoBuild, prepareShadow, workerJob, DIR } = require('./autobuild');

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

function fakeStart(log, ok = true, ms = 30) {
  return (sh) => {
    let killed = false, res;
    const j = { done: new Promise((r) => { res = r; }), kill: () => { killed = true; j.killed = true; res({ code: 137, tail: '' }); } };
    log.push(j);
    setTimeout(() => { if (killed) return; if (ok) fs.writeFileSync(path.join(sh, 'manifest.json'), JSON.stringify({ t: log.length, parts: [{ name: 'a' }] })); res({ code: ok ? 0 : 1, tail: ok ? '' : 'BUILD FAILED: x' }); }, ms);
    return j;
  };
}

test('a burst of edits is one build; the model is reported', async () => {
  const d = proj(), spawned = [], models = [];
  const a = new AutoBuild({ dir: d, start: fakeStart(spawned), onModel: (m) => models.push(m), debounceMs: 20 });
  a.edited(); a.edited(); a.edited();
  await wait(120);
  assert.equal(spawned.length, 1);
  assert.equal(models.length, 1);
  a.stop();
});

test('edits during a build run it once more after; a failed build only logs', async () => {
  const d = proj(), spawned = [], models = [], logs = [];
  const a = new AutoBuild({ dir: d, start: fakeStart(spawned), onModel: (m) => models.push(m), debounceMs: 10 });
  a.edited(); await wait(20); a.edited(); a.edited(); await wait(150);
  assert.equal(spawned.length, 2); assert.equal(models.length, 2);
  const b = new AutoBuild({ dir: d, start: fakeStart([], false), onModel: (m) => models.push(m), log: (m) => logs.push(m), debounceMs: 10 });
  b.edited(); await wait(80);
  assert.equal(models.length, 2);
  assert.ok(logs.some((l) => /failed .*BUILD FAILED: x/.test(l)), logs.join('|'));
});

test("the agent's build: nothing starts while it runs; one in flight still lands unless the agent's model came first", async () => {
  const d = proj(), spawned = [], models = [];
  let building = true;
  const a = new AutoBuild({ dir: d, start: fakeStart(spawned, true, 60), onModel: (m) => models.push(m), agentBuilding: () => building, debounceMs: 10 });
  a.edited(); await wait(40);
  assert.equal(spawned.length, 0);
  building = false; a.edited(); await wait(20); a.agentBuildStarted(); await wait(80);
  assert.equal(spawned.length, 1); assert.ok(!spawned[0].killed); assert.equal(models.length, 1); // not killed: it began first
  a.edited(); await wait(20); a.agentModelLanded(); await wait(80);
  assert.equal(spawned.length, 2); assert.equal(models.length, 1); // landed after the agent's model: dropped
  a.edited(); await wait(20); a.stop(); await wait(80);
  assert.ok(spawned[2].killed); assert.equal(models.length, 1);
});

test('workerJob: hands the build over with the build.sh files and reads the exit code', async () => {
  const d = proj(), sh = prepareShadow(d), w = path.join(sh, '.build');
  const job = workerJob(sh, () => true);
  await wait(30);
  const req = fs.readdirSync(w).find((f) => f.startsWith('req.'));
  assert.ok(req);
  const tag = req.slice(4);
  fs.writeFileSync(path.join(w, 'out.' + tag), 'manifest written\nbuild ok');
  fs.writeFileSync(path.join(w, 'done.' + tag), '0');
  const r = await job.done;
  assert.equal(r.code, 0); assert.match(r.tail, /build ok/);
  assert.deepEqual(fs.readdirSync(w), []);
  const dead = await workerJob(sh, () => false).done;
  assert.equal(dead.code, 1);
});
