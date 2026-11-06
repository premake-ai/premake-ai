// Version history for agent runs (design chat + website chat). Zero dependencies.
//
// Every agent run is one entry in <project>/versions.json. Before the run the relevant files are copied to
// <project>/.versions/<n>/before/, after it to .versions/<n>/after/. Entries form a tree: entry.parent is the
// entry that was current when the run started (0 = the state before any recorded run). head[kind] is the
// current entry; entries not on the head's parent chain are "rewound" (still listed, restorable).
//   design run: design.py, bom.json, meta.json   (STLs/manifest are rebuilt with ./build.sh after a restore)
//   site run:   everything under site/ except waitlist.json, messages.json, launch.json
//   ads run:    ads/ads.json (the renders are never touched by the ads agent)
//   app run:    everything under app/ (apps: the companion app; its chat is .app_messages.json, outside app/)
// .versions starts with a dot, so the /files route never serves it; it is outside site/, so the site agent can't write it.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const VDIR = '.versions';
const VFILE = 'versions.json';
const DESIGN_FILES = ['design.py', 'bom.json', 'meta.json'];
const ADS_FILES = ['ads/ads.json'];
const SITE_SKIP = new Set(['waitlist.json', 'messages.json', 'launch.json']); // top level of site/: user data, not page content
const SITE_KEEP_KEYS = ['published', 'published_at']; // store flags in site.json are user actions: never rewound

const KINDS = ['design', 'site', 'ads', 'app'];
const now = () => Date.now() / 1000;
function readJSON(p, fallback = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
}
/** root (security B2): the dir dst must stay in. Never copies a symlink, never writes through a symlinked folder. */
function copyAtomic(src, dst, root = null) {
  if (!fs.lstatSync(src).isFile()) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (root) {
    const r = fs.realpathSync(root), d = fs.realpathSync(path.dirname(dst));
    if (d !== r && !d.startsWith(r + path.sep)) return;
  }
  const tmp = dst + '.' + process.pid + '.tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}
const err = (msg, code) => Object.assign(new Error(msg), { code });
const msgFile = (dir, kind) => (kind === 'site' ? path.join(dir, 'site', 'messages.json') : kind === 'ads' ? path.join(dir, 'ads', 'messages.json')
  : kind === 'app' ? path.join(dir, '.app_messages.json') : path.join(dir, 'messages.json'));
const FOLDER = { site: 'site', app: 'app' }; // kinds whose files are a whole folder
const snapDir = (dir, n, which) => path.join(dir, VDIR, String(n), which);

function load(dir) {
  const v = readJSON(path.join(dir, VFILE), null) || {};
  if (!Array.isArray(v.entries)) v.entries = [];
  v.head = { design: 0, site: 0, ads: 0, app: 0, ...(v.head || {}) };
  v.note = v.note || {};
  v.next = Math.max(Number(v.next) || 1, ...v.entries.map((e) => e.n + 1));
  return v;
}
function save(dir, v) { writeJSON(path.join(dir, VFILE), v); }

/** Relative file paths under root (recursive), skipping SITE_SKIP at the top level when site=true. */
function listFiles(root, site) {
  const out = [];
  const walk = (d, rel) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (!rel && site && SITE_SKIP.has(e.name)) continue;
      if (e.name.endsWith('.tmp')) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

function sourceRoot(dir, kind) { return FOLDER[kind] ? path.join(dir, FOLDER[kind]) : dir; }
function filesOf(dir, kind) {
  if (FOLDER[kind]) return listFiles(path.join(dir, FOLDER[kind]), kind === 'site');
  return (kind === 'ads' ? ADS_FILES : DESIGN_FILES).filter((f) => fs.existsSync(path.join(dir, f)));
}

/** Copy the kind's files from the project into dest (replacing dest). */
function snapshot(dir, kind, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const root = sourceRoot(dir, kind);
  for (const f of filesOf(dir, kind)) {
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(dest, f));
  }
}

/** bom.json minus the build-written "printed" key, so a rebuild alone doesn't count as a change. */
function norm(file, buf) {
  if (path.basename(file) !== 'bom.json') return buf.toString('utf8');
  try { const j = JSON.parse(buf.toString('utf8')); delete j.printed; return JSON.stringify(j); } catch { return buf.toString('utf8'); }
}
function changedFiles(a, b, kind) {
  const fa = new Set(listFiles(a, false)), fb = new Set(listFiles(b, false));
  const out = [];
  for (const f of new Set([...fa, ...fb])) {
    const label = FOLDER[kind] ? FOLDER[kind] + '/' + f : f;
    if (!fa.has(f) || !fb.has(f)) { out.push(label); continue; }
    if (norm(f, fs.readFileSync(path.join(a, f))) !== norm(f, fs.readFileSync(path.join(b, f)))) out.push(label);
  }
  return out.sort();
}

/** Make the project's kind files match snapshot src. */
function restoreSnap(dir, kind, src) {
  if (!fs.existsSync(src)) throw err('That version was not saved completely, so it can’t be restored', 409);
  const files = listFiles(src, false);
  if (kind === 'design' || kind === 'ads') {
    for (const f of files) copyAtomic(path.join(src, f), path.join(dir, f), dir);
    return;
  }
  if (kind === 'app') { // the folder becomes exactly the snapshot
    const appDir = path.join(dir, 'app');
    const want = new Set(files);
    for (const f of listFiles(appDir, false)) if (!want.has(f)) fs.rmSync(path.join(appDir, f), { force: true });
    for (const f of files) copyAtomic(path.join(src, f), path.join(appDir, f), dir);
    return;
  }
  const siteDir = path.join(dir, 'site');
  const keep = readJSON(path.join(siteDir, 'site.json'), {}) || {};
  const want = new Set(files);
  for (const f of listFiles(siteDir, true)) if (!want.has(f)) fs.rmSync(path.join(siteDir, f), { force: true });
  for (const f of files) copyAtomic(path.join(src, f), path.join(siteDir, f), dir);
  const cur = readJSON(path.join(siteDir, 'site.json'), null);
  if (cur && typeof cur === 'object') {
    for (const k of SITE_KEEP_KEYS) { if (keep[k] !== undefined) cur[k] = keep[k]; else delete cur[k]; }
    writeJSON(path.join(siteDir, 'site.json'), cur);
  }
}

function activeSet(v, kind) {
  const by = new Map(v.entries.filter((e) => e.kind === kind).map((e) => [e.n, e]));
  const s = new Set();
  for (let n = v.head[kind]; n && by.has(n) && !s.has(n); n = by.get(n).parent) s.add(n);
  return s;
}

/** Write run ids + rewound flags into the chat file so the UI can render them. */
function syncMessages(dir, kind, v) {
  const file = msgFile(dir, kind);
  const msgs = readJSON(file, null);
  if (!Array.isArray(msgs)) return;
  const active = activeSet(v, kind);
  const byIdx = new Map(v.entries.filter((e) => e.kind === kind).map((e) => [e.message_index, e]));
  let flag = false, changed = false;
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      const e = byIdx.get(i);
      if (e && m.run !== e.n) { m.run = e.n; changed = true; }
      flag = !!e && !active.has(e.n);
    }
    if (!!m.rewound !== flag) { if (flag) m.rewound = true; else delete m.rewound; changed = true; }
  });
  if (changed) writeJSON(file, msgs);
}

