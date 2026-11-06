// The public build guide page /build/<slug> (server/guide.js renders the <head>, SEO tags and a server-side copy of the
// guide). Laid out like the studio: top bar, the 3D viewer (web/viewer.js) with its toolbar and Parts panel in the
// center, and a right panel with Instructions | Order tabs, an "Order this" pill and a chat box pinned at the bottom.
// The chat box remixes the design into the visitor's projects (POST /api/projects {fromShare|fromExample, prompt}: the
// server starts the design agent with that message) and opens the studio; guests sign in first (web/guest.js) and the
// message is kept in sessionStorage/localStorage and sent when they come back (?do=remix).
// Everything this page loads is public through the gateway: /build/<slug>/..., /api/auth, /api/checkout/config and
// the static .js/.css files.

import { ACCESS } from './api.js';
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)
import './glass.js'; // glass: sliding pill on the Instructions / Modify / Order tabs
import './toolmore.js'; // toolmore: the viewer toolbar on phones (Explode toggle)
import './motion.js'; // Move button: plays the design's motion.json in the viewer
import './phone.js'; // phone: bottom sheets you can drag down (phones)
import { mdHtml } from './guide.js';
import { signInModal, keepImages, takeImages } from './guest.js';
import { attachImages, defaultImageText } from './attach.js'; // photos/sketches in the Modify box (phones: camera button)
import { mountSocial } from './social.js'; // social: like / remix / built bar and comments (server/social.js)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n)) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => (n == null || isNaN(n)) ? '–' : '$' + Math.round(Number(n)).toLocaleString('en-US');
const howTo = t => `How to build the ${String(t).replace(/^(a|an|the)\s+/i, '').replace(/^[A-Z](?=[a-z])/, ch => ch.toLowerCase())}`; // same as server/guide.js
const shipsIn = d => d <= 1 ? 'ships tomorrow' : `ships in ${d} days`;
const isNarrow = () => matchMedia('(max-width: 640px)').matches;
const SIGNED_IN = !!ACCESS.authed && !ACCESS.showcase;
const DRAFT_KEY = 'buildery.buildDraft';

const IC = {
  dl: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 2l6.5 11.5h-13z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 11.8v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  box: '<svg viewBox="0 0 16 16" width="28" height="28" aria-hidden="true"><path d="M2.5 4.5l5.5-2.5 5.5 2.5v7L8 14l-5.5-2.5zM2.5 4.5L8 7l5.5-2.5M8 7v7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
  cart: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M2 3h1.8l1.4 7.2h7.3L14 5H4.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="6" cy="13" r="1" fill="currentColor"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg>',
  send: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" stroke-width="1.7" fill="none"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
  eyeOn: '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 13L13 3" stroke="currentColor" stroke-width="1.2"/></svg>',
};
const TOOLBAR = `
  <div class="seg"><button data-view="iso" title="Isometric">Iso</button><button data-view="front" title="Front">Front</button><button data-view="side" title="Side">Side</button><button data-view="top" title="Top">Top</button></div>
  <span class="tsep"></span>
  <div class="tmore" role="group" aria-label="View options">
  <label class="tslider" title="Explode"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1v4M8 11v4M1 8h4M11 8h4M3 3l2.5 2.5M13 13l-2.5-2.5M13 3l-2.5 2.5M3 13l2.5-2.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
    <input type="range" id="bpExplode" min="0" max="100" value="0" aria-label="Explode"></label>
  <span class="tsep"></span>
  <button class="tbtn" id="bpGhost" aria-pressed="false" title="See-through case"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-dasharray="2 1.5"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/></svg><span>See-through</span></button>
  <button class="tbtn on" id="bpComp" aria-pressed="true" title="Show bought parts"><svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5" stroke="currentColor" stroke-width="1.4"/></svg><span>Bought parts</span></button>
  <button class="tbtn" id="bpBg" title="Viewport background: light or dark"><svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/></svg><span>Dark</span></button>
  </div>
  <button class="tbtn" id="bpFit" title="Fit to view"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg><span>Fit</span></button>
  <span class="tsep"></span>
  <button class="tbtn render-btn" id="bpRender" aria-pressed="false" title="Product render: real materials and studio light"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.8l1.5 3.6 3.7.3-2.8 2.5.9 3.7L8 9.9l-3.3 2 .9-3.7-2.8-2.5 3.7-.3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg><span>Render</span></button>`;

