// Product home page: what signed-out visitors see at GET / (LANDING=product, the default). A full-viewport hero with the
// studio's own prompt box, then examples, how it works, materials, pricing, the store and launch, a final call to action.
// Rendered here (static HTML + CSS, fast first paint, works with the Mac offline) from the landing module's cache.
// The prompt box is the studio's: /home/home.js loads /attach.js (images) and /guest.js (sign-in modal + prompt
// carry-over) from the Mac through the gateway's anonymous allowlist. Examples open in the real studio at /start#/examples/<slug>.
// Hero backdrop: a CSS perspective grid, upgraded on desktop by /home/cad.js (three.js from jsDelivr, loaded after first
// paint) to a CAD floor grid with real example STLs floating left and right of the text (/files/examples/**, anonymous).
// Public routes: GET / (signed out), /home/home.css, /home/glass.css (copy of web/glass.css: liquid glass buttons), /home/home.js, /home/cad.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const OG_V = require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(path.join(__dirname, '..', 'home', 'og.png'))).digest('hex').slice(0, 10);
const crypto = require('node:crypto');
const landing = require('../landing');

const read = (f) => fs.readFileSync(path.join(__dirname, f));
const FILES = { '/home/home.css': ['text/css; charset=utf-8', read('home.css')], '/home/glass.css': ['text/css; charset=utf-8', read('glass.css')], '/home/home.js': ['text/javascript; charset=utf-8', read('home.js')],
  '/home/cad.js': ['text/javascript; charset=utf-8', read('cad.js')], '/home/og.png': ['image/png', read('og.png')] };
const V = crypto.createHash('sha256').update(Buffer.concat(Object.values(FILES).map((f) => f[1]))).digest('hex').slice(0, 10);

// Deep links to the studio (/#/examples/x) go to the guest studio at /start, keeping the hash.
const HASH_JS = `(function(){var h=location.hash;if(h&&h.charAt(1)==='/'&&h.length>2)location.replace('/start'+h)})()`;
const HASH_SHA = crypto.createHash('sha256').update(HASH_JS).digest('base64');
const CSP = `default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; `
  + `script-src 'self' 'sha256-${HASH_SHA}' https://cdn.jsdelivr.net https://us-assets.i.posthog.com; connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com; `
  + `worker-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`; // analytics: PostHog (/analytics.js loads posthog-js from jsDelivr)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const LOGIN = '/auth/login?next=%2F';
const ARROW = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
// Starter chips (as on the studio home): a chip fills the box.
const STARTERS = [
  ['Controller wall mount', 'A wall mount for two game controllers with a cable slot'],
  ['Headphone stand', 'A desk headphone stand with a hidden drawer'],
  ['Photo turntable', 'A motorised photo turntable with an ESP32 and a stepper'],
];
// What you can make: one real example per way of making things.
const MAKES = [
  { slug: 'twist-planter', h: '3D printing', p: 'PLA, PETG and TPU parts, sized and tolerance-checked for a printer farm.' },
  { slug: 'rail-monitor-stand', h: 'Aluminium extrusion', p: '2020 rails cut to length, joined with printed gussets and T-nuts.' },
  { slug: 'fin-glow-lamp', h: 'Sheet metal', p: 'Folded aluminium channels and brackets with real bend allowances.' },
  { slug: 'spin-turntable', h: 'Laser cutting', p: 'Acrylic and plywood plates exported as clean cut files.' },
  { slug: 'drop-night-light', h: 'Electronics', p: 'ESP32 boards, LED rings and steppers, wired up with firmware included.' },
];

// Hero backdrop models (/home/cad.js): left, right. Real examples, small enough to load after first paint.
const CAD_MODELS = ['spin-turntable', 'arc-desk-lamp'];

// card-stats: "Designed in 8 min · $6.34 each" (or "Prints in 2.1 h · …"), same rules as web/stats.js; real numbers only.
function statsText(e) {
  const b = [];
  if (e.design_minutes > 0) b.push(e.design_minutes < 1 ? 'Designed in under 1 min' : `Designed in ${Math.ceil(e.design_minutes)} min`);
  else if (e.print_hours > 0) b.push(`Prints in ${e.print_hours < 0.1 ? '0.1' : e.print_hours.toFixed(1)} h`);
  if (e.price_each > 0) b.push(`$${e.price_each.toFixed(2)} each`);
  return b.join(' · ');
}
const statsSpan = (e, cls = 'st') => { const t = statsText(e); return t ? `<span class="${cls}">${esc(t)}</span>` : ''; };

