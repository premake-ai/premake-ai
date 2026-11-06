// renderLaunch is now the Make tab (web/make.js). renderLaunchMore = the old Launch pane, for the future More tab:
// Launch (/designs/<x>/launch): 1. publish the build guide (/build/<id>: renders, steps,
// print files, shopping list, "Buy it made"), 2. put the product page online. Domain and ads steps are not shown (coming soon).
// renderGuidePreview() draws the center preview of the guide page while the Launch tab is open (app.js decides when).
// The website deploy is a real static export served at /s/<slug>/. Domains are not registered, Meta is never called,
// nothing is charged. Every estimate below is a rough range with its assumptions printed next to it.
import { designPath } from './nav.js'; // urls: clean URLs
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)
import { productHtml } from './store.js';
import { drawAd, loadImage } from './ads.js';
import { renderMake } from './make.js'; // the Make tab: downloads + shopping list + get it made

// ---------- constants (demo assumptions, shown to the user) ----------
const TLD_PRICES = { com: [10, 15], shop: [3, 40], co: [25, 35], store: [5, 60] }; // typical first-year registration, USD
const BUDGET_STEPS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500];
const DURATIONS = [[3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'Ongoing']];
const FEE_TIERS = [[1000, 0.15], [10000, 0.10], [Infinity, 0.07]]; // our fee, marginal, on ad spend per month
const CPM = [8, 25];        // $ per 1,000 impressions
const CTR = [0.008, 0.02];  // clicks per impression
const CONV = [0.02, 0.08];  // landing-page visitors who join the waitlist
const COUNTRIES = [['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia']];
const DEMO = 'Demo — nothing is charged or sent to Meta';
const INTERESTS = {
  fitness: ['Physical fitness', 'Strength training'], grip: ['Grip strength', 'Weight training'], climbing: ['Rock climbing', 'Bouldering'],
  gym: ['Gyms', 'Weight training'], training: ['Strength training'], workout: ['Home workouts'], bouldering: ['Bouldering'],
  cycling: ['Cycling', 'Mountain biking'], bike: ['Cycling'], kitchen: ['Cooking', 'Kitchen gadgets'], cooking: ['Cooking'],
  pets: ['Pet owners'], dog: ['Dog owners'], cat: ['Cat owners'], audio: ['Headphones', 'Music'], headphones: ['Headphones'],
  gaming: ['Video games', 'PC gaming'], controller: ['Video game consoles'], desk: ['Home office', 'Desk setups'],
  office: ['Home office'], outdoor: ['Camping', 'Hiking'], camping: ['Camping'], hiking: ['Hiking'], garden: ['Gardening'],
  '3d printing': ['3D printing', 'Maker culture'], tools: ['DIY', 'Woodworking'], workshop: ['DIY'], home: ['Home improvement', 'Interior design'],
  'home decor': ['Interior design'], plants: ['Houseplants'], lighting: ['Interior design'], phone: ['Smartphones'],
};

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n, dp = 0) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const usd2 = n => usd(n, n % 1 ? 2 : 0);
function nice(n) {
  if (n < 10) return Math.round(n);
  const step = n < 100 ? 1 : n < 1000 ? 10 : n < 10000 ? 100 : 1000;
  return Math.round(n / step) * step;
}
const range = ([a, b]) => `${nice(a).toLocaleString('en-US')}–${nice(b).toLocaleString('en-US')}`;
function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const ICON = {
  open: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.9" fill="none"/></svg>',
  ext: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 10.5V3h7.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
};

// ---------- money + estimates ----------
function monthlyFee(m) {
  let fee = 0, prev = 0;
  for (const [cap, r] of FEE_TIERS) { fee += Math.max(0, Math.min(m, cap) - prev) * r; if (m <= cap) break; prev = cap; }
  return fee;
}
/** daily $, days (0 = ongoing → per 30 days). */
export function plan(daily, days) {
  const span = days || 30;
  const spend = daily * span;
  const month = daily * Math.min(span, 30);
  const rate = monthlyFee(month) / month;
  const fee = Math.round(spend * rate * 100) / 100;
  const imp = [spend / CPM[1] * 1000, spend / CPM[0] * 1000];
  const clicks = [imp[0] * CTR[0], imp[1] * CTR[1]];
  const signups = [clicks[0] * CONV[0], clicks[1] * CONV[1]];
  return { span, spend, fee, rate, total: spend + fee, imp, clicks, signups, ongoing: !days };
}

// ---------- domains ----------
const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'of', 'to', 'in', 'my', 'remix', 'adjustable', 'simple', 'mini', 'small', 'big', 'new']);
export function domainIdeas(title) {
  const all = (String(title || '').toLowerCase().replace(/^remix of /, '').match(/[a-z0-9]+/g) || ['product']);
  let w = all.filter(x => !STOP.has(x));
  if (!w.length) w = all;
  const two = w.slice(-2), core = two.join('').slice(0, 24), head = two[0].slice(0, 14), last = w[w.length - 1].slice(0, 14);
  const list = [`${core}.com`, `get${core}.com`, `${core}.shop`, `${head}forge.com`, `${core}.co`, `${head}lab.store`,
    `try${core}.com`, `${core}.store`, `${last}works.co`, `the${core}.shop`];
  return [...new Set(list)].filter(d => d.split('.')[0].length <= 63).slice(0, 8);
}

// ---------- audience ----------
function interestsFor(tags, title) {
  const out = [];
  for (const t of (tags || []).map(x => String(x).toLowerCase().trim())) {
    const hit = INTERESTS[t];
    if (hit) out.push(...hit);
    else if (/^[a-z][a-z ]{2,24}$/.test(t) && !/part|hardware|store|print|remix/.test(t)) out.push(t[0].toUpperCase() + t.slice(1));
  }
  if (!out.length) for (const w of String(title || '').toLowerCase().match(/[a-z]{4,}/g) || []) if (INTERESTS[w]) out.push(...INTERESTS[w]);
  out.push('Online shopping');
  return [...new Set(out)].slice(0, 6);
}

