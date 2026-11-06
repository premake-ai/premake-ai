// Public landing page for signed-out visitors at GET /. Rendered here on the gateway, so it loads fast and still shows
// when the Mac is offline. Read-only example data (list, hero quote, thumbnails) is fetched server-side from the Mac
// as an anonymous gateway request and kept in memory; browsers never call the Mac's API from this page.
// Public routes this adds: GET / (signed out), GET /landing/landing.css, GET /landing/thumb/<example-slug>.png.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const OG_V = require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(path.join(__dirname, '..', 'home', 'og.png'))).digest('hex').slice(0, 10);
const crypto = require('node:crypto');

const CSS = fs.readFileSync(path.join(__dirname, 'landing.css'));
const CSS_V = crypto.createHash('sha256').update(CSS).digest('hex').slice(0, 10);
const HERO_SLUG = 'drop-night-light';
// Examples kept off the public landing gallery (the grip trainer reads as weapon-like in a thumbnail)
const OFF_LANDING = new Set(['grip-trainer']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const REFRESH_MS = 5 * 60e3;
const THUMB_MAX = 3 * 1024 * 1024;

let cfg = { getTarget: () => null, secret: '', host: '', base: '', log: console.log };
const cache = { examples: null, quote: null, at: 0, thumbs: new Map(), recent: [] }; // thumbs: slug -> { v, buf, etag }
let refreshing = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// ---------------------------------------------------------------- data from the Mac (anonymous, read-only)
async function mac(p, as = 'json') {
  const t = cfg.getTarget();
  if (!t) throw new Error('offline');
  const r = await fetch(new URL(p, t.origin), {
    headers: { 'x-forma-gateway': cfg.secret, 'x-forwarded-host': cfg.host, 'x-forwarded-proto': 'https', accept: as === 'json' ? 'application/json' : 'image/png' },
    signal: AbortSignal.timeout(6000), redirect: 'error',
  });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  if (as === 'json') return r.json();
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > THUMB_MAX || buf.subarray(0, 4).toString('hex') !== '89504e47') throw new Error(`${p}: not a png`);
  return buf;
}
const versionOf = (thumb) => { try { return new URL(String(thumb), 'http://x').searchParams.get('v') || ''; } catch { return ''; } };

const statNum = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const statNums = (e) => ({ price_each: statNum(e.price_each), design_minutes: statNum(e.design_minutes), print_hours: statNum(e.print_hours) });
// social: like / comment counts on cards and the recently designed strip (server/social.js: real designs only)
const socialNums = (e) => ({ likes: statNum(e.likes), remixes: statNum(e.remixes), comments: statNum(e.comments) });
const cleanRecent = (d) => (Array.isArray(d?.recent) ? d.recent : []).filter((o) => o && SLUG_RE.test(String(o.slug)) && !Number.isNaN(Date.parse(o.at))).slice(0, 30)
  .map((o) => ({ slug: String(o.slug), title: String(o.title || o.slug).slice(0, 120), price_each: statNum(o.price_each), at: String(o.at) }));

