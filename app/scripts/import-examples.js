#!/usr/bin/env node
// import-examples: refresh app/examples from a Premake studio's data folder. Re-runnable: app/examples is rebuilt from
// scratch every run, so new designs appear and removed ones go.
//   node scripts/import-examples.js <studio-data-dir> [--out <dir>]
// Sources, in order: <data>/examples/<slug>/ (hand-made examples), then <data>/showcase/<slug>/ (the owner's published
// designs; a slug already taken by a hand-made example is skipped, as the server does).
// Only the files the Examples page needs are copied (the same allowlist as server/showcase.js): model, parts list, code,
// thumbnail, motion, wiring, firmware, the companion-app preview, ad renders and the product page copy. Never chats,
// versions, run logs, build logs, uploads, waitlists or owners. meta.json is rewritten with public fields only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const outArg = args.indexOf('--out');
if (!src) { console.error('usage: node scripts/import-examples.js <studio-data-dir> [--out <dir>]'); process.exit(2); }
const DATA = path.resolve(src);
const OUT = path.resolve(outArg >= 0 ? args[outArg + 1] : path.join(__dirname, '..', 'examples'));

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const COPY_FILES = ['design.py', 'bom.json', 'manifest.json', 'thumb.png', 'motion.json', 'wiring.md', 'wiring.json', 'app.json'];
const DIRS = { // dir -> allowed file names (one level, plus nested folders for firmware/app/ads)
  stl: /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.stl$/i,
  firmware: /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(?:ino|h|c|cpp|hpp|json|md|txt)$/i,
  app: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(?:html|js|css|json|svg|png|jpe?g|webp|woff2)$/i,
  ads: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(?:json|png|jpe?g|webp)$/i,
};
const SITE_FILES = ['site.json']; // product page copy only (never waitlist.json: visitors' emails)
const META_KEYS = ['title', 'description', 'creator', 'tags', 'created', 'demo'];
const MAX_FILE = 50e6;

const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function copyTree(from, to, re, depth) {
  let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const s = path.join(from, e.name);
    if (e.isDirectory() && depth < 2 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(e.name)) n += copyTree(s, path.join(to, e.name), re, depth + 1);
    else if (e.isFile() && re.test(e.name) && fs.statSync(s).size <= MAX_FILE) {
      fs.mkdirSync(to, { recursive: true }); fs.copyFileSync(s, path.join(to, e.name)); n++;
    }
  }
  return n;
}

function importOne(dir, slug, dst) {
  const meta = readJSON(path.join(dir, 'meta.json'));
  if (!meta || !meta.title || !isFile(path.join(dir, 'thumb.png')) || !isFile(path.join(dir, 'manifest.json'))) return false;
  if (meta.showcase === false) return false;
  fs.mkdirSync(dst, { recursive: true });
  const clean = {};
  for (const k of META_KEYS) if (meta[k] != null) clean[k] = meta[k];
  if (!clean.creator || /@/.test(String(clean.creator))) clean.creator = 'Premake';
  fs.writeFileSync(path.join(dst, 'meta.json'), JSON.stringify(clean, null, 1) + '\n');
  for (const f of COPY_FILES) if (isFile(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(dst, f));
  for (const [d, re] of Object.entries(DIRS)) {
    if (!isDir(path.join(dir, d))) continue;
    if (d === 'app' && !isFile(path.join(dir, 'app', 'index.html'))) continue;
    copyTree(path.join(dir, d), path.join(dst, d), re, d === 'stl' ? 2 : 0);
  }
  for (const f of SITE_FILES) if (isFile(path.join(dir, 'site', f))) { fs.mkdirSync(path.join(dst, 'site'), { recursive: true }); fs.copyFileSync(path.join(dir, 'site', f), path.join(dst, 'site', f)); }
  return true;
}

const tmp = OUT + '.importing';
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const taken = new Set();
const counts = { examples: 0, showcase: 0, skipped: 0 };
for (const kind of ['examples', 'showcase']) {
  const root = path.join(DATA, kind);
  if (!isDir(root)) { console.log(`no ${root}, skipping`); continue; }
  for (const slug of fs.readdirSync(root).sort()) {
    if (!SLUG_RE.test(slug) || taken.has(slug) || !isDir(path.join(root, slug))) continue;
    if (importOne(path.join(root, slug), slug, path.join(tmp, slug))) { taken.add(slug); counts[kind]++; }
    else { fs.rmSync(path.join(tmp, slug), { recursive: true, force: true }); counts.skipped++; }
  }
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.renameSync(tmp, OUT);
console.log(`${taken.size} examples in ${OUT} (${counts.examples} hand-made, ${counts.showcase} published designs, ${counts.skipped} skipped: no title, thumbnail or model)`);
