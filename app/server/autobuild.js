// autobuild: the model keeps up while the design agent edits. After each successful Edit / MultiEdit / Write of
// design.py the server builds a COPY of the design in <project>/autobuild/ (0.5 s debounce: a burst of edits = one
// build; edits during a build = one more after it) and the studio shows that model live (web/app.js 'auto_model').
// The agent's own ./build.sh always wins: no auto build starts while it runs, and an auto build that finishes after
// the agent's model landed is dropped. One already running when the agent starts its build is NOT killed: it began
// earlier, so it usually lands first and the user sees the edits a few seconds before the agent's model.
// Builds go to a warm cadlib.worker serving the shadow folder (started at the first edit, so cadquery is imported
// before the first build), else a cold `python -m cadlib.build`.
//
// Cheap on purpose: no AI, CPU only, niced, one build at a time per run, same Seatbelt sandbox / empty env / caps as
// ./build.sh (the server passes start). A build that fails (a half-finished edit) only logs one line.
// Off with FORMA_AUTOBUILD=0.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DIR = 'autobuild';
const DEBOUNCE_MS = 500; // edits come seconds apart and the agent builds soon after the last one: start early
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

/** A cold build process as a job: { done: Promise<{ code, tail }>, kill() }. tail = the last output lines (piped stdio). */
function childJob(child) {
  let tail = '';
  const keep = (d) => { tail = (tail + d).slice(-1500); };
  child.stdout?.on('data', keep); child.stderr?.on('data', keep);
  const done = new Promise((res) => { let n = 0; const end = (code) => { if (!n++) res({ code: code ?? 1, tail }); }; child.on('error', () => end(1)); child.on('close', end); });
  return { done, kill: () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } } };
}
/** A build handed to a warm cadlib.worker serving <sh> (the same req / ack / done files ./build.sh uses), as a job.
 * alive() false = the worker died: the job ends with code 1. */
function workerJob(sh, alive, timeoutMs = TIMEOUT_MS) {
  const w = path.join(sh, '.build'), tag = `ab${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, 'req.' + tag), '');
  let timer, killed = false;
  const t0 = Date.now();
  const done = new Promise((res) => {
    const tick = () => {
      let code = null;
      try { code = parseInt(fs.readFileSync(path.join(w, 'done.' + tag), 'utf8'), 10); } catch {}
      const dead = killed || !alive() || Date.now() - t0 > timeoutMs;
      if (code == null && !dead) { timer = setTimeout(tick, 100); return; }
      let tail = '';
      try { tail = fs.readFileSync(path.join(w, 'out.' + tag), 'utf8').slice(-1500); } catch {}
      for (const f of ['req.', 'ack.', 'done.', 'out.']) try { fs.rmSync(path.join(w, f + tag), { force: true }); } catch {}
      res({ code: Number.isFinite(code) ? code : 1, tail: code == null ? (killed ? 'stopped' : 'worker gone or timed out') : tail });
    };
    timer = setTimeout(tick, 100);
  });
  return { done, kill: () => { killed = true; } };
}

/**
 * One per design run. deps: { dir, start(shadowDir) -> job ({ done: Promise<{ code, tail }>, kill() }), onModel(manifest),
 * agentBuilding() -> bool, log(msg), debounceMs?, prepare? }.
 * edited() after each successful design.py edit; agentBuildStarted() / agentModelLanded() around the agent's ./build.sh;
 * stop() at turn end.
 */
class AutoBuild {
  constructor(deps) {
    this.deps = deps;
    this.timer = null; this.job = null; this.again = false; this.stopped = false; this.gen = 0; this.n = 0;
  }
  edited() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.kick(); }, this.deps.debounceMs ?? DEBOUNCE_MS);
    this.timer.unref?.();
  }
  /** The agent runs ./build.sh: nothing new starts until it ends, but an auto build already running keeps going and
   * still shows its model if it lands before the agent's (the agent's build takes as long as ours). */
  agentBuildStarted() { this.again = false; clearTimeout(this.timer); this.timer = null; }
  /** The agent's own model is out: any auto build started before now is older than it and is dropped. */
  agentModelLanded() { this.gen++; }
  stop() { this.stopped = true; this.gen++; this.agentBuildStarted(); this.job?.kill(); }
  kick() {
    if (this.stopped) return;
    if (this.deps.agentBuilding?.()) { this.deps.log?.('skipped: the agent is building'); return; }
    if (this.job) { this.again = true; return; }
    const gen = this.gen, t0 = Date.now();
    let sh, job;
    try { sh = (this.deps.prepare || prepareShadow)(this.deps.dir); } catch (e) { this.deps.log?.(`prepare failed: ${e.message}`); return; }
    try { job = this.deps.start(sh); } catch (e) { this.deps.log?.(`start failed: ${e.message}`); return; }
    this.job = job;
    this.deps.log?.('build started');
    job.done.then(({ code, tail }) => {
      if (this.job === job) this.job = null;
      if (this.stopped) return;
      const ms = Date.now() - t0;
      if (gen !== this.gen) this.deps.log?.(`dropped after ${ms} ms: the agent's model landed first`);
      else {
        let man = null;
        try { man = JSON.parse(fs.readFileSync(path.join(sh, 'manifest.json'), 'utf8')); } catch {}
        if (man?.parts?.length) { // written last by cadlib.build: present = the model exported (a later check may still fail)
          this.n++;
          this.deps.log?.(`model ${this.n} in ${ms} ms${code ? ` (exit ${code})` : ''}`);
          try { this.deps.onModel(man); } catch {}
        } else this.deps.log?.(`failed in ${ms} ms (exit ${code}): ${String(tail || '').trim().split('\n').slice(-1)[0] || '-'}`);
      }
      if (this.again) { this.again = false; this.edited(); }
    });
  }
}

/** Remove a project's shadow folder (the run is over). */
function clean(dir) { try { fs.rmSync(path.join(dir, DIR), { recursive: true, force: true }); } catch {} }

module.exports = { AutoBuild, prepareShadow, childJob, workerJob, clean, DIR, DEBOUNCE_MS };
