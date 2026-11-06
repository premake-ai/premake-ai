// phonedesigns: the phone app's root screen (<= 860 px, signed in, at /): a full-page "Designs" list, like the list in
// Apple's Notes or Freeform. Phones have no projects drawer; a design's back button comes here (web/phone.js), and
// "+ New design" pushes the New design screen at /new (web/phonehome.js). Desktop never sees any of it: #mDesigns is
// display: none outside @media (max-width: 640px) in web/phone.css, and it is only shown when phone() is true.
// Nothing here owns state: app.js loads the projects (window.__forma.state.projects) and keeps the sidebar list
// (#projList) up to date with each design's running step; this mirrors that list.
//  1. Large "Designs" title that collapses into the glass top bar's pill on scroll (body.m-ltop while it shows).
//  2. Search (more than 8 designs), then the designs newest first: thumbnail, name, "3 h ago · $5.93", a small
//     spinner and the step while the AI works on one.
//  3. Examples: a sideways row of a few examples and "See all".
//  4. "+ New design": a round orange button bottom right.
//  5. No designs yet: a friendly empty state with a big "Describe something to make" button (and the examples).
import { go, isGuest, projectPath } from './nav.js';

const phone = () => matchMedia('(max-width: 640px)').matches;
const $ = (s, el = document) => el.querySelector(s);
const S = () => window.__forma?.state || {};
const body = document.body;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, w = 20, sw = 1.6) => `<svg viewBox="0 0 20 20" width="${w}" height="${w}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  plus: svg('M10 3.5v13M3.5 10h13', 24, 2.2),
  search: svg('M8.7 14.4a5.7 5.7 0 1 0 0-11.4 5.7 5.7 0 0 0 0 11.4zM17 17l-4.2-4.2', 17, 1.8),
  chev: svg('M8 5l5 5-5 5', 15, 1.8),
  cube: svg('M10 2.8 16.5 6.4v7.2L10 17.2 3.5 13.6V6.4zM3.5 6.4 10 10l6.5-3.6M10 10v7.2', 22, 1.3),
};
// the empty state's picture: the New design stage's dashed ghost box, smaller
const GHOST = `<svg class="m-dghost" viewBox="0 0 140 132" width="104" height="98" aria-hidden="true">
  <path d="M70 14 124 42 70 70 16 42Z" fill="rgba(255,255,255,.7)"/><path d="M16 42 70 70v58L16 100Z" fill="rgba(255,255,255,.45)"/><path d="M70 70 124 42v58l-54 28Z" fill="rgba(255,255,255,.3)"/>
  <path d="M70 14 124 42 70 70 16 42ZM16 42v58l54 28 54-28V42M70 70v58" fill="none" stroke="#948f85" stroke-opacity=".85" stroke-width="1.4" stroke-dasharray="4.5 3.2" stroke-linejoin="round"/></svg>`;
const SEARCH_MIN = 9; // more than 8 designs

function ago(t) {
  if (!t) return '';
  const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return s < 60 ? 'Just now' : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const tm = p => (typeof p.updated === 'number' ? p.updated : Date.parse(p.updated)) || 0;
const thumbOf = p => p.thumb && (p.thumb.includes('?') ? p.thumb : `${p.thumb}?v=${encodeURIComponent(p.updated || '')}`);

const studio = $('#studio'), topbar = $('.topbar:not(.bp-top)');
if (studio && topbar) init();

function init() {
  const el = document.createElement('section');
  el.id = 'mDesigns'; el.className = 'm-designs'; el.hidden = true; el.setAttribute('aria-label', 'Designs');
  el.innerHTML = `<div class="m-dinner">
      <h1 class="m-dtitle">Designs</h1>
      <label class="m-dsearch" hidden>${I.search}<input type="search" placeholder="Search" aria-label="Search designs" autocomplete="off" enterkeyhint="search"></label>
      <div class="m-dlist" role="list"></div>
      <section class="m-dex" hidden aria-label="Examples"><div class="m-rhead"><h2>Examples</h2><a class="m-rall" href="/examples">See all</a></div><div class="m-rrow"></div></section>
    </div>
    <button type="button" class="m-dnew" aria-label="New design">${I.plus}</button>`;
  studio.after(el);
  const list = $('.m-dlist', el), sbox = $('.m-dsearch', el), sin = $('input', sbox), ex = $('.m-dex', el), title = $('.m-dtitle', el);

  const newDesign = () => go('/new');
  $('.m-dnew', el).onclick = newDesign;
  list.addEventListener('click', e => {
    if (e.target.closest('.m-dstart')) { newDesign(); return; }
    if (e.target.closest('.m-dretry')) { e.preventDefault(); $('#projRetry')?.click(); }
  });

  // ---------------------------------------------------------------- 2. the list
  let lastKey = '';
  function render() {
    const P = S().projects, q = sin.value.trim().toLowerCase();
    // app.js's sidebar row knows each design's live step ("Building", "Thinking") and the "Updated" dot
    const side = id => document.querySelector(`#projList a.proj[data-id="${CSS.escape(id)}"]`);
    const all = (P || []).slice().sort((a, b) => tm(b) - tm(a));
    const rows = q ? all.filter(p => String(p.title || 'Untitled design').toLowerCase().includes(q)) : all;
    const info = rows.map(p => {
      const r = side(p.id), busy = !!r?.classList.contains('busy') || !!p.running || !!p.site_running || !!p.ads_running;
      const step = busy ? (r?.querySelector('.ptime')?.textContent.trim() || 'Designing') : '';
      return { p, busy, step, fresh: !busy && !!r?.querySelector('.pnew') };
    });
    const key = [S().projectsErr ? 'err' : P ? 'ok' : 'wait', q, (S().examples || []).length,
      ...info.map(({ p, busy, step, fresh }) => [p.id, p.title, p.thumb, p.updated, p.price_each, busy, step, fresh].join('|'))].join('/');
    if (key === lastKey) return;
    lastKey = key;
    sbox.hidden = !P || P.length < SEARCH_MIN;
    el.classList.toggle('m-dempty', !!P && !P.length && !S().projectsErr);
    if (S().projectsErr) list.innerHTML = `<div class="m-dmsg">Can’t load your designs. <a href="#" class="m-dretry">Try again</a></div>`;
    else if (!P) list.innerHTML = '<div class="m-dgroup">' + '<div class="m-drow m-dskel"><span class="m-dimg"></span><span class="m-dtext"><span></span><span></span></span></div>'.repeat(3) + '</div>';
    else if (!P.length) list.innerHTML = `<div class="m-dempty-box">${GHOST}<h2>No designs yet</h2>
        <p>Describe a product in a sentence or snap a photo. Premake designs it in 3D, ready to order.</p>
        <button type="button" class="m-dstart">Describe something to make</button></div>`;
    else if (!info.length) list.innerHTML = `<div class="m-dmsg">No designs match “${esc(sin.value.trim())}”.</div>`;
    else list.innerHTML = '<div class="m-dgroup">' + info.map(({ p, busy, step, fresh }) => {
      const th = thumbOf(p), price = Number(p.price_each) > 0 ? ` · $${Number(p.price_each).toFixed(2)}` : '';
      const sub = busy ? `<span class="m-dspin" aria-hidden="true"></span>${esc(step)}` : `${fresh ? '<b class="m-dfresh">Updated</b> · ' : ''}${esc(ago(p.updated))}${price}`;
      return `<a class="m-drow${busy ? ' busy' : ''}" role="listitem" href="${esc(projectPath(p.id, p.title || ''))}"${busy ? ' aria-busy="true"' : ''}>
        <span class="m-dimg${th ? '' : ' blank'}"${th ? ` style="background-image:url('${esc(th)}')"` : ''}>${th ? '' : I.cube}</span>
        <span class="m-dtext"><span class="m-dt">${esc(p.title || 'Untitled design')}</span><span class="m-ds">${sub}</span></span>
        <span class="m-dchev">${I.chev}</span></a>`;
    }).join('') + '</div>';
    // 3. examples
    const E = (S().examples || []).slice(0, 6);
    ex.hidden = !E.length || !!q;
    $('.m-rrow', ex).innerHTML = E.map(e => `<a class="m-rcard" href="/examples/${encodeURIComponent(e.slug)}">
      <span class="m-rimg" style="background-image:url('${esc(e.thumb)}')"></span><span class="m-rt">${esc(e.title)}</span>
      <span class="m-rs">${Number(e.price_each) > 0 ? '$' + Number(e.price_each).toFixed(2) : ''}</span></a>`).join('');
  }
  sin.addEventListener('input', render);
  sin.addEventListener('keydown', e => { if (e.key === 'Enter') sin.blur(); if (e.key === 'Escape') { sin.value = ''; render(); sin.blur(); } });

  // ---------------------------------------------------------------- 1. large title -> the bar's pill
  function syncTop() {
    const t = title.getBoundingClientRect(), barH = topbar.getBoundingClientRect().height || 48;
    const top = !el.hidden && t.bottom > barH - 4;
    if (body.classList.contains('m-ltop') !== top) body.classList.toggle('m-ltop', top);
  }
  el.addEventListener('scroll', syncTop, { passive: true });

  // ---------------------------------------------------------------- show / hide
  function sync() {
    const on = phone() && !isGuest() && location.pathname === '/' && !studio.hidden && studio.classList.contains('mode-home');
    if (el.hidden === on) {
      el.hidden = !on;
      if (!on) { sin.blur(); }
    }
    body.classList.toggle('m-list', on);
    if (on) render();
    syncTop();
  }
  addEventListener('forma:route', () => { sync(); setTimeout(sync, 0); }); // now, so web/phone.js slides this screen in
  matchMedia('(max-width: 640px)').addEventListener?.('change', sync);
  new MutationObserver(sync).observe(studio, { attributes: true, attributeFilter: ['class', 'hidden'] });
  const pl = $('#projList');
  if (pl) new MutationObserver(() => { if (!el.hidden) render(); }).observe(pl, { childList: true, subtree: true });
  setInterval(() => { if (!el.hidden && !document.hidden) render(); }, 1000); // examples arriving, "3 h ago" (render skips when nothing changed)
  sync();
}
