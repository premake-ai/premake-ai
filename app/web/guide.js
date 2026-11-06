// Build guides: "Generate instructions" for a design (server/guide.js).
// In the studio: /designs/<x>/guide and /examples/<slug>/guide (old #/build/p|examples/<id>) via renderGuide(). Public page: /build/<slug> (auto-mounts below).
// The Order panel links here with guideLinkHtml().

import { designPath } from './nav.js'; // urls: clean URLs
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)
import { statsHtml } from './stats.js'; // card-stats: "Designed in 8 min · $6.34 each"
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n)) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => (n == null || isNaN(n)) ? '–' : '$' + Math.round(Number(n)).toLocaleString('en-US');
const howTo = t => `How to build the ${String(t).replace(/^(a|an|the)\s+/i, '').replace(/^[A-Z](?=[a-z])/, ch => ch.toLowerCase())}`; // same as server/guide.js
const days = n => `${n} day${n === 1 ? '' : 's'}`;

const ICON = {
  zip: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 2.5h7l3.5 3.5v11.5H5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 2.5V6h3.5M9 5h1.5M9 7.5h1.5M9 10h1.5M9 12.5h1.5v2H9z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  csv: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 8h14M3 12h14M8 3.5v13" stroke="currentColor" stroke-width="1.3"/></svg>',
  md: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 6h4l2 3M3 10h3M11 6h6M11 10h6M3 14h14" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>',
  dl: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2l6.5 11.5h-13z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 11.8v.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  box: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 4.5l5.5-2.5 5.5 2.5v7L8 14l-5.5-2.5zM2.5 4.5L8 7l5.5-2.5M8 7v7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  print: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  spark: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.8l1.5 4.1 4.3.2-3.4 2.7 1.2 4.2L8 10.6 4.4 13l1.2-4.2-3.4-2.7 4.3-.2z" fill="currentColor"/></svg>',
  remix: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 5h7.5a2.5 2.5 0 010 5H5M5 7.5L2.5 10 5 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const SITE = 'https://premake.ai';
const publicUrl = id => `${SITE}/build/${encodeURIComponent(id)}`;
const pubState = new Map(); // id -> true when the guide is public (examples always are)

/** The Order panel's "Build it yourself" section. cur = { kind: 'project' | 'example', id }.
 *  "Publish guide" writes the steps if needed, shares the guide and copies its premake.ai link (wired by delegation below). */
export function guideLinkHtml(cur) {
  if (!cur?.id) return '';
  const href = designPath(cur.kind === 'project' ? { project: cur.id } : { example: cur.id }, 'build'); // urls: /designs/<x>/guide
  const pub = cur.kind !== 'project' || pubState.get(cur.id) === true;
  if (cur.kind === 'project' && !pubState.has(cur.id)) setTimeout(() => refreshPub(cur.id), 0);
  return `<section class="gd-order-link" data-gd-id="${esc(cur.id)}" data-gd-kind="${cur.kind === 'project' ? 'project' : 'example'}">
    <h3>Build it yourself</h3>
    <p class="muted">Printable files, print settings, a shopping list and step-by-step instructions with pictures.</p>
    <div class="gd-pub-row">
      <button class="btn primary sm" type="button" data-gd-publish>${ICON.link}<span>${pub ? 'Copy public link' : 'Publish guide'}</span></button>
      <a class="btn sm" href="${href}">${ICON.print}Open guide</a>
    </div>
    <p class="gd-pub-status muted" ${pub ? '' : 'hidden'}>${pub ? pubLine(cur.id) : ''}</p>
  </section>`;
}
/** The Order tab's quiet footer version: a "Build it yourself (free files)" link, plus a small Publish / Copy link button. */
export function guideQuietLinkHtml(cur) {
  if (!cur?.id) return '';
  const href = designPath(cur.kind === 'project' ? { project: cur.id } : { example: cur.id }, 'build'); // urls: /designs/<x>/guide
  const pub = cur.kind !== 'project' || pubState.get(cur.id) === true;
  if (cur.kind === 'project' && !pubState.has(cur.id)) setTimeout(() => refreshPub(cur.id), 0);
  return `<div class="gd-order-link quiet" data-gd-id="${esc(cur.id)}" data-gd-kind="${cur.kind === 'project' ? 'project' : 'example'}">
    <div class="gd-quiet-row"><a class="ot-diy" href="${href}">Build it yourself (free files) →</a>
      <button class="gd-quiet-pub" type="button" data-gd-publish>${ICON.link}<span>${pub ? 'Copy public link' : 'Publish guide'}</span></button></div>
    <p class="gd-pub-status muted" ${pub ? '' : 'hidden'}>${pub ? pubLine(cur.id) : ''}</p>
  </div>`;
}
const pubLine = id => `Public at <a href="${esc(publicUrl(id))}" target="_blank" rel="noopener">${esc(publicUrl(id).replace(/^https:\/\//, ''))}</a>`;

async function refreshPub(id) {
  try { const g = await getJSON(`/build/${encodeURIComponent(id)}/data.json`); pubState.set(id, !!g.share); } catch { return; }
  for (const sec of $$(`.gd-order-link[data-gd-id="${CSS.escape(id)}"]`)) setPubUi(sec, id, pubState.get(id));
}
function setPubUi(sec, id, on, msg) {
  const label = $('[data-gd-publish] span', sec), st = $('.gd-pub-status', sec);
  if (label) label.textContent = on ? 'Copy public link' : 'Publish guide';
  if (st) { st.hidden = !(on || msg); st.innerHTML = msg || (on ? pubLine(id) : ''); }
}
/** Copy text; ClipboardItem with a promise keeps Safari's user-gesture permission across the awaits. */
function copyLater(textPromise) {
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then(t => new Blob([t], { type: 'text/plain' })) })]).then(() => true, () => false);
    }
  } catch {}
  return textPromise.then(t => navigator.clipboard.writeText(t)).then(() => true, () => false);
}
async function publish(sec, btn) {
  const id = sec.dataset.gdId, project = sec.dataset.gdKind === 'project';
  btn.disabled = true;
  const label = $('span', btn), was = label.textContent;
  label.textContent = 'Publishing…';
  let fail = null, generating = false;
  const work = (async () => {
    const g = await getJSON(`/build/${encodeURIComponent(id)}/data.json`);
    if (project && !g.share) {
      if (!g.can_edit) throw new Error('Only the owner can publish this guide.');
      await getJSON('/api/guide/share', { method: 'POST', body: { slug: id, on: true } });
      track('guide_published', { page: 'studio' }); // analytics:
    }
    if (g.can_generate && g.has_model && (g.state === 'none' || g.state === 'stale')) {
      await getJSON('/api/guide/generate', { method: 'POST', body: { slug: id, force: g.state === 'stale' && g.can_edit } }).catch(() => {});
      generating = true;
    } else if (g.state === 'running') generating = true;
    pubState.set(id, true);
    return publicUrl(id);
  })();
  work.catch(e => { fail = e; });
  const copied = await copyLater(work); // a failed publish rejects the write, so nothing is copied
  try { await work; } catch {}
  btn.disabled = false;
  if (fail) { label.textContent = was; setPubUi(sec, id, pubState.get(id), esc(fail.message)); return; }
  label.textContent = copied ? 'Link copied' : 'Copy public link';
  setPubUi(sec, id, true, `${pubLine(id)}${generating ? '. Writing the steps now, about a minute.' : ''}${copied ? '' : ` <input class="gd-pub-input" readonly value="${esc(publicUrl(id))}" aria-label="Public link">`}`);
  const inp = $('.gd-pub-input', sec); if (inp) inp.select();
  setTimeout(() => { if (label.isConnected) label.textContent = 'Copy public link'; }, 2200);
}
document.addEventListener('click', e => {
  const btn = e.target.closest?.('.gd-order-link [data-gd-publish]');
  if (btn && !btn.disabled) publish(btn.closest('.gd-order-link'), btn);
});

