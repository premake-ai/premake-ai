'use strict';
// showcase: the owner's finished designs, published as examples automatically.
//
// A design in <DATA>/projects/<id> owned by one of SHOWCASE_OWNERS (FORMA_SHOWCASE_OWNERS, comma separated) becomes an
// example when it passes the bar: last build ok (no "BUILD FAILED" in build_log.txt), at least one part, a thumbnail, a
// price, a real title (not a filler word, not "Remix of ...", not the prompt echoed back), nothing weapon-like in its title / description / tags, and
// no agent running on it. Its meta.json can opt out with "showcase": false.
//
// A qualifying design is copied, allowlisted files only, to <DATA>/showcase/<slug>/ (model, parts list, code, thumbnail,
// wiring / firmware: the same files a repo example has). Never its chat, versions, uploads, run logs, product page, ads or
// owner. The examples API, file serving, quotes, orders, guides and the landing page read these exactly like the repo
// examples in app/data/examples (server.js exDir / exampleSlugs). The slug comes from the title on first publish and then
// stays, so links keep working when the design is rebuilt or renamed. Same-titled designs (benchmark rounds, retries)
// show once: the newest. sync() runs at boot, every few minutes and after each design run; it refreshes a snapshot when
// the design changed, keeps the last good snapshot while a design is building or its latest build failed, and removes it
// when the project is deleted or stops qualifying for good (opt-out, weapon-like, retitled to filler, a newer duplicate).
// Index: <DATA>/showcase.json { slug: { project, key, sig, at } } (server-only, never served).
const fs = require('node:fs');
const path = require('node:path');
const { isPromptEcho } = require('./agentbrain');

