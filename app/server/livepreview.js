// livepreview: parts appear while a NEW design's design.py is still being written, before the agent runs its build.
//
// The design agent's Write of design.py streams in token by token (--include-partial-messages: input_json_delta).
// Each time another top-level statement starts after a def, that def is complete: the code so far (minus the statement
// still being typed) goes to a preview process (cadlib/preview.py) which runs it and exports every finished,
// argument-free function that returns a shape as a coarse STL in <project>/preview/. The studio lays them out on a
// "workbench" next to the sketch and snaps them into place when the real model lands.
//
// It never costs the agent time: the preview is a separate process (niced, same Seatbelt sandbox, empty env and caps as
// ./build.sh, no network), one job at a time (only the latest code waits), and it is killed the moment the agent starts
// ./build.sh or the turn ends. New designs only (Edits of an existing design are out of scope for v1).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const JOB_TIMEOUT_MS = 25e3; // a job that hangs (a slow OCC boolean) kills the process; the next job starts a fresh one
const MAX_CRASHES = 4;       // a process that keeps dying (crash, timeout) ends the session quietly

/** The string value of `key` in a partial JSON object text, decoded as far as it is complete (null if not started). */
function partialString(json, key) {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let out = '', i = m.index + m[0].length;
  const E = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
  while (i < json.length) {
    const c = json[i];
    if (c === '"') break;
    if (c !== '\\') { out += c; i++; continue; }
    const n = json[i + 1];
    if (n === undefined) break; // escape cut off
    if (n === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
    }
    out += E[n] ?? n; i += 2;
  }
  return out;
}

/** The part of `code` whose top-level statements are complete: everything before the last top-level line (the one
 * still being typed), or all of it when final. null when no def is complete yet. */
function completePrefix(code, final = false) {
  const text = String(code || '');
  if (final) return /^def\s/m.test(text) ? text : null;
  const re = /^(?![\s#)\]}]|$|else\b|elif\b|except\b|finally\b)/gm; // a line that starts a new top-level statement
  let last = -1, m;
  while ((m = re.exec(text))) { last = m.index; re.lastIndex = m.index + 1; }
  if (last <= 0) return null;
  const prefix = text.slice(0, last);
  return /^def\s/m.test(prefix) ? prefix : null;
}
const defCount = (s) => (String(s).match(/^def\s+[A-Za-z]\w*\s*\(/gm) || []).length;

/**
 * One preview session per design turn. deps: { spawnPreview(dir) -> ChildProcess (stdin/stdout piped),
 * onPart(part), log(msg) }. feed(code) as the file streams in; finish(code) when the Write is complete; stop() to kill.
 */
class PreviewSession {
  constructor(dir, deps) {
    this.dir = dir; this.deps = deps;
    this.child = null; this.busy = false; this.pending = null; this.sentDefs = 0; this.stopped = false;
    this.buf = ''; this.jobTimer = null; this.stats = { jobs: 0, parts: 0, failed: 0, cpu_ms: 0, started: Date.now() };
    this.seen = new Set();
    this.bad = new Set(); this.trying = null; this.crashes = 0; // what the process was running when it died: never again
  }
  /** Start the process early (cadquery takes ~2 s to import) while the code is still streaming. */
  warm() { if (!this.stopped && !this.child) this.start(); }
  start() {
    try { fs.rmSync(path.join(this.dir, 'preview'), { recursive: true, force: true }); } catch {}
    let child;
    try { child = this.deps.spawnPreview(this.dir); } catch (e) { this.deps.log?.(`spawn failed: ${e.message}`); this.stopped = true; return; }
    this.child = child; this.buf = '';
    child.stdout.on('data', (d) => {
      this.buf += d.toString('utf8');
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (line) this.onLine(line); }
    });
    child.stderr?.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => {});
    child.on('close', () => { // a crash (OpenCascade segfault -> quiet exit 11), a kill or a timeout: skip it silently
      if (this.child !== child) return;
      this.child = null; clearTimeout(this.jobTimer);
      if (this.busy) this.died();
    });
  }
  onLine(line) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.trying) { this.trying = String(j.trying); return; }
    if (j.done) { clearTimeout(this.jobTimer); this.busy = false; this.trying = null; if (j.cpu_ms) this.stats.cpu_ms += j.cpu_ms; this.next(); return; }
    if (j.part && !this.seen.has(j.part.file)) { this.seen.add(j.part.file); this.stats.parts++; this.deps.onPart(j.part); }
  }
  feed(code) {
    const prefix = completePrefix(code);
    if (!prefix) return;
    const n = defCount(prefix);
    if (n <= this.sentDefs) return;
    this.sentDefs = n;
    this.queue(prefix);
  }
  finish(code) { const all = completePrefix(code, true); if (all) { this.sentDefs = Infinity; this.queue(all); } }
  queue(src) { if (this.stopped) return; this.pending = src; if (!this.busy) this.next(); }
  next() {
    if (this.stopped || this.busy || this.pending == null) return;
    if (!this.child) this.start();
    if (!this.child) return;
    const src = this.pending; this.pending = null; this.busy = true; this.stats.jobs++;
    this.lastSrc = src; this.trying = null;
    this.child.stdin.write(JSON.stringify({ src, skip: [...this.bad] }) + '\n');
    clearTimeout(this.jobTimer);
    this.jobTimer = setTimeout(() => { this.deps.log?.('job timed out, restarting the preview process'); this.kill(); }, JOB_TIMEOUT_MS);
    this.jobTimer.unref?.();
  }
  kill() {
    const c = this.child; this.child = null; clearTimeout(this.jobTimer);
    if (c) { try { process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch {} } }
    if (this.busy) this.died();
  }
  /** The running job's process died. Never run what it was trying again; give up after a few deaths. */
  died() {
    this.busy = false; this.stats.failed++; this.crashes++;
    const culprit = this.trying; this.trying = null;
    if (this.crashes >= MAX_CRASHES) { this.stop('kept crashing'); return; }
    if (culprit) { this.bad.add(culprit); if (this.pending == null) this.pending = this.lastSrc; } // the rest of that job, minus the crash
    this.next(); // unknown culprit: only newer code (if any) runs, never the same job again
  }
  /** The real build started or the turn ended: kill it now. */
  stop(why = '') {
    if (this.stopped) return;
    this.stopped = true; this.pending = null; this.busy = false;
    this.kill();
    this.deps.log?.(`stopped (${why}): ${this.stats.jobs} jobs, ${this.stats.parts} parts, ${this.stats.failed} failed, ${(this.stats.cpu_ms / 1000).toFixed(1)}s CPU over ${((Date.now() - this.stats.started) / 1000).toFixed(1)}s`);
  }
}

module.exports = { partialString, completePrefix, defCount, PreviewSession };