async function refreshNow() {
  const list = await mac('/api/examples');
  if (!Array.isArray(list)) throw new Error('bad example list');
  const examples = list.filter((e) => e && SLUG_RE.test(String(e.slug)) && !OFF_LANDING.has(String(e.slug))).slice(0, 150).map((e) => ({
    slug: String(e.slug), title: String(e.title || e.slug).slice(0, 120), description: String(e.description || '').slice(0, 400),
    creator: String(e.creator || '').slice(0, 60), v: versionOf(e.thumb),
    ...statNums(e), // card-stats: price_each, design_minutes, print_hours (null when the Mac has none)
    ...socialNums(e), // social: likes, remixes, comments
  }));
  try { cache.recent = cleanRecent(await mac('/api/social/feed')); } catch (e) { cfg.log('[landing] feed', e.message); } // social: designs finished lately
  const hero = examples.find((e) => e.slug === HERO_SLUG) || examples[0];
  let quote = cache.quote;
  if (hero) {
    try {
      const q = (mode) => mac(`/api/quote?example=${encodeURIComponent(hero.slug)}&mode=${mode}`);
      const [a, k] = await Promise.all([q('assembled'), q('kit')]);
      quote = a && Array.isArray(a.tiers) ? { slug: hero.slug, a, k: k && Array.isArray(k.tiers) ? k : null } : null;
    } catch (e) { cfg.log('[landing] quote', e.message); }
  }
  cache.examples = examples; cache.quote = quote; cache.at = Date.now();
  // Thumbnails: keep a copy here so the gallery still shows when the Mac is offline.
  const live = new Set(examples.map((e) => e.slug));
  for (const k of cache.thumbs.keys()) if (!live.has(k)) cache.thumbs.delete(k);
  const todo = examples.filter((e) => { const h = cache.thumbs.get(e.slug); return !h || h.v !== e.v; });
  Promise.all(Array.from({ length: 6 }, async () => { for (let e; (e = todo.shift());) await fetchThumb(e); })); // in the background
}
async function fetchThumb(e) {
  try {
    const buf = await mac(`/files/examples/${encodeURIComponent(e.slug)}/thumb.png`, 'png');
    const t = { v: e.v, buf, etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"' };
    cache.thumbs.set(e.slug, t); return t;
  } catch (err) { cfg.log('[landing] thumb', e.slug, err.message); return null; }
}
function refresh() {
  if (refreshing || !cfg.getTarget()) return refreshing;
  refreshing = refreshNow().catch((e) => cfg.log('[landing] refresh failed:', e.message)).finally(() => { refreshing = null; });
  return refreshing;
}

// ---------------------------------------------------------------- page
const ARROW = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" fill="none"/></svg>';
const SIGNIN = '/auth/signin?next=%2F';
// App deep links (/#/projects/...) still go through sign-in, keeping the hash as `next`.
const HASH_JS = `(function(){function f(){var h=location.hash;if(h&&h.charAt(1)==='/'&&h.length>2)location.replace('/auth/signin?next='+encodeURIComponent('/'+h))}f();addEventListener('hashchange',f)})()`;
const HASH_SHA = crypto.createHash('sha256').update(HASH_JS).digest('base64');
// analytics: /analytics.js (self) loads posthog-js from jsDelivr, its lazy parts from us-assets, and sends to us.i.posthog.com
const CSP = `default-src 'none'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; `
  + `script-src 'self' 'sha256-${HASH_SHA}' https://cdn.jsdelivr.net https://us-assets.i.posthog.com; connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com; `
  + `worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const thumbUrl = (e) => `/landing/thumb/${encodeURIComponent(e.slug)}.png${e.v ? `?v=${encodeURIComponent(e.v)}` : ''}`;
const hasThumb = (e) => cache.thumbs.has(e.slug) || !!cfg.getTarget();

function render() {
  const ex = cache.examples || [];
  const withThumb = ex.filter(hasThumb);
  const hero = withThumb.find((e) => e.slug === HERO_SLUG) || withThumb[0] || null;
  const q = hero && cache.quote && cache.quote.slug === hero.slug ? cache.quote : null;
  const base = cfg.base;
  const title = 'Premake: say what you want, hold it next week';
  const desc = 'Describe a product in plain words. Premake designs it in CAD, lists the parts you can buy, and prices one unit or five hundred.';
  const ogImg = `${base}/home/og.png?v=${OG_V}`; // designed share card (cadlib/render_og_home.py)
  const tiers = q ? q.a.tiers.slice(0, 4) : [{ qty: 1 }, { qty: 10 }, { qty: 100 }, { qty: 500 }];
  const row = (t, k) => `<tr><td>${t.qty === 1 ? '1 unit' : Number(t.qty).toLocaleString('en-US') + ' units'}</td><td class="u">${money(t.unit_price)}</td>
    <td>${k ? money(k.unit_price) : '–'}</td><td>${money(t.shipping)}</td><td>${esc(t.lead_time_days)} d</td></tr>`;
  const card = (e, eager) => `<a class="card" href="/build/${encodeURIComponent(e.slug)}">
      <span class="img">${hasThumb(e) ? `<img src="${thumbUrl(e)}" alt="" width="640" height="480"${eager ? '' : ' loading="lazy"'} decoding="async">` : `<span class="ph">${esc(e.title)}</span>`}</span>
      <span class="t">${esc(e.title)}</span>${e.creator ? `<span class="by">by ${esc(e.creator)}</span>` : ''}</a>`;
  const strip = withThumb.slice(0, 10);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(base)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="Premake"><meta property="og:url" content="${esc(base)}/">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Premake: build something you can hold">` : ''}
