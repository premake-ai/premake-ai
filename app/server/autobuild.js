// autobuild: the model keeps up while the design agent edits. After each successful Edit / MultiEdit / Write of
// design.py the server builds a COPY of the design in <project>/autobuild/ (debounced: a burst of edits = one build)
// and the studio shows that model live (web/app.js 'auto_model'). The agent's own ./build.sh always wins: an auto build
// never starts while one runs, and one that is running when the agent starts its build is killed and its result dropped.
//
// Cheap on purpose: no AI, CPU only, niced, one build at a time per run, same Seatbelt sandbox / empty env / caps as
// ./build.sh (the server passes spawnBuild). A build that fails (a half-finished edit) is ignored silently.
// Off with FORMA_AUTOBUILD=0.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DIR = 'autobuild';
const DEBOUNCE_MS = 1500;
const TIMEOUT_MS = 90e3;
// what is never copied into the shadow folder: the model it makes, chats, history, scripts, scratch dirs
const SKIP = new Set(['manifest.json', 'thumb.png', 'build_log.txt', 'messages.json', 'agent.json', 'versions.json', 'runs.jsonl',
  'build.sh', 'views.sh', 'motion.json', 'questions.json', 'stl', 'step', 'views', 'preview', DIR, '__pycache__']);
const MAX_COPY = 20 * 1024 * 1024;

/** Fill <dir>/autobuild/ with the design as it is now: top-level files copied, other folders symlinked (read-only use). */
function prepareShadow(dir) {
  const sh = path.join(dir, DIR);
  fs.mkdirSync(sh, { recursive: true });
  for (const name of fs.readdirSync(sh)) { // last round's inputs and model go (stl/ stays: the build prunes it)
    if (name === 'stl' || name === 'step' || name.startsWith('.')) continue;
    try { fs.rmSync(path.join(sh, name), { recursive: true, force: true }); } catch {}
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const n = ent.name;
    if (n.startsWith('.') || SKIP.has(n)) continue;
    const src = path.join(dir, n), dst = path.join(sh, n);
    try {
      if (ent.isFile()) { if (fs.statSync(src).size <= MAX_COPY) fs.copyFileSync(src, dst); }
      else if (ent.isDirectory()) fs.symlinkSync(path.join('..', n), dst, 'dir'); // relative: the data folder can move
    } catch {}
  }
  return sh;
}

/**
 * One per design run. deps: { dir, spawnBuild(shadowDir) -> ChildProcess, onModel(manifest), agentBuilding() -> bool,
 * log(msg), debounceMs?, timeoutMs?, prepare? }.
 * edited() after each successful design.py edit; agentBuildStarted() when the agent runs ./build.sh; stop() at turn end.
 */
class AutoBuild {
  constructor(deps) {
    this.deps = deps;
    this.timer = null; this.child = null; this.again = false; this.stopped = false; this.gen = 0; this.n = 0;
  }
  edited() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.kick(); }, this.deps.debounceMs ?? DEBOUNCE_MS);
    this.timer.unref?.();
  }
  /** The agent's own build starts: it covers every edit so far, so the auto build in flight (if any) goes. */
  agentBuildStarted() {
    this.gen++; this.again = false;
    clearTimeout(this.timer); this.timer = null;
    this.kill();
  }
  stop() { this.stopped = true; this.agentBuildStarted(); }
  kill() {
    const c = this.child;
    if (!c) return;
    try { process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch {} }
  }
  kick() {
    if (this.stopped || this.deps.agentBuilding?.()) return; // the agent's build will show these edits
    if (this.child) { this.again = true; return; }
    const gen = this.gen, t0 = Date.now();
    let sh;
    try { sh = (this.deps.prepare || prepareShadow)(this.deps.dir); } catch (e) { this.deps.log?.(`prepare failed: ${e.message}`); return; }
    let child;
    try { child = this.deps.spawnBuild(sh); } catch (e) { this.deps.log?.(`spawn failed: ${e.message}`); return; }
    this.child = child;
    const to = setTimeout(() => { this.deps.log?.('build timed out'); this.kill(); }, this.deps.timeoutMs ?? TIMEOUT_MS);
    to.unref?.();
    let done = false;
    const end = (code) => {
      if (done) return; done = true;
      clearTimeout(to);
      if (this.child === child) this.child = null;
      if (this.stopped || gen !== this.gen) return; // the agent's build started meanwhile: its model wins
      let man = null;
      try { man = JSON.parse(fs.readFileSync(path.join(sh, 'manifest.json'), 'utf8')); } catch {}
      if (man?.parts?.length) { // written last by cadlib.build: present = the model exported (a later check may still fail)
        this.n++;
        this.deps.log?.(`model ${this.n} in ${Date.now() - t0} ms${code ? ` (exit ${code})` : ''}`);
        try { this.deps.onModel(man); } catch {}
      }
      if (this.again) { this.again = false; this.edited(); }
    };
    child.on('error', () => end(1));
    child.on('close', (code) => end(code));
  }
}

/** Remove a project's shadow folder (the run is over). */
function clean(dir) { try { fs.rmSync(path.join(dir, DIR), { recursive: true, force: true }); } catch {} }

module.exports = { AutoBuild, prepareShadow, clean, DIR, DEBOUNCE_MS };