// social: real like / comment counts on cards and a strip of designs finished lately (server/social.js via the landing cache)
const IC_HEART = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 13.5S2 10 2 6.2A3.2 3.2 0 018 4.6a3.2 3.2 0 016 1.6C14 10 8 13.5 8 13.5z" fill="currentColor"/></svg>';
const IC_REMIX = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v6a3 3 0 003 3h5M9.5 9l2.5 2.5L9.5 14M4 2.5L2 4.5M4 2.5l2 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const IC_TALK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const kfmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
const socialSpan = (e) => (e.likes > 0 || e.comments > 0 ? `<span class="so">${e.likes > 0 ? `<span title="${e.likes} likes">${IC_HEART}${kfmt(e.likes)}</span>` : ''}${e.remixes > 0 ? `<span title="${e.remixes} remixes">${IC_REMIX}${kfmt(e.remixes)}</span>` : ''}${e.comments > 0 ? `<span title="${e.comments} comments">${IC_TALK}${kfmt(e.comments)}</span>` : ''}</span>` : '');
function ago(iso) {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60e3);
  return m < 1.5 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
const priceShort = (n) => (!(n > 0) ? '' : n >= 100 ? '$' + Math.round(n).toLocaleString('en-US') : '$' + n.toFixed(2));
/** Designs really finished lately (server/social.js recent(), via the landing cache): thumbnail, title, when, price. */
function recentStrip(recent) {
  if (!recent || recent.length < 3) return '';
  const items = recent.slice(0, 18).map((o) => `<li><a href="${exHref(o)}"><img class="th" src="${landing.thumbUrl(o)}" alt="" width="28" height="28" loading="lazy" decoding="async">`
    + `<span><b>${esc(o.title)}</b> designed <time datetime="${esc(o.at)}">${esc(ago(o.at))}</time></span>${o.price_each > 0 ? `<span class="pr">${esc(priceShort(o.price_each))}</span>` : ''}</a></li>`).join('');
  return `<div class="orders" role="region" aria-label="Recently designed"><span class="orders-note">Just designed</span>
    <div class="orders-view"><div class="orders-track" style="animation-duration:${Math.max(40, Math.min(18, recent.length) * 5)}s"><ul>${items}</ul><ul aria-hidden="true">${items.replace(/<a /g, '<a tabindex="-1" ')}</ul></div></div></div>`;
}

const exHref = (e) => `/start#/examples/${encodeURIComponent(e.slug)}`;
const img = (e, w, h, lazy = true) => `<img src="${landing.thumbUrl(e)}" alt="" width="${w}" height="${h}"${lazy ? ' loading="lazy"' : ''} decoding="async">`;

function render(d, base) {
  const ex = d.examples;
  const by = new Map(ex.map((e) => [e.slug, e]));
  const hero = by.get(d.heroSlug) || ex[0] || null;
  const q = hero && d.quote && d.quote.slug === hero.slug ? d.quote : null;
  const title = 'Premake: build something you can hold';
  const desc = 'Describe a product. Watch an AI agent design it in CAD, live in 3D. Order 1 to 500, or launch it with a website and ads.';
  const ogImg = `${base}/home/og.png?v=${OG_V}`; // designed share card (cadlib/render_og_home.py)
  const tiers = q ? q.a.tiers : [];
  const watch = by.get('controller-wall-mount') || hero;
  const makes = MAKES.map((m) => ({ ...m, e: by.get(m.slug) })).filter((m) => m.e);
  const promptBox = (id) => `<form class="prompt-box" id="${id}Form" action="/auth/login" method="get" autocomplete="off">
      <input type="hidden" name="next" value="/#/?resume=1">
      <textarea id="${id}Prompt" rows="3" aria-label="Describe a product to build, or paste or drop a photo or sketch" placeholder="Describe a product, or paste a photo or sketch…"></textarea>
      <div class="prompt-row">
        <div class="chips">${STARTERS.map(([l, s]) => `<button type="button" class="chip" data-fill="${esc(s)}">${esc(l)}</button>`).join('')}</div>
        <button class="btn primary go" type="submit">Start building ${ARROW}</button>
      </div>
    </form>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(base)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="Premake"><meta property="og:url" content="${esc(base)}/">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Premake: build something you can hold">` : ''}