<meta name="twitter:card" content="${ogImg ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : ''}
<meta name="theme-color" content="#f3f0e8">
<script>${HASH_JS}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/landing/landing.css?v=${CSS_V}">
<script type="module" src="/analytics.js"></script>
</head><body>
<header class="wrap nav">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>Premake</a>
  <nav><a href="#how">How it works</a><a href="#pricing">Pricing</a>${ex.length ? '<a href="#gallery">Gallery</a>' : ''}</nav>
  <a class="open" href="${SIGNIN}">Start building</a>
</header>

<main>
<section class="wrap hero">
  <div>
    <h1>Say what you want, hold it next week</h1>
    <p class="lede">Premake turns a plain description into a real product: printable CAD, a list of parts you can actually buy, and a price for one unit or five hundred.</p>
    <div class="ctas"><a class="cta" href="${SIGNIN}">Start building ${ARROW}</a>
      <a class="ghost" href="${ex.length ? '#gallery' : '#how'}">${ex.length ? 'Browse examples' : 'See how it works'}</a></div>
    <p class="fine">Sign in with Google to get started.</p>
  </div>
  <div class="plate">
    <div class="ask">“${hero && hero.slug !== HERO_SLUG ? esc(hero.title) : 'A night light that glows warm, with a button to change modes'}.”</div>
    <div class="img">${hero ? `<img src="${thumbUrl(hero)}" alt="${esc(hero.title)}" width="640" height="480" fetchpriority="high">` : ''}</div>
    <div class="cap"><b>${esc(hero ? hero.title : 'Drop night light')}</b><span>${q ? `${Math.round(q.a.print.grams)} g PETG · ${(+q.a.print.hours).toFixed(1)} h` : 'PETG · fits a 256 mm bed'}</span></div>
  </div>
</section>

${strip.length ? `<section class="strip-wrap" aria-label="Made with Premake"><div class="strip">${strip.map((e, i) => card(e, i < 4)).join('')}</div></section>` : ''}

<section class="sec" id="how"><div class="wrap">
  <h2>From a sentence to a box on your doorstep</h2>
  <p class="intro">You talk, an agent does the CAD. Every change rebuilds the model in front of you, and the price updates with it.</p>
  <div class="steps">
    <div class="step"><h3>Describe it</h3>
      <p>Say what it is, roughly how big, and what it needs to hold or do. No CAD skills, no sketches.</p>
      <div class="vign"><div class="bubble">A wall mount for two controllers, with a slot for the charging cable<span class="caret"></span></div></div></div>
    <div class="step"><h3>Watch it build</h3>
      <p>The agent writes parametric CadQuery, exports print-ready parts and picks off-the-shelf hardware. Ask for changes like you would a colleague.</p>
      <div class="vign"><ul><li><b>✓</b>Editing design.py</li><li><b>✓</b>Exported 3 printed parts</li><li><b>✓</b>Added 4 × M3 screws to the parts list</li><li><b>›</b>Widening the cable slot to 9 mm</li></ul></div></div>
    <div class="step"><h3>Order 1 to 500</h3>
      <p>Print the parts yourself or have a shop make them, then add the hardware. One for your desk or a run for your shop.</p>
      <div class="vign"><div class="qtys">${tiers.map((t) => `<div><b>${esc(t.qty)}</b><span>${t.unit_price ? money(t.unit_price) : 'units'}</span></div>`).join('')}</div></div></div>
  </div>
</div></section>