async function getJSON(url, opts = {}) {
  let r;
  try {
    r = await fetch(url, { cache: 'no-store', ...opts, headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw Object.assign(new Error('Can’t reach Premake. Check your connection and retry.'), { status: 0 }); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(d?.error || `Request failed (${r.status})`), { status: r.status });
  return d;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.innerHTML = `<span class="dot"></span>${esc(msg)}`; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
/** Sign in, coming back to this page with ?do=<what>. Through the gateway: the Google modal; locally: the login page. */
function signIn(title, text, what) {
  const next = `${location.pathname}?do=${what}`;
  if (ACCESS.signin && ACCESS.signin !== '/auth/signin') { location.href = `${ACCESS.signin}?next=${encodeURIComponent(next)}`; return; }
  signInModal({ title, text, next });
}

// ---------------------------------------------------------------- state
const S = { slug: document.body.dataset.buildSlug, g: null, tab: 'ins', mode: 'assembled', tierIdx: 0, quotes: {}, quoteErr: null,
  v: null, step: null, render: false, poll: null, autoGen: false, busy: false };

// ---------------------------------------------------------------- shell
function shell(g) {
  const acct = ACCESS.user
    ? `<a class="avatar bp-avatar" href="/" title="Signed in as ${esc(ACCESS.user)}. Open your studio">${esc(ACCESS.user[0].toUpperCase())}</a>`
    : !SIGNED_IN && ACCESS.signin ? '<button type="button" class="btn sm bp-signin" id="bpSignin">Sign in</button>' : '';
  return `
  <header class="topbar bp-top">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>Premake</a>
    <div class="crumb"><b>${esc(g.title)}</b>${g.creator ? ` <span class="bp-by">by ${esc(g.creator)}</span>` : ''}</div>
    <div class="top-right"><a class="bp-made" href="/">Made with Premake</a><span class="conn">${acct}</span></div>
  </header>
  <div class="bp">
    <main class="center bp-center">
      <div class="model-pane" id="bpModel">
        <div class="viewport" id="bpViewport"></div>
        <div class="toolbar">${TOOLBAR}</div>
        <div class="tree ${innerWidth < 1280 ? 'collapsed' : ''}" id="bpTree" hidden>
          <button class="tree-head" id="bpTreeToggle"><span>Parts</span><span class="muted" id="bpTreeCount"></span>${IC.chev}</button>
          <div class="tree-body" id="bpTreeBody"></div></div>
        <div class="bp-stepchip" id="bpStepChip" hidden></div>
        <div class="vp-overlay" id="bpOverlay" ${g.has_model ? '' : ''}>${g.has_model ? '<div class="box"><div class="big-spin"></div><p>Loading model…</p></div>' : '<div class="box"><h3>No 3D model yet</h3></div>'}</div>
        <div class="vp-hint">Drag to rotate · scroll to zoom · mm</div>
      </div>
    </main>
    <aside class="right bp-right">
      <div class="tabbar" role="tablist" aria-label="Guide">
        <button class="tab on" role="tab" data-bptab="ins" aria-selected="true">Instructions</button>
        <button class="tab" role="tab" data-bptab="modify" aria-selected="false">Modify</button>
        <button class="tab" role="tab" data-bptab="order" aria-selected="false">Order</button>
      </div>
      <div class="bp-scroll" id="bpIns"></div>
      <div class="bp-scroll bp-modify" id="bpModify" hidden>${modifyHtml(g)}</div>
      <div class="pane order bp-scroll" id="bpOrder" hidden></div>
      <div class="bp-foot">
        <button class="order-pill" id="bpPill" hidden></button>
        <div id="bpChatWrap" hidden>${chatHtml(g)}</div>
      </div>
    </aside>
  </div>`;
}

// Modify tab: what you can change, with one-tap suggestions that fill the chat box below
const MODS = ['Make it 20% bigger', 'Make it stronger and thicker', 'Add my name on it', 'Make it fit a different size'];
function modifyHtml(g) {
  return `<h2 class="bp-mod-h">Make it yours</h2>
    <p class="bp-mod-p">Describe a change and the AI redesigns ${esc(g.title || 'this')} for you: size, fit, strength, text, features. You get your own copy to keep editing, then print it or order it made.</p>
    <div class="bp-mod-chips">${MODS.map(m => `<button type="button" class="chip" data-mod="${esc(m)}">${esc(m)}</button>`).join('')}</div>`;
}

function chatHtml(g) {
  const can = g.is_owner || !!g.remix_src;
  if (!can) return `<p class="bp-noremix">Want changes? Ask the creator to enable remixing.</p>`;
  const who = g.is_owner ? 'Opens your design in the studio' : g.remix_src.original ? 'Makes your own copy of the original design' : 'Makes your own copy to change';
  return `<form class="composer" id="bpChat">
    <div class="cbox"><textarea id="bpChatInput" rows="1" placeholder="What changes would you like to make?" aria-label="What changes would you like to make?"></textarea>
      <div class="cbar"><span class="c-who muted small bp-who">${esc(who)}</span>
        <button class="send" id="bpSend" type="submit" aria-label="Send">${IC.send}</button></div></div></form>`;
}

// ---------------------------------------------------------------- Instructions tab
function facts(g) {
  const t = g.totals;
  return [g.printed.length && `${g.printed.length} printed part${g.printed.length === 1 ? '' : 's'}`, t.hours && `${t.hours} h printing`,
    t.grams && `${Math.round(t.grams)} g filament`, t.assembly_minutes && `about ${t.assembly_minutes} min to assemble`].filter(Boolean);
}
const stlName = f => String(f || '').split('/').pop();
const stlOk = f => /^stl\/[\w.-]+\.stl$/.test(f || '');

// wire steps (server/buildplan.js): pin to pin, with the wire colour as a swatch
const WIRE_HEX = { red: '#d93025', black: '#1c1917', white: '#f5f5f4', yellow: '#f4c20d', green: '#1e8e3e', blue: '#1a73e8', orange: '#f57c00', purple: '#8e44ad', brown: '#795548', grey: '#9e9e9e', gray: '#9e9e9e', pink: '#e91e63' };
const wiresHtml = s => (s.wires || []).length ? `<ul class="wire-list">${s.wires.map(w => `<li><i class="wire-sw" style="background:${WIRE_HEX[w.color] || '#b8b2a7'}"></i><span>${esc(w.text)}</span>${w.color && !w.guess ? `<em>${esc(w.color)}</em>` : ''}</li>`).join('')}</ul>${s.note ? `<p class="wire-note">${esc(s.note)}</p>` : ''}` : '';

function stepsHtml(g) {
  if (!g.steps.length) {
    if (g.state === 'running') return genCard(g);
    if (!g.has_model) return '<div class="bp-note">This design has no exported model yet. Instructions appear once it builds.</div>';
    return `<div class="bp-note">${g.error ? `${esc(g.error)} ` : ''}The step-by-step instructions haven’t been written yet.${g.can_generate ? ' <button class="btn sm" data-gen>Write them now</button>' : ''}</div>`;
  }
  const head = g.state === 'running' ? genCard(g)
    : g.state === 'stale' && g.can_edit ? '<div class="bp-note">The design changed after these steps were written. <button class="btn sm" data-gen data-force>Rewrite the steps</button></div>'
    : g.error && g.can_edit ? `<div class="bp-note">Last rewrite failed: ${esc(g.error)}</div>` : '';
  return head + `<ol class="bp-steps">${g.steps.map(s => `
    <li class="bp-step ${S.step === s.n ? 'on' : ''}" id="step-${s.n}" data-step="${s.n}" tabindex="0" title="Show this step in 3D">
      <div class="bp-step-img">${s.img ? `<img src="${esc(s.img)}" alt="Step ${s.n}: ${esc(s.title)}" loading="lazy">` : `<span class="bp-noimg">${IC.box}</span>`}</div>
      <h3><span class="bp-n">${s.n}</span>${esc(s.title)}</h3>
      <p>${esc(s.text)}</p>${wiresHtml(s)}
      ${s.parts.length ? `<div class="bp-chips">${s.parts.map(p => `<span class="bp-chip">${esc(p)}</span>`).join('')}</div>` : ''}
      ${s.warning ? `<div class="bp-warn">${IC.warn}<span>${esc(s.warning)}</span></div>` : ''}
    </li>`).join('')}</ol>`;
}
const stageText = g => g.stage === 'rendering' ? 'Rendering a picture for each step' : 'Writing the steps. This takes about a minute.';
const genCard = g => `<div class="bp-gen"><span class="spin"></span><div><b>Writing the instructions</b><span class="bp-gen-stage">${esc(stageText(g))}</span></div></div>`;

function insHtml(g) {
  const main = g.downloads[0];
  const rest = g.downloads.slice(1);
  const stls = g.printed.filter(p => stlOk(p.file));
  const base = `/build/${encodeURIComponent(g.slug)}/`;
  const f = facts(g), diy = g.bought_total + g.fab_total + g.totals.grams * 0.025;
  return `<article class="bp-ins">
    <h1>${esc(howTo(g.title))}</h1>
    ${g.description ? `<p class="bp-lede">${esc(g.description)}</p>` : ''}
    ${f.length || diy > 0 ? `<p class="bp-sub">${esc(f.join(' · '))}${diy > 0 ? `${f.length ? ' · ' : ''}about ${money0(diy)} in parts` : ''}</p>` : ''}
    <div class="so-bar" data-social-bar></div>

    ${g.project && g.can_edit ? `<label class="bp-owner"><input type="checkbox" data-share ${g.share ? 'checked' : ''}>
      <span><b>${g.share ? 'Public guide' : 'Only you can see this guide'}</b><small>${g.share ? 'Anyone with the link can open it.' : 'Turn on to get a public link.'}</small></span></label>` : ''}

    ${main ? `<div class="bp-dlbox">
      <div class="bp-dlrow"><a class="btn bp-dl" href="${esc(main.href)}" download>${IC.dl}${main.main ? 'Download files' : `Download ${esc(main.label.toLowerCase())}`}</a>
        <button type="button" class="btn primary bp-dl bp-buy" data-buymade>${IC.cart}Buy it made</button></div>
      <small>${esc(main.main ? `everything.zip: ${main.sub}` : main.sub)}</small>
      ${rest.length || stls.length ? `<details class="bp-files"><summary>Individual files</summary><ul>
        ${rest.map(d => `<li><a href="${esc(d.href)}" download>${esc(d.label)}</a><span>${esc(d.sub)}</span></li>`).join('')}
        ${stls.map(p => `<li><a href="${esc(base + p.file)}" download="${esc(stlName(p.file))}">${esc(stlName(p.file))}</a><span>${esc(p.name)}</span></li>`).join('')}
      </ul></details>` : ''}
    </div>` : ''}

    <section class="bp-sec" id="bp-steps"><h2>Assembly</h2>${g.steps.length ? '<p class="bp-hint">Click a step to see it in 3D.</p>' : ''}<div id="bpSteps">${stepsHtml(g)}</div></section>

    ${g.printed.length ? `<section class="bp-sec"><h2>Print settings</h2>
      <p class="bp-hint">0.4 mm nozzle. ${g.totals.hours} h and ${Math.round(g.totals.grams)} g in total.</p>
      <ul class="bp-list">${g.printed.map(p => `<li><div class="bp-row"><b>${esc(p.name)}</b><span class="bp-num">${p.hours} h · ${Math.round(p.grams)} g</span></div>
        <div class="bp-meta">${esc([p.material, p.layer_height, p.walls, `${p.infill} infill`].join(' · '))}</div>
        <div class="bp-meta">${esc(p.orientation)}. Supports: ${esc(p.supports)}.</div>
        ${p.note ? `<div class="bp-meta">${esc(p.note)}</div>` : ''}${p.too_big ? '<div class="bp-meta bad">Larger than 256 mm: needs a big printer</div>' : ''}</li>`).join('')}</ul></section>` : ''}

    ${g.fabricated.length ? `<section class="bp-sec"><h2>Cut list</h2>
      <ul class="bp-list">${g.fabricated.map(x => `<li><div class="bp-row"><b>${esc(x.name)}</b><span class="bp-num">${x.material_usd ? money(x.material_usd) : ''}</span></div><div class="bp-meta">${esc(x.spec)}</div></li>`).join('')}</ul></section>` : ''}

    ${g.bought.length ? `<section class="bp-sec"><h2>Parts to buy</h2>
      <ul class="bp-list">${g.bought.map(p => `<li><div class="bp-row"><b>${p.qty} × ${esc(p.name)}</b><span class="bp-num">${money(p.total)}</span></div>
        ${p.notes || p.url || p.supplier ? `<div class="bp-meta">${p.notes ? esc(p.notes) + ' ' : ''}${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.supplier || 'Link')} ↗</a>` : esc(p.supplier || '')}</div>` : ''}</li>`).join('')}
        <li class="bp-total"><div class="bp-row"><b>Approximate total</b><span class="bp-num">${money(g.bought_total)}</span></div></li></ul>
      <p class="bp-hint">Prices are approximate. You’ll usually buy packs, so expect leftovers.</p></section>` : ''}

    ${g.wiring || g.firmware.length ? `<section class="bp-sec"><h2>Wiring and firmware</h2>
      ${g.firmware.length ? `<div class="bp-fw"><span>${g.firmware.map(f => `<code>${esc(f)}</code>`).join(' ')}</span><a class="btn sm" href="${esc(base)}firmware.zip" download>${IC.dl}Firmware</a></div>` : ''}
      ${g.wiring ? `<div class="bp-md">${mdHtml(g.wiring)}</div>` : ''}</section>` : ''}

    <section class="bp-sec so-talk" id="comments" data-social-talk></section>

    <p class="bp-fine">${g.generated_at ? `Instructions written ${esc(new Date(g.generated_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))} from the design files. ` : ''}Files are for personal use. Build at your own risk: check fits as you go, wear eye protection, and never leave electronics unattended while testing. <a href="/guides">More build guides</a></p>
  </article>`;
}

function drawIns() {
  const el = $('#bpIns'), top = el.scrollTop;
  el.innerHTML = insHtml(S.g);
  el.scrollTop = top;
  wireIns(el);
  mountSocial(el, S.g, { signIn, toast }); // social:
}
function drawSteps() {
  const box = $('#bpSteps'); if (!box) return drawIns();
  box.innerHTML = stepsHtml(S.g);
  wireSteps(box);
}
function wireSteps(el) {
  $$('[data-gen]', el).forEach(b => b.onclick = () => { b.disabled = true; generate(b.hasAttribute('data-force')); });
  $$('.bp-step', el).forEach(li => {
    const go = () => showStep(Number(li.dataset.step));
    li.onclick = e => { if (!e.target.closest('a')) go(); };
    li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}
function wireIns(el) {
  const bm = $('[data-buymade]', el); if (bm) bm.onclick = () => orderThis();
  wireSteps(el);
  const sh = $('[data-share]', el);
  if (sh) sh.onchange = async () => {
    sh.disabled = true;
    try { await getJSON('/api/guide/share', { method: 'POST', body: { slug: S.g.slug, on: sh.checked } }); S.g.share = sh.checked; if (sh.checked) track('guide_published', { page: 'build_page' }); }
    catch (e) { sh.checked = !sh.checked; toast(e.message); }
    drawIns();
  };
}

// Owner (or an admin, for examples): write the steps on first open and when the design changed, then poll.
async function generate(force) {
  S.g = { ...S.g, state: 'running', stage: 'writing' }; drawSteps();
  try { await getJSON('/api/guide/generate', { method: 'POST', body: { slug: S.g.slug, force } }); poll(); }
  catch (e) { S.g = { ...S.g, state: 'none', error: e.message }; drawSteps(); }
}
function poll() {
  clearTimeout(S.poll);
  S.poll = setTimeout(async () => {
    let n; try { n = await getJSON(`/build/${encodeURIComponent(S.slug)}/data.json`); } catch { return poll(); }
    S.g = n;
    if (n.state === 'running') { const s = $('.bp-gen-stage'); if (s) s.textContent = stageText(n); else drawSteps(); return poll(); }
    drawIns();
  }, 2500);
}

// ---------------------------------------------------------------- 3D viewer
async function initViewer() {
  const g = S.g;
  if (!g.has_model) return;
  const ov = $('#bpOverlay');
  try {
    const { Viewer, savedBackdrop } = await import('./viewer.js');
    const v = S.v = new Viewer($('#bpViewport'));
    showBg(savedBackdrop());
    const base = `/build/${encodeURIComponent(S.slug)}/`;
    const man = await getJSON(base + 'manifest.json');
    await v.load(man, base);
    ov.hidden = true;
    renderTree();
    import('./hover.js').then(m => { // hover tooltips: what each part is and what it costs
      m.attachHover(v, { getData: () => ({ quote: S.quotes.assembled || S.quotes.kit || null }) });
      if (S.g.quote_base) loadQuote('assembled').catch(() => {});
    }).catch(e => console.warn('hover', e));
  } catch (e) {
    console.warn('viewer', e);
    ov.innerHTML = g.thumb ? `<img class="bp-thumb" src="${esc(g.thumb)}" alt="${esc(g.title)}">` : '<div class="box"><p>The 3D view couldn’t load in this browser.</p></div>';
    ov.classList.add('bp-ov-img');
  }
}
function showBg(mode) { const b = $('#bpBg'); if (b) { $('span', b).textContent = mode === 'light' ? 'Light' : 'Dark'; b.setAttribute('aria-label', `Viewport background: ${mode}. Switch`); } }

function renderTree() {
  const v = S.v, parts = v?.parts() || [];
  const tree = $('#bpTree');
  tree.hidden = !parts.length;
  $('#bpTreeCount').textContent = parts.length || '';
  const groups = [['case', 'Printed'], ['component', 'Bought']];
  $('#bpTreeBody').innerHTML = groups.map(([grp, label]) => {
    const list = parts.filter(p => (p.group === 'component' ? 'component' : 'case') === grp);
    if (!list.length) return '';
    return `<div class="tgroup">${label}<span class="count">${list.length}</span></div>` + list.map(p => {
      const off = v.hidden.has(p.name);
      const dim = grp === 'case' && p.size ? `<span class="dim" title="Bounding box, mm">${p.size.map(n => Math.round(n)).join('×')}</span>` : '';
      return `<div class="titem ${off ? 'off' : ''}"><span class="sw" style="background:${esc(p.color)}"></span><span class="nm" title="${esc(p.name)}">${esc(p.name)}</span>${dim}
        <button class="eye" data-part="${esc(p.name)}" aria-label="${off ? 'Show' : 'Hide'} ${esc(p.name)}">${off ? IC.eyeOff : IC.eyeOn}</button></div>`;
    }).join('');
  }).join('');
  $$('#bpTreeBody .eye').forEach(b => b.onclick = e => { e.stopPropagation(); const n = b.dataset.part; v.setHidden(n, !v.hidden.has(n)); renderTree(); });
}

/** Click a step: show the parts placed up to that step, pulse the ones it adds. Click it again to show everything. */
function showStep(n) {
  const v = S.v, g = S.g;
  if (S.step === n || !v) n = null;
  S.step = n;
  $$('.bp-step').forEach(li => li.classList.toggle('on', Number(li.dataset.step) === n));
  const chip = $('#bpStepChip');
  if (!v) return;
  const all = v.parts().map(p => p.name);
  if (!n) { v.hidden.clear(); v.apply(); chip.hidden = true; renderTree(); return; }
  const upto = new Set(g.steps.filter(s => s.n <= n).flatMap(s => s.parts));
  const step = g.steps.find(s => s.n === n);
  const fresh = new Set(step?.parts || []);
  v.hidden.clear();
  if (upto.size) for (const name of all) if (!upto.has(name)) v.hidden.add(name);
  v.apply();
  for (const it of v.items) if (fresh.has(it.p.name) && it.mesh.visible) v.fadeIn(it, true);
  chip.innerHTML = `<span><b>Step ${n} of ${g.steps.length}</b> ${esc(step?.title || '')}</span><button type="button" class="btn sm" data-allparts>Show all</button>`;
  chip.hidden = false;
  $('[data-allparts]', chip).onclick = () => showStep(n);
  renderTree();
  if (isNarrow()) $('#bpModel').scrollIntoView?.({ block: 'nearest' });
}

function wireToolbar() {
  $$('.bp [data-view]').forEach(b => b.onclick = () => S.v?.setView(b.dataset.view));
  $('#bpExplode').oninput = e => S.v?.set('explode', e.target.value / 100);
  const toggle = (id, key) => { $(id).onclick = e => { const b = e.currentTarget, on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); S.v?.set(key, on); }; };
  toggle('#bpGhost', 'ghost'); toggle('#bpComp', 'showComp');
  $('#bpFit').onclick = () => S.v?.fit();
  $('#bpBg').onclick = () => { if (S.v) showBg(S.v.setBackdrop(S.v.backdrop === 'light' ? 'dark' : 'light')); };
  $('#bpRender').onclick = async () => {
    if (!S.v) return;
    const b = $('#bpRender'); b.disabled = true;
    try { S.render = !S.render; await S.v.setRender(S.render); } catch (e) { S.render = false; toast('Render mode isn’t supported in this browser'); }
    b.disabled = false; b.classList.toggle('on', S.render); b.setAttribute('aria-pressed', S.render);
    $('#bpModel').classList.toggle('rendering', S.render);
  };
  $('#bpTreeToggle').onclick = () => {
    const t = $('#bpTree');
    if (isNarrow()) { t.classList.remove('collapsed'); t.classList.toggle('open-m'); } else t.classList.toggle('collapsed');
  };
}

// ---------------------------------------------------------------- Order tab + pill
let checkoutMod;
async function loadCheckout() {
  if (checkoutMod !== undefined) return checkoutMod;
  try { checkoutMod = await import('./checkout.js'); } catch { checkoutMod = null; }
  return checkoutMod;
}
// prices: SELL_ASSEMBLED off on the server = kits only (cta.sell_assembled false); cta.orderable false = needs assembly
const kitsOnly = () => S.g?.cta?.sell_assembled === false;
const needsAssembly = () => S.g?.cta?.orderable === false;
async function loadQuote(mode) {
  if (kitsOnly()) mode = 'kit';
  if (S.quotes[mode]) return S.quotes[mode];
  const q = await getJSON(`${S.g.quote_base}?mode=${mode}`);
  S.quotes[mode] = q;
  return q;
}
function renderPill() {
  const el = $('#bpPill'), a = kitsOnly() ? S.g.cta?.kit || S.g.cta?.assembled : S.g.cta?.assembled;
  el.hidden = !(S.g.orderable && S.g.has_model && a) || S.tab === 'order';
  if (el.hidden) return;
  if (needsAssembly()) { el.innerHTML = `<span class="op-ic">${IC.cart}</span><span class="op-t"><b>Not available to order yet</b><span>This design needs assembly.</span></span>`; return; }
  el.innerHTML = `<span class="op-ic">${IC.cart}</span><span class="op-t"><b>${kitsOnly() ? 'Order the parts' : 'Order this'}</b><span>${money(a.total)} delivered · ${shipsIn(a.lead_time_days)}</span></span><span class="op-go">→</span>`;
}
// sourcing: "Where to source it" (web/sourcing.js) under the Order tab, loaded on first use
function sourcingInto(el, qty, unit) {
  const g = S.g, src = g.project ? { project: g.slug } : { example: g.slug };
  import('/sourcing.js').then(m => m.mountSourcing($('#bpSrc', el), src, { qty, builderyUnit: unit, builderyLabel: S.mode === 'kit' ? 'Premake kit' : 'Premake, assembled' })).catch(() => {});
}
async function drawOrder() {
  const el = $('#bpOrder'), g = S.g;
  if (!g.has_model) { el.innerHTML = '<div class="order-empty"><h3>No quote yet</h3><p>Pricing appears once the design has a model and a parts list.</p></div>'; return; }
  if (kitsOnly()) S.mode = 'kit';
  const mode = S.mode;
  let q = S.quotes[mode];
  if (!q) {
    el.innerHTML = `<div class="skel" style="height:56px;margin-bottom:12px"></div><div class="tiers">${Array(4).fill('<div class="skel" style="height:130px"></div>').join('')}</div>`;
    try { q = await loadQuote(mode); } catch { q = {}; } // order tab: the quote only adds the soldering iron link; the shop list comes from /api/sourcing
    if (S.mode !== mode || S.tab !== 'order') return;
  }
  S.tierIdx = Math.min(S.tierIdx, Math.max(0, (q.tiers?.length || 1) - 1));
  const [{ renderOrderView }] = await Promise.all([import('./ordertab.js')]); // order tab: same view as the studio
  if (S.tab !== 'order') return;
  renderOrderView(el, { // order tab: where to buy each part (we don't sell the parts)
    key: `${g.project ? 'project' : 'example'}:${g.slug}`, quote: q, src: g.project ? { project: g.slug } : { example: g.slug },
    title: g.title, thumb: g.thumb || '',
    buildHtml: '<button class="ot-diy gd-quiet-pub" data-tabgo="ins" type="button">Step-by-step build instructions →</button>',
    wire: root => { const b = $('[data-tabgo]', root); if (b) b.onclick = () => setTab('ins'); },
  });
}
async function checkout(tier, omit) {
  const g = S.g;
  if (!SIGNED_IN) { signIn('Sign in to order', 'You need an account to order, so we can email you when it ships.', 'order'); return; }
  const co = await loadCheckout();
  if (!co?.CHECKOUT?.enabled) { toast('Ordering opens soon.'); return; }
  const close = () => { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; };
  $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  co.openCheckout({ title: g.title, src: g.project ? { project: g.id } : { example: g.id }, mode: S.mode, tier, omit, close,
    errBox: e => `<div class="errbox"><div><b>Couldn’t start checkout</b>${esc(e?.message || 'Something went wrong.')}</div></div>` });
}
async function orderThis() {
  setTab('order');
  if (needsAssembly()) return;
  S.mode = kitsOnly() ? 'kit' : 'assembled';
}

function setTab(t) {
  S.tab = t === 'order' || t === 'modify' ? t : 'ins';
  $$('[data-bptab]').forEach(b => { const on = b.dataset.bptab === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  $('#bpIns').hidden = S.tab !== 'ins'; $('#bpOrder').hidden = S.tab !== 'order'; $('#bpModify').hidden = S.tab !== 'modify';
  $('#bpChatWrap').hidden = S.tab !== 'modify';
  // no auto-focus on narrow screens: focusing folds the viewer (typing mode) and blanks the page
  if (S.tab === 'modify' && !isNarrow()) $('#bpChatInput')?.focus({ preventScroll: true });
  if (S.tab === 'order') drawOrder();
  renderPill();
}

// ---------------------------------------------------------------- chat: remix into your projects, then open the studio
function saveDraft(text) {
  const v = JSON.stringify({ slug: S.slug, text, t: Date.now(), img: S.att ? S.att.count() : 0 });
  try { sessionStorage.setItem(DRAFT_KEY, v); } catch {}
  try { localStorage.setItem(DRAFT_KEY, v); } catch {}
}
function takeDraft() {
  let d = null;
  for (const st of [() => sessionStorage, () => localStorage]) {
    try { const x = JSON.parse(st().getItem(DRAFT_KEY) || 'null'); if (!d && x && x.slug === S.slug && Date.now() - x.t < 2 * 3600e3 && (x.text || x.img)) d = x; st().removeItem(DRAFT_KEY); } catch {}
  }
  return d;
}
async function submitChat(text) {
  const g = S.g;
  text = String(text || '').trim();
  const nImg = S.att ? S.att.count() : 0;
  if ((!text && !nImg) || S.busy) return;
  if (!SIGNED_IN) {
    saveDraft(text);
    if (nImg) await keepImages(DRAFT_KEY, S.att.blobs()); // photos survive the sign-in round trip (IndexedDB)
    signIn('Sign in to make changes', 'You get your own copy of this design, and the design agent starts on your change.', 'remix');
    return;
  }
  if (!text) text = defaultImageText(nImg);
  S.busy = true;
  const send = $('#bpSend'), ta = $('#bpChatInput');
  if (send) send.disabled = true; if (ta) ta.disabled = true;
  try {
    // with photos: make (or reuse) the project, upload them, then send the message with their ids
    track(g.is_owner ? 'change_requested' : 'remix_started', { page: 'build_page', prompt_length: text.length, has_image: nImg > 0, ...(g.is_owner ? { queued: false } : {}) }); // analytics:
    const post = async id => {
      const attachments = nImg ? (await S.att.uploadAll(id)).map(a => a.id) : undefined;
      await getJSON(`/api/projects/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text, attachments } });
    };
    if (g.is_owner) {
      await post(g.id);
      location.href = `/designs/${encodeURIComponent(g.id)}`;
      return;
    }
    const { fromShare, fromExample } = g.remix_src || {};
    const src = fromShare ? { fromShare } : { fromExample };
    let id;
    if (nImg) { id = S.remixId || (S.remixId = (await getJSON('/api/projects', { method: 'POST', body: src })).id); await post(id); }
    else id = (await getJSON('/api/projects', { method: 'POST', body: { ...src, prompt: text } })).id;
    location.href = `/designs/${encodeURIComponent(id)}`;
  } catch (e) {
    S.busy = false; if (send) send.disabled = false; if (ta) { ta.disabled = false; ta.value = text; }
    toast(e.status === 401 ? 'Sign in to make changes.' : e.message);
  }
}
function wireChat() {
  const f = $('#bpChat'); if (!f) return;
  const ta = $('#bpChatInput');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
  ta.oninput = grow;
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } };
  f.onsubmit = e => { e.preventDefault(); submitChat(ta.value); };
  S.att = attachImages({ box: $('.cbox', f), textarea: ta, strip: { before: ta }, button: { into: $('.cbar', f) }, dropLabel: 'Drop a photo to design from it' }); // no "Screenshot the 3D view" button (owner: removed)
  $$('[data-mod]').forEach(b => b.onclick = () => { ta.value = b.dataset.mod; grow(); ta.focus(); });
}

