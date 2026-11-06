'use strict';
// assetver: fingerprinted studio code, so the studio loads from the browser cache and is still never stale.
// index.html is rewritten on every request: each /x.js and /x.css it links, and (through the import map) every module
// those import, gets ?v=<content hash>. A ?v= URL whose hash matches the file is cached for a year (immutable);
// index.html itself is never cached, so a changed file means a new hash, a new URL and one fresh download.
// build() is a hash over all of them: the page carries it in <meta name="premake-build"> and /api/version returns the
// current one, so an open tab can tell it is out of date (web/app.js shows "Premake updated").
// Companion apps (web/apps/) keep their own service worker and caching, so they are left out.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let WEB = '';
const state = { at: 0, sig: '', files: new Map(), build: '' }; // files: rel ('/viewer.js') -> hash

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || (rel === '' && e.name === 'apps')) continue;
    const p = path.join(dir, e.name), r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(p, r, out);
    else if (e.isFile() && /\.(m?js|css)$/i.test(e.name)) out.push([r, p]);
  }
}
/** Rescans at most once a second; rehashes only when a file's size or mtime changed. */
function scan() {
  if (Date.now() - state.at < 1000) return state;
  state.at = Date.now();
  const list = []; try { walk(WEB, '', list); } catch { return state; }
  const stats = list.map(([r, p]) => { try { const s = fs.statSync(p); return [r, p, `${s.size}:${s.mtimeMs}`]; } catch { return null; } }).filter(Boolean);
  const sig = stats.map(([r, , s]) => `${r}:${s}`).join('|');
  if (sig === state.sig) return state;
  const files = new Map();
  for (const [r, p] of stats) { try { files.set(r, crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10)); } catch {} }
  state.sig = sig; state.files = files;
  state.build = crypto.createHash('sha1').update([...files].map(([r, h]) => r + h).join('|')).digest('hex').slice(0, 10);
  return state;
}

/** The current content hash of a web file ('/viewer.js'), or null. */
function hashOf(rel) { return scan().files.get(rel.startsWith('/') ? rel : '/' + rel) || null; }
function build() { return scan().build; }

/** index.html with fingerprinted links, an import map entry per module and the build id. */
function html(raw) {
  const { files, build: b } = scan();
  let out = raw.replace(/\b(src|href)="(\/[^"?#]+\.(?:m?js|css))"/g, (m, attr, url) => files.has(url) ? `${attr}="${url}?v=${files.get(url)}"` : m);
  const add = {}; for (const [r, h] of files) if (/\.m?js$/i.test(r)) add[r] = `${r}?v=${h}`;
  let mapped = false;
  out = out.replace(/<script type="importmap">([\s\S]*?)<\/script>/i, (m, json) => {
    try { const j = JSON.parse(json); j.imports = { ...(j.imports || {}), ...add }; mapped = true; return `<script type="importmap">${JSON.stringify(j)}</script>`; } catch { return m; }
  });
  if (!mapped) out = out.replace(/<script\b/i, `<script type="importmap">${JSON.stringify({ imports: add })}</script><script`);
  return out.replace(/<head>/i, `<head><meta name="premake-build" content="${b}">`);
}

function init(webDir) { WEB = webDir; return module.exports; }
module.exports = { init, html, hashOf, build };