function firstLine(s) {
  const l = String(s || '').split('\n').map((x) => x.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '';
  return l.length > 140 ? l.slice(0, 139).replace(/\s+\S*$/, '') + '…' : l;
}

/** Finalize an entry whose run died (server restart): what's on disk now is its "after". */
function closeStale(dir, v, kind) {
  for (const e of v.entries) {
    if (e.kind !== kind || e.status !== 'running') continue;
    snapshot(dir, kind, snapDir(dir, e.n, 'after'));
    e.files = changedFiles(snapDir(dir, e.n, 'before'), snapDir(dir, e.n, 'after'), kind);
    e.status = 'interrupted';
  }
}

/** Before an agent run. messageIndex = index the user's message will have in the chat file.
 *  Returns { n, note }: note is a one-shot context line for the agent if the user rewound since its last turn. */
function begin(dir, kind, messageIndex, text) {
  const v = load(dir);
  closeStale(dir, v, kind);
  const n = v.next++;
  snapshot(dir, kind, snapDir(dir, n, 'before'));
  const seq = v.entries.filter((e) => e.kind === kind).length + 1;
  v.entries.push({ n, kind, v: seq, message_index: messageIndex, prompt: String(text || '').slice(0, 200), t: now(),
    parent: v.head[kind] || 0, status: 'running', summary: '', files: [] });
  v.head[kind] = n;
  const note = v.note[kind] || '';
  delete v.note[kind];
  save(dir, v);
  return { n, note };
}

/** After the user's message was appended (so its index exists in the chat file). */
function sync(dir, kind) { syncMessages(dir, kind, load(dir)); }

/** After an agent run: snapshot the result and record what changed. */
function finish(dir, n, reply, ok) {
  const v = load(dir);
  const e = v.entries.find((x) => x.n === n);
  if (!e) return null;
  snapshot(dir, e.kind, snapDir(dir, n, 'after'));
  e.files = changedFiles(snapDir(dir, n, 'before'), snapDir(dir, n, 'after'), e.kind);
  e.summary = firstLine(reply);
  e.status = ok ? 'done' : 'failed';
  e.done_t = now();
  save(dir, v);
  syncMessages(dir, e.kind, v);
  return e;
}

/** The turn's builds ended in a good one and the design has a manifest: the run left a valid design behind. */
function builtOk(builds, dir) {
  const last = Array.isArray(builds) && builds.length ? builds[builds.length - 1] : null;
  return !!(last && last.ok) && fs.existsSync(path.join(dir, 'manifest.json'));
}

function quoteOf(e) { const p = e.prompt.replace(/\s+/g, ' ').trim(); return p.length > 120 ? p.slice(0, 117) + '…' : p; }
function noteFor(kind, how, e) {
  const reread = kind === 'site' ? 'Re-read site/site.json (and site/theme.css if it exists)' : kind === 'ads' ? 'Re-read ads/ads.json'
    : kind === 'app' ? 'Re-read the app files you are about to change (app/index.html, app/app.js, app/style.css, the JSON files)' : 'Re-read design.py and bom.json';
  const what = kind === 'site' ? 'page' : kind === 'ads' ? 'ads' : kind === 'app' ? 'app' : 'design';
  const state = how === 'before'
    ? `the ${what} files were restored to how they were BEFORE their message "${quoteOf(e)}". Changes made for that message and any later ones no longer exist in the files`
    : how === 'after'
      ? `the ${what} files were restored to how they were right AFTER your turn for their message "${quoteOf(e)}". Changes from any later messages no longer exist in the files`
      : `the ${what} files were restored to the original version, before any of the chat's changes`;
  return `[Note from the app, not typed by the user: the user used undo/rewind. ${state[0].toUpperCase() + state.slice(1)}. ${reread} before changing anything; don't rely on what you remember of them.]`;
}

function markRewound(v, kind, before, after) {
  const t = now();
  for (const e of v.entries) if (e.kind === kind && before.has(e.n) && !after.has(e.n)) e.rewound_at = t;
}

function entryOf(v, kind, n) { return v.entries.find((e) => e.kind === kind && e.n === n); }

/** Restore the files to the state BEFORE the run triggered by the user message at messageIndex. */
function rewindTo(dir, kind, messageIndex) {
  const v = load(dir);
  const e = v.entries.find((x) => x.kind === kind && x.message_index === messageIndex);
  if (!e) throw err('That message has no saved version', 404);
  if (e.status === 'running') throw err('That change is still running', 409);
  const was = activeSet(v, kind);
  restoreSnap(dir, kind, snapDir(dir, e.n, 'before'));
  v.head[kind] = e.parent || 0;
  markRewound(v, kind, was, activeSet(v, kind));
  v.note[kind] = noteFor(kind, 'before', e);
  save(dir, v);
  syncMessages(dir, kind, v);
  const parent = entryOf(v, kind, e.parent);
  return { label: parent ? `Rewound to v${parent.v}` : 'Rewound to the original', head: v.head[kind] };
}

/** Restore the files to the state right AFTER run n (0 = the original, before the first run). */
function restoreTo(dir, kind, n) {
  const v = load(dir);
  if (!n) { // the original = the state before the earliest root run
    const root = v.entries.filter((e) => e.kind === kind && !e.parent).sort((a, b) => a.n - b.n)[0];
    if (!root) throw err('No history yet', 404);
    return rewindTo(dir, kind, root.message_index);
  }
  const e = entryOf(v, kind, n);
  if (!e) throw err('No such version', 404);
  if (e.status === 'running') throw err('That change is still running', 409);
  const was = activeSet(v, kind);
  restoreSnap(dir, kind, snapDir(dir, n, 'after'));
  v.head[kind] = n;
  markRewound(v, kind, was, activeSet(v, kind));
  v.note[kind] = noteFor(kind, 'after', e);
  save(dir, v);
  syncMessages(dir, kind, v);
  return { label: `Restored v${e.v}`, head: n };
}

function undo(dir, kind) {
  const v = load(dir);
  const e = entryOf(v, kind, v.head[kind]);
  if (!e) throw err('Nothing to undo', 400);
  return rewindTo(dir, kind, e.message_index);
}

function redoTarget(v, kind) {
  return v.entries.filter((e) => e.kind === kind && (e.parent || 0) === (v.head[kind] || 0) && e.status !== 'running')
    .sort((a, b) => (b.rewound_at || 0) - (a.rewound_at || 0) || b.n - a.n)[0] || null;
}
function redo(dir, kind) {
  const t = redoTarget(load(dir), kind);
  if (!t) throw err('Nothing to redo', 400);
  return restoreTo(dir, kind, t.n);
}

/** What the UI needs: the kind's versions (newest first) and whether undo/redo are possible. */
function history(dir, kind) {
  const v = load(dir);
  const active = activeSet(v, kind);
  const head = v.head[kind] || 0;
  const list = v.entries.filter((e) => e.kind === kind).map((e) => ({
    n: e.n, v: e.v, message_index: e.message_index, prompt: e.prompt, summary: e.summary, t: e.t, files: e.files || [], status: e.status,
    active: active.has(e.n), current: e.n === head,
  })).reverse();
  const cur = entryOf(v, kind, head);
  return { head, current_v: cur ? cur.v : 0, can_undo: !!cur && cur.status !== 'running', can_redo: !!redoTarget(v, kind), versions: list };
}

module.exports = { KINDS, begin, sync, finish, builtOk, rewindTo, restoreTo, undo, redo, history, VDIR, VFILE };
