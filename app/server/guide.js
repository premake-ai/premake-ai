'use strict';
// Build guides: "Generate instructions" for a design. A shareable page per design with downloads (STL zip, cut list,
// firmware), print settings, parts to buy, step-by-step assembly (one no-tools claude call, cached) with a VTK render
// per step, wiring, and "skip the build" calls to action priced from the live quote.
//
// Routes (handle() returns true when it answered):
//   GET  /build/<slug>                  public page (examples always; projects when the owner shares it; owner/admin always)
//   GET  /build/<slug>/data.json        the guide payload (same access)
//   GET  /build/<slug>/step-<n>.png     step render; /build/<slug>/thumb.png
//   GET  /build/<slug>/share.png        1200x630 share card (og:image), cached in the guide dir, re-rendered when the
//                                       design, bom or card text changes (cadlib/render_share.py, outside the sandbox)
//   GET  /build/<slug>/manifest.json    the 3D model the page's viewer loads, and /build/<slug>/stl/<file>.stl
//   GET  /build/<slug>/motion.json      the model's motion (Move button), when design.py defines motion()
//   GET  /build/<slug>/quote.json?mode= price tiers for the Order tab (kit | assembled)
//   GET  /build/<slug>/<file>           downloads: printed-parts.zip, everything.zip, cut-list.csv, parts-to-buy.csv,
//                                       firmware.zip, wiring.md
//   POST /api/guide/generate {slug, force?}   write (or rewrite) the steps; 202, poll data.json
//   POST /api/guide/share    {slug, on}       owner/admin: share a project's guide publicly
//   GET  /guides                        public index: every shared guide plus the examples (server-rendered, OG tags)
//   GET  /sitemap.xml, /robots.txt      for crawlers: /, /guides and every public guide
// Canonical / OG URLs use SITE (FORMA_SITE_URL, default https://premake.ai) whatever host served the page.
// <slug> is a project id or an example slug (projects win).
// Storage: projects in <project>/guide/; examples in <DATA>/guides/examples/<slug>/ (falls back to a seeded
// <example>/guide/ for reads), so generating never writes into the repo's example folders.

const fs = require('node:fs');
const { publicCreator } = require('./share'); // pen test A5: never an email as the public creator
const buildplan = require('./buildplan'); // the physically valid step order + wiring steps (geometry, wiring.json)
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const GUIDE_TIMEOUT = 240e3;
const RENDER_TIMEOUT = 150e3;
const SHARE_TIMEOUT = 90e3;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SITE = String(process.env.FORMA_SITE_URL || 'https://premake.ai').replace(/\/+$/, '');
/** The "Design your own with Premake" link: the landing page, tagged so guide traffic shows up in analytics. */
const designUrl = (slug) => `${SITE}/?utm_source=guide&utm_medium=referral${slug ? `&utm_campaign=${encodeURIComponent(slug)}` : ''}`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;
const MARK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.8l1.5 4.1 4.3.2-3.4 2.7 1.2 4.2L8 10.6 4.4 13l1.2-4.2-3.4-2.7 4.3-.2z" fill="currentColor"/></svg>';

// ---------------------------------------------------------------- store-only zip writer (no deps)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}
/** files: [{name, data: Buffer, mtime?: Date}] -> Buffer (zip, method 0 = stored, UTF-8 names). */
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const { time, date } = dosTime(f.mtime || new Date());
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------- helpers
const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function cleanStr(v, n) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : ''; }