const COPY_FILES = ['meta.json', 'design.py', 'bom.json', 'manifest.json', 'thumb.png', 'motion.json', 'wiring.md', 'wiring.json', 'app.json'];
const COPY_DIRS = ['stl', 'firmware'];
const SIG_FILES = ['meta.json', 'design.py', 'bom.json', 'manifest.json', 'thumb.png', 'runs.jsonl', 'app/index.html', 'app/app.js', 'app/style.css', 'app/app.json'];
// app-preview: the companion app (the example page's "Try the app", served with demo data at /apps/ex/<slug>): only the
// files the app server serves, no dot files, no links, two folders deep at most. Never its chat or the agent's session.
const APP_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(?:html|js|css|json|svg|png|jpe?g|webp|woff2)$/i;
const SNAP_V = 5; // bump when the snapshot format changes: every snapshot is re-copied once
// Josh's rule: nothing weapon- or gun-like in marketing (the grip trainer reads as a pistol grip).
const WEAPON_RE = /\b(guns?|rifles?|pistols?|revolvers?|shotguns?|firearms?|handguns?|turrets?|sling ?shots?|catapults?|crossbows?|bows? and arrows?|archery|knife|knives|blades?|swords?|daggers?|machetes?|weapons?|ammo|ammunition|bullets?|holsters?|triggers?|silencers?|suppressors?|grenades?|tasers?|stun|shock|launchers?|airsoft|paintball|blasters?|nerf|scopes?|optics|hyrax\w*|grip trainers?|knuckles?|batons?|nunchucks?|militar\w*|tactical)\b/i;
const FILLER_RE = /^(?:untitled(?: design)?|new (?:design|project|product)|design|project|product|test(?:ing)?|thing|something|idea|placeholder|my (?:design|project|product)|this|that|it|.{0,2})$/i;
const INTERNAL_TAGS = new Set(['benchmark', 'round1', 'round2', 'realworld', 'kickstarter', 'test']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** "3D-Printed" -> "3d printed", "12V" / "benchmark" -> '' (gallery filter chips stay few and tidy) */
function cleanTag(t) {
  const x = String(t || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!x || x.length > 24 || INTERNAL_TAGS.has(x) || /^\d+(?:\.\d+)? ?v$/.test(x)) return '';
  const ACRO = { esp32: 'ESP32', led: 'LED', leds: 'LED', tpu: 'TPU', pla: 'PLA', petg: 'PETG', usb: 'USB', 'usb c': 'USB-C', iot: 'IoT', wifi: 'Wi-Fi', 'wi fi': 'Wi-Fi' };
  return /^3d print(?:ed|ing|s)?$/.test(x) ? '3d printed' : ACRO[x] || x;
}

/** "Tapered Handled Cup" and "tapered handle mug" -> the same key, so near-identical retries show once. */
function titleKey(title) {
  const syn = { mug: 'cup', cups: 'cup', mugs: 'cup' };
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    .map((w) => syn[w] || (w.length > 3 ? w.replace(/(?:ed|es|s)$/, '').replace(/e$/, '') : w)).sort().join(' ');
}
function slugify(title) {
  return String(title || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'design';
}

/** ctx: { DATA, PROJECTS, EXAMPLES, OWNERS (Set), readJSON, writeJSON, ownerOf, busy(id), priceOf(dir) } */
function init(ctx) {
  const { DATA, PROJECTS, EXAMPLES, OWNERS, readJSON, writeJSON, ownerOf, busy, priceOf } = ctx;
  const ROOT = path.join(DATA, 'showcase');
  const INDEX = path.join(DATA, 'showcase.json');
  let index = readJSON(INDEX, {}) || {};
  let syncing = false;

  const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
  const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  const sigOf = (dir) => SNAP_V + '#' + SIG_FILES.map((f) => { try { const s = fs.statSync(path.join(dir, f)); return Math.floor(s.mtimeMs) + ':' + s.size; } catch { return '-'; } }).join('|');

  /** The snapshot dir for a slug, or null. */
  function dir(slug) {
    if (!SLUG_RE.test(slug || '') || !index[slug]) return null;
    const d = path.join(ROOT, slug);
    return exists(path.join(d, 'meta.json')) ? d : null;
  }
  /** Published slugs, newest design first. */
  function slugs() {
    return Object.entries(index).filter(([s]) => dir(s)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).map(([s]) => s);
  }
  /** When the published design was last built (ISO), for "designed 8 min ago". */
  function builtAt(slug) { const e = index[slug]; return e && e.at ? new Date(e.at).toISOString() : null; }

  /** 'ok' | 'hold' (keep any snapshot, don't publish a new one) | 'drop' (remove any snapshot). */
  function verdict(id, pdir, meta) {
    if (!OWNERS.has(String(ownerOf(id) || meta.owner || '').toLowerCase())) return 'drop';
    if (meta.showcase === false) return 'drop';
    const title = String(meta.title || '').trim();
    if (!title || FILLER_RE.test(title) || isPromptEcho(title) || /^remix of\b/i.test(title)) return 'drop';
    if (WEAPON_RE.test([title, meta.description || '', ...(meta.tags || [])].join(' '))) return 'drop';
    if (busy(id)) return 'hold';
    const man = readJSON(path.join(pdir, 'manifest.json'));
    if (!man?.parts?.length || !exists(path.join(pdir, 'thumb.png'))) return 'hold';
    let log = ''; try { log = fs.readFileSync(path.join(pdir, 'build_log.txt'), 'utf8'); } catch {}
    if (/BUILD FAILED/.test(log)) return 'hold';
    if (!(priceOf(pdir) > 0)) return 'hold';
    return 'ok';
  }

  function copyInto(src, dst, meta) {
    const tmp = dst + '.tmp-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of COPY_FILES) {
      const s = path.join(src, f);
      try { if (fs.lstatSync(s).isFile()) fs.copyFileSync(s, path.join(tmp, f)); } catch {}
    }
    for (const d of COPY_DIRS) {
      const s = path.join(src, d);
      try { if (!fs.lstatSync(s).isDirectory()) continue; } catch { continue; }
      fs.cpSync(s, path.join(tmp, d), { recursive: true, dereference: false, filter: (p) => { try { const st = fs.lstatSync(p); return st.isDirectory() || st.isFile(); } catch { return false; } } });
    }
    const copyApp = (s, d, depth) => {
      let ents; try { ents = fs.readdirSync(s, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const sp = path.join(s, e.name);
        let st; try { st = fs.lstatSync(sp); } catch { continue; }
        if (st.isDirectory() && depth < 2 && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(e.name)) copyApp(sp, path.join(d, e.name), depth + 1);
        else if (st.isFile() && st.size <= 5e6 && APP_FILE_RE.test(e.name) && !e.name.includes('..')) { fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(sp, path.join(d, e.name)); }
      }
    };
    try { if (fs.lstatSync(path.join(src, 'app')).isDirectory() && fs.lstatSync(path.join(src, 'app', 'index.html')).isFile()) copyApp(path.join(src, 'app'), path.join(tmp, 'app'), 0); } catch {}
    // runs.jsonl reduced to the design runs' durations, so cards can say "Designed in 8 min" (no prompts, errors or models)
    let runs = ''; try { runs = fs.readFileSync(path.join(src, 'runs.jsonl'), 'utf8'); } catch {}
    const durations = runs.split('\n').map((l) => { try { const r = JSON.parse(l); return r.kind === 'design' && Number.isFinite(r.end) && r.end > 0 ? Math.round(r.end) : null; } catch { return null; } }).filter(Boolean);
    if (durations.length) fs.writeFileSync(path.join(tmp, 'runs.jsonl'), durations.map((end) => JSON.stringify({ kind: 'design', end })).join('\n') + '\n');
    // Public meta: title, description, tags, created. Never the owner, referral or internal flags.
    const tags = [...new Set((Array.isArray(meta.tags) ? meta.tags : []).map(cleanTag).filter(Boolean))].slice(0, 5);
    writeJSON(path.join(tmp, 'meta.json'), { title: String(meta.title).trim().slice(0, 120), description: String(meta.description || '').slice(0, 600),
      creator: 'Premake', tags, created: meta.created || null, demo: true, showcase: true });
    fs.rmSync(dst, { recursive: true, force: true });
    fs.renameSync(tmp, dst);
  }
  function remove(slug) {
    try { fs.rmSync(path.join(ROOT, slug), { recursive: true, force: true }); } catch {}
    delete index[slug];
  }

  /** Bring <DATA>/showcase in line with the owner's projects. Returns { published, removed, total }. */
  function sync() {
    if (syncing) return null;
    syncing = true;
    const out = { published: [], removed: [], total: 0 };
    try {
      fs.mkdirSync(ROOT, { recursive: true });
      const repoKeys = new Set();
      for (const s of exists(EXAMPLES) ? fs.readdirSync(EXAMPLES) : []) {
        const m = readJSON(path.join(EXAMPLES, s, 'meta.json'));
        if (m) repoKeys.add(titleKey(m.title));
      }
      const ok = new Map(); // key -> newest { id, pdir, meta, at }
      const held = new Set(); // project ids whose snapshot stays as is
      for (const id of exists(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
        const pdir = path.join(PROJECTS, id);
        const meta = readJSON(path.join(pdir, 'meta.json'));
        if (!meta) continue;
        const v = verdict(id, pdir, meta);
        if (v === 'hold') { held.add(id); continue; }
        if (v !== 'ok') continue;
        const key = titleKey(meta.title);
        if (repoKeys.has(key)) continue; // a repo example already shows this design
        const at = mtime(path.join(pdir, 'manifest.json'));
        const cur = ok.get(key);
        if (!cur || at > cur.at) ok.set(key, { id, pdir, meta, at });
      }
      const winners = new Set([...ok.values()].map((w) => w.id));
      const byKey = new Map(Object.entries(index).map(([s, e]) => [e.key, s])); // before removals: a newer duplicate inherits the slug
      // Drop snapshots whose project is gone or no longer qualifies (held ones stay unless a newer duplicate won).
      for (const [slug, e] of Object.entries(index)) {
        const keep = winners.has(e.project) || (held.has(e.project) && !ok.has(e.key));
        if (!keep || !exists(path.join(ROOT, slug, 'meta.json'))) { remove(slug); out.removed.push(slug); }
      }
      const bySrc = new Map(Object.entries(index).map(([s, e]) => [e.project, s]));
      const taken = new Set([...(exists(EXAMPLES) ? fs.readdirSync(EXAMPLES) : []), ...Object.keys(index), ...byKey.values()]);
      for (const [key, w] of ok) {
        // a newer duplicate takes over the old slug (links keep working), unless that slug still belongs to another winner
        let slug = bySrc.get(w.id) || byKey.get(key);
        if (slug && index[slug] && index[slug].project !== w.id && winners.has(index[slug].project)) slug = null;
        if (!slug) {
          const base = slugify(w.meta.title);
          slug = base;
          for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
          taken.add(slug);
        }
        const sig = sigOf(w.pdir);
        const e = index[slug];
        if (e && e.project === w.id && e.sig === sig && exists(path.join(ROOT, slug, 'meta.json'))) continue;
        try {
          copyInto(w.pdir, path.join(ROOT, slug), w.meta);
          index[slug] = { project: w.id, key, sig, at: Math.floor(w.at) };
          out.published.push(slug);
        } catch (err) { console.error(`[showcase] ${slug}: ${err.message}`); }
      }
      // Leftover dirs the index doesn't know (a crash mid-copy): clean up.
      for (const d of fs.readdirSync(ROOT)) if (!index[d]) { try { fs.rmSync(path.join(ROOT, d), { recursive: true, force: true }); } catch {} }
      writeJSON(INDEX, index);
      out.total = Object.keys(index).length;
    } catch (err) {
      console.error('[showcase] sync failed:', err.message);
    } finally { syncing = false; }
    if (out.published.length || out.removed.length) console.log(`[showcase] ${out.total} designs; published ${out.published.join(', ') || '-'}; removed ${out.removed.join(', ') || '-'}`);
    return out;
  }

  let timer = null;
  /** Sync soon (after a design run): coalesces bursts. */
  function soon(ms = 4000) { clearTimeout(timer); timer = setTimeout(sync, ms); timer.unref?.(); }

  return { dir, slugs, builtAt, sync, soon, verdict };
}

module.exports = { init, titleKey, slugify, WEAPON_RE, FILLER_RE };
