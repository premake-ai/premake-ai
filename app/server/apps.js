// apps: companion web apps for products with electronics (companion-app CONTRACT.md §4-6). Zero dependencies.
//   GET /apps/<id>                          the trusted shell (owner or admin, 404 for anyone else); ?preview=1 = demo data
//   GET /apps/<id>/manifest.webmanifest     PWA manifest from app/app.json
//   GET /apps/<id>/icon-<180|192|512>.png   home-screen icon, drawn here (no image libraries on this Mac)
//   GET /apps/<id>/ui/<file>                the generated app (projects/<id>/app/), owner or admin, sandboxed by UI_CSP
//   GET /apps/sw.js, /apps/sdk.js           the service worker (scope /apps/) and the bridge SDK the generated app includes
//   GET /apps/{shell.js,shell.css,bridge.js,demo.js,qr.js}   the shell's own code (web/apps/)
//   GET /apps/t/<token>[/...]               app-preview: a phone preview link (the QR in the App tab): the same shell with
//                                           demo data only, for anyone holding an unexpired, unrevoked token (24 h)
//   GET /apps/ex/<slug>[/...]               app-preview: an example's app (the showcase copies app/), demo data only, public
//   GET|POST|DELETE /api/apps/<id>/link     app-preview: the owner's preview link (linkApi() below)
// The app agent (kind 'app' in server.js startAgent) gets Read/Write/Edit in ./app/** only, the prompt in
// server/app_agent_prompt.md plus contextPrompt(), and finalize() checks its JSON files after every turn.
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const approutes = require('./approutes');

// The sandbox for generated files: exactly the contract's header. Opaque origin (no allow-same-origin), so no cookies,
// no storage, no API; no allow-top-navigation, no allow-popups; no network at all (connect-src 'none').
const UI_CSP = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'";
// The trusted shell: our own files only, framed by our own pages only (the studio's App tab).
const SHELL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const UI_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };
const IMG_EXT = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
const SHELL_FILES = { 'shell.js': 'text/javascript; charset=utf-8', 'shell.css': 'text/css; charset=utf-8', 'bridge.js': 'text/javascript; charset=utf-8',
  'demo.js': 'text/javascript; charset=utf-8', 'qr.js': 'text/javascript; charset=utf-8', 'sdk.js': 'text/javascript; charset=utf-8', 'sw.js': 'text/javascript; charset=utf-8' };
const SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,23}$/;
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_FILE = 5e6; // per served file
const INLINE_BUDGET = 3e6; // bytes inlined into one index.html
const ICON_SIZES = [180, 192, 512];
// app-preview: phone preview links. 22 base62 characters (~131 bits), kept in <DATA>/app_links.json (server-only, 0600).
const TOKEN_RE = /^[A-Za-z0-9]{22}$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LINK_TTL_MS = 24 * 3600e3;
// Agent: tools and rules (Claude Code permission syntax, --permission-mode dontAsk denies everything else).
const TOOLS = 'Read,Write,Edit';
const ALLOWED = 'Read(./app/**),Write(./app/**),Edit(./app/**)';
// No instruction files the CLI would load on a later turn (pentest C6), no settings, no MCP config, anywhere in app/.
const DENIED = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.mcp.json'].flatMap((f) => [`Write(./app/${f})`, `Edit(./app/${f})`, `Write(./app/**/${f})`, `Edit(./app/**/${f})`])
  .concat(['Write(./app/.claude/**)', 'Edit(./app/.claude/**)', 'Write(./app/**/.claude/**)', 'Edit(./app/**/.claude/**)']).join(',');
const PLANTED = new Set(['claude.md', 'claude.local.md', 'agents.md', '.mcp.json', '.claude']);
// "This design has electronics": a microcontroller or a sensor among its bought parts (or a firmware/ folder).
const ELECTRONICS = /\b(esp32(?:-[a-z0-9]+)?|esp8266|esp-?01|arduino|raspberry ?pi|rp2040|pico ?w|nrf5\d+|particle (?:photon|argon|boron)|stm32|microcontroller|wemos|nodemcu|seeed ?xiao|attiny\d*|atmega\d*|sensor|bme\d{3}|bmp\d{3}|dht\d{2}|ds18b20|sht\d{2}|bh1750|veml\d+|tsl\d+|hc-sr04|hx711|load cell|thermistor|hygrometer|anemometer|accelerometer|mpu-?\d{4}|gps module|lora|zigbee)\b/i;

let D = null; // deps from server.js: { PROJECTS, WEB, DATA?, projDir, exDir?, ownerOf?, readJSON, readText, send, canEdit, now? }
const sdkCache = { m: 0, text: '' };
let agentPrompt = '';

function init(deps) {
  D = deps;
  const file = path.join(__dirname, 'app_agent_prompt.md');
  const load = () => { agentPrompt = D.readText(file) || ''; };
  load();
  try { fs.watchFile(file, { interval: 2000 }, load).unref(); } catch {}
  return module.exports;
}