// ---------------------------------------------------------------- tiny markdown (wiring.md): headings, tables, lists, paragraphs
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
export function mdHtml(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      out.push(`<div class="gd-scroll"><table class="gd-table"><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const n = Math.min(4, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ol = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      out.push(`<${ol ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||#|[-*]\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}

// ---------------------------------------------------------------- data
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
const errHtml = e => `<div class="gd-err">${esc(e?.message || 'Something went wrong.')}</div>`;

let checkoutMod; // loaded on demand: web/checkout.js (Stripe order modal)
async function loadCheckout() {
  if (checkoutMod !== undefined) return checkoutMod;
  try { checkoutMod = await import('./checkout.js'); } catch { checkoutMod = null; }
  return checkoutMod;
}

// ---------------------------------------------------------------- render
const state = new Map(); // slug -> { auto: bool, poll }

/** Mount the guide for one design into el. opts: { id, kind ('p' | 'examples'), standalone } */
export async function renderGuide(el, opts) {
  const slug = opts.id;
  const st = state.get(slug) || { auto: false };
  state.set(slug, st);
  el.classList.add('gd-root');
  if (!el.firstChild || el.dataset.slug !== slug) el.innerHTML = `<div class="gd-wrap"><div class="gd-skel" style="height:260px"></div><div class="gd-skel" style="height:120px"></div></div>`;
  el.dataset.slug = slug;
  let g;
  try { g = await getJSON(`/build/${encodeURIComponent(slug)}/data.json`); }
  catch (e) {
    el.innerHTML = `<div class="gd-wrap"><div class="gd-empty"><h1>This build guide isn’t available</h1><p>${esc(e.status === 404 ? 'The link may be wrong, or the owner hasn’t shared this guide.' : e.message)}</p><a class="gd-btn" href="/">Go to Premake</a></div></div>`;
    return;
  }
  if (el.dataset.slug !== slug || !el.isConnected) return;
  draw(el, g, opts);
  if (opts.standalone) document.title = `${howTo(g.title)} · Premake`;
  // Write the steps on first open, and again when the design changed (only for people allowed to).
  if (g.can_generate && !st.auto && (g.state === 'none' || g.state === 'stale') && !g.error) { st.auto = true; startGenerate(el, g, opts, false); }
  else if (g.state === 'running') schedulePoll(el, g, opts);
}

function schedulePoll(el, g, opts) {
  const st = state.get(g.slug);
  clearTimeout(st.poll);
  st.poll = setTimeout(async () => {
    if (!el.isConnected || el.dataset.slug !== g.slug || el.hidden) return;
    let n; try { n = await getJSON(`/build/${encodeURIComponent(g.slug)}/data.json`); } catch { return schedulePoll(el, g, opts); }
    if (el.dataset.slug !== g.slug) return;
    if (n.state === 'running') { const s = $('.gd-gen-stage', el); if (s) s.textContent = stageText(n); return schedulePoll(el, n, opts); }
    draw(el, n, opts);
  }, 2500);
}

async function startGenerate(el, g, opts, force) {
  const box = $('#gdSteps', el);
  if (box) box.innerHTML = genCard({ ...g, state: 'running', stage: 'writing', started_at: Date.now() });
  try {
    await getJSON('/api/guide/generate', { method: 'POST', body: { slug: g.slug, force } });
    schedulePoll(el, g, opts);
  } catch (e) { if (box) box.innerHTML = errHtml(e) + stepsHtml(g); wireSteps(el, g, opts); }
}

const stageText = g => g.stage === 'rendering' ? 'Rendering a picture for each step' : 'Writing the steps. This takes about a minute.';
const genCard = g => `<div class="gd-gen"><span class="gd-spin"></span><div><b>Generating instructions</b><span class="gd-gen-stage">${esc(stageText(g))}</span></div></div>`;

// prices: SELL_ASSEMBLED off on the server = kits only (cta.sell_assembled false); cta.orderable false = needs assembly
const kitsOnly = c => c.sell_assembled === false;
const NA = 'Not available to order yet. This design needs assembly.';
const main = c => (kitsOnly(c) ? c.kit || c.assembled : c.assembled);
function ctaLine(c) {
  if (kitsOnly(c)) return `kit ${money0(main(c).total)}`;
  const bits = [];
  if (c.kit) bits.push(`kit ${money0(c.kit.total)}`);
  bits.push(`assembled ${money0(c.assembled.total)}`);
  return bits.join(' · ');
}
function ctaBand(g, i) {
  const c = g.cta;
  if (!c) return ''; // open-source app: no ordering from Premake unless checkout is set up (cta null)
  if (c.orderable === false) return `<aside class="gd-cta-band" aria-label="Ordering"><div><b>${NA}</b></div></aside>`;
  if (kitsOnly(c)) return `<aside class="gd-cta-band" aria-label="Order the parts instead">
    <div><b>Get the kit from Premake</b>
      <span>${esc(ctaLine(c))}, delivered. Kit: parts ship to you, with step-by-step instructions. Ships in ${days(main(c).lead_time_days)}.</span></div>
    <div class="gd-cta-btns"><button class="gd-btn primary" data-order="kit">Order the parts</button></div>
  </aside>`;
  return `<aside class="gd-cta-band" aria-label="Order it instead">
    <div><b>Skip the build: get it from Premake</b>
      <span>${esc(ctaLine(c))}, delivered. Ships in ${days(c.assembled.lead_time_days)}.</span></div>
    <div class="gd-cta-btns">${c.kit ? `<button class="gd-btn" data-order="kit">Order the parts</button>` : ''}<button class="gd-btn primary" data-order="assembled">Order assembled</button></div>
  </aside>`;
}

/** "Design your own with Premake" (public page only): a slim strip under the hero, a bigger card at the end. */
function makeCta(g, big) {
  const remix = g.remix ? `<a class="gd-btn" href="${esc(g.remix.href)}">${ICON.remix}${esc(g.remix.label)}</a>` : '';
  const go = `<a class="gd-btn ${big ? 'primary' : 'dark'}" href="${esc(g.design_url)}">${ICON.spark}Design your own</a>`;
  return big
    ? `<aside class="gd-make big"><div><h2>Design your own with Premake</h2><p>Describe a product in plain words. An AI agent models it in CAD, then you print it yourself or order it made. Start from this ${g.project ? 'design' : 'example'} or from scratch.</p></div>
        <div class="gd-make-btns">${go}${remix}</div></aside>`
    : `<aside class="gd-make"><div class="gd-make-txt"><b>Design your own with Premake</b><span>Describe a product and an AI agent models it in CAD, ready to print or order.</span></div>
        <div class="gd-make-btns">${go}${remix}</div></aside>`;
}


// wire steps (server/buildplan.js): pin to pin, with the wire colour as a swatch
const WIRE_HEX = { red: '#d93025', black: '#1c1917', white: '#f5f5f4', yellow: '#f4c20d', green: '#1e8e3e', blue: '#1a73e8', orange: '#f57c00', purple: '#8e44ad', brown: '#795548', grey: '#9e9e9e', gray: '#9e9e9e', pink: '#e91e63' };
const wiresHtml = s => (s.wires || []).length ? `<ul class="wire-list">${s.wires.map(w => `<li><i class="wire-sw" style="background:${WIRE_HEX[w.color] || '#b8b2a7'}"></i><span>${esc(w.text)}</span>${w.color && !w.guess ? `<em>${esc(w.color)}</em>` : ''}</li>`).join('')}</ul>${s.note ? `<p class="wire-note">${esc(s.note)}</p>` : ''}` : '';
function stepsHtml(g) {
  if (!g.steps.length) {
    if (g.state === 'running') return genCard(g);
    if (!g.has_model) return `<div class="gd-note">This design has no exported model yet. Instructions appear once it builds.</div>`;
    return `<div class="gd-note">${g.error ? `${esc(g.error)} ` : ''}The step-by-step instructions haven’t been written yet.${g.can_generate ? ` <button class="gd-btn sm" data-gen>Generate instructions</button>` : ''}</div>`;
  }
  const out = [];
  if (g.state === 'running') out.push(genCard(g));
  else if (g.state === 'stale') out.push(`<div class="gd-note">The design changed after these steps were written.${g.can_generate ? ` <button class="gd-btn sm" data-gen data-force>Rewrite the steps</button>` : ''}</div>`);
  else if (g.error && g.can_edit) out.push(`<div class="gd-note">Last rewrite failed: ${esc(g.error)}</div>`);
  const every = g.steps.length > 8 ? 3 : 2;
  g.steps.forEach((s, i) => {
    out.push(`<article class="gd-step" id="step-${s.n}">
      <div class="gd-step-img">${s.img ? `<a href="${esc(s.img)}" target="_blank" rel="noopener"><img src="${esc(s.img)}" alt="Step ${s.n}: ${esc(s.title)}" loading="lazy"></a>` : `<div class="gd-noimg">${ICON.box}</div>`}</div>
      <div class="gd-step-body">
        <div class="gd-step-n">Step ${s.n} of ${g.steps.length}</div>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.text)}</p>${wiresHtml(s)}
        ${s.parts.length ? `<div class="gd-chips">${s.parts.map(p => `<span class="gd-chip new">${esc(p)}</span>`).join('')}</div>` : ''}
        ${s.warning ? `<div class="gd-warn">${ICON.warn}<span>${esc(s.warning)}</span></div>` : ''}
      </div>
    </article>`);
    if ((i + 1) % every === 0 && i < g.steps.length - 1) out.push(ctaBand(g, i));
  });
  if (g.generated_at) out.push(`<p class="gd-fine">Instructions written ${esc(new Date(g.generated_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))} from the design files. Check fits as you go.${g.can_edit && g.state === 'ready' ? ` <button class="gd-link" data-gen data-force>Rewrite</button>` : ''}</p>`);
  return out.join('');
}

function draw(el, g, opts) {
  const c = g.cta, t = g.totals;
  const facts = [
    g.printed.length && `${g.printed.length} printed part${g.printed.length === 1 ? '' : 's'}`,
    t.hours && `${t.hours} h of printing`,
    t.grams && `${Math.round(t.grams)} g filament`,
    g.bought.length && `${g.bought.length} part${g.bought.length === 1 ? '' : 's'} to buy`,
    t.assembly_minutes && `about ${t.assembly_minutes} min to assemble`,
  ].filter(Boolean);
  const diyCost = g.bought_total + g.fab_total + t.grams * 0.025;
  const shareAbs = location.origin + g.share_url;
  const back = opts.standalone ? '' : `<a class="gd-back" href="${esc(designPath(g.project ? { project: g.id } : { example: g.id }))}">← Back to the design</a>`;
  el.innerHTML = `
  <header class="gd-bar">
    <div class="gd-bar-in">
      ${opts.standalone ? `<a class="gd-brand" href="/"><span class="gd-mark" aria-hidden="true"></span>Premake</a>` : back}
      <span class="gd-bar-title">${esc(g.title)}</span>
      ${!c ? '' : c.orderable === false ? `<span class="gd-bar-cta"><span class="gd-bar-txt">${NA}</span></span>`
        : `<span class="gd-bar-cta"><span class="gd-bar-txt">${kitsOnly(c) ? 'Get the kit' : 'Skip the build'}: ${esc(ctaLine(c))}, ships in ${days(main(c).lead_time_days)}</span>
        <button class="gd-btn primary sm" data-order="${kitsOnly(c) ? 'kit' : 'assembled'}">${kitsOnly(c) ? 'Order the parts' : 'Get it from Premake'}</button></span>`}
    </div>
  </header>
  <div class="gd-wrap">
    <section class="gd-hero">
      ${g.thumb ? `<div class="gd-hero-img"><img src="${esc(g.thumb)}" alt="${esc(g.title)}"></div>` : ''}
      <div class="gd-hero-txt">
        <h1>${esc(howTo(g.title))}</h1>
        ${g.description ? `<p class="gd-lede">${esc(g.description)}</p>` : ''}
        <ul class="gd-facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}${diyCost > 0 ? `<li>about ${money0(diyCost)} in parts and filament</li>` : ''}</ul>
        <div class="gd-hero-actions">
          ${g.downloads[0] ? `<a class="gd-btn primary" href="${esc(g.downloads[0].href)}" download>${ICON.dl}Download ${g.downloads[0].main ? 'everything' : esc(g.downloads[0].label.toLowerCase())}</a>` : ''}
          <button class="gd-btn" data-print>${ICON.print}Print this guide</button>
          ${g.share ? `<button class="gd-btn" data-copy>${ICON.link}Copy link</button>` : ''}
        </div>
        ${g.creator ? `<p class="gd-fine">Design by ${esc(g.creator)}</p>` : ''}
        ${statsHtml(g, 'gd-fine gd-cstats')}
      </div>
    </section>
    ${opts.standalone ? makeCta(g, false) : ''}

    ${g.project && g.can_edit ? `<section class="gd-owner">
      <label class="gd-switch"><input type="checkbox" data-share ${g.share ? 'checked' : ''}><span class="gd-track"><span></span></span>
        <span><b>Share build guide</b><span class="gd-sub">${g.share ? `Anyone with the link can see it: <a href="${esc(g.share_url)}" target="_blank" rel="noopener">${esc(shareAbs)}</a>` : 'Only you can see this guide. Turn on to get a public link.'}</span></span></label>
    </section>` : ''}

    ${!c ? '' : c.orderable === false ? `<aside class="gd-cta-hero"><div class="gd-cta-col"><b>Not available to order yet</b><span>This design needs assembly.</span></div></aside>`
      : kitsOnly(c) ? `<aside class="gd-cta-hero">
      <div class="gd-cta-col"><b>Rather not source the parts?</b><span>Kit: parts ship to you, with step-by-step instructions. US shipping included.</span></div>
      <button class="gd-price on" data-order="kit"><span>Kit</span><b>${money(main(c).total)}</b><small>Ships in ${days(main(c).lead_time_days)}</small></button>
    </aside>` : `<aside class="gd-cta-hero">
      <div class="gd-cta-col"><b>Rather not build it?</b><span>We print, pack and ship it. Made to order, US shipping included.</span></div>
      ${c.kit ? `<button class="gd-price" data-order="kit"><span>Kit</span><b>${money(c.kit.total)}</b><small>Printed parts + hardware bag</small></button>` : ''}
      <button class="gd-price on" data-order="assembled"><span>Assembled</span><b>${money(c.assembled.total)}</b><small>Ships in ${days(c.assembled.lead_time_days)}</small></button>
    </aside>`}

    <nav class="gd-toc" aria-label="On this page">
      ${g.downloads.length ? '<a href="#gd-downloads">Downloads</a>' : ''}${g.printed.length ? '<a href="#gd-print">Print settings</a>' : ''}
      ${g.fabricated.length ? '<a href="#gd-fab">Cut list</a>' : ''}${g.bought.length ? '<a href="#gd-buy">Parts to buy</a>' : ''}
      <a href="#gd-steps">Assembly</a>${g.wiring || g.firmware.length ? '<a href="#gd-wiring">Wiring and firmware</a>' : ''}
    </nav>

    ${g.downloads.length ? `<section class="gd-sec" id="gd-downloads"><h2>Downloads</h2>
      <div class="gd-dl">${g.downloads.map(d => `<a class="gd-dl-card ${d.main ? 'main' : ''}" href="${esc(d.href)}" download>
        <span class="gd-dl-ic">${ICON[d.kind] || ICON.zip}</span><span><b>${esc(d.label)}</b><small>${esc(d.sub)}</small></span><span class="gd-dl-go">${ICON.dl}</span></a>`).join('')}</div>
    </section>` : ''}

    ${g.printed.length ? `<section class="gd-sec" id="gd-print"><h2>Print settings</h2>
      <p class="gd-sub">0.4 mm nozzle. ${t.hours} h and ${Math.round(t.grams)} g in total. Any printer with a 256 mm bed fits every part.</p>
      <div class="gd-scroll"><table class="gd-table gd-print">
        <thead><tr><th>Part</th><th>Material</th><th>Layer</th><th>Walls</th><th>Infill</th><th>Orientation</th><th>Supports</th><th class="num">Time</th></tr></thead>
        <tbody>${g.printed.map(p => `<tr><td><b>${esc(p.name)}</b>${p.note ? `<div class="gd-cell-note">${esc(p.note)}</div>` : ''}${p.too_big ? '<div class="gd-cell-note warn">Larger than 256 mm: needs a big printer</div>' : ''}</td>
          <td>${esc(p.material)}</td><td>${esc(p.layer_height)}</td><td>${esc(p.walls)}</td><td>${esc(p.infill)}</td><td>${esc(p.orientation)}</td><td>${esc(p.supports)}</td>
          <td class="num">${p.hours} h<div class="gd-cell-note">${Math.round(p.grams)} g</div></td></tr>`).join('')}</tbody></table></div>
    </section>` : ''}

    ${g.fabricated.length ? `<section class="gd-sec" id="gd-fab"><h2>Cut list</h2>
      <p class="gd-sub">Parts cut or bent from stock. Send the cut list to a local shop or an online service, or make them yourself.</p>
      <div class="gd-scroll"><table class="gd-table"><thead><tr><th>Part</th><th>Process</th><th>Spec</th><th class="num">Approx stock</th></tr></thead>
        <tbody>${g.fabricated.map(f => `<tr><td><b>${esc(f.name)}</b></td><td>${esc(f.process)}</td><td>${esc(f.spec)}</td><td class="num">${f.material_usd ? money(f.material_usd) : '–'}</td></tr>`).join('')}</tbody></table></div>
    </section>` : ''}

    ${g.bought.length ? `<section class="gd-sec" id="gd-buy"><h2>Parts to buy</h2>
      <div class="gd-scroll"><table class="gd-table gd-buy"><thead><tr><th>Part</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Total</th><th>Where</th></tr></thead>
        <tbody>${g.bought.map(p => `<tr><td><b>${esc(p.name)}</b>${p.notes ? `<div class="gd-cell-note">${esc(p.notes)}</div>` : ''}</td><td class="num">${p.qty}</td><td class="num">${money(p.unit_cost)}</td><td class="num">${money(p.total)}</td>
          <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.supplier || 'Link')} ↗</a><span class="gd-print-url">${esc(p.url)}</span>` : esc(p.supplier || '')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Approximate total</td><td class="num">${money(g.bought_total)}</td><td></td></tr></tfoot></table></div>
      <p class="gd-fine">Prices are approximate and change. You’ll usually buy packs, so expect leftovers.</p>
    </section>` : ''}

    <section class="gd-sec" id="gd-steps"><h2>Assembly</h2>
      <div id="gdSteps">${stepsHtml(g)}</div>
    </section>

    ${g.wiring || g.firmware.length ? `<section class="gd-sec" id="gd-wiring"><h2>Wiring and firmware</h2>
      ${g.firmware.length ? `<div class="gd-fw"><div><b>Firmware</b><span class="gd-sub">${g.firmware.map(f => `<code>${esc(f)}</code>`).join(' ')}</span></div>
        <a class="gd-btn sm" href="/build/${encodeURIComponent(g.slug)}/firmware.zip" download>${ICON.dl}Download firmware</a></div>` : ''}
      ${g.wiring ? `<div class="gd-md">${mdHtml(g.wiring)}</div>` : ''}
    </section>` : ''}

    ${ctaBand(g)}
    ${opts.standalone ? makeCta(g, true) : ''}
    <footer class="gd-foot">Made with <a href="${esc(opts.standalone ? g.design_url : '/')}">Premake</a>.${opts.standalone ? ' <a href="/guides">More build guides</a>.' : ''} Files are for personal use. Build at your own risk: check fits, wear eye protection, and never leave electronics unattended while testing.</footer>
  </div>`;
  wire(el, g, opts);
}

function wireSteps(el, g, opts) {
  $$('[data-gen]', el).forEach(b => b.onclick = () => { b.disabled = true; startGenerate(el, g, opts, b.hasAttribute('data-force')); });
}

function wire(el, g, opts) {
  wireSteps(el, g, opts);
  $$('[data-order]', el).forEach(b => b.onclick = () => order(el, g, b.dataset.order, b));
  const pr = $('[data-print]', el); if (pr) pr.onclick = () => print();
  const cp = $('[data-copy]', el);
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(location.origin + g.share_url); cp.lastChild.textContent = 'Link copied'; }
    catch { prompt('Copy this link', location.origin + g.share_url); }
    setTimeout(() => { cp.lastChild.textContent = 'Copy link'; }, 1800);
  };
  const sh = $('[data-share]', el);
  if (sh) sh.onchange = async () => {
    sh.disabled = true;
    try { await getJSON('/api/guide/share', { method: 'POST', body: { slug: g.slug, on: sh.checked } }); pubState.set(g.slug, sh.checked); if (sh.checked) track('guide_published', { page: 'guide' }); }
    catch (e) { sh.checked = !sh.checked; alert(e.message); }
    renderGuide(el, opts);
  };
  // in-app: keep the TOC links from changing the route
  $$('.gd-toc a', el).forEach(a => a.onclick = e => { e.preventDefault(); $(a.getAttribute('href'), el)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

async function order(el, g, mode, btn) {
  const fallback = () => { location.href = g.studio_href; };
  if (!g.orderable) return fallback();
  const co = await loadCheckout();
  if (!co?.CHECKOUT?.enabled || !$('#modalBox')) return fallback();
  btn.disabled = true;
  try {
    const src = g.project ? { project: g.id } : { example: g.id };
    const q = await getJSON(`/api/quote?${g.project ? 'project' : 'example'}=${encodeURIComponent(g.id)}&mode=${mode}`);
    const tier = q.tiers.find(t => t.qty === 1) || q.tiers[0];
    const close = () => { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; };
    $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
    co.openCheckout({ title: g.title, src, mode, tier, close, errBox: errHtml });
  } catch (e) { alert(e.message); }
  btn.disabled = false;
}

// ---------------------------------------------------------------- public page: /build/<slug>
const standaloneSlug = document.body?.dataset?.guideSlug;
if (standaloneSlug) {
  const root = document.getElementById('guideRoot');
  renderGuide(root, { id: standaloneSlug, standalone: true });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; } });
}