// ---------- state ----------
const L = {
  id: null, el: null, ctx: null,
  data: null, site: null, ads: null, err: null,
  busy: '', domainSel: null, customDomain: '', customTld: 'com',
  form: null, editing: false, thumbs: new Map(), adsGen: false,
  guide: null, gstage: '', gerr: '', // build guide payload (/build/<id>/data.json), publish progress, last error
};
const PV = { el: null, ctx: null }; // center preview of the guide page (renderGuidePreview)
const GUIDE_SITE = 'https://premake.ai';
const guideUrl = id => `${GUIDE_SITE}/build/${encodeURIComponent(id)}`;
const STAGES = { starting: 'Starting…', writing: 'Writing instructions…', rendering: 'Rendering steps…', sharing: 'Publishing…' };
const hrs = h => (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + ' h';

// The right panel's tab is now "Make" (web/make.js). The guide + website publishing below is kept for the future "More" tab.
export { renderMake as renderLaunch };
export function renderLaunchMore(el, ctx) {
  L.el = el; L.ctx = ctx;
  const id = ctx.src?.project;
  if (!id) {
    L.id = null;
    el.innerHTML = `<div class="launch-ln"><div class="ln-in"><div class="ln-empty"><h1>Launch a design</h1>
      <p>${ctx.src?.example ? 'Examples are read-only. Remix this one to get your own copy, then launch it.' : 'Open one of your projects, then press Launch in the top bar.'}</p>
      ${ctx.src?.example ? '<button class="btn primary ln-big" id="lnRemix">Remix to launch</button>' : '<a class="btn primary ln-big" href="${designPath(null)}">Go to your projects</a>'}</div></div></div>`;
    const b = $('#lnRemix', el);
    if (b) b.onclick = async () => {
      b.disabled = true;
      try { const { id } = await ctx.api.createProject({ fromExample: ctx.src.example }); track('remix_started', { example: ctx.src.example, project_id: id, page: 'launch' }); ctx.toast('Remixed into your projects'); ctx.onRemixed?.(id); }
      catch (e) { ctx.toast(e.message); b.disabled = false; }
    };
    return;
  }
  if (L.id !== id) {
    Object.assign(L, { id, data: null, site: null, ads: null, err: null, busy: '', domainSel: null, customDomain: '', form: null, editing: false, adsGen: false, guide: null, gstage: '', gerr: '' });
    L.thumbs = new Map();
    load();
  }
  draw();
}

async function load() {
  const id = L.id, api = L.ctx.api;
  try {
    const [data, ads, guide] = await Promise.all([api.launch(id), api.ads({ project: id }).catch(() => null), api.guide?.(id).catch(() => null)]);
    if (L.id !== id) return;
    L.data = data; L.ads = ads; L.err = null; L.guide = guide || L.guide;
    if (!L.form) initForm();
    if (guide?.state === 'running' && !L.gstage) watchGuide(id); // started elsewhere (Order tab, guide page): show progress
  } catch (e) { if (L.id === id) L.err = e; }
  drawAll();
}
function drawAll() { draw(); drawPreview(); }

function initForm() {
  const c = L.data.launch.campaign, ads = L.ads?.ads?.ads || [];
  const live = c && c.status !== 'stopped';
  L.form = {
    ads: new Set(live ? c.ads : ads.slice(0, 3).map(a => a.id)),
    budget: Math.max(0, BUDGET_STEPS.indexOf(live ? c.daily_budget : 50)),
    days: live ? c.duration_days : 7,
    country: live ? c.country : 'US',
    interests: new Set(live ? c.interests : interestsFor(L.data.tags, L.data.title)),
    pool: [...new Set([...(live ? c.interests : []), ...interestsFor(L.data.tags, L.data.title)])],
  };
}

// ---------- status ----------
function status() {
  const d = L.data, c = d.launch.campaign;
  const site = d.site_url ? { k: 'live', t: 'Live' } : { k: 'none', t: 'Not started' };
  const dom = d.launch.domain ? { k: 'live', t: 'Connected (demo)' } : d.site_url ? { k: 'ready', t: 'Ready' } : { k: 'none', t: 'Not started' };
  let ads = { k: 'none', t: 'Not started' };
  if (c?.status === 'demo_scheduled') ads = { k: 'live', t: 'Live (demo)' };
  else if (c?.status === 'paused') ads = { k: 'paused', t: 'Paused (demo)' };
  else if (d.ad_count && d.site_url) ads = { k: 'ready', t: 'Ready' };
  return { site, dom, ads };
}
const pill = s => `<span class="ln-pill ${s.k}">${s.k === 'live' ? '<i></i>' : ''}${esc(s.t.replace(' (demo)', ''))}${/\(demo\)/.test(s.t) ? '<span class="ln-pd">(demo)</span>' : ''}</span>`;

// ---------- draw ----------
function draw() {
  const el = L.el; if (!el) return;
  const scroller = $('.launch-ln', el), top = scroller?.scrollTop || 0;
  if (L.err && !L.data) { el.innerHTML = `<div class="launch-ln"><div class="ln-in"><div class="ln-empty"><h1>Couldn’t load launch</h1><p>${esc(L.err.message)}</p><button class="btn ln-big" id="lnRetry">Retry</button></div></div></div>`; $('#lnRetry', el).onclick = load; return; }
  if (!L.data) { el.innerHTML = `<div class="launch-ln"><div class="ln-in"><div class="ln-loading"><div class="big-spin"></div></div></div></div>`; return; }
  const d = L.data, st = status();
  // Only the website step is real. Custom domains and ad campaigns are not built yet: shown as "Coming soon", nothing to click.
  el.innerHTML = `<div class="launch-ln"><div class="ln-in">
    <header class="ln-head">
      ${d.thumb ? `<img class="ln-thumb" src="${esc(d.thumb)}" alt="">` : '<span class="ln-thumb"></span>'}
      <div class="ln-head-t">
        <h1>Launch ${esc(d.title)}</h1>
        <p>Share how to build it, then put your product page online.</p>
      </div>
    </header>
    <button type="button" class="btn ln-share-btn" data-ln-share>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M3 8.5v4.5h10V8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Share this design</button>
    ${guideCard()}
    ${siteCard(d, st.site)}
    <section class="ln-card locked none" id="ln-soon">
      <div class="ln-card-h"><span class="ln-num">+</span>
        <div class="ln-card-t"><h2>Custom domains and ads</h2><p>Your own domain name and ad campaigns for your page are coming soon.</p></div>
        <span class="ln-pill none">Coming soon</span></div>
    </section>
  </div></div>`;
  $('.launch-ln', el).scrollTop = top;
  wire();
}

function card(id, n, title, s, sub, body, locked) {
  return `<section class="ln-card ${locked ? 'locked' : ''} ${s.k}" id="ln-${id}">
    <div class="ln-card-h"><span class="ln-num">${s.k === 'live' || s.k === 'paused' ? ICON.check : n}</span>
      <div class="ln-card-t"><h2>${title}</h2><p>${sub}</p></div>${pill(s)}</div>
    <div class="ln-card-b">${body}</div></section>`;
}

// ---------- step 1: build guide ----------
const guideLive = () => !!L.guide?.share;
function guideStatus() {
  if (L.gstage) return { k: 'ready', t: 'Working' };
  return guideLive() ? { k: 'live', t: 'Published' } : { k: 'none', t: 'Not published' };
}
/** The Publish button (also in the center placeholder). */
function publishBtn(extra = '') {
  const g = L.guide, busy = !!L.gstage, ok = !!g?.has_model && g.can_edit !== false;
  return `<button class="btn primary ln-big ${extra}" data-guide-pub ${busy || !ok ? 'disabled' : ''}>${busy ? `<span class="spin"></span>${esc(STAGES[L.gstage] || 'Working…')}` : 'Publish guide'}</button>`;
}
function guideCard() {
  const g = L.guide, s = guideStatus();
  let body;
  if (!g) body = `<p class="ln-lead muted">Loading…</p>`;
  else if (guideLive() && !L.gstage) {
    const url = guideUrl(L.id);
    body = `
    <div class="ln-gurl"><span class="ln-dot"></span><a class="ln-gurl-t" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">${esc(url.replace(/^https:\/\//, ''))}</a>
      <button class="btn ln-mid" id="lnGuideCopy">${ICON.copy}Copy</button>
      <a class="btn ln-mid" href="${esc(url)}" target="_blank" rel="noopener">Open ${ICON.ext}</a></div>
    <a class="btn primary ln-big block" href="${esc(url)}" target="_blank" rel="noopener">Open instructions page</a>
    <div class="ln-meta">
      <span>${g.steps.length ? `${g.steps.length} steps` : 'Steps not written yet'}${g.printed.length ? ` · ${g.printed.length} print file${g.printed.length === 1 ? '' : 's'}` : ''}${g.totals?.hours ? ` · ${hrs(g.totals.hours)} print` : ''}</span>
      ${g.state === 'stale' ? '<span class="ln-warn">The design changed since the steps were written. <button class="ln-linkbtn" data-guide-pub>Update steps</button></span>' : ''}
      ${g.state === 'none' && g.has_model ? '<span><button class="ln-linkbtn" data-guide-pub>Write the steps</button></span>' : ''}
    </div>
    <p class="ln-fine">Post it anywhere: the link shows a preview card with the render, print time and price. <button class="ln-linkbtn" id="lnReddit">Copy Reddit post</button> · <button class="ln-linkbtn" id="lnGuideOff">Unpublish</button></p>`;
  } else body = `
    <p class="ln-lead">A public page with renders, step-by-step instructions, downloadable print files, a shopping list and a “Buy it made” option.</p>
    <div class="ln-row">${publishBtn()}</div>
    ${L.gstage ? '<p class="ln-fine">About a minute. You can keep working.</p>' : ''}
    ${!g.has_model ? '<p class="ln-warn">Build the model in the studio first.</p>' : ''}
    ${L.gerr ? `<p class="ln-warn">${esc(L.gerr)}</p>` : ''}`;
  return card('guide', '1', 'Publish instructions & files', s, 'A build guide people can follow, print and buy', body, false);
}

/** "Copy Reddit post": a plain title and body, written like a maker sharing a project, with the link at the end. */
export function redditPost(g, url) {
  // project titles are often the first words of the prompt ("A simple phone stand, one printed"): keep the noun phrase
  const name = String(g.title || 'this').split(/\s*[,:;(–—]\s*|\s+-\s+/)[0].replace(/^(a|an|the)\s+/i, '') || 'thing';
  const lower = name.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
  const title = `I made ${/^[aeiou]/i.test(lower) ? 'an' : 'a'} ${lower} you can print at home (free files + step-by-step guide)`;
  const desc = String(g.description || '').replace(/\s+/g, ' ').trim();
  const intro = desc ? (desc.match(/^(.+?[.!?])(\s|$)/)?.[1] || desc).slice(0, 280) : `I put together a ${lower} and wrote up how to build it.`;
  const t = g.totals || {};
  const lines = [];
  if (g.printed?.length) lines.push(`- ${g.printed.length} printed part${g.printed.length === 1 ? '' : 's'}${t.hours ? `, about ${hrs(t.hours)} of printing` : ''}${t.grams ? ` (${Math.round(t.grams)} g of PETG)` : ''}`);
  if (g.bought?.length) {
    const items = g.bought.slice(0, 4).map(b => `${b.qty > 1 ? `${b.qty}× ` : ''}${b.name}`).join(', ');
    lines.push(`- Hardware: ${items}${g.bought.length > 4 ? ` and ${g.bought.length - 4} more` : ''}${g.bought_total ? ` (about $${Math.round(g.bought_total)})` : ''}`);
  } else if (g.printed?.length) lines.push('- No extra hardware, just prints');
  if (g.fabricated?.length) lines.push(`- ${g.fabricated.length} cut or bent part${g.fabricated.length === 1 ? '' : 's'} (cut list included)`);
  if (g.steps?.length) lines.push(`- ${g.steps.length} assembly steps with pictures`);
  const body = [intro, lines.join('\n'), `STLs, print settings, the parts list and the full guide are here: ${url}`,
    'Happy to answer questions or take suggestions for a v2.'].filter(Boolean).join('\n\n');
  return { title, body };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Poll data.json while the steps are being written; returns the final payload (or null if the user moved on). */
async function watchGuide(id) {
  let g = L.guide;
  for (let i = 0; i < 200; i++) {
    if (L.id !== id) return null;
    L.gstage = g?.stage || L.gstage || 'writing'; drawAll();
    await sleep(2500);
    if (L.id !== id) return null;
    try { g = await L.ctx.api.guide(id); } catch { continue; }
    L.guide = g;
    if (g.state !== 'running') break;
  }
  if (L.id === id && L.gstage !== 'sharing') { L.gstage = ''; drawAll(); }
  return g;
}

/** Publish: write the steps if there are none (or the design changed), then share, then show the link. */
async function publishGuide() {
  if (L.gstage) return;
  const id = L.id, api = L.ctx.api;
  L.gerr = ''; L.gstage = 'starting'; drawAll();
  try {
    let g = await api.guide(id);
    if (L.id !== id) return;
    L.guide = g;
    if (!g.has_model) throw new Error('Build the model in the studio first.');
    if (g.state === 'none' || g.state === 'stale') { await api.guideGenerate(id, g.state === 'stale'); g = { ...g, state: 'running', stage: 'writing' }; L.guide = g; }
    if (g.state === 'running') {
      g = await watchGuide(id);
      if (!g) return;
      if (g.state !== 'ready') throw new Error(g.error || 'Writing the steps failed. Try again.');
    }
    if (!g.share) { L.gstage = 'sharing'; drawAll(); await api.guideShare(id, true); track('guide_published', { page: 'launch' }); } // analytics:
    g = await api.guide(id);
    if (L.id !== id) return;
    L.guide = g; L.gstage = '';
    L.ctx.toast('Guide published');
  } catch (e) {
    if (L.id !== id) return;
    L.gstage = ''; L.gerr = e.message; L.ctx.toast(e.message);
  }
  drawAll();
}

async function unpublishGuide() {
  if (!confirm('Unpublish this guide? The link stops working for everyone else. You can publish it again any time.')) return;
  const id = L.id;
  try { await L.ctx.api.guideShare(id, false); const g = await L.ctx.api.guide(id); if (L.id === id) { L.guide = g; L.ctx.toast('Guide unpublished'); } }
  catch (e) { L.ctx.toast(e.message); }
  drawAll();
}

// ---------- center preview of the guide page (Launch tab open, desktop) ----------
export function renderGuidePreview(el, ctx) {
  PV.el = el; PV.ctx = ctx;
  drawPreview();
}
function drawPreview() {
  const el = PV.el;
  if (!el || el.hidden || !L.id || PV.ctx?.src?.project !== L.id) return;
  const g = L.guide, d = L.data;
  if (!g) { if (!el.querySelector('.gp-loading')) el.innerHTML = '<div class="gp-loading"><div class="big-spin"></div></div>'; return; }
  const show = (g.steps.length || g.share) && !L.gstage;
  if (show) {
    const src = `/build/${encodeURIComponent(L.id)}?v=${encodeURIComponent(String(g.generated_at || 0))}`;
    const bar = `<div class="gp-bar"><span class="ln-pill ${g.share ? 'live' : 'none'}">${g.share ? '<i></i>Published' : 'Only you can see this'}</span>
      <span class="gp-url">${esc(guideUrl(L.id).replace(/^https:\/\//, ''))}</span>
      <a class="btn sm" href="/build/${encodeURIComponent(L.id)}" target="_blank" rel="noopener">Open ${ICON.ext}</a></div>`;
    const fr = el.querySelector('iframe.gp-frame');
    if (fr && fr.dataset.src === src) { el.querySelector('.gp-bar').outerHTML = bar; return; } // keep the loaded page (no reload, keeps scroll)
    el.innerHTML = `<div class="gp">${bar}<iframe class="gp-frame" title="Build guide preview" src="${esc(src)}" data-src="${esc(src)}"></iframe></div>`;
    return;
  }
  const t = g.title || d?.title || 'your design';
  const thumb = g.thumb || d?.thumb;
  el.innerHTML = `<div class="gp-empty"><div class="gp-card">
    <div class="gp-mock" aria-hidden="true">
      <div class="gp-mock-bar"><span class="gp-mock-mark"></span>Premake</div>
      <div class="gp-mock-hero">${thumb ? `<img src="${esc(thumb)}" alt="">` : ''}</div>
      <div class="gp-mock-lines"><b></b><i></i><i class="s"></i></div>
      <div class="gp-mock-steps"><span></span><span></span><span></span></div>
    </div>
    <div class="gp-copy">
      <h2>Your build guide for ${esc(t)}</h2>
      <p>One public page people can follow to make it themselves:</p>
      <ul>
        <li>Renders of the finished product</li>
        <li>Step-by-step instructions with a picture per step</li>
        <li>Print files (STL) and print settings</li>
        <li>A shopping list for the hardware</li>
        <li>A “Buy it made” option for people without a printer</li>
      </ul>
      <div class="ln-row">${publishBtn()}</div>
      <p class="ln-fine">${L.gstage ? 'About a minute. You can keep working.' : 'Claude writes the steps from your design (about a minute), each step gets a render, then you get a link at premake.ai.'}</p>
      ${L.gerr ? `<p class="ln-warn">${esc(L.gerr)}</p>` : ''}
    </div></div></div>`;
  wirePub(el);
}
function wirePub(root) { $$('[data-guide-pub]', root).forEach(b => b.onclick = publishGuide); }

function siteCard(d, s) {
  const busy = L.busy === 'deploy';
  const url = d.site_url ? location.origin + d.site_url : '';
  const body = d.site_url ? `
    <div class="ln-url">
      <span class="ln-dot"></span>
      <a href="${esc(d.site_url)}" target="_blank" rel="noopener" class="ln-url-t">${esc(url.replace(/^https?:\/\//, ''))}</a>
      <a class="btn primary ln-big" href="${esc(d.site_url)}" target="_blank" rel="noopener">Open site ${ICON.ext}</a>
    </div>
    <div class="ln-meta">
      <span>Deployed ${esc(ago(d.launch.site.deployed_at))}${d.launch.site.deploys > 1 ? ` · ${d.launch.site.deploys} deploys` : ''}</span>
      <span>${d.waitlist_count} sign-up${d.waitlist_count === 1 ? '' : 's'} so far</span>
      ${d.stale ? '<span class="ln-warn">Page changed since the last deploy</span>' : ''}
    </div>
    <div class="ln-row">
      <button class="btn ${d.stale ? 'primary' : ''} ln-mid" id="lnDeploy" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span>Deploying…' : 'Re-deploy'}</button>
      <a class="btn ln-mid" href="${esc(designPath({ project: L.id }, 'site'))}">Edit page</a>
    </div>
    <p class="ln-fine">A static copy of your product page, hosted by Premake. Waitlist and pre-order sign-ups save to your project.</p>`
    : `
    <p class="ln-lead">Your product page goes online as its own website, with the pre-order button and waitlist working. Change it any time and re-deploy.</p>
    <div class="ln-row">
      <button class="btn primary ln-big" id="lnDeploy" ${busy || !d.has_model ? 'disabled' : ''}>${busy ? '<span class="spin"></span>Deploying…' : 'Deploy website'}</button>
      <a class="btn ln-mid" id="lnSitePrev" href="${esc(designPath({ project: L.id }, 'site'))}">Preview page first</a>
    </div>
    ${d.has_model ? '' : '<p class="ln-warn">Build the model in the studio first.</p>'}`;
  return card('site', '2', 'Put your website online', s, 'Your product page, live at its own address', body, false);
}

function domainCard(d, s) {
  const locked = !d.site_url;
  const dom = d.launch.domain;
  let body;
  if (locked) body = `<p class="ln-lead muted">Deploy the website first. Then pick a name and we connect it.</p>`;
  else if (dom) body = `
    <div class="ln-url">
      <span class="ln-dot"></span><b class="ln-url-t">${esc(dom.name)}</b>
      <span class="ln-pill live"><i></i>Connected (demo)</span>
    </div>
    <div class="ln-meta"><span>Points to <a href="${esc(d.site_url)}" target="_blank" rel="noopener">${esc(location.host + d.site_url)}</a></span><span>Not registered in this demo</span></div>
    <div class="ln-row"><button class="btn ln-mid" id="lnDomChange">Change domain</button></div>`;
  else {
    const ideas = domainIdeas(d.title);
    const sel = L.domainSel || ideas[0];
    body = `
    <p class="ln-lead">Pick a name. We register it and connect it for you.</p>
    <div class="ln-doms" role="radiogroup" aria-label="Domain suggestions">
      ${ideas.map(n => { const tld = n.split('.').pop(), p = TLD_PRICES[tld]; return `<button class="ln-dom ${n === sel ? 'on' : ''}" role="radio" aria-checked="${n === sel}" data-dom="${esc(n)}">
        <span class="ln-radio"></span><span class="ln-dom-n"><b>${esc(n)}</b><small>Availability checked at purchase</small></span>
        <span class="ln-dom-p">${usd(p[0])}–${usd(p[1])}<small>first year, typical</small></span></button>`; }).join('')}
    </div>
    <div class="ln-custom">
      <label class="ln-field"><span>Or type your own</span>
        <span class="ln-inrow"><input id="lnDomIn" placeholder="yourbrand" maxlength="63" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(L.customDomain)}">
        <select id="lnTld" aria-label="Ending">${Object.keys(TLD_PRICES).map(t => `<option value="${t}" ${t === L.customTld ? 'selected' : ''}>.${t}</option>`).join('')}</select></span></label>
    </div>
    <div class="ln-row">
      <button class="btn primary ln-big" id="lnDomGo" ${L.busy === 'domain' ? 'disabled' : ''}>Use ${esc(L.customDomain ? `${L.customDomain}.${L.customTld}` : sel)}</button>
    </div>
    <p class="ln-fine">Availability checked at purchase. Prices are typical first-year ranges (${Object.entries(TLD_PRICES).map(([t, p]) => `.${t} ${usd(p[0])}–${usd(p[1])}`).join(', ')}); renewals can cost more. ${esc(DEMO)}.</p>`;
  }
  return card('domain', '2', 'Choose a domain', s, 'A short name people can type and remember', body, locked);
}

function adsCard(d, s) {
  const c = d.launch.campaign;
  const locked = !d.site_url;
  let body;
  if (locked) body = `<p class="ln-lead muted">Deploy the website first. Ads send people to it.</p>`;
  else if (c && c.status !== 'stopped' && !L.editing) body = campaignHtml(d, c);
  else if (!d.ad_count) body = `
    <p class="ln-lead">You need ads to run first. Premake renders product shots and writes six ad ideas with honest pre-order wording.</p>
    <div class="ln-row"><button class="btn primary ln-big" id="lnGenAds" ${L.adsGen ? 'disabled' : ''}>${L.adsGen ? '<span class="spin"></span>Making ads… about a minute' : 'Make ads'}</button>
    <a class="btn ln-mid" href="${esc(designPath({ project: L.id }, 'ads'))}">Open the Ads tab</a></div>
    <p class="ln-fine">Uses one Claude Code request.</p>`;
  else body = formHtml(d, c);
  return card('ads', '3', 'Run ads on Facebook and Instagram', s, 'We run them for you. You pick the budget.', body, locked);
}

function adThumb(ad) {
  const src = L.thumbs.get(ad.id);
  return src ? `<img src="${src}" alt="">` : `<span class="ln-ad-ph" data-paint="${esc(ad.id)}"></span>`;
}

function formHtml(d, c) {
  const f = L.form, ads = L.ads.ads.ads;
  const daily = BUDGET_STEPS[f.budget];
  return `<div class="ln-form">
    <div class="ln-fcol">
      <div class="ln-q"><h3>Which ads</h3><p class="muted">${f.ads.size} of ${ads.length} picked. Running a few lets Meta find the one that works.</p>
        <div class="ln-ads">${ads.map(a => `<button class="ln-ad ${f.ads.has(a.id) ? 'on' : ''}" data-ad="${esc(a.id)}" aria-pressed="${f.ads.has(a.id)}">
          ${adThumb(a)}<span class="ln-ad-t">${esc(a.headline)}</span><span class="ln-tick">${ICON.check}</span></button>`).join('')}</div></div>
      <div class="ln-q"><h3>Daily budget</h3>
        <div class="ln-budget"><b id="lnBudget">${usd(daily)}</b><span>per day</span></div>
        <input type="range" class="ln-slider" id="lnSlider" min="0" max="${BUDGET_STEPS.length - 1}" step="1" value="${f.budget}" aria-label="Daily budget">
        <div class="ln-scale">${[5, 50, 100, 250, 500].map(v => `<span style="left:${BUDGET_STEPS.indexOf(v) / (BUDGET_STEPS.length - 1) * 100}%">${usd(v)}</span>`).join('')}</div></div>
      <div class="ln-q"><h3>How long</h3>
        <div class="ln-seg">${DURATIONS.map(([v, t]) => `<button data-days="${v}" class="${f.days === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <div class="ln-q"><h3>Who sees it</h3><p class="muted">Picked from your design’s tags. Tap to turn one off.</p>
        <div class="ln-aud">
          <label class="ln-field sm"><span>Country</span><select id="lnCountry">${COUNTRIES.map(([k, t]) => `<option value="${k}" ${f.country === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="ln-field sm"><span>Ages</span><select disabled><option>18 to 65+</option></select></label>
        </div>
        <div class="ln-chips">${f.pool.map(t => `<button class="ln-chip ${f.interests.has(t) ? 'on' : ''}" data-int="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
      <div class="ln-q"><h3>Goal</h3>
        <div class="ln-goal"><b>Pre-orders and waitlist sign-ups</b><span>Sends people to ${esc(d.launch.domain?.name || location.host + d.site_url)}</span></div></div>
    </div>
    <aside class="ln-sum" id="lnSum">${summaryHtml()}</aside>
  </div>`;
}

function summaryHtml() {
  const f = L.form, daily = BUDGET_STEPS[f.budget], p = plan(daily, f.days);
  const per = p.ongoing ? ' per 30 days' : '';
  const ok = f.ads.size > 0;
  return `<div class="ln-sum-in">
    <div class="ln-sum-h">${usd(daily)}/day · ${p.ongoing ? 'ongoing' : `${p.span} days`}</div>
    <dl class="ln-money">
      <dt>Ad spend${per}</dt><dd>${usd2(p.spend)}</dd>
      <dt>Our fee <span class="muted">(${(p.rate * 100).toFixed(p.rate * 100 % 1 ? 1 : 0)}%)</span></dt><dd>${usd2(p.fee)}</dd>
      <dt class="tot">Total${per}</dt><dd class="tot">${usd2(p.total)}</dd>
    </dl>
    <p class="ln-fine">Fee is a sliding scale on monthly ad spend: 15% up to $1,000, 10% from $1,000 to $10,000, 7% above.</p>
    <div class="ln-est">
      <h4>What it might get you${per}</h4>
      <div class="ln-est-r"><span>Times your ads are shown</span><b>${range(p.imp)}</b></div>
      <div class="ln-est-r"><span>Clicks to your site</span><b>${range(p.clicks)}</b></div>
      <div class="ln-est-r"><span>Waitlist sign-ups</span><b>${range(p.signups)}</b></div>
      <p class="ln-assume">Assumes ${usd(CPM[0])}–${usd(CPM[1])} per 1,000 views, ${CTR[0] * 100}–${CTR[1] * 100}% of viewers click, and ${CONV[0] * 100}–${CONV[1] * 100}% of visitors sign up.</p>
      <p class="ln-caveat">Rough estimates, not a guarantee. Real results vary.</p>
    </div>
    <button class="btn primary ln-big block" id="lnLaunch" ${ok && L.busy !== 'campaign' ? '' : 'disabled'}>${L.busy === 'campaign' ? '<span class="spin"></span>Saving…' : L.editing ? 'Save changes (demo)' : 'Launch campaign (demo)'}</button>
    ${L.editing ? '<button class="btn block ln-mid" id="lnCancelEdit">Cancel</button>' : ''}
    <p class="ln-demo-l">${esc(DEMO)}.</p>
    <p class="ln-fine">Pre-order ads must deliver in the time the page promises. We review every ad before it runs.</p>
  </div>`;
}

function campaignHtml(d, c) {
  const p = plan(c.daily_budget, c.duration_days);
  const ads = (L.ads?.ads?.ads || []).filter(a => c.ads.includes(a.id));
  const paused = c.status === 'paused';
  const country = COUNTRIES.find(x => x[0] === c.country)?.[1] || c.country;
  return `<div class="ln-camp">
    <div class="ln-camp-h">
      <span class="ln-pill ${paused ? 'paused' : 'live'}">${paused ? '' : '<i></i>'}${paused ? 'Paused (demo)' : 'Scheduled (demo)'}</span>
      <span class="ln-camp-note">Not sent to Meta — demo</span>
    </div>
    <div class="ln-camp-grid">
      <div class="ln-stat"><span>Budget</span><b>${usd(c.daily_budget)}/day</b><em>${c.duration_days ? `${c.duration_days} days · ${usd2(p.spend)} total` : `ongoing · about ${usd2(p.spend)} per 30 days`}</em></div>
      <div class="ln-stat"><span>Our fee</span><b>${usd2(p.fee)}</b><em>${(p.rate * 100).toFixed(p.rate * 100 % 1 ? 1 : 0)}% of ad spend${p.ongoing ? ' per 30 days' : ''}</em></div>
      <div class="ln-stat"><span>Schedule</span><b>${paused ? 'Paused' : 'Starts after ad review'}</b><em>Set up ${esc(ago(c.updated))}</em></div>
      <div class="ln-stat"><span>Waitlist</span><b>${d.waitlist_count} sign-up${d.waitlist_count === 1 ? '' : 's'}</b><em>Real count from your site</em></div>
    </div>
    <div class="ln-camp-ads">${ads.map(a => `<figure>${adThumb(a)}<figcaption>${esc(a.headline)}</figcaption></figure>`).join('')}</div>
    <p class="ln-meta-l">${esc(country)} · ages 18 to 65+ · ${c.interests.length ? esc(c.interests.join(', ')) : 'broad audience'} · goal: waitlist sign-ups on ${esc(d.launch.domain?.name || location.host + d.site_url)}</p>
    <div class="ln-row">
      <button class="btn ln-mid" id="lnPause" ${L.busy ? 'disabled' : ''}>${paused ? 'Resume' : 'Pause'}</button>
      <button class="btn ln-mid" id="lnEdit">Edit</button>
      <button class="btn danger ln-mid" id="lnStop" ${L.busy ? 'disabled' : ''}>Stop</button>
    </div>
    <p class="ln-fine">No results are shown here because nothing is actually running. A live version would show real spend and clicks from Meta.</p>
  </div>`;
}

function shareCard(d) {
  const c = d.launch.campaign;
  if (!c || c.status === 'stopped') return '';
  const link = `${location.origin}/?ref=${encodeURIComponent(L.id)}`;
  return `<section class="ln-share">
    <div class="ln-share-t"><h2>Launched. Know someone selling online?</h2>
      <p>Send them your link. When they launch, they get $50 in ad credit and so do you. <span class="ln-pill none">Planned</span></p></div>
    <div class="ln-copy"><input id="lnRef" readonly value="${esc(link)}" aria-label="Your referral link"><button class="btn primary ln-mid" id="lnCopy">${ICON.copy}Copy link</button></div>
  </section>`;
}

// ---------- wiring ----------
function wire() {
  // Share: the studio's Share menu (its header button is hidden on phones)
  $$('[data-ln-share]', L.el).forEach(b => b.onclick = () => dispatchEvent(new CustomEvent('buildery:share', { detail: b })));
  const el = L.el, d = L.data, api = L.ctx.api, toast = L.ctx.toast;
  $$('[data-go]', el).forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.dataset.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const dep = $('#lnDeploy', el); if (dep) dep.onclick = deploy;
  // build guide
  wirePub(el);
  const gc = $('#lnGuideCopy', el); if (gc) gc.onclick = async () => { if (await copyText(guideUrl(L.id))) { gc.innerHTML = `${ICON.check}Copied`; toast('Link copied'); setTimeout(() => { if (gc.isConnected) gc.innerHTML = `${ICON.copy}Copy`; }, 1800); } };
  const rd = $('#lnReddit', el); if (rd) rd.onclick = async () => {
    const p = redditPost(L.guide, guideUrl(L.id));
    if (await copyText(`${p.title}\n\n${p.body}`)) { rd.textContent = 'Copied'; toast('Reddit post copied. Paste the first line as the title.'); setTimeout(() => { if (rd.isConnected) rd.textContent = 'Copy Reddit post'; }, 2400); }
    else toast('Couldn’t copy. Your browser blocked the clipboard.');
  };
  const off = $('#lnGuideOff', el); if (off) off.onclick = unpublishGuide;
  const sp = $('#lnSitePrev', el); if (sp) sp.onclick = e => { if (L.ctx.preview?.('site')) e.preventDefault(); };
  // domain
  $$('[data-dom]', el).forEach(b => b.onclick = () => { L.domainSel = b.dataset.dom; L.customDomain = ''; draw(); });
  const din = $('#lnDomIn', el), tld = $('#lnTld', el), go = $('#lnDomGo', el);
  const label = () => { if (go) go.textContent = 'Use ' + (L.customDomain ? `${L.customDomain}.${L.customTld}` : (L.domainSel || domainIdeas(d.title)[0])); };
  if (din) din.oninput = () => {
    L.customDomain = din.value.toLowerCase().replace(/^https?:\/\//, '').replace(/\.(com|shop|co|store)$/, '').replace(/[^a-z0-9-]/g, '').slice(0, 63);
    if (din.value !== L.customDomain && !/[A-Z]/.test(din.value)) din.value = L.customDomain;
    $$('[data-dom]', el).forEach(b => b.classList.toggle('on', !L.customDomain && b.dataset.dom === (L.domainSel || domainIdeas(d.title)[0])));
    label();
  };
  if (din) din.onkeydown = e => { if (e.key === 'Enter') go?.click(); };
  if (tld) tld.onchange = () => { L.customTld = tld.value; label(); };
  if (go) go.onclick = async () => {
    const name = L.customDomain ? `${L.customDomain.replace(/^-+|-+$/g, '')}.${L.customTld}` : (L.domainSel || domainIdeas(d.title)[0]);
    await act('domain', () => api.setDomain(L.id, name), `${name} connected (demo)`);
  };
  const ch = $('#lnDomChange', el); if (ch) ch.onclick = () => act('domain', () => api.setDomain(L.id, null));
  // ads form
  $$('[data-ad]', el).forEach(b => b.onclick = () => { const f = L.form; f.ads.has(b.dataset.ad) ? f.ads.delete(b.dataset.ad) : f.ads.add(b.dataset.ad); draw(); });
  const sl = $('#lnSlider', el);
  if (sl) {
    const fill = () => sl.style.setProperty('--p', (sl.value / sl.max * 100) + '%');
    fill();
    sl.oninput = () => { L.form.budget = Number(sl.value); fill(); $('#lnBudget', el).textContent = usd(BUDGET_STEPS[L.form.budget]); $('#lnSum', el).innerHTML = summaryHtml(); wireSummary(); };
  }
  $$('[data-days]', el).forEach(b => b.onclick = () => { L.form.days = Number(b.dataset.days); draw(); });
  $$('[data-int]', el).forEach(b => b.onclick = () => { const s = L.form.interests; s.has(b.dataset.int) ? s.delete(b.dataset.int) : s.add(b.dataset.int); b.classList.toggle('on'); });
  const co = $('#lnCountry', el); if (co) co.onchange = () => { L.form.country = co.value; };
  wireSummary();
  const gen = $('#lnGenAds', el); if (gen) gen.onclick = genAds;
  // campaign card
  const c = d.launch.campaign;
  const pa = $('#lnPause', el); if (pa) pa.onclick = () => act('status', () => api.campaignStatus(L.id, c.status === 'paused' ? 'demo_scheduled' : 'paused'), c.status === 'paused' ? 'Campaign resumed (demo)' : 'Campaign paused (demo)');
  const ed = $('#lnEdit', el); if (ed) ed.onclick = () => { L.form = null; initForm(); L.editing = true; draw(); };
  const stp = $('#lnStop', el); if (stp) stp.onclick = () => {
    if (!confirm('Stop this campaign? You can set up a new one after.')) return;
    act('status', () => api.campaignStatus(L.id, 'stopped'), 'Campaign stopped (demo)').then(() => { L.form = null; initForm(); });
  };
  const cp = $('#lnCopy', el); if (cp) cp.onclick = async () => {
    const i = $('#lnRef', el);
    try { await navigator.clipboard.writeText(i.value); } catch { i.select(); document.execCommand?.('copy'); }
    cp.innerHTML = `${ICON.check}Copied`; toast('Referral link copied');
    setTimeout(() => { if (cp.isConnected) cp.innerHTML = `${ICON.copy}Copy link`; }, 1800);
  };
  paintThumbs();
}

function wireSummary() {
  const el = L.el;
  const lb = $('#lnLaunch', el); if (lb) lb.onclick = launchCampaign;
  const ce = $('#lnCancelEdit', el); if (ce) ce.onclick = () => { L.editing = false; L.form = null; initForm(); draw(); };
}

async function act(kind, fn, msg) {
  if (L.busy) return;
  const id = L.id;
  L.busy = kind; draw();
  try { const r = await fn(); if (L.id !== id) return; L.data = r; if (msg) L.ctx.toast(msg); }
  catch (e) { L.ctx.toast(e.message); }
  if (L.id !== id) return;
  L.busy = ''; draw();
}

async function deploy() {
  const id = L.id;
  await act('deploy', async () => {
    const site = await L.ctx.api.site({ project: id });
    return L.ctx.api.deploy(id, productHtml(site, { editable: false }), exportCss());
  }, 'Website deployed');
}

async function launchCampaign() {
  const f = L.form, wasEdit = L.editing, before = L.data.launch.campaign?.updated;
  if (!f.ads.size) return;
  await act('campaign', () => L.ctx.api.saveCampaign(L.id, {
    ads: [...f.ads], daily_budget: BUDGET_STEPS[f.budget], duration_days: f.days, country: f.country, interests: [...f.interests],
  }), wasEdit ? 'Campaign updated (demo)' : 'Campaign launched (demo). Nothing was sent to Meta.');
  if (L.data.launch.campaign && L.data.launch.campaign.updated !== before) L.editing = false;
  draw();
  if (!wasEdit) setTimeout(() => $('.ln-share', L.el)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
}

async function genAds() {
  const id = L.id;
  L.adsGen = true; draw();
  try { await L.ctx.api.generateAds({ project: id }); L.ctx.toast('Ads are ready'); }
  catch (e) { L.ctx.toast(e.message); }
  if (L.id !== id) return;
  L.adsGen = false; L.form = null; await load();
}

// ---------- ad thumbnails (same compositor as the Ads tab), cached as data URLs ----------
let painting = false;
async function paintThumbs() {
  if (painting) return;
  const ph = $$('[data-paint]', L.el); if (!ph.length) return;
  const A = L.ads; if (!A?.ads) return;
  painting = true;
  try {
    await document.fonts.load('700 40px Inter').catch(() => {});
    for (const ad of A.ads.ads) {
      if (L.thumbs.has(ad.id)) continue;
      const r = A.ads.renders.find(x => x.name === ad.render) || A.ads.renders[0];
      if (!r) continue;
      try {
        const im = await loadImage(`${A.base}${r.file}?t=${A.ads.t}`);
        const c = document.createElement('canvas'); c.width = c.height = 540;
        drawAd(c.getContext('2d'), ad, im, 540, 540, { price: A.ads.price, brand: A.ads.title });
        L.thumbs.set(ad.id, c.toDataURL('image/jpeg', 0.82));
      } catch { L.thumbs.set(ad.id, `${A.base}${r.file}`); }
      $$(`[data-paint="${CSS.escape(ad.id)}"]`, L.el).forEach(n => { n.outerHTML = `<img src="${L.thumbs.get(ad.id)}" alt="">`; });
    }
  } finally { painting = false; }
}

// ---------- static export CSS: the product-page rules from styles.css ----------
const BASE_CSS = `:root{--ui:'Inter',-apple-system,system-ui,sans-serif;--serif:var(--ui);--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}[hidden]{display:none!important}
html,body{margin:0;background:#f3efe7}a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}input,textarea{font:inherit;color:inherit}
h1,h2,h3{margin:0;font-weight:600;letter-spacing: normal}img{max-width:100%}`;
const AFTER_CSS = `.sf-scroll{overflow:visible;min-height:100vh;flex:none}.sf{min-height:100vh}`;
export function exportCss() {
  const keep = sel => /\.sf\b|\.sf-|\.product-page/.test(sel) && !/\.sf-(strip|shell|loading|ctaseg|back|listed|count)|\.sc\b|\.sc-|\.store\b|\.site\b|\.mk-|\.ads|\.studio|body\.|\.ln/.test(sel);
  const walk = rules => [...rules].map(r => {
    if (r instanceof CSSStyleRule) return keep(r.selectorText) ? r.cssText : '';
    if (r instanceof CSSKeyframesRule) return r.cssText;
    if (r.cssRules && r.cssText.startsWith('@')) { const inner = walk(r.cssRules); return inner ? r.cssText.slice(0, r.cssText.indexOf('{')) + '{\n' + inner + '\n}' : ''; }
    return '';
  }).filter(Boolean).join('\n');
  let out = '';
  for (const sh of document.styleSheets) {
    if (!sh.href || !/\/styles\.css(\?|$)/.test(sh.href)) continue;
    try { out += walk(sh.cssRules); } catch {}
  }
  return `${BASE_CSS}\n${out}\n${AFTER_CSS}\n`;
}