// ---------------------------------------------------------------- small helpers
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : ''); // eslint-disable-line no-control-regex
function statOf(p) { try { return fs.lstatSync(p); } catch { return null; } }
const isFile = (p) => !!statOf(p)?.isFile();
const isDir = (p) => !!statOf(p)?.isDirectory();
/** JSON from a regular file (not a symlink) of at most `max` bytes, else null. */
function smallJSON(p, max) {
  const st = statOf(p);
  if (!st || !st.isFile() || st.size > max) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
/** JSON for a <script type="application/json"> block: nothing in it can end the element. */
const jsonForHtml = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The project's app.json, cleaned for the shell's own use (name, short name, colour, icon, fields). */
function cleanApp(raw, title) {
  const a = isObj(raw) ? raw : {};
  const name = clip(a.name, 40) || clip(title, 40) || 'App';
  const fields = {};
  if (isObj(a.fields)) {
    for (const [k, v] of Object.entries(a.fields).slice(0, 16)) {
      if (!FIELD_RE.test(k)) continue;
      const f = isObj(v) ? v : {};
      fields[k] = { label: clip(f.label, 40) || k, unit: clip(f.unit, 12) };
    }
  }
  const icon = typeof a.icon === 'string' && a.icon.split('/').every((s) => SEG_RE.test(s) && !s.includes('..')) && IMG_EXT.includes(path.extname(a.icon).toLowerCase()) ? a.icon : null;
  return { name, short_name: clip(a.short_name, 12) || name.slice(0, 12).trim(), theme: HEX_RE.test(a.theme || '') ? a.theme.toLowerCase() : '#e8590c', icon, fields };
}
/** profiles.json for the shell: key -> { name, numeric thresholds, notes }. */
function cleanProfiles(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 300)) {
    if (!PROFILE_RE.test(k) || !isObj(v)) continue;
    const p = { name: clip(v.name, 60) || k };
    for (const [f, n] of Object.entries(v)) if (/^[a-z][a-z0-9_]{0,40}$/.test(f) && typeof n === 'number' && Number.isFinite(n)) p[f] = n;
    if (typeof v.notes === 'string') p.notes = v.notes.slice(0, 600);
    out[k] = p;
  }
  return out;
}
/** "{name} needs a drink" -> "Needs a drink": what the alerts sheet lists. */
function alertLines(raw) {
  const rules = isObj(raw) && Array.isArray(raw.rules) ? raw.rules : [];
  const out = [];
  for (const r of rules) {
    if (!isObj(r) || typeof r.message !== 'string') continue;
    let m = r.message.replace(/^\s*\{name\}(?:['’]s)?\s*/i, '').replace(/\s*\(?\{value\}\s*\{unit\}\)?/gi, '').replace(/\{(name|value|unit)\}/gi, '').replace(/\s+/g, ' ').trim();
    if (!m) continue;
    m = m[0].toUpperCase() + m.slice(1);
    if (!out.includes(m)) out.push(m.slice(0, 80));
    if (out.length >= 6) break;
  }
  return out;
}
const isPlantApp = (app, profiles) => /plant|garden|soil|leaf|grow|herb|flower|seed/i.test(`${app.name} ${app.short_name}`)
  || Object.keys(app.fields).some((f) => /moist|soil/.test(f)) || Object.values(profiles).some((p) => 'moisture_min' in p);

// ---------------------------------------------------------------- what the studio needs to know
/** { show, exists, electronics, name }: show the App tab when the design has electronics or an app/ folder. */
function info(dir) {
  const appDir = path.join(dir, 'app');
  const exists = isFile(path.join(appDir, 'index.html'));
  let electronics = isDir(path.join(dir, 'firmware'));
  if (!electronics) {
    const bom = smallJSON(path.join(dir, 'bom.json'), 2e6) || {};
    electronics = (Array.isArray(bom.parts) ? bom.parts : []).some((p) => ELECTRONICS.test(`${p?.name || ''}`));
  }
  const name = exists ? cleanApp(smallJSON(path.join(appDir, 'app.json'), 65536), '').name : null;
  return { show: exists || isDir(appDir) || electronics, exists, electronics, name: name === 'App' ? null : name };
}
/** Changes when anything in app/ changes (the file watcher emits app_updated). */
function sig(dir) {
  const appDir = path.join(dir, 'app');
  const parts = [];
  const walk = (d, rel, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents.slice(0, 200)) {
      if (e.name.endsWith('.tmp')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(p, rel + e.name + '/', depth + 1);
      else if (e.isFile()) { const st = statOf(p); if (st) parts.push(`${rel}${e.name}:${st.mtimeMs}:${st.size}`); }
    }
  };
  walk(appDir, '', 0);
  return parts.sort().join('|');
}

// ---------------------------------------------------------------- files of the generated app
/** The real path of a file in projects/<id>/app/, or null. Every segment plain (no dot files, no ..), a whitelisted
 *  extension, no symlink anywhere (the project dir and app/ included), a regular file, at most MAX_FILE bytes. */
async function uiFile(dir, rel) {
  if (typeof dir !== 'string' || !dir || typeof rel !== 'string') return null;
  const segs = rel.split('/');
  if (!segs.length || segs.length > 6 || !segs.every((s) => SEG_RE.test(s) && !s.includes('..'))) return null;
  const ext = path.extname(segs[segs.length - 1]).toLowerCase();
  if (!UI_TYPES[ext]) return null;
  let root;
  try {
    const parent = await fsp.realpath(path.dirname(dir));
    root = await fsp.realpath(path.join(dir, 'app'));
    if (root !== path.join(parent, path.basename(dir), 'app')) return null; // the design dir or app/ itself is a link
  } catch { return null; }
  const want = path.join(root, ...segs);
  let real;
  try { real = await fsp.realpath(want); } catch { return null; }
  if (real !== want) return null; // a symlink somewhere below app/
  let st;
  try { st = await fsp.lstat(real); } catch { return null; }
  if (!st.isFile() || st.size > MAX_FILE) return null;
  return { file: real, ext, size: st.size, rel: segs.join('/') };
}
/** Read a resolved file without following a link swapped in since it was checked. */
async function readNoFollow(file) {
  const fh = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { return await fh.readFile(); } finally { await fh.close(); }
}
function sdkText() {
  const f = path.join(D.WEB, 'apps', 'sdk.js');
  try { const m = fs.statSync(f).mtimeMs; if (m !== sdkCache.m) { sdkCache.text = fs.readFileSync(f, 'utf8'); sdkCache.m = m; } } catch {}
  return sdkCache.text;
}
/** A reference in the app's HTML/CSS -> a path inside app/ (relative to `base`), or null when it points elsewhere.
 *  at: the app's URL root ('/apps/<id>', '/apps/t/<token>', '/apps/ex/<slug>'), or a bare project id. */
function localRel(ref, at, base = '') {
  let r = String(ref || '').trim().replace(/[?#].*$/, '');
  if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return null;
  const pre = `${String(at).startsWith('/') ? at : `/apps/${at}`}/ui/`;
  if (r.startsWith(pre)) r = r.slice(pre.length);
  else if (r.startsWith('/')) return null;
  else r = path.posix.normalize(path.posix.join(base || '.', r));
  try { r = decodeURIComponent(r); } catch { return null; }
  if (r.startsWith('../') || r === '..' || r.startsWith('/')) return null;
  return r.replace(/^\.\//, '');
}
const jsSafe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const cssSafe = (s) => s.replace(/<\/(style)/gi, '<\\/$1');
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null; };
const hasFlag = (tag, name) => new RegExp(`\\s${name}(?=[\\s>/=]|$)`, 'i').test(tag.replace(/(["'])[\s\S]*?\1/g, '""'));

/** index.html as served: the SDK, the app's own scripts and stylesheets and small images are put inline, so the sandboxed
 *  page loads with no further request. Its subresource requests come from an opaque origin and may carry no sign-in
 *  cookie, so through the gateway they would be sent to the sign-in page; inline content never needs one. The page
 *  behaves the same: deferred scripts move to the end of <body> in order, module scripts stay modules. */
async function inlineHtml(html, src, base = '') {
  let budget = INLINE_BUDGET;
  const read = async (ref, exts, from = base) => {
    const rel = localRel(ref, src.at, from);
    if (!rel) return null;
    const f = await uiFile(src.dir, rel);
    if (!f || !exts.includes(f.ext) || f.size > budget) return null;
    budget -= f.size;
    try { return { buf: await readNoFollow(f.file), ext: f.ext, rel: f.rel }; } catch { return null; }
  };
  const dataUri = (r) => `data:${UI_TYPES[r.ext].split(';')[0]};base64,${r.buf.toString('base64')}`;
  async function css(text, from) {
    const refs = new Map();
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
      const ref = m[2].trim();
      if (refs.has(ref) || /^data:/i.test(ref)) continue;
      const r = await read(ref, [...IMG_EXT, '.woff2'], from);
      refs.set(ref, r && r.buf.length <= 400e3 ? dataUri(r) : null);
    }
    return cssSafe(text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => (refs.get(ref.trim()) ? `url("${refs.get(ref.trim())}")` : m)));
  }
  let sdk = false;
  const tail = [];
  const pieces = [];
  let last = 0;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<link\b[^>]*>|<img\b[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    pieces.push(html.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];
    let rep = tag;
    if (/^<script/i.test(tag)) {
      const open = `<script${m[1]}>`, src = attr(open, 'src');
      if (src != null) {
        const type = (attr(open, 'type') || '').toLowerCase().trim();
        if (/^(?:https?:\/\/[^/]+)?\/apps\/sdk\.js(?:[?#].*)?$/i.test(src.trim())) { rep = `<script>${jsSafe(sdkText())}</script>`; sdk = true; }
        else {
          const r = await read(src, ['.js']);
          if (r) {
            const code = jsSafe(r.buf.toString('utf8'));
            if (type === 'module') rep = `<script type="module">${code}</script>`;
            else if (hasFlag(open, 'defer') || hasFlag(open, 'async')) { tail.push(`<script>${code}</script>`); rep = ''; }
            else rep = `<script>${code}</script>`;
          }
        }
      }
    } else if (/^<link/i.test(tag)) {
      const rel = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/);
      const href = attr(tag, 'href');
      if (rel.includes('stylesheet') && href) {
        const r = await read(href, ['.css']);
        if (r) {
          const media = attr(tag, 'media');
          rep = `<style${media ? ` media="${escHtml(media)}"` : ''}>${await css(r.buf.toString('utf8'), path.posix.dirname(r.rel))}</style>`;
        }
      }
    } else {
      const src = attr(tag, 'src');
      if (src && !/^data:/i.test(src)) {
        const r = await read(src, IMG_EXT);
        if (r && r.buf.length <= 400e3) rep = tag.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i, (x, a) => `${a}"${dataUri(r)}"`);
      }
    }
    pieces.push(rep);
  }
  pieces.push(html.slice(last));
  let out = pieces.join('');
  // inline <style> blocks may point at files too
  if (/<style\b/i.test(out)) {
    const blocks = [];
    for (const m of out.matchAll(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi)) blocks.push(m);
    for (const m of blocks.reverse()) {
      const fixed = await css(m[2], base);
      out = out.slice(0, m.index) + m[1] + fixed + m[3] + out.slice(m.index + m[0].length);
    }
  }
  // (function replacements: app code may contain $& or $' and must not be read as replacement patterns)
  if (tail.length) out = /<\/body\s*>/i.test(out) ? out.replace(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i, () => `${tail.join('\n')}\n</body>`) : out + tail.join('\n');
  if (!sdk) { // every app gets the SDK, first thing
    const s = `<script>${jsSafe(sdkText())}</script>`;
    out = /<head\b[^>]*>/i.test(out) ? out.replace(/<head\b[^>]*>/i, (h) => h + s) : s + out;
  }
  return out;
}

// No X-Frame-Options here: browsers check SAMEORIGIN against the framed page's own origin, which the sandbox makes opaque,
// so the shell's <iframe sandbox> would be refused. The app has nothing privileged to clickjack; the shell has frame-ancestors.
const UI_HEADERS = { 'Content-Security-Policy': UI_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
async function serveUi(req, res, src, rel) {
  const f = await uiFile(src.dir, rel);
  if (!f) return D.send(res, 404, { error: 'not found' });
  // SVG only as an image (an SVG document could run script; even sandboxed, it has no business being a page)
  const dest = String(req.headers['sec-fetch-dest'] || '');
  if (f.ext === '.svg' && dest && dest !== 'image') return D.send(res, 404, { error: 'not found' });
  let body;
  try { body = await readNoFollow(f.file); } catch { return D.send(res, 404, { error: 'not found' }); }
  if (f.ext === '.html') body = Buffer.from(await inlineHtml(body.toString('utf8'), src, path.posix.dirname(f.rel)), 'utf8');
  res.writeHead(200, { 'Content-Type': UI_TYPES[f.ext], 'Content-Length': body.length, ...UI_HEADERS });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------- icons: a flat PNG in the app's colour, no libraries
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngRgb(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** Is (u, v) in [0,1]^2 inside the white glyph? leaf: a leaf with its midrib; signal: a dot and two arcs. */
function glyph(kind, u, v) {
  if (kind === 'leaf') {
    const dx = u - 0.52, dy = v - 0.48, c = Math.SQRT1_2;
    const x = (dx - dy) * c, y = (dx + dy) * c; // leaf axis along the up-right diagonal
    const L = 0.3, W = 0.135, R = (L * L + W * W) / (2 * W), d = R - W;
    const inLeaf = x * x + (y - d) * (y - d) <= R * R && x * x + (y + d) * (y + d) <= R * R;
    if (inLeaf) return !(Math.abs(y + 0.012 * Math.sin(x * 9)) < 0.0115 && x > -L * 0.92 && x < L * 0.72); // midrib cut out
    return Math.abs(y) < 0.016 && x <= -L + 0.02 && x > -L - 0.1; // stem
  }
  const cx = 0.5, cy = 0.64, dx = u - cx, dy = v - cy, r = Math.hypot(dx, dy);
  if (r <= 0.068) return true;
  const ang = Math.atan2(dx, -dy); // 0 = straight up
  if (Math.abs(ang) > 0.82) return false;
  return (r >= 0.15 && r <= 0.215) || (r >= 0.29 && r <= 0.355);
}
const iconCache = new Map();
function iconPng(size, theme, kind) {
  const key = `${size}:${theme}:${kind}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(theme.slice(i, i + 2), 16));
  const rgb = Buffer.alloc(size * size * 3);
  const S = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let cover = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (glyph(kind, (x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size)) cover++;
    const a = cover / (S * S), i = (y * size + x) * 3;
    rgb[i] = Math.round(r + (255 - r) * a); rgb[i + 1] = Math.round(g + (255 - g) * a); rgb[i + 2] = Math.round(b + (255 - b) * a);
  }
  const png = pngRgb(size, size, rgb);
  if (iconCache.size > 48) iconCache.delete(iconCache.keys().next().value);
  iconCache.set(key, png);
  return png;
}

// ---------------------------------------------------------------- the shell
/** Everything the shell page needs about this app, read fresh from disk. src: { kind: 'owner' | 'link' | 'example', at, dir }
 *  (a bare project id is the owner's own /apps/<id>). Link and example shells are always the demo. */
function appConfig(id, dir, preview, src = null) {
  const at = src ? src.at : `/apps/${id}`;
  const kind = src ? src.kind : 'owner';
  if (kind !== 'owner') preview = true;
  const meta = smallJSON(path.join(dir, 'meta.json'), 2e6) || {};
  const appDir = path.join(dir, 'app');
  const rawApp = smallJSON(path.join(appDir, 'app.json'), 65536);
  const rawProfiles = smallJSON(path.join(appDir, 'profiles.json'), 262144);
  const app = cleanApp(rawApp, meta.title);
  const profiles = cleanProfiles(rawProfiles);
  const plant = isPlantApp(app, profiles);
  const iconOk = app.icon && isFile(path.join(appDir, app.icon));
  return {
    v: 1, id, at, kind, preview: !!preview, exists: isFile(path.join(appDir, 'index.html')),
    name: app.name, short_name: app.short_name, theme: app.theme, fields: app.fields, plant,
    controls: approutesControls(rawApp), // controls: app.json "controls", cleaned (the shell checks commands against them)
    icon: iconOk ? `${at}/ui/${app.icon}` : `${at}/icon-192.png`,
    // what buildery.app() / buildery.profiles() give the app: its own files as written (they are the app's data)
    app_json: isObj(rawApp) ? rawApp : { name: app.name, short_name: app.short_name, theme: app.theme, fields: app.fields },
    profiles: isObj(rawProfiles) ? rawProfiles : {},
    profile_keys: Object.keys(profiles),
    demo_profiles: profiles,
    alerts: alertLines(smallJSON(path.join(appDir, 'alerts.json'), 65536)),
    studio: kind === 'owner' ? approutes.designPath(id, meta.title || '') + '/app' : null,
  };
}
const approutesControls = (rawApp) => require('../web/apps/bridge.js').cleanControls(isObj(rawApp) ? rawApp.controls : null);
const ICONS = {
  back: '<svg viewBox="0 0 12 20" width="11" height="18" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bell: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 2.8a4.6 4.6 0 0 0-4.6 4.6v2.7c0 .9-.3 1.7-.9 2.4l-.9 1h12.8l-.9-1a3.6 3.6 0 0 1-.9-2.4V7.4A4.6 4.6 0 0 0 10 2.8zM8 16.2a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
function shellHtml(cfg) {
  const at = cfg.at, name = escHtml(cfg.name);
  const touch = iconPng(180, cfg.theme, cfg.plant ? 'leaf' : 'signal').toString('base64');
  const main = cfg.exists
    ? `<iframe id="bxApp" class="bx-frame" sandbox="allow-scripts allow-forms" src="${at}/ui/index.html" title="${name}"></iframe>`
    : `<div class="bx-empty"><img src="${at}/icon-192.png" alt="" width="72" height="72"><h2>This app isn’t built yet</h2>
      <p>Open the design in the Premake studio on a computer and build it from the App tab.</p>${cfg.studio ? `<a class="bx-cta" href="${escHtml(cfg.studio)}">Open the design</a>` : ''}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${name}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f6f5f2">
<meta name="color-scheme" content="light">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${escHtml(cfg.short_name)}">
<link rel="manifest" href="${at}/manifest.webmanifest"${cfg.kind === 'owner' ? ' crossorigin="use-credentials"' : ''}>
<link rel="icon" type="image/png" sizes="192x192" href="${at}/icon-192.png">
<link rel="apple-touch-icon" href="data:image/png;base64,${touch}">
<link rel="stylesheet" href="/apps/shell.css">
<script type="application/json" id="bxcfg">${jsonForHtml(cfg)}</script>
<script src="/apps/bridge.js" defer></script>
<script src="/apps/qr.js" defer></script>
${cfg.preview ? '<script src="/apps/demo.js" defer></script>\n' : ''}<script src="/apps/shell.js" defer></script>
</head>
<body class="${cfg.preview ? 'bx-preview' : ''}">
<header class="bx-bar">
  <button class="bx-round bx-back" type="button" aria-label="Back to the studio" hidden>${ICONS.back}</button>
  <img class="bx-icon" src="${escHtml(cfg.icon)}" alt="" width="30" height="30">
  <div class="bx-title"><h1>${name}</h1>${cfg.preview ? '<span class="bx-pill">Demo data</span>' : ''}<span class="bx-pill bx-offline" hidden>Offline</span></div>
  <button class="bx-round bx-alerts" type="button" aria-pressed="false" aria-label="Alerts" title="Alerts"${cfg.exists ? '' : ' hidden'}>${ICONS.bell}<span class="bx-dot" hidden></span></button>
  <button class="bx-round bx-add" type="button" aria-label="Add sensor" title="Add sensor"${cfg.exists ? '' : ' hidden'}>${ICONS.plus}</button>
</header>
<main class="bx-main">${main}</main>
<div class="bx-scrim" hidden></div>
<section class="bx-sheet" role="dialog" aria-modal="true" aria-labelledby="bxSheetTitle" hidden></section>
<div class="bx-toast" role="status" aria-live="polite" hidden></div>
</body>
</html>
`;
}
function manifest(cfg) {
  const at = cfg.at;
  return {
    name: cfg.name, short_name: cfg.short_name, id: at, start_url: at, scope: at,
    display: 'standalone', orientation: 'portrait', background_color: '#f6f5f2', theme_color: '#f6f5f2',
    icons: [
      { src: `${at}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${at}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${at}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

// ---------------------------------------------------------------- routes
/** /apps/... Returns true when handled. */
async function handle(req, res, { parts, m, acc, url }) {
  if (parts[0] !== 'apps') return false;
  if (m !== 'GET' && m !== 'HEAD') { D.send(res, 405, { error: 'method not allowed' }); return true; }
  const [, a, b, ...rest] = parts;
  // the shell's own code, the SDK and the service worker: static, the same for everyone
  if (a && !b && Object.prototype.hasOwnProperty.call(SHELL_FILES, a)) {
    let body;
    try { body = fs.readFileSync(path.join(D.WEB, 'apps', a)); } catch { D.send(res, 404, { error: 'not found' }); return true; }
    res.writeHead(200, { 'Content-Type': SHELL_FILES[a], 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      ...(a === 'sw.js' ? { 'Service-Worker-Allowed': '/apps/' } : {}) });
    res.end(m === 'HEAD' ? undefined : body);
    return true;
  }
  // app-preview: /apps/t/<token>/... (a phone preview link) and /apps/ex/<slug>/... (an example's app): demo data only
  let src;
  if (a === 't' || a === 'ex') {
    if (a === 't' && tooManyBad()) { D.send(res, 429, { error: 'too many requests' }); return true; }
    src =a === 't' ? linkSource(b) : exampleSource(b);
    if (!src) { if (a === 't') badLookup(); D.send(res, 404, { error: 'not found' }); return true; }
    return serveApp(req, res, m, url, src, rest[0], rest.slice(1));
  }
  // everything else belongs to one project: its owner (or an admin) only, 404 for anyone else
  const dir = ID_RE.test(a || '') ? D.projDir(a) : null;
  if (!dir || !D.canEdit(acc, a) || !isFile(path.join(dir, 'meta.json'))) { D.send(res, 404, { error: 'not found' }); return true; }
  return serveApp(req, res, m, url, { kind: 'owner', id: a, at: `/apps/${a}`, dir }, b, rest);
}
/** One app's pages under src.at: the shell, ui/<file>, the manifest and icons. */
async function serveApp(req, res, m, url, src, b, rest) {
  const { id, dir } = src;
  if (b === 'ui' && rest.length) { await serveUi(req, res, src, rest.join('/')); return true; }
  if (!b) {
    if (url.pathname.endsWith('/')) { res.writeHead(301, { Location: `${src.at}${url.search}`, 'Cache-Control': 'no-store' }); res.end(); return true; }
    const body = Buffer.from(shellHtml(appConfig(id, dir, url.searchParams.get('preview') === '1', src)), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Content-Security-Policy': SHELL_CSP,
      'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': src.kind === 'owner' ? 'same-origin' : 'no-referrer', 'Cache-Control': 'no-store',
      ...(src.kind === 'owner' ? {} : { 'X-Robots-Tag': 'noindex' }) });
    res.end(m === 'HEAD' ? undefined : body);
    return true;
  }
  if (b === 'manifest.webmanifest' && !rest.length) {
    const body = Buffer.from(JSON.stringify(manifest(appConfig(id, dir, false, src))), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(m === 'HEAD' ? undefined : body);
    return true;
  }
  const im = /^icon-(\d+)\.png$/.exec(b || '');
  if (im && !rest.length && ICON_SIZES.includes(Number(im[1]))) {
    const cfg = appConfig(id, dir, false, src);
    const body = iconPng(Number(im[1]), cfg.theme, cfg.plant ? 'leaf' : 'signal');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(m === 'HEAD' ? undefined : body);
    return true;
  }
  D.send(res, 404, { error: 'not found' });
  return true;
}

// ---------------------------------------------------------------- app-preview: phone preview links and example apps
// A link lets a phone that isn't signed in open this design's app with DEMO data: the shell, the generated app files, the
// manifest and icons, nothing else (no devices, readings, photos, chats or account data: the demo shell calls no API).
// One link per design, 24 hours, revocable; turning it off, making a new one, a change of owner or deleting the design
// ends it at once. Stored server-side in <DATA>/app_links.json { token: { project, owner, created, expires } } (0600).
let links = null;
const linksFile = () => (D.DATA ? path.join(D.DATA, 'app_links.json') : null);
const nowMs = () => (D.now ? D.now() : Date.now());
function loadLinks() {
  if (links) return links;
  links = {};
  const f = linksFile();
  const raw = f ? smallJSON(f, 4e6) : null;
  if (isObj(raw)) for (const [t, e] of Object.entries(raw)) if (TOKEN_RE.test(t) && isObj(e) && ID_RE.test(e.project || '') && typeof e.owner === 'string') links[t] = e;
  return links;
}
function saveLinks() {
  const f = linksFile(); if (!f) return;
  const t = nowMs();
  for (const [k, e] of Object.entries(links)) if (!(Date.parse(e.expires) > t)) delete links[k]; // expired: gone
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(links, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
function newToken() {
  const out = []; // rejection sampling: no modulo bias
  while (out.length < 22) for (const x of crypto.randomBytes(44)) if (x < 248 && out.length < 22) out.push(B62[x % 62]);
  return out.join('');
}
/** The live link entry for a token, or null (unknown, expired, owner changed, design gone). */
function linkEntry(token) {
  if (!TOKEN_RE.test(token || '')) return null;
  const e = Object.prototype.hasOwnProperty.call(loadLinks(), token) ? links[token] : null;
  if (!e || !(Date.parse(e.expires) > nowMs())) return null;
  if (D.ownerOf && D.ownerOf(e.project) !== e.owner) return null;
  return e;
}
function linkSource(token) {
  const e = linkEntry(token);
  const dir = e ? D.projDir(e.project) : null;
  if (!dir || !isFile(path.join(dir, 'meta.json')) || !isFile(path.join(dir, 'app', 'index.html'))) return null;
  return { kind: 'link', id: e.project, at: `/apps/t/${token}`, dir };
}
function exampleSource(slug) {
  const dir = SLUG_RE.test(slug || '') && D.exDir ? D.exDir(slug) : null;
  if (!dir || !isFile(path.join(dir, 'meta.json')) || !isFile(path.join(dir, 'app', 'index.html'))) return null;
  return { kind: 'example', id: slug, at: `/apps/ex/${slug}`, dir };
}
/** Unknown tokens: a global cap, so guessing is slow as well as hopeless (131 bits). */
let bad = { start: 0, n: 0 };
function badLookup() { const t = nowMs(); if (t - bad.start > 60e3) bad = { start: t, n: 0 }; bad.n++; }
const tooManyBad = () => nowMs() - bad.start <= 60e3 && bad.n > 300;
/** { exists, name } for an example's app (the example page's "Try the app"), or null. */
function exampleInfo(slug, dir) {
  if (!dir || !isFile(path.join(dir, 'app', 'index.html'))) return null;
  return { exists: true, name: cleanApp(smallJSON(path.join(dir, 'app', 'app.json'), 65536), '').name, url: `/apps/ex/${slug}` };
}
const linkView = (token, e) => ({ token, url: `/apps/t/${token}`, created: e.created, expires: e.expires });
/** GET|POST|DELETE /api/apps/<id>/link: the owner's phone preview link. GET -> { link: {...} | null }, POST makes a new one
 *  (the old one stops working), DELETE turns it off. Owner or admin only, 404 for anyone else. */
async function linkApi(req, res, { id, m, acc }) {
  const dir = ID_RE.test(id || '') ? D.projDir(id) : null;
  if (!dir || !D.canEdit(acc, id) || !isFile(path.join(dir, 'meta.json'))) { D.send(res, 404, { error: 'not found' }); return true; }
  loadLinks();
  const mine = Object.entries(links).filter(([t]) => linkEntry(t) && links[t].project === id);
  if (m === 'GET') { const [t, e] = mine[0] || []; D.send(res, 200, { link: t ? linkView(t, e) : null }); return true; }
  if (m === 'DELETE') { for (const [t] of mine) delete links[t]; saveLinks(); D.send(res, 200, { link: null }); return true; }
  if (m !== 'POST') { D.send(res, 405, { error: 'GET, POST or DELETE' }); return true; }
  if (!isFile(path.join(dir, 'app', 'index.html'))) { D.send(res, 409, { error: 'Build the app first.' }); return true; }
  if (D.allow && !D.allow('applink:' + (acc.user || 'local'), 30, 3600e3)) { D.send(res, 429, { error: 'That is a lot of new links this hour. Try again later.' }); return true; }
  for (const [t] of Object.entries(links)) if (links[t].project === id) delete links[t]; // one link per design
  const owner = D.ownerOf ? D.ownerOf(id) : acc.user;
  const t = newToken(), at = nowMs();
  links[t] = { project: id, owner: owner || '', created: new Date(at).toISOString(), expires: new Date(at + LINK_TTL_MS).toISOString() };
  saveLinks();
  D.send(res, 200, { link: linkView(t, links[t]) });
  return true;
}

// ---------------------------------------------------------------- the app agent
/** Field names the firmware seems to send, from the source in firmware/ (a hint for the agent, not an authority). */
const NOT_FIELDS = new Set(['name', 'state_topic', 'unit_of_measurement', 'device_class', 'value_template', 'unique_id', 'device', 'identifiers', 'r', 'fw', 'ok',
  'interval', 'ssid', 'password', 'pass', 'key', 'host', 'user', 'topic', 'payload', 'state', 'config', 'model', 'manufacturer', 'sw_version', 'availability_topic',
  'json_attributes_topic', 'icon', 'expire_after', 'force_update', 'platform', 'id', 'type', 'error', 'status', 'version', 'time', 't', 'mac', 'ip', 'rssi_dbm']);
function firmwareFields(dir) {
  const found = [];
  const add = (k) => { if (FIELD_RE.test(k) && !NOT_FIELDS.has(k) && !found.includes(k)) found.push(k); };
  let files = 0;
  const walk = (d, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files >= 30) return;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3 && !e.name.startsWith('.')) walk(p, depth + 1);
      else if (e.isFile() && /\.(ino|cpp|cc|c|h|hpp|py|js|ts|ya?ml)$/i.test(e.name)) {
        files++;
        const st = statOf(p); if (!st || st.size > 300e3) continue;
        let s; try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
        for (const m of s.matchAll(/\\"([a-z][a-z0-9_]{0,23})\\"\s*:/g)) add(m[1]); // "{\"moisture\":%d, ...}" in C strings
        for (const m of s.matchAll(/\[\s*"([a-z][a-z0-9_]{0,23})"\s*\]\s*=/g)) add(m[1]); // ArduinoJson doc["moisture"] = ...
        for (const m of s.matchAll(/\br\s*\[\s*["']([a-z][a-z0-9_]{0,23})["']\s*\]/g)) add(m[1]); // r["light"]
      }
    }
  };
  walk(path.join(dir, 'firmware'), 0);
  return found.slice(0, 16);
}
/** Does any firmware source post to Premake's ingest endpoint (so its field names are the real ones)? */
function firmwarePostsToBuildery(dir) {
  let hit = false, files = 0;
  const walk = (d, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (hit || files >= 30) return;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3 && !e.name.startsWith('.')) walk(p, depth + 1);
      else if (e.isFile() && /\.(ino|cpp|cc|c|h|hpp|py|js|ts|ya?ml)$/i.test(e.name)) {
        files++;
        const st = statOf(p); if (!st || st.size > 300e3) continue;
        try { hit = fs.readFileSync(p, 'utf8').includes('/api/d/ingest'); } catch {}
      }
    }
  };
  walk(path.join(dir, 'firmware'), 0);
  return hit;
}
/** controls: the firmware's "// controls: angle (range 0-180), lamp (toggle)" line(s), and whether it polls /api/d/commands. */
function firmwareControls(dir) {
  const notes = [];
  let polls = false, files = 0;
  const walk = (d, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files >= 30) return;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3 && !e.name.startsWith('.')) walk(p, depth + 1);
      else if (e.isFile() && /\.(ino|cpp|cc|c|h|hpp|py)$/i.test(e.name)) {
        files++;
        const st = statOf(p); if (!st || st.size > 300e3) continue;
        let s; try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
        if (s.includes('/api/d/commands')) polls = true;
        for (const m of s.matchAll(/(?:\/\/|#)\s*controls?:\s*([^\n]{1,300})/gi)) if (notes.length < 4) notes.push(clip(m[1], 300));
      }
    }
  };
  walk(path.join(dir, 'firmware'), 0);
  return { notes, polls };
}
const snip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
/** Context appended to the system prompt for each app-agent turn: it can't read anything outside ./app, so it gets the
 *  design, the parts, the wiring, the firmware's fields and the current app files here. */
function contextPrompt(dir) {
  const meta = smallJSON(path.join(dir, 'meta.json'), 2e6) || {};
  const msgs = smallJSON(path.join(dir, 'messages.json'), 4e6);
  const first = Array.isArray(msgs) ? msgs.find((x) => x && x.role === 'user' && typeof x.text === 'string') : null;
  const bom = smallJSON(path.join(dir, 'bom.json'), 2e6) || {};
  const parts = (Array.isArray(bom.parts) ? bom.parts : []).map((p) => `${p?.qty_per_unit || 1} x ${clip(p?.name, 80)}`).filter((x) => !/x $/.test(x)).slice(0, 30);
  const wiring = (() => { const st = statOf(path.join(dir, 'wiring.md')); if (!st?.isFile() || st.size > 200e3) return ''; try { return fs.readFileSync(path.join(dir, 'wiring.md'), 'utf8'); } catch { return ''; } })();
  const fw = firmwareFields(dir), posts = firmwarePostsToBuildery(dir), ctl = firmwareControls(dir);
  const appDir = path.join(dir, 'app');
  const files = [];
  const walk = (d, rel, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory() && depth < 2) walk(path.join(d, e.name), rel + e.name + '/', depth + 1);
      else if (e.isFile() && files.length < 60) files.push(`${rel}${e.name} (${Math.max(1, Math.round((statOf(path.join(d, e.name))?.size || 0) / 1024))} KB)`);
    }
  };
  walk(appDir, '', 0);
  const json = (f, n) => { const st = statOf(path.join(appDir, f)); if (!st?.isFile()) return null; try { return snip(fs.readFileSync(path.join(appDir, f), 'utf8'), n); } catch { return null; } };
  const lines = [
    '', '', '## This product right now',
    `- Design: "${clip(meta.title, 80) || 'Untitled'}"${meta.description ? ` — ${snip(meta.description, 400)}` : ''}`,
    first ? `- What the owner first asked the design agent for: "${snip(first.text, 700)}"` : null,
    parts.length ? `- Bought parts: ${parts.join('; ')}` : '- Bought parts: none listed',
    fw.length && posts ? `- The firmware (firmware/) posts these fields to /api/d/ingest: ${fw.join(', ')}. app.json "fields" must use exactly these names, and profiles.json thresholds are <field>_min / <field>_max.`
      : fw.length ? `- The firmware in firmware/ doesn't post to Premake yet (it will be updated to post to /api/d/ingest with the contract's field names). Its current code uses ${fw.join(', ')}. Use the contract names in app.json instead: moisture, light, temp, humidity, battery for a plant sensor (or plain names for what this product measures), and <field>_min / <field>_max in profiles.json.`
      : '- No firmware source yet: use the contract field names (moisture, light, temp, humidity, battery for a plant sensor) unless the product clearly measures something else.',
    ctl.notes.length ? `- The firmware's controls${ctl.polls ? ' (it polls /api/d/commands)' : ''}: ${ctl.notes.join('; ')}. Declare exactly these in app.json "controls" and build a control for each.`
      : ctl.polls ? '- The firmware polls /api/d/commands for controls: declare the keys it reads in app.json "controls" and build a control for each.'
      : '- If this product has actuators (a servo, motor, relay, LEDs, a buzzer), give the app controls for them (app.json "controls" + buildery.command); the firmware will be updated to poll /api/d/commands with the same names.',
    wiring ? `- Wiring notes (wiring.md):\n\n${snip(wiring, 1800).split('\n').map((l) => '  ' + l).join('\n')}` : null,
    files.length ? `- Files in ./app now: ${files.join(', ')}. Read the ones you change before editing them.` : '- ./app is empty: write the first version of every file.',
    json('app.json', 2000) ? `- ./app/app.json now:\n\n  ${json('app.json', 2000).replace(/\n/g, '\n  ')}` : null,
  ].filter((x) => x != null);
  return lines.join('\n') + '\n';
}
/** Before an app-agent turn: app/ exists, and the JSON files are kept to restore if the turn breaks them. */
function prepare(dir) {
  const appDir = path.join(dir, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  const backup = {};
  for (const f of ['app.json', 'profiles.json', 'alerts.json']) { const st = statOf(path.join(appDir, f)); if (st?.isFile() && st.size < 2e6) backup[f] = fs.readFileSync(path.join(appDir, f), 'utf8'); }
  return backup;
}
/** After an app-agent turn: JSON files must parse (else the previous version comes back), and no instruction or settings
 *  files may be left anywhere in app/ for a later agent turn to load. Returns a note for the chat, or ''. */
function finalize(dir, backup = {}) {
  const appDir = path.join(dir, 'app');
  const notes = [];
  const sweep = (d, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (PLANTED.has(e.name.toLowerCase()) || e.isSymbolicLink()) { try { fs.rmSync(p, { recursive: true, force: true }); console.log(`[apps] removed ${path.relative(dir, p)}`); } catch {} continue; }
      if (e.isDirectory() && depth < 6) sweep(p, depth + 1);
    }
  };
  sweep(appDir, 0);
  for (const f of ['app.json', 'profiles.json', 'alerts.json']) {
    const p = path.join(appDir, f);
    const st = statOf(p);
    if (!st?.isFile()) continue;
    let ok = st.size < 2e6;
    if (ok) { try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); ok = isObj(v) && (f !== 'alerts.json' || Array.isArray(v.rules)); } catch { ok = false; } }
    if (ok) continue;
    if (backup[f] != null) { fs.writeFileSync(p, backup[f]); notes.push(`${f} came out invalid, so I restored the previous version.`); }
    else { fs.rmSync(p, { force: true }); notes.push(`${f} came out invalid, so I removed it.`); }
  }
  if (!isFile(path.join(appDir, 'index.html'))) notes.push('There is no app/index.html yet, so the app can’t open.');
  return notes.join(' ');
}

module.exports = { init, handle, linkApi, exampleInfo, info, sig, contextPrompt, prepare, finalize, prompt: () => agentPrompt, TOOLS, ALLOWED, DENIED, UI_CSP, SHELL_CSP,
  _test: { uiFile, inlineHtml, localRel, cleanApp, cleanProfiles, alertLines, firmwareFields, iconPng, glyph, crc32, ELECTRONICS } };