// ---------------------------------------------------------------- boot
function fitHeight() { // phones: the visible height (Safari toolbars, keyboard)
  if (!window.visualViewport) return;
  const root = document.documentElement;
  const fit = () => root.style.setProperty('--app-h', Math.round(visualViewport.height * visualViewport.scale) + 'px');
  visualViewport.addEventListener('resize', fit); fit();
}

async function boot() {
  const root = $('#buildRoot');
  let g;
  try { g = await getJSON(`/build/${encodeURIComponent(S.slug)}/data.json`); }
  catch (e) { // keep the server-rendered guide; just say what went wrong
    console.warn('guide', e);
    return;
  }
  S.g = g;
  root.innerHTML = shell(g);
  fitHeight();
  drawIns(); renderPill(); wireToolbar(); wireChat();
  $$('[data-bptab]').forEach(b => b.onclick = () => setTab(b.dataset.bptab));
  $('#bpPill').onclick = orderThis;
  const si = $('#bpSignin'); if (si) si.onclick = () => signIn('Sign in to Premake', 'Free to try. Remix this design or order one.', 'signin');
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; } });
  // back from sign-in: ?do=order opens the Order tab; ?do=remix sends the change typed before signing in (once)
  const want = new URLSearchParams(location.search).get('do');
  if (want) history.replaceState(null, '', location.pathname + location.hash);
  if (want === 'order') setTab('order');
  if (want === 'remix') setTab('modify');
  if (want === 'remix' && SIGNED_IN) {
    const d = takeDraft();
    if (d) {
      const ta = $('#bpChatInput'); if (ta) ta.value = d.text;
      const files = await takeImages(DRAFT_KEY); // photos kept before sign-in
      if (files.length && S.att) await S.att.add(files);
      submitChat(d.text);
    }
  }
  if (location.hash.startsWith('#step-')) { const n = Number(location.hash.slice(6)); setTimeout(() => $(`#step-${n}`)?.scrollIntoView({ block: 'start' }), 50); }
  // the owner opening it: write the steps the first time, and again when the design changed
  if (g.can_generate && !S.autoGen && (g.state === 'none' || g.state === 'stale') && !g.error) { S.autoGen = true; generate(g.state === 'stale' && g.can_edit); }
  else if (g.state === 'running') poll();
  initViewer();
}
if (S.slug) boot();