/** Files under dir (relative), skipping dot files, max depth 4 and 200 files. */
function listTree(dir, base = '', depth = 0, out = []) {
  let ents; try { ents = fs.readdirSync(path.join(dir, base), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || out.length >= 200) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory() && depth < 4) listTree(dir, rel, depth + 1, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Print settings per printed part: bom.json printed info (+ any per-part overrides), Claude's suggestions, defaults. */
function printSettings(p, hint = {}) {
  const bb = (p.bbox || []).map(Number);
  let orientation = '';
  if (bb.length === 3) {
    const axes = ['X', 'Y', 'Z'];
    const iMin = bb.indexOf(Math.min(...bb));
    const flat = bb.filter((_, i) => i !== iMin).map((v) => Math.round(v)).join(' × ');
    orientation = Math.min(...bb) * 3 < Math.max(...bb)
      ? `Flat: largest face on the bed (${flat} mm footprint, ${Math.round(bb[iMin])} mm tall)`
      : `As modelled, flattest face down (${bb.map((v) => Math.round(v)).join(' × ')} mm, ${axes[iMin]} smallest)`;
  }
  const pick = (k, d) => cleanStr(p[k], 120) || cleanStr(hint[k], 160) || d;
  return {
    name: p.name, file: p.file, grams: r1(p.grams), hours: r1(p.print_hours), bbox: bb.map(r1),
    material: pick('material', 'PETG'),
    layer_height: pick('layer_height', '0.2 mm'),
    walls: pick('walls', '4 walls (1.6 mm)'),
    infill: pick('infill', '40% gyroid'),
    orientation: pick('orientation', orientation || 'Flattest face down'),
    supports: pick('supports', 'None'),
    note: cleanStr(hint.note, 200),
    too_big: bb.some((v) => v > 256),
  };
}

function fabSpec(f) {
  const p = f.params || {}, e = f.est || {};
  let spec = '';
  if (f.process === 'extrusion') spec = `${p.profile || '2020'} aluminium extrusion, cut to ${Math.round(e.length_mm || p.length_mm || 0)} mm${p.tapped_ends ? ', ends tapped M5' : ''}`;
  else if (f.process === 'sheet') spec = `${p.material || 'Sheet'} ${p.thickness_mm || ''} mm, ${e.bends ?? p.bends ?? 0} bend${(e.bends ?? p.bends) === 1 ? '' : 's'}, flat blank about ${Math.round(e.area_cm2 || 0)} cm²`;
  else if (f.process === 'laser') spec = `Laser cut ${p.material || 'sheet'} ${p.thickness_mm || ''} mm, ${Math.round(e.cut_length_mm || 0)} mm of cut, ${Math.round(e.area_cm2 || 0)} cm²`;
  else spec = f.process || '';
  return { name: f.name, file: f.file, process: f.process, params: p, est: e, bbox: (f.bbox || []).map(r1), spec,
    material_usd: Number(e.material_usd) || 0 };
}

// ---------------------------------------------------------------- the module
function init(ctx) {
  const { DATA, APP, VENV_PY, CLAUDE, MODEL, PROJECTS, EXAMPLES, readJSON, writeJSON, readText, exists, send, quote,
    canEdit, isAdmin, isPublished, publicFlag, setPublicFlag, agentGate, agentEnv, runProc, childEnv, renderSpawn, escHtml, allow, clientIp, cardStats, serveFile, ownerOf, orderPriceQuery } = ctx;
  const exDirOf = (slug) => (ctx.exDir ? ctx.exDir(slug) : path.join(EXAMPLES, slug));
  const exampleIds = () => (ctx.exampleSlugs ? ctx.exampleSlugs() : safeDir(EXAMPLES));
  const jobs = new Map(); // guide dir -> { startedAt, stage }
  const shareJobs = new Map(); // guide dir -> Promise<path> (share card render in flight)

  function resolve(slug) {
    if (!ID_RE.test(slug || '')) return null;
    const pd = path.join(PROJECTS, slug);
    if (exists(path.join(pd, 'meta.json'))) return { kind: 'projects', id: slug, dir: pd, project: true, gdir: path.join(pd, 'guide') };
    const ed = exDirOf(slug); // showcase: repo examples and the owner's published designs
    if (exists(path.join(ed, 'meta.json'))) return { kind: 'examples', id: slug, dir: ed, project: false, gdir: path.join(DATA, 'guides', 'examples', slug), seed: path.join(ed, 'guide') };
    return null;
  }
  /** guide.json for reading: the writable copy, else (examples) a seeded one in the repo. */
  function readGuide(src) {
    const g = readJSON(path.join(src.gdir, 'guide.json'));
    if (g) return { g, dir: src.gdir };
    if (src.seed) { const s = readJSON(path.join(src.seed, 'guide.json')); if (s) return { g: s, dir: src.seed }; }
    return { g: {}, dir: src.gdir };
  }
  function saveGuide(src, patch) {
    fs.mkdirSync(src.gdir, { recursive: true });
    const cur = readJSON(path.join(src.gdir, 'guide.json'), {}) || {};
    const next = { ...cur, ...patch };
    writeJSON(path.join(src.gdir, 'guide.json'), next);
    return next;
  }
  // N1: a project's guide is public only by the server's record (guide.json is in the agent-writable project folder)
  const shared = (src) => (src.project ? (publicFlag ? publicFlag('guide', src.id) : !!readJSON(path.join(src.gdir, 'guide.json'), {})?.share) : true);
  const canSee = (acc, src) => !src.project || canEdit(acc, src.id) || shared(src);
  const mayEdit = (acc, src) => (src.project ? canEdit(acc, src.id) : isAdmin(acc));

  /** Design version: the model, parts list, wiring and the planner version. Steps are rewritten when this changes. */
  function designSig(src) {
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const bom = readText(path.join(src.dir, 'bom.json')) || '';
    const wiring = (readText(path.join(src.dir, 'wiring.json')) || '') + (readText(path.join(src.dir, 'wiring.md')) || '');
    return crypto.createHash('sha1').update(String(man.t || '') + JSON.stringify(man.parts || []) + bom + wiring + 'plan' + buildplan.PLAN_V).digest('hex').slice(0, 16);
  }

  /** The validated build plan (cached per design version). Steps: {kind: place|wire|test, title, text, parts, files,
   *  hl, hl_files, wires, note}. */
  const planCache = new Map();
  function planFor(src, sig = designSig(src)) {
    const hit = planCache.get(src.dir);
    if (hit && hit.sig === sig) return hit.plan;
    let plan;
    try {
      const r = buildplan.buildPlan(src.dir, summary(src).man);
      plan = { v: r.v, errors: r.errors, wiring: r.wiring, model: r.model, steps: r.steps.map((s) => ({ kind: s.kind, title: s.title, text: s.text, note: s.note || '',
        parts: s.parts, files: s.ids, hl: s.hl, hl_files: s.hlIds, wires: s.wires || [], ...(s.missing ? { missing: true } : {}), ...(s.closes ? { closes: true } : {}) })) };
      if (r.errors.length) console.error(`[guide ${src.id}] build plan: ${r.errors.slice(0, 3).join('; ')}`);
    } catch (e) { console.error(`[guide ${src.id}] build plan failed: ${e.message}`); plan = { v: 0, errors: [e.message], steps: [], wiring: null }; }
    planCache.set(src.dir, { sig, plan });
    if (planCache.size > 300) planCache.delete(planCache.keys().next().value);
    return plan;
  }

  function summary(src) {
    const meta = readJSON(path.join(src.dir, 'meta.json'), {}) || {};
    const man = readJSON(path.join(src.dir, 'manifest.json'), {}) || {};
    const bom = readJSON(path.join(src.dir, 'bom.json'), {}) || {};
    return { meta, man, bom };
  }

  function bbox(man) {
    // overall size from part bboxes is unreliable (positions unknown); report the largest part dims instead
    const parts = man.parts || [];
    return parts.reduce((m, p) => (p.bbox || []).map((v, i) => Math.max(m[i] || 0, Number(v) || 0)), [0, 0, 0]).map(r1);
  }

  function guidePrompt(src, plan) {
    const { meta, man, bom } = summary(src);
    const buy = (bom.parts || []).filter((p) => !p.fabricated).map((p) => `- ${p.qty_per_unit} x ${p.name}${p.notes ? ` (${p.notes})` : ''}`).join('\n') || '- none';
    const fab = (bom.fabricated || []).map((f) => `- ${f.name}: ${fabSpec(f).spec}`).join('\n') || '- none';
    const printed = (man.parts || []).filter((p) => p.group !== 'component').map((p) => `- ${p.name} ${(p.bbox || []).map(r1).join(' x ')} mm`).join('\n') || '- none';
    const notes = (readText(path.join(src.dir, 'wiring.md')) || '').slice(0, 2500);
    const steps = plan.steps.map((s, i) => `${i + 1}. [${s.kind}] ${s.title}\n   draft: ${s.text}${s.parts.length ? `\n   adds: ${s.parts.join('; ')}` : ''}`).join('\n');
    return `Write the final wording of the assembly instructions for a maker building this product at home from 3D printed parts and bought hardware.

Product: ${meta.title || src.id}
Description: ${meta.description || ''}
Largest part dimensions: ${bbox(man).join(' x ')} mm. Assembly time estimate: ${bom.assembly_minutes || '?'} min.${bom.needs_soldering ? ' Soldering is needed.' : ''}

Printed parts:
${printed}

Hardware to buy:
${buy}

Fabricated parts (cut or bent stock):
${fab}
${notes ? `\nWiring notes from the designer:\n${notes}\n` : ''}
The build order below is FIXED: it was checked against the 3D model so nothing is fitted through a closed lid and every wire is connected after both of its parts are in and before the case is closed. Keep exactly these ${plan.steps.length} steps, in this order, one output step per input step. Do not merge, split, add, drop or reorder steps, and do not move a part to another step.

${steps}

Rules:
- For each step: a short sentence-case title (no numbering, no trailing period) and 1 to 4 plain sentences. Keep every exact screw, nut and insert count from the draft. Mention orientation where it is easy to get wrong.
- [wire] steps: keep every connection exactly as drafted (pin to pin, wire colour, connector or solder). You may write them as a compact list in the sentence ("VCC to 3V3 (red), GND to GND (black)").
- [test] step: how to power it and what to check. Keep the draft's checks (they come from this design's own parts and what they do) and add what the description says the product does; never generic checks for parts it does not have.
- "warning": only when there is a real risk (polarity, battery shorts, a hot soldering iron, pinch point, over-tightening into plastic). Otherwise omit it.
- "print": for each printed part, the best orientation and whether it needs supports, in a few words. Settings are PETG, 0.2 mm layers, 4 walls, 40% gyroid infill; only put a "note" when a part needs something different or special (e.g. pause to insert a nut).
- Plain language, no marketing, no emoji. Do not invent parts that are not listed.

Reply with ONLY this JSON, no prose, no code fence:
{"steps":[{"n":1,"title":"...","text":"...","warning":"..."}],"print":[{"name":"<printed part name>","orientation":"...","supports":"None","note":"..."}]}`;
  }

  function parseJSON(text) {
    const s = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch {}
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
    return null;
  }

  /** Map Claude's part names onto manifest parts (exact, normalised, then substring). */
  function matchParts(names, manParts) {
    const out = [];
    for (const n of Array.isArray(names) ? names : []) {
      const k = norm(n);
      if (!k) continue;
      const hit = manParts.find((p) => p.name === n) || manParts.find((p) => norm(p.name) === k)
        || manParts.find((p) => norm(p.name).includes(k) || k.includes(norm(p.name)));
      if (hit && !out.includes(hit)) out.push(hit);
    }
    return out;
  }

  async function generate(src) {
    const key = src.gdir;
    const job = { startedAt: Date.now(), stage: 'writing' };
    jobs.set(key, job);
    const sig = designSig(src);
    try {
      const cw = path.join(DATA, '.copywriter');
      fs.mkdirSync(cw, { recursive: true });
      const env = agentEnv(cw); // built from scratch: no ANTHROPIC_API_KEY, the CLI uses the subscription login
      delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
      const plan = planFor(src, sig);
      if (!plan.steps.length) throw new Error('Could not work out a build order for this design.');
      const args = ['-p', guidePrompt(src, plan), '--output-format', 'json', '--model', ctx.MODEL, '--effort', 'low',
        '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
        '--system-prompt', 'You write clear, accurate assembly instructions for maker build guides. You output only valid JSON.'];
      const t0 = Date.now();
      const r = await runProc(CLAUDE, args, { cwd: cw, env }, GUIDE_TIMEOUT);
      if (r.timedOut) throw new Error('Writing the steps timed out. Try again.');
      let j; try { j = JSON.parse(r.stdout); } catch {}
      if (!j) throw new Error('Claude Code failed: ' + ((r.stderr || '').trim().split('\n').pop() || `exit ${r.code}`));
      if (j.is_error) throw new Error(String(j.result || 'Claude Code returned an error').slice(0, 300));
      const parsed = parseJSON(j.result);
      if (!parsed || !Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('The steps came back in an unexpected format. Try again.');
      // the plan decides the order, the parts and the wires; Claude only words each step (by its number, else position)
      const byN = new Map(parsed.steps.filter((x) => x && Number.isInteger(x.n)).map((x) => [x.n, x]));
      const steps = plan.steps.map((p, i) => {
        const w = byN.get(i + 1) || (byN.size ? null : parsed.steps[i]) || {};
        const warning = cleanStr(w.warning, 300);
        return { ...p, title: cleanStr(w.title, 90) || p.title, text: cleanStr(w.text, 900) || p.text, ...(warning ? { warning } : {}), planned: buildplan.PLAN_V };
      });
      const errs = buildplan.validate(steps.map((x) => ({ ...x, ids: x.files, hlIds: x.hl_files })), plan.model);
      if (errs.length) console.error(`[guide ${src.id}] steps fail validation: ${errs.slice(0, 3).join('; ')}`);
      const print = (Array.isArray(parsed.print) ? parsed.print : []).slice(0, 60).map((p) => ({
        name: cleanStr(p.name, 120), orientation: cleanStr(p.orientation, 160), supports: cleanStr(p.supports, 80), note: cleanStr(p.note, 200) })).filter((p) => p.name);
      const claude_s = +((Date.now() - t0) / 1000).toFixed(1);

      job.stage = 'rendering';
      const images = await renderSteps(src, steps);
      steps.forEach((s, i) => { s.img = images[i] || null; });
      const g = saveGuide(src, { sig, t: Date.now() / 1000, steps, print, model: ctx.MODEL, timing: { claude_s, total_s: +((Date.now() - t0) / 1000).toFixed(1) }, error: null });
      console.log(`[guide ${src.id}] ${steps.length} steps, ${images.filter(Boolean).length} renders, claude ${claude_s}s`);
      warmShare(src);
      return g;
    } catch (e) {
      console.error(`[guide ${src.id}] ${e.message}`);
      saveGuide(src, { error: e.message, error_t: Date.now() / 1000 });
      throw e;
    } finally {
      jobs.delete(key);
    }
  }

  /** One VTK process for all steps; any failure means no images (the guide still works). */
  async function renderSteps(src, steps) {
    try {
      const imgDir = path.join(src.gdir, 'img');
      fs.mkdirSync(imgDir, { recursive: true });
      for (const f of fs.readdirSync(imgDir)) if (/^step-\d+\.png$/.test(f)) fs.rmSync(path.join(imgDir, f), { force: true });
      const shown = [];
      const plan = steps.map((s) => { shown.push(...(s.files || [])); return { show: [...shown], new: s.files?.length ? s.files : (s.hl_files || []) }; }); // wire steps: their two parts
      const sf = path.join(src.gdir, 'steps-render.json');
      writeJSON(sf, { steps: plan });
      // sandboxed (security C2): reads the design, writes only the guide dir
      const [cmd, args, opts] = renderSpawn('cadlib.render_steps', [src.dir, sf, imgDir], { dir: src.gdir, extraReads: [src.dir] });
      const r = await runProc(cmd, args, opts, RENDER_TIMEOUT);
      fs.rmSync(sf, { force: true });
      let out; try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
      if (!out) { console.error(`[guide ${src.id}] renders skipped: ${(r.stderr || '').trim().split('\n').pop() || (r.timedOut ? 'timed out' : `exit ${r.code}`)}`); return []; }
      if (out.errors?.length) console.error(`[guide ${src.id}] render: ${out.errors.slice(0, 3).join('; ')}`);
      return out.images || [];
    } catch (e) { console.error(`[guide ${src.id}] renders skipped: ${e.message}`); return []; }
  }

  // ---------------------------------------------------------------- share card (og:image)
  /** What the card says. Same for every viewer, so it never depends on who asks. */
  function shareInfo(src) {
    const { meta, man, bom } = summary(src);
    const printed = (bom.printed || []).length, hours = (bom.printed || []).reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
    let price = null; try { price = quote(bom, 'assembled').tiers[0].total; } catch {}
    return { title: meta.title || man.title || src.id, parts: printed || (man.parts || []).length, hours: r1(hours), price,
      site: SITE.replace(/^https?:\/\//, '') };
  }
  /** Cache key: manifest + bom mtimes (the design) and the card text. Also the ?v= on og:image so unfurls refresh. */
  function shareKey(src, info = shareInfo(src)) {
    const mt = (f) => { try { return fs.statSync(path.join(src.dir, f)).mtimeMs; } catch { return 0; } };
    return crypto.createHash('sha1').update(JSON.stringify([mt('manifest.json'), mt('bom.json'), info, 1])).digest('hex').slice(0, 12);
  }
  /** Path to an up-to-date share.png, rendering it first when needed (one render per guide at a time). */
  function ensureShare(src) {
    const info = shareInfo(src), key = shareKey(src, info);
    const file = path.join(src.gdir, 'share.png'), stamp = path.join(src.gdir, 'share.json');
    if (exists(file) && readJSON(stamp, {})?.key === key) return Promise.resolve(file);
    const running = shareJobs.get(src.gdir);
    if (running && running.key === key) return running.p;
    fs.mkdirSync(src.gdir, { recursive: true });
    const [cmd, args, opts] = renderSpawn('cadlib.render_share', [src.dir, file, JSON.stringify(info)], { dir: src.gdir, extraReads: [src.dir] });
    const p = runProc(cmd, args, opts, SHARE_TIMEOUT)
      .then((r) => {
        if (r.code !== 0 || !exists(file)) throw new Error((r.stderr || '').trim().split('\n').pop() || (r.timedOut ? 'timed out' : `exit ${r.code}`));
        writeJSON(stamp, { key, t: Date.now() / 1000 });
        return file;
      })
      .finally(() => { if (shareJobs.get(src.gdir)?.p === p) shareJobs.delete(src.gdir); });
    shareJobs.set(src.gdir, { key, p });
    return p;
  }
  /** Warm the card in the background (after sharing or writing the steps) so the first unfurl is fast. */
  const warmShare = (src) => { if (summary(src).man.parts?.length) ensureShare(src).catch((e) => console.error(`[guide ${src.id}] share card: ${e.message}`)); };
  const shareImageUrl = (src) => `${SITE}/build/${encodeURIComponent(src.id)}/share.png?v=${shareKey(src)}`;

  function ctaFor(bom, dir) {
    const qa = quote(bom, 'assembled', dir), a = qa.tiers[0], k = quote(bom, 'kit', dir).tiers[0];
    return {
      assembled: { total: a.total, unit_price: a.unit_price, lead_time_days: a.lead_time_days },
      kit: bom.kit_ok === false ? null : { total: k.total, unit_price: k.unit_price, lead_time_days: k.lead_time_days },
      // prices: SELL_ASSEMBLED off = kits only ("assembled" then holds kit pricing); orderable false = needs assembly
      sell_assembled: qa.sell_assembled !== false, orderable: qa.orderable !== false,
    };
  }

  /** "Remix this design": examples open read-only in the studio (/examples/<slug>, signed in or out) with
   *  their Remix button; projects via a live share link that allows remixing, else the example they came from. */
  function remixLink(src, meta) {
    if (!src.project) return { href: `/examples/${encodeURIComponent(src.id)}`, label: 'Remix this design' };
    const sh = meta.share;
    if (sh?.on && sh.remix !== false && /^[A-Za-z0-9]{10,24}$/.test(sh.id || '')) return { href: `/d/${sh.id}`, label: 'Remix this design' };
    if (ID_RE.test(meta.remix_of || '') && exists(path.join(exDirOf(meta.remix_of), 'meta.json'))) return { href: `/examples/${encodeURIComponent(meta.remix_of)}`, label: 'Remix the original' };
    return null;
  }

  /** What "What changes would you like to make?" copies (POST /api/projects body), or null when it can't be remixed. */
  function remixSrc(src, meta) {
    if (!src.project) return { fromExample: src.id };
    const sh = meta.share;
    if (sh?.on && sh.remix !== false && /^[A-Za-z0-9]{10,24}$/.test(sh.id || '')) return { fromShare: sh.id };
    if (ID_RE.test(meta.remix_of || '') && exists(path.join(exDirOf(meta.remix_of), 'meta.json'))) return { fromExample: meta.remix_of, original: true };
    return null;
  }

  function payload(acc, src) {
    const { meta, man, bom } = summary(src);
    const { g, dir: gd } = readGuide(src);
    const sig = designSig(src);
    const base = `/build/${encodeURIComponent(src.id)}/`;
    const hints = new Map((g.print || []).map((p) => [norm(p.name), p]));
    const printed = (bom.printed || []).map((p) => printSettings(p, hints.get(norm(p.name)) || {}));
    const fabricated = (bom.fabricated || []).map(fabSpec);
    const bought = (bom.parts || []).filter((p) => !p.fabricated).map((p) => ({
      name: p.name, qty: Number(p.qty_per_unit) || 0, unit_cost: Number(p.unit_cost_usd) || 0, supplier: p.supplier || '', url: /^https?:\/\//.test(p.url || '') ? p.url : '',
      notes: p.notes || '', total: Math.round((Number(p.qty_per_unit) || 0) * (Number(p.unit_cost_usd) || 0) * 100) / 100 }));
    const hasFw = exists(path.join(src.dir, 'firmware'));
    const fwFiles = hasFw ? listTree(path.join(src.dir, 'firmware')) : [];
    const wiring = readText(path.join(src.dir, 'wiring.md'));
    const downloads = [];
    if (printed.length) downloads.push({ label: 'Printable parts', sub: `${printed.length} STL file${printed.length === 1 ? '' : 's'}, zipped`, href: base + 'printed-parts.zip', kind: 'zip' });
    if (fabricated.length) downloads.push({ label: 'Cut list', sub: `${fabricated.length} fabricated part${fabricated.length === 1 ? '' : 's'}, CSV`, href: base + 'cut-list.csv', kind: 'csv' });
    if (bought.length) downloads.push({ label: 'Shopping list', sub: `${bought.length} item${bought.length === 1 ? '' : 's'}, CSV`, href: base + 'parts-to-buy.csv', kind: 'csv' });
    if (fwFiles.length) downloads.push({ label: 'Firmware', sub: `${fwFiles.length} file${fwFiles.length === 1 ? '' : 's'}, zipped`, href: base + 'firmware.zip', kind: 'zip' });
    if (wiring) downloads.push({ label: 'Wiring table', sub: 'wiring.md', href: base + 'wiring.md', kind: 'md' });
    if (downloads.length > 1) {
      const what = ['STLs', fabricated.length && 'cut list', bought.length && 'shopping list', 'print settings', fwFiles.length && 'firmware', wiring && 'wiring'].filter(Boolean);
      downloads.unshift({ label: 'Everything', sub: what.slice(0, -1).join(', ') + ' and ' + what[what.length - 1], href: base + 'everything.zip', kind: 'zip', main: true });
    }
    const job = jobs.get(src.gdir);
    const stepOut = (s, i, img) => ({ n: i + 1, kind: s.kind || 'place', title: s.title, text: s.text, parts: s.parts || [], files: s.files || [], warning: s.warning || null,
      hl: s.hl || [], hl_files: s.hl_files || [], wires: s.wires || [], note: s.note || '', ...(s.missing ? { missing: true } : {}), img });
    const steps = (g.steps || []).map((s, i) => stepOut(s, i, s.img ? `${base}step-${i + 1}.png?v=${encodeURIComponent(String(g.t || ''))}` : null));
    const plan = (man.parts || []).length ? planFor(src, sig) : null; // the 3D step sheet's order before (or without) a written guide
    const planned = steps.length && (g.steps || []).every((s) => s.planned === buildplan.PLAN_V);
    const edit = mayEdit(acc, src);
    return {
      slug: src.id, kind: src.kind, id: src.id, project: src.project,
      title: meta.title || man.title || src.id, description: meta.description || '', creator: publicCreator(meta.creator),
      thumb: exists(path.join(src.dir, 'thumb.png')) ? base + 'thumb.png' : null,
      has_model: !!(man.parts || []).length,
      can_edit: edit,
      can_generate: !!acc.authed && (edit || (!src.project && (!g.steps?.length || g.sig !== sig))),
      share: src.project ? shared(src) : true,
      share_url: `/build/${encodeURIComponent(src.id)}`,
      share_image: (man.parts || []).length ? `/build/${encodeURIComponent(src.id)}/share.png?v=${shareKey(src)}` : null,
      studio_href: `/${src.project ? 'designs' : 'examples'}/${encodeURIComponent(src.id)}`, // urls: clean studio URLs
      canonical: `${SITE}/build/${encodeURIComponent(src.id)}`, design_url: designUrl(src.id), remix: remixLink(src, meta),
      remix_src: remixSrc(src, meta), is_owner: !!(src.project && acc.user && ownerOf && ownerOf(src.id) === acc.user),
      authed: !!acc.authed,
      orderable: !src.project || canEdit(acc, src.id) || isPublished(src.dir) || shared(src), // a public guide offers "buy it made"
      quote_base: `/build/${encodeURIComponent(src.id)}/quote.json`,
      state: job ? 'running' : !steps.length ? 'none' : g.sig !== sig || !planned ? 'stale' : 'ready', // steps from before the build plan: rewrite
      plan: plan ? { v: plan.v, steps: plan.steps.map((s, i) => stepOut(s, i, null)), wiring: plan.wiring, errors: plan.errors } : null,
      stage: job?.stage || null, started_at: job ? job.startedAt : null,
      generated_at: g.t || null, error: job ? null : g.error || null, seeded: gd !== src.gdir,
      steps, printed, fabricated, bought,
      bought_total: Math.round(bought.reduce((s, p) => s + p.total, 0) * 100) / 100,
      fab_total: Math.round(fabricated.reduce((s, p) => s + p.material_usd, 0) * 100) / 100,
      totals: { grams: r1(printed.reduce((s, p) => s + p.grams, 0)), hours: r1(printed.reduce((s, p) => s + p.hours, 0)), assembly_minutes: Number(bom.assembly_minutes) || 0 },
      firmware: fwFiles, wiring: wiring ? wiring.slice(0, 20000) : null,
      downloads, cta: process.env.STRIPE_SECRET_KEY ? ctaFor(bom, src.dir) : null, // open-source app: "buy it made" only with checkout set up
      ...(cardStats ? cardStats(src.dir) : {}), // card-stats: price_each, design_minutes, print_hours
    };
  }

  // ---------------------------------------------------------------- downloads
  const fileBuf = (dir, rel) => {
    const root = fs.realpathSync(dir);
    let real; try { real = fs.realpathSync(path.join(dir, rel)); } catch { return null; }
    if (!real.startsWith(root + path.sep)) return null;
    try { const st = fs.statSync(real); return st.isFile() && st.size < 200e6 ? { data: fs.readFileSync(real), mtime: st.mtime } : null; } catch { return null; }
  };
  function zipEntries(src, what) {
    const { meta, bom } = summary(src);
    const out = [];
    const add = (name, rel) => { const b = fileBuf(src.dir, rel); if (b) out.push({ name, ...b }); };
    const P = (meta.title ? meta.title.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() : src.id).slice(0, 48) || src.id;
    if (what === 'printed' || what === 'all') for (const p of bom.printed || []) add(`${P}/printed/${path.basename(p.file)}`, p.file);
    if (what === 'firmware' || what === 'all') for (const rel of listTree(path.join(src.dir, 'firmware'))) add(`${P}/firmware/${rel}`, `firmware/${rel}`);
    if (what === 'all') {
      for (const f of bom.fabricated || []) add(`${P}/fabricated/${path.basename(f.file)}`, f.file);
      add(`${P}/wiring.md`, 'wiring.md');
      if ((bom.fabricated || []).length) out.push({ name: `${P}/cut-list.csv`, data: Buffer.from(cutListCsv(bom)) });
      if ((bom.parts || []).length) out.push({ name: `${P}/parts-to-buy.csv`, data: Buffer.from(buyCsv(bom)) });
      out.push({ name: `${P}/print-settings.txt`, data: Buffer.from(printTxt(src, bom)) });
    }
    return { P, files: out };
  }
  const cutListCsv = (bom) => csv([['Part', 'Process', 'Spec', 'Material', 'Thickness mm', 'Profile', 'Length mm', 'Bends', 'Cut length mm', 'Area cm2', 'Bounding box mm', 'Approx stock $', 'File'],
    ...(bom.fabricated || []).map((f) => { const s = fabSpec(f); return [f.name, f.process, s.spec, s.params.material || '', s.params.thickness_mm || '', s.params.profile || '',
      s.est.length_mm || s.params.length_mm || '', s.est.bends ?? s.params.bends ?? '', s.est.cut_length_mm || '', s.est.area_cm2 || '', s.bbox.join(' x '), s.material_usd || '', f.file]; })]);
  const buyCsv = (bom) => csv([['Part', 'Qty', 'Unit cost $', 'Line total $', 'Supplier', 'Link', 'Notes'],
    ...(bom.parts || []).filter((p) => !p.fabricated).map((p) => [p.name, p.qty_per_unit, p.unit_cost_usd, Math.round((p.qty_per_unit || 0) * (p.unit_cost_usd || 0) * 100) / 100, p.supplier || '', p.url || '', p.notes || ''])]);
  function printTxt(src, bom) {
    const { g } = readGuide(src);
    const hints = new Map((g.print || []).map((p) => [norm(p.name), p]));
    return ['Print settings (0.4 mm nozzle)', ''].concat((bom.printed || []).map((p) => {
      const s = printSettings(p, hints.get(norm(p.name)) || {});
      return `${s.name} (${path.basename(s.file)})\n  ${s.material}, ${s.layer_height} layers, ${s.walls}, ${s.infill} infill\n  Orientation: ${s.orientation}\n  Supports: ${s.supports}\n  About ${s.grams} g, ${s.hours} h${s.note ? `\n  ${s.note}` : ''}\n`;
    })).join('\n');
  }
  function sendDownload(res, name, type, buf) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  }

  // ---------------------------------------------------------------- page shell
  const abs = (u) => (u ? (/^https?:/.test(u) ? u : SITE + u) : null);
  const ldJson = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
  const isoMin = (min) => { const m = Math.max(1, Math.round(min)); return `PT${m >= 60 ? `${Math.floor(m / 60)}H` : ''}${m % 60 ? `${m % 60}M` : ''}`; };
  /** "How to build the phone stand": same wording as the page's h1 (web/guide.js). */
  const howTo = (t) => `How to build the ${String(t).replace(/^(a|an|the)\s+/i, '').replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`;
  const hrs = (h) => (h >= 10 ? Math.round(h) : r1(h)) + ' h';
  const usd0 = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  /** Shared <head> tags: title, description, canonical, Open Graph, Twitter. */
  function metaTags({ title, desc, url, image, type = 'website', card = false }) {
    return `<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}">
<link rel="canonical" href="${escHtml(url)}">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="Premake"><meta property="og:url" content="${escHtml(url)}">
<meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}">
${image ? `<meta property="og:image" content="${escHtml(image)}"><meta property="og:image:alt" content="${escHtml(title)}">` : ''}${card ? '<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">${image ? `<meta name="twitter:image" content="${escHtml(image)}">` : ''}
<meta name="theme-color" content="#fafaf9"><meta name="color-scheme" content="light">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Premake">`;
  }

  function pageHtml(src, p) {
    const t = p.totals;
    const bits = [p.printed.length && `${p.printed.length} printed part${p.printed.length === 1 ? '' : 's'}`, t.hours && `${hrs(t.hours)} of printing`,
      p.bought.length && `${p.bought.length} part${p.bought.length === 1 ? '' : 's'} to buy`].filter(Boolean);
    const desc = `Build ${howTo(p.title).slice(13)} yourself: free STL downloads, print settings, a parts list and ${p.steps.length ? `${p.steps.length} illustrated steps` : 'step-by-step instructions'}.${bits.length ? ' ' + bits.join(', ') + '.' : ''}`.slice(0, 300);
    const image = p.has_model ? shareImageUrl(src) : abs(p.thumb);
    const diy = p.bought_total + p.fab_total + t.grams * 0.025;
    const howto = {
      '@context': 'https://schema.org', '@type': 'HowTo', name: howTo(p.title), description: p.description || desc, url: p.canonical,
      ...(image ? { image } : {}),
      ...(t.assembly_minutes || t.hours ? { totalTime: isoMin((t.assembly_minutes || 0) + (t.hours || 0) * 60) } : {}),
      ...(diy > 0 ? { estimatedCost: { '@type': 'MonetaryAmount', currency: 'USD', value: Math.round(diy * 100) / 100 } } : {}),
      supply: [...(p.printed.length ? [{ '@type': 'HowToSupply', name: `${Math.round(t.grams)} g PETG filament` }] : []),
        ...p.bought.slice(0, 40).map((b) => ({ '@type': 'HowToSupply', name: b.name, requiredQuantity: b.qty }))],
      tool: [...(p.printed.length ? [{ '@type': 'HowToTool', name: '3D printer (0.4 mm nozzle)' }] : [])],
      step: p.steps.map((s) => ({ '@type': 'HowToStep', position: s.n, name: s.title, text: s.text, url: `${p.canonical}#step-${s.n}`, ...(s.img ? { image: abs(s.img) } : {}) })),
      ...(p.creator ? { author: { '@type': 'Person', name: p.creator } } : {}),
      publisher: { '@type': 'Organization', name: 'Premake', url: SITE },
    };
    // Server-rendered shell: the studio-like layout with the guide in the Instructions panel, so crawlers and no-JS
    // readers get the whole text. web/buildpage.js takes over the same root on load (viewer, tabs, order, chat).
    const sub = [p.printed.length && `${p.printed.length} printed part${p.printed.length === 1 ? '' : 's'}`, t.hours && `${hrs(t.hours)} of printing`,
      t.assembly_minutes && `about ${t.assembly_minutes} min to assemble`].filter(Boolean).join(' · ');
    const main = p.downloads[0];
    const ssr = `<header class="topbar bp-top"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Premake</a>
  <div class="crumb"><b>${escHtml(p.title)}</b></div><div class="top-right"><span class="bp-made">Made with Premake</span></div></header>
<div class="bp">
  <main class="center bp-center"><div class="model-pane">${p.thumb ? `<img class="bp-ssr-thumb" src="${escHtml(p.thumb)}" alt="${escHtml(p.title)}">` : ''}</div></main>
  <aside class="right bp-right"><div class="tabbar"><span class="tab on">Instructions</span><span class="tab">Order</span></div>
    <div class="bp-scroll"><article class="bp-ins">
      <h1>${escHtml(howTo(p.title))}</h1>${p.description ? `<p class="bp-lede">${escHtml(p.description)}</p>` : ''}${sub ? `<p class="bp-sub">${escHtml(sub)}</p>` : ''}
      ${main ? `<a class="btn primary block bp-dl" href="${escHtml(main.href)}" download>Download ${main.main ? 'all files' : escHtml(main.label.toLowerCase())}</a>` : ''}
      ${p.downloads.length > 1 ? `<details class="bp-files"><summary>Individual files</summary><ul>${p.downloads.slice(main?.main ? 1 : 0).map((d) => `<li><a href="${escHtml(d.href)}" download>${escHtml(d.label)}</a> <span>${escHtml(d.sub)}</span></li>`).join('')}</ul></details>` : ''}
      ${p.steps.length ? `<h2>Assembly</h2><ol class="bp-ssr-steps">${p.steps.map((s) => `<li id="step-${s.n}"><h3>${escHtml(s.title)}</h3>${s.img ? `<img src="${escHtml(s.img)}" alt="Step ${s.n}: ${escHtml(s.title)}" loading="lazy" width="400" height="300">` : ''}<p>${escHtml(s.text)}</p>${s.warning ? `<p><b>Warning:</b> ${escHtml(s.warning)}</p>` : ''}</li>`).join('')}</ol>` : ''}
      ${p.bought.length ? `<h2>Parts to buy</h2><ul>${p.bought.map((b) => `<li>${b.qty} × ${escHtml(b.name)}</li>`).join('')}</ul>` : ''}
      <p class="bp-sub"><a href="/guides">More build guides</a></p>
    </article></div></aside>
</div>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${metaTags({ title: `${howTo(p.title)} · Premake`, desc, url: p.canonical, image, type: 'article', card: p.has_model })}
${ldJson(howto)}
${FONTS}
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/checkout.css"><link rel="stylesheet" href="/guide.css"><link rel="stylesheet" href="/glass.css">
<script type="importmap">{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/",
  "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/",
  "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.7.8/src/index.js",
  "three-gpu-pathtracer": "https://cdn.jsdelivr.net/npm/three-gpu-pathtracer@0.0.23/src/index.js"
} }</script></head>
<body class="bp-page" data-build-slug="${escHtml(src.id)}"><div id="buildRoot" class="bp-root">${ssr}</div>
<div class="modal-wrap" id="modal" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" id="modalBox"></div></div>
<div class="toast" id="toast"></div>
<script type="module" src="/buildpage.js"></script></body></html>`;
  }

  // ---------------------------------------------------------------- public index (/guides), sitemap, robots
  let listCache = { t: 0, v: null };
  /** Every public guide: shared projects first, then examples; only designs with an exported model. Cached 30 s. */
  function publicList() {
    if (listCache.v && Date.now() - listCache.t < 30e3) return listCache.v;
    const out = [];
    const add = (src) => {
      const { meta, man, bom } = summary(src);
      if (!(man.parts || []).length) return;
      const { g } = readGuide(src);
      const hours = (bom.printed || []).reduce((s, p) => s + (Number(p.print_hours) || 0), 0);
      let price = null; try { price = quote(bom, 'assembled').tiers[0].total; } catch {}
      let mt = 0; try { mt = fs.statSync(path.join(src.dir, 'manifest.json')).mtimeMs; } catch {}
      out.push({ slug: src.id, project: src.project, title: meta.title || man.title || src.id, description: meta.description || '', creator: publicCreator(meta.creator),
        thumb: exists(path.join(src.dir, 'thumb.png')) ? `/build/${encodeURIComponent(src.id)}/thumb.png` : null,
        hours: hours > 0 ? hours : null, price, steps: (g.steps || []).length,
        updated: new Date(Math.max(mt, (Number(g.t) || 0) * 1000) || Date.now()).toISOString() });
    };
    for (const id of safeDir(PROJECTS)) { const src = resolve(id); if (src?.project && shared(src)) add(src); }
    for (const id of exampleIds()) { const src = resolve(id); if (src && !src.project) add(src); }
    out.sort((a, b) => (b.steps > 0) - (a.steps > 0) || (b.project - a.project) || a.title.localeCompare(b.title));
    listCache = { t: Date.now(), v: out };
    return out;
  }
  function safeDir(d) { try { return fs.readdirSync(d).filter((n) => ID_RE.test(n)).sort(); } catch { return []; } }

  function indexHtml() {
    const list = publicList();
    const url = `${SITE}/guides`;
    const title = 'Free 3D printable build guides · Premake';
    const desc = `Step-by-step build guides for ${list.length} 3D printable designs: STL downloads, print settings, parts lists and illustrated assembly steps. Build one yourself or get it made.`;
    const image = abs(list.find((x) => x.thumb)?.thumb);
    const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Build guides', description: desc, url,
      mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 100).map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/build/${encodeURIComponent(x.slug)}`, name: x.title })) } };
    const card = (x) => `<a class="gx-card" href="/build/${encodeURIComponent(x.slug)}">
  <span class="gx-img">${x.thumb ? `<img src="${escHtml(x.thumb)}" alt="${escHtml(x.title)}" loading="lazy" width="400" height="300">` : ''}</span>
  <span class="gx-body"><b>${escHtml(x.title)}</b>
    <span class="gx-meta">${[x.hours ? `${hrs(x.hours)} print` : null, x.price != null ? `${usd0(x.price)} assembled` : null, x.steps ? `${x.steps} steps` : null].filter(Boolean).map((s) => `<span>${escHtml(s)}</span>`).join('')}</span></span>
</a>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${metaTags({ title, desc, url, image })}
${ldJson(ld)}
${FONTS}
<link rel="stylesheet" href="/guide.css"><link rel="stylesheet" href="/glass.css">
<script type="module" src="/analytics.js"></script></head>
<body class="gd-standalone"><div class="gd-root gx-page">
<header class="gd-bar"><div class="gd-bar-in"><a class="gd-brand" href="/"><span class="gd-mark" aria-hidden="true"></span>Premake</a>
  <span class="gd-bar-cta"><a class="gd-btn primary sm" href="${escHtml(designUrl('guides'))}">Design your own</a></span></div></header>
<main class="gd-wrap">
  <section class="gx-hero"><h1>Build guides</h1>
    <p class="gd-lede">Free STL files, print settings, shopping lists and step-by-step pictures for ${list.length} designs made with Premake. Build one yourself, or have it printed and shipped.</p></section>
  ${list.length ? `<div class="gx-grid">${list.map(card).join('')}</div>` : '<p class="gd-note">No public guides yet.</p>'}
  <aside class="gd-make big"><div><h2>Design your own with Premake</h2><p>Describe a product in plain words. An AI agent models it in CAD, then you print it yourself or order it made.</p></div>
    <div class="gd-make-btns"><a class="gd-btn primary" href="${escHtml(designUrl('guides'))}">${MARK}Design your own</a></div></aside>
  <footer class="gd-foot">Made with <a href="${escHtml(designUrl('guides'))}">Premake</a>. Files are for personal use.</footer>
</main></div></body></html>`;
  }

  function sitemapXml() {
    const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const list = publicList();
    const urls = [{ loc: `${SITE}/`, pri: '1.0' }, { loc: `${SITE}/guides`, pri: '0.9', mod: list.reduce((m, g) => (g.updated > m ? g.updated : m), '') || null },
      ...list.map((g) => ({ loc: `${SITE}/build/${encodeURIComponent(g.slug)}`, pri: g.steps ? '0.8' : '0.6', mod: g.updated }))];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
      `  <url><loc>${x(u.loc)}</loc>${u.mod ? `<lastmod>${x(u.mod.slice(0, 10))}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`;
  }
  const robotsTxt = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /auth/\n\nSitemap: ${SITE}/sitemap.xml\n`;
  function sendText(res, type, body, maxAge = 300) {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  }
  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Premake</title><body style="font:16px/1.5 Inter,system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 16px;color:#1b1a17;background:#fff"><h1 style="font-size:24px">This build guide isn’t available</h1><p>The link may be wrong, or the owner hasn’t shared this guide.</p><p><a href="/" style="color:#e8590c">Go to Premake</a></p></body>');
  }

  // ---------------------------------------------------------------- routing
  async function handle(req, res, { parts, m, acc, readBody }) {
    if ((m === 'GET' || m === 'HEAD') && parts.length === 1) {
      if (parts[0] === 'guides') { sendText(res, 'text/html; charset=utf-8', indexHtml(), 60); return true; }
      if (parts[0] === 'sitemap.xml') { sendText(res, 'application/xml; charset=utf-8', sitemapXml(), 600); return true; }
      if (parts[0] === 'robots.txt') { sendText(res, 'text/plain; charset=utf-8', robotsTxt(), 3600); return true; }
    }
    if (parts[0] === 'build' && (m === 'GET' || m === 'HEAD')) {
      const src = resolve(parts[1]);
      const deep = parts.length === 4 && parts[2] === 'stl' && /^[\w.-]+\.stl$/.test(parts[3] || '');
      if (!src || !canSee(acc, src) || (parts.length > 3 && !deep)) { if (parts.length === 2) notFound(res); else send(res, 404, { error: 'not found' }); return true; }
      const f = parts[2];
      if (!f) { const p = payload(acc, src); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(pageHtml(src, p)); return true; }
      if (f === 'data.json') { send(res, 200, payload(acc, src)); return true; }
      // the model for the page's 3D viewer (same access as the page); motion.json drives its Move button
      if (f === 'manifest.json' || f === 'motion.json' || deep) {
        if (!allow('guide-file:' + (acc.user || clientIp(req)), 4000, 600e3)) { send(res, 429, { error: 'Too many requests' }); return true; }
        await serveFile(res, src.dir, deep ? `stl/${parts[3]}` : f, { noCache: true, sandbox: true }); return true;
      }
      if (f === 'quote.json') {
        const u = new URL(req.url, 'http://x');
        const op = orderPriceQuery && orderPriceQuery(u, summary(src).bom, src.dir); // order tab: at-cost price for a quantity
        if (op) { send(res, op.error ? 400 : 200, op); return true; }
        const mode = u.searchParams.get('mode') === 'kit' ? 'kit' : 'assembled';
        send(res, 200, quote(summary(src).bom, mode, src.dir)); return true;
      }
      if (f === 'share.png') {
        let file = null;
        try { file = await ensureShare(src); } catch (e) { console.error(`[guide ${src.id}] share card: ${e.message}`); }
        const b = file ? fileBuf(src.gdir, 'share.png') : exists(src.dir) ? fileBuf(src.dir, 'thumb.png') : null; // fall back to the thumbnail
        if (!b) { send(res, 404, { error: 'not found' }); return true; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': b.data.length, 'Cache-Control': file ? 'public, max-age=300' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(m === 'HEAD' ? undefined : b.data); return true;
      }
      const img = f === 'thumb.png' ? { dir: src.dir, rel: 'thumb.png' } : /^step-\d{1,2}\.png$/.test(f) ? { dir: readGuide(src).dir, rel: path.join('img', f) } : null;
      if (img) {
        const b = exists(img.dir) ? fileBuf(img.dir, img.rel) : null;
        if (!b) { send(res, 404, { error: 'not found' }); return true; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': b.data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(b.data); return true;
      }
      const { bom } = summary(src);
      if (!allow('guide-dl:' + (acc.user || clientIp(req)), 120, 3600e3)) { send(res, 429, { error: 'Too many downloads. Try again later.' }); return true; }
      if (/^(printed-parts|everything|firmware)\.zip$/.test(f)) {
        const what = f.startsWith('printed') ? 'printed' : f.startsWith('firmware') ? 'firmware' : 'all';
        const { P, files } = zipEntries(src, what);
        if (!files.length) { send(res, 404, { error: 'nothing to download' }); return true; }
        sendDownload(res, `${P}-${f}`, 'application/zip', makeZip(files)); return true;
      }
      if (f === 'cut-list.csv' && (bom.fabricated || []).length) { sendDownload(res, `${src.id}-cut-list.csv`, 'text/csv; charset=utf-8', Buffer.from(cutListCsv(bom))); return true; }
      if (f === 'parts-to-buy.csv' && (bom.parts || []).length) { sendDownload(res, `${src.id}-parts-to-buy.csv`, 'text/csv; charset=utf-8', Buffer.from(buyCsv(bom))); return true; }
      if (f === 'wiring.md') { const t = readText(path.join(src.dir, 'wiring.md')); if (t != null) { sendDownload(res, `${src.id}-wiring.md`, 'text/markdown; charset=utf-8', Buffer.from(t)); return true; } }
      send(res, 404, { error: 'not found' }); return true;
    }
    if (parts[0] === 'api' && parts[1] === 'guide' && m === 'POST' && !parts[3]) {
      if (!acc.authed) { send(res, 401, { error: 'Sign in first', code: 'signin' }); return true; }
      const body = await readBody(req, 1e4);
      const src = resolve(body.slug);
      if (!src || !canSee(acc, src)) { send(res, 404, { error: 'not found' }); return true; }
      if (parts[2] === 'share') {
        if (!src.project || !canEdit(acc, src.id)) { send(res, 404, { error: 'not found' }); return true; }
        saveGuide(src, { share: !!body.on });
        if (setPublicFlag) setPublicFlag('guide', src.id, !!body.on); // N1: the authority
        listCache.v = null; // /guides and the sitemap pick it up now
        if (body.on) warmShare(src);
        send(res, 200, { ok: true, share: !!body.on, share_url: `/build/${src.id}` }); return true;
      }
      if (parts[2] === 'generate') {
        const p = payload(acc, src);
        if (!p.can_generate || (body.force && !mayEdit(acc, src))) { send(res, 403, { error: src.project ? 'Only the owner can write these steps.' : 'These steps are already up to date.' }); return true; }
        if (!p.has_model) { send(res, 400, { error: 'This design has no exported model yet.' }); return true; }
        if (jobs.has(src.gdir)) { send(res, 202, { ok: true, state: 'running' }); return true; }
        agentGate(acc);
        generate(src).catch(() => {});
        send(res, 202, { ok: true, state: 'running' }); return true;
      }
      send(res, 404, { error: 'no such endpoint' }); return true;
    }
    return false;
  }

  /** Payments hook: a project whose build guide is public can be ordered by anyone who opens it. */
  const isShared = (id) => { const src = resolve(id); return !!(src?.project && shared(src)); };

  return { handle, makeZip, resolve, isShared };
}

module.exports = { init, makeZip, crc32 };