<meta name="twitter:card" content="${ogImg ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : ''}
<meta name="theme-color" content="#fafaf9">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Premake">
<script>${HASH_JS}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/home/home.css?v=${V}"><link rel="stylesheet" href="/home/glass.css?v=${V}">
<link rel="modulepreload" href="/guest.js"><link rel="modulepreload" href="/attach.js">
<script type="module" src="/home/home.js?v=${V}"></script>
<script type="module" src="/analytics.js"></script>
</head><body>
<header class="nav"><div class="wrap nav-in">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>Premake</a>
  <nav class="links" aria-label="Sections"><a href="#examples">Examples</a><a href="/start#/store">Store</a><a href="#pricing">Pricing</a><a href="#how">How it works</a></nav>
  <div class="auth"><a class="btn ghost" href="${LOGIN}">Log in</a><a class="btn primary" href="${LOGIN}">Get started</a></div>
</div></header>

<main>
<section class="hero" aria-labelledby="heroTitle">
  <div class="cad" id="cad" aria-hidden="true" data-src="/home/cad.js?v=${V}" data-models="${CAD_MODELS.join(',')}"><div class="cad-floor"></div></div>
  <div class="glow" aria-hidden="true"></div>
  <div class="hero-in">
    <h1 id="heroTitle">Build something you can <em>hold</em></h1>
    <p class="sub">Describe a product. Watch it take shape in 3D. Order 1 to 500.</p>
    ${promptBox('hero')}
    <p class="fine">Tip: paste (⌘V) or drop a photo of anything you want made</p>
  </div>
  <a class="scroll-cue" href="#examples" aria-label="See examples"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg></a>
</section>

${ex.length ? `<section class="sec" id="examples"><div class="wrap">
  <div class="sec-head"><h2>Vibe manufacturing is here</h2><p>${ex.length} real designs, each with CAD you can open, a parts list and a price. Click one to explore it in 3D.</p></div>
  ${recentStrip(d.recent)}
  <div class="grid">${ex.slice(0, 24).map((e) => `<a class="card" href="${exHref(e)}"><span class="img">${img(e, 640, 480)}</span>
    <span class="meta"><span class="t">${esc(e.title)}</span>${e.creator ? `<span class="by">${esc(e.creator)}</span>` : ''}${statsSpan(e)}${socialSpan(e)}</span></a>`).join('')}</div>
  ${ex.length > 8 ? `<div class="all-ex"><a class="btn" href="/start#/examples">See all ${ex.length} examples ${ARROW}</a></div>` : ''}
</div></section>` : ''}

<section class="sec" id="how"><div class="wrap">
  <div class="sec-head"><h2>How it works</h2><p>You talk, an agent does the CAD. Every change rebuilds the model in front of you, and the price moves with it.</p></div>
  <div class="steps">
    <div class="step"><div class="vign v-type"><div class="mini-box"><span class="line"><span class="typed">A wall mount for two controllers</span><span class="caret"></span></span><span class="mini-go">Start building</span></div></div>
      <h3>Describe it</h3><p>Say what it is, roughly how big, and what it has to hold or do. No CAD skills, no sketches.</p></div>
    <div class="step"><div class="vign v-build">${watch ? `<span class="build-img">${img(watch, 640, 480)}</span>` : ''}
      <ul><li>Writing design.py</li><li>Exported 3 printed parts</li><li>Added 4 × M3 screws</li><li>Widened the cable slot to 9 mm</li></ul></div>
      <h3>Watch it build</h3><p>The agent writes parametric CadQuery and you see the model change live. Ask for edits like you would a colleague.</p></div>
    <div class="step"><div class="vign v-order"><div class="qtys">${(tiers.length ? tiers.slice(0, 4) : [{ qty: 1 }, { qty: 10 }, { qty: 100 }, { qty: 500 }])
      .map((t) => `<div><b>${esc(t.qty)}</b><span>${t.unit_price ? money(t.unit_price) : 'units'}</span></div>`).join('')}</div></div>
      <h3>Order it or launch it</h3><p>Order one for your desk or a run of 500. Or put it on sale with a product page and ads.</p></div>
  </div>
</div></section>

${makes.length ? `<section class="sec" id="make"><div class="wrap">
  <div class="sec-head"><h2>More than 3D printing</h2><p>Designs mix printed parts with bought ones: extrusion, folded metal, laser-cut plates and electronics.</p></div>
  <div class="makes">${makes.map((m) => `<a class="make" href="${exHref(m.e)}"><span class="img">${img(m.e, 640, 480)}</span>
    <span class="mk-t"><b>${esc(m.h)}</b><span>${esc(m.p)}</span><span class="mk-ex">${esc(m.e.title)} ${ARROW}</span>${statsSpan(m.e, 'mk-st')}</span></a>`).join('')}</div>
</div></section>` : ''}