<section class="sec" id="pricing"><div class="wrap price">
  <div>
    <h2>Honest pricing, per unit</h2>
    <p class="intro">Every quote is built from the design itself: the hardware on its parts list, the grams of filament, the printer hours, and assembly time.</p>
    <div class="points">
      <div><h3>Per unit, plus shipping</h3><p>Hardware gets cheaper in bulk and printing scales across the farm, so the unit price drops as quantity goes up. Shipping is one flat line per order.</p></div>
      <div><h3>Kit or assembled</h3><p>Kits ship as printed parts plus a bagged set of hardware, for a lower price. Assembled units arrive ready to use.</p></div>
      <div><h3>Lead time you can plan on</h3><p>Small orders ship in days. Large runs show the real time the printers need, before you order.</p></div>
    </div>
  </div>
  <div class="table">
    <div class="th"><b>${esc(hero ? hero.title : 'Example quote')}</b><span>${q ? 'Real quote' : 'Example'}</span></div>
    ${q ? `<div class="scroll"><table><thead><tr><th>Quantity</th><th>Assembled</th><th>Kit</th><th>Shipping</th><th>Ships in</th></tr></thead>
      <tbody>${q.a.tiers.map((t, i) => row(t, q.k && q.k.tiers[i])).join('')}</tbody></table></div>
      <div class="foot">Unit prices include parts, filament, printing, assembly, packaging and margin. Single units carry a one-off handling fee.</div>`
    : '<div class="foot">Sign in to see a live quote for any design, from 1 to 500 units.</div>'}
  </div>
</div></section>

${ex.length ? `<section class="sec" id="gallery"><div class="wrap">
  <h2>Made with Premake</h2>
  <p class="intro">Real designs, each with printable files, a parts list and step-by-step build instructions. Open one to see how it goes together.</p>
  <div class="grid">${ex.map((e) => card(e, false)).join('')}</div>
</div></section>` : ''}

<section class="end"><div class="wrap">
  <h2>What will you make first?</h2>
  <div class="ctas center"><a class="cta" href="${SIGNIN}">Start building ${ARROW}</a>${ex.length ? '<a class="ghost" href="#gallery">Browse examples</a>' : ''}</div>
</div></section>
</main>

<footer class="wrap foot-bar"><span class="brand sm"><span class="mark" aria-hidden="true"></span>Premake</span>
  <span>Premake: describe it, watch it take shape, hold it next week.</span>
  <span>Made to order</span></footer>
</body></html>`;
}

// ---------------------------------------------------------------- routes
async function page(req, res) {
  if (!cache.examples) await Promise.race([refresh(), new Promise((r) => setTimeout(r, 2500))]);
  else if (Date.now() - cache.at > REFRESH_MS) refresh();
  const body = Buffer.from(render());
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache', Vary: 'Cookie',
    'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(req.method === 'HEAD' ? undefined : body);
}
/** /landing/* (public, GET/HEAD only). Resolves false if the path isn't one of ours. */
async function asset(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
  if (p === '/landing/landing.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : CSS); return true;
  }
  const m = /^\/landing\/thumb\/([a-z0-9][a-z0-9-]{0,80})\.png$/.exec(p);
  if (!m) return false;
  const ex = (cache.examples || []).find((e) => e.slug === m[1]);
  const t = cache.thumbs.get(m[1]) || (ex && cfg.getTarget() ? await fetchThumb(ex) : null);
  if (!t) { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('not found'); return true; }
  const h = { 'Content-Type': 'image/png', ETag: t.etag, 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === t.etag) { res.writeHead(304, h); res.end(); return true; }
  res.writeHead(200, { ...h, 'Content-Length': t.buf.length });
  res.end(req.method === 'HEAD' ? undefined : t.buf); return true;
}
function init(o) {
  cfg = { ...cfg, ...o };
  // Warm the cache once the Mac has registered, then keep it fresh.
  setInterval(() => { if (!cache.examples || Date.now() - cache.at > REFRESH_MS) refresh(); }, 30e3).unref();
}
/** home: the data behind the page (gateway/home renders the product home page from the same cache). */
async function data() {
  if (!cache.examples) await Promise.race([refresh(), new Promise((r) => setTimeout(r, 2500))]);
  else if (Date.now() - cache.at > REFRESH_MS) refresh();
  const ex = (cache.examples || []).filter(hasThumb);
  const shown = new Map(ex.map((e) => [e.slug, e])); // the strip only links designs whose thumbnail the gateway holds
  const recent = (cache.recent || []).filter((o) => shown.has(o.slug)).map((o) => ({ ...o, v: shown.get(o.slug).v }));
  return { examples: ex, quote: cache.quote, heroSlug: HERO_SLUG, recent };
}
module.exports = { init, page, asset, data, thumbUrl, OFF_LANDING };