<section class="sec" id="pricing"><div class="wrap price">
  <div class="sec-head left"><h2>A real price, per unit</h2><p>Every quote is built from the design itself: the hardware on its parts list, grams of filament, printer hours and assembly time. The price drops as quantity goes up.</p>
    <ul class="ticks"><li>Kit or assembled</li><li>One flat shipping line per order</li><li>Lead time shown before you order</li></ul></div>
  <div class="qtable">
    <div class="qt-head">${hero ? `<a href="${exHref(hero)}">${img(hero, 96, 72)}<b>${esc(hero.title)}</b></a>` : '<b>Example quote</b>'}${q ? `<span>${Math.round(q.a.print.grams)} g · ${(+q.a.print.hours).toFixed(1)} h print</span>` : ''}</div>
    ${q ? `<div class="scroll"><table><thead><tr><th>Quantity</th><th>Assembled</th><th>Kit</th><th>Ships in</th></tr></thead>
      <tbody>${tiers.map((t, i) => { const k = q.k && q.k.tiers[i]; return `<tr><td>${Number(t.qty).toLocaleString('en-US')}</td><td class="u">${money(t.unit_price)}</td><td>${k ? money(k.unit_price) : '–'}</td><td>${esc(t.lead_time_days)} days</td></tr>`; }).join('')}</tbody></table></div>
      <p class="qt-foot">Per unit, live from this design's quote. Includes parts, filament, printing, assembly and packaging.</p>`
    : '<p class="qt-foot">Open any example to see its live quote, from 1 to 500 units.</p>'}
  </div>
</div></section>

<section class="sec" id="store"><div class="wrap duo">
  <a class="panel" href="/start#/store">
    <div class="pics">${ex.slice(4, 8).map((e) => `<span>${img(e, 320, 240)}</span>`).join('')}</div>
    <h3>The Store</h3><p>Products people designed with Premake, made to order. Buy one, or remix it into your own.</p><span class="more">Browse the store ${ARROW}</span></a>
  <a class="panel" href="${hero ? `/start#/site/examples/${encodeURIComponent(hero.slug)}` : '/start#/store'}">
    <div class="site-mock" aria-hidden="true"><div class="sm-bar"><i></i><i></i><i></i></div><div class="sm-body">${hero ? img(hero, 320, 240) : ''}<div><b>${esc(hero ? hero.title : 'Your product')}</b><span></span><span></span><em>Pre-order</em></div></div></div>
    <h3>Launch your product</h3><p>Get a product page with pre-orders and a waitlist, plus ad creative ready for Meta. Test demand before you make a run.</p><span class="more">See a product page ${ARROW}</span></a>
</div></section>

<section class="end"><div class="glow small" aria-hidden="true"></div><div class="wrap end-in">
  <h2>What will you make first?</h2>
  ${promptBox('end')}
</div></section>
</main>
<div class="m-cta" id="mCta" hidden><button class="btn primary" type="button">Start building ${ARROW}</button></div><!-- phones: Start building within thumb reach once the hero box scrolls away (home.js) -->

<footer class="foot"><div class="wrap foot-in">
  <span class="brand sm"><span class="mark" aria-hidden="true"></span>Premake</span>
  <span>Premake: describe it, watch it take shape, hold it next week.</span>
  <nav aria-label="Footer"><a href="/about">About</a></nav>
</div></footer>
</body></html>`;
}

async function page(req, res, base) {
  const body = Buffer.from(render(await landing.data(), base));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache', Vary: 'Cookie',
    'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(req.method === 'HEAD' ? undefined : body);
}
// analytics: GET /analytics.js for every page behind the gateway (this folder's copy of web/analytics.js, so the landing,
// sign-in and legal pages have it with the Mac offline). Short cache: the URL isn't versioned.
const ANALYTICS = read('analytics.js');
function analytics(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : ANALYTICS);
  return true;
}
/** /home/* static files. Returns false if the path isn't one of ours. */
function asset(req, res, p) {
  const f = FILES[p];
  if (!f || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  res.writeHead(200, { 'Content-Type': f[0], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : f[1]);
  return true;
}
module.exports = { page, asset, analytics };
