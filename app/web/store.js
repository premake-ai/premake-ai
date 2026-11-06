// Website: a single-product storefront for the current design (#/site/p/<id>, #/site/examples/<slug>).
// Not about Forma. Copy comes from /api/site (Claude-generated or a template), inline-editable, saved on blur.
// The website agent (right-panel chat on the Website tab) edits site/site.json (+ site/theme.css); the page re-renders live.
import { srcKey, contrast, inkOn } from './ads.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const lumOf = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

const W = { key: null, d: null, err: null, busy: false, pubBusy: false, el: null, ctx: null, pendingDraw: false };

function theme(palettes, override) {
  const ps = (palettes || []).filter(p => p && /^#[0-9a-f]{6}$/i.test(p.bg || '') && /^#[0-9a-f]{6}$/i.test(p.accent || ''));
  const light = ps.find(p => lumOf(p.bg) > 0.75 && contrast(p.accent, p.bg) >= 3) || ps.find(p => lumOf(p.bg) > 0.75);
  const dark = ps.find(p => lumOf(p.bg) < 0.12);
  let paper = light?.bg && light.bg.toLowerCase() !== '#ffffff' ? light.bg : '#f3efe7';
  let accent = light?.accent || dark?.accent || '#d9480f';
  let ink = '#141414', night = dark?.bg || '#16171b';
  const o = override || {};
  if (o.paper) paper = o.paper;
  if (o.ink) ink = o.ink; else if (lumOf(paper) < 0.2) ink = '#f5f5f4';
  if (o.accent) accent = o.accent;
  if (o.night) night = o.night;
  if (contrast(accent, paper) < 3 && !o.accent) accent = lumOf(paper) < 0.2 ? '#f5f5f4' : '#1d1d1f';
  return { paper, ink, accent, accentInk: inkOn(accent), night, nightAccent: dark?.accent || accent, darkPaper: lumOf(paper) < 0.2 };
}

// ---------- public ----------
/** The product page for ctx.src, rendered into el (the Website tab's center pane). The chat lives in the app's right panel. */
export function renderStore(el, ctx) {
  W.el = el; W.ctx = ctx;
  const { src } = ctx;
  if (!src) { W.key = null; el.innerHTML = ''; return; }
  const key = srcKey(src);
  if (W.key !== key) {
    W.key = key; W.d = null; W.err = null; W.busy = false; W.pubBusy = false;
    load();
  }
  ensureShell();
  draw();
}

/** The website agent saved site.json / theme.css (or a run finished): refetch and re-render in place. */
export function siteChanged(id) {
  if (W.key !== 'p/' + id) return;
  load();
}
/** A render snapshot became available: redraw if the page is waiting for a hero image. */
export function heroReady() { if (W.d && !W.d.images.hero && !W.d.images.thumb) draw(); }

// ---------- data ----------
function load() {
  const key = W.key, ctx = W.ctx;
  ctx.api.site(ctx.src).then(d => { if (W.key === key) { W.d = d; W.err = null; draw(); } })
    .catch(e => { if (W.key === key && !W.d) { W.err = e; draw(); } });
}

const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
function set(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; }

// ---------- shell: the page scroller (built once per design, so scroll survives re-renders) ----------
function ensureShell() {
  const el = W.el;
  if ($(':scope > .sf-shell', el)?.dataset.key === W.key) return;
  el.innerHTML = `<div class="sf-shell" data-key="${esc(W.key)}"><div class="sf-scroll" id="sfScroll"></div><style id="sfTheme"></style></div>`;
}

// ---------- page ----------
function draw() {
  const el = W.el; if (!el) return;
  const sc = $('#sfScroll', el); if (!sc) return;
  // don't yank the page out from under an inline edit; redraw once the field loses focus
  if (document.activeElement && sc.contains(document.activeElement) && document.activeElement.isContentEditable) { W.pendingDraw = true; return; }
  W.pendingDraw = false;
  const top = sc.scrollTop;
  const openFaq = new Set($$('.sf-faq details', sc).map((x, i) => x.open ? i : -1).filter(i => i >= 0));
  const d = W.d;
  $('#sfTheme', el).textContent = d?.theme_css || '';
  if (W.err) { sc.innerHTML = `<div class="ads-empty" style="margin:60px auto"><h1>Couldn’t load this design</h1><p>${esc(W.err.message)}</p></div>`; return; }
  if (!d) { sc.innerHTML = `<div class="sf-loading"><div class="big-spin"></div></div>`; return; }
  sc.innerHTML = pageHtml(d);
  if (openFaq.size) $$('.sf-faq details', sc).forEach((x, i) => { x.open = openFaq.has(i); });
  sc.scrollTop = top;
  wirePage(sc);
}

function pageHtml(d) {
  const ctx = W.ctx;
  return `
  <div class="sf-strip">
    ${ctx.fromStore ? `<a class="sf-back" href="/store"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>Store</a>` : ''}
    <span class="sf-strip-l"><b>Product page preview</b> · click any text to edit${ctx.src?.project ? ' or ask the chat' : ''}${d.generated ? '' : ' · template copy'}</span>
    <span class="sf-strip-r">
      ${d.listable ? (d.published
        ? `<span class="sf-listed"><span class="dot"></span>Listed in store</span><a class="sf-strip-link" href="/store">View</a><button class="btn sm" id="sfPub" ${W.pubBusy ? 'disabled' : ''}>Unlist</button>`
        : `<button class="btn sm primary" id="sfPub" ${W.pubBusy || !d.has_model ? 'disabled' : ''} title="${d.has_model ? 'List this design in the Premake store' : 'Build the model first'}">Publish to store</button>`)
        : `<span class="muted">Example listing in the store</span>`}
      ${d.waitlist_count ? `<span class="muted sf-count">${d.waitlist_count} sign-up${d.waitlist_count === 1 ? '' : 's'}</span>` : ''}
      <span class="seg sf-ctaseg">${['Pre-order', 'Join the waitlist'].map(x => `<button data-cta="${x}" class="${(d.copy.cta || 'Pre-order') === x ? 'on' : ''}">${x}</button>`).join('')}</span>
      <button class="btn sm" id="sfGen" ${W.busy || !d.has_model ? 'disabled' : ''}>${W.busy ? '<span class="spin"></span>Writing…' : d.generated ? 'Regenerate copy' : 'Generate copy'}</button>
    </span>
  </div>
  ${productHtml(d)}`;
}

/** The product page itself. editable=false gives clean markup for the static export (Launch → Deploy). */
export function productHtml(d, { editable = true } = {}) {
  const c = d.copy, m = d.meta, t = theme(d.palettes, d.palette);
  const ed = editable
    ? (k, tag = 'span', cls = '') => `<${tag} class="${cls}" contenteditable="plaintext-only" spellcheck="false" data-k="${k}">${esc(get(c, k))}</${tag}>`
    : (k, tag = 'span', cls = '') => `<${tag}${cls ? ` class="${cls}"` : ''}>${esc(get(c, k))}</${tag}>`;
  const weeks = d.ship_weeks || 3;
  const cta = c.cta || 'Pre-order';
  const brand = m.title;
  const sections = (d.sections?.length ? d.sections : [{ type: 'hero' }]);
  const has = type => sections.some(s => s.type === type);
  const links = [['benefits', 'Features'], ['specs', 'Specs'], ['comparison', 'Compare'], ['faq', 'FAQ']].filter(([ty]) => has(ty));
  let body = '';
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], next = sections[i + 1];
    if ((s.type === 'specs' && next?.type === 'in-the-box') || (s.type === 'in-the-box' && next?.type === 'specs')) {
      const [a, b] = s.type === 'specs' ? [s, next] : [next, s];
      body += wrap(s, `<section class="sf-specs sf-wrap" id="sec-specs">${specsHtml(d, a)}${boxHtml(d, b)}</section>`);
      i++; continue;
    }
    body += sectionHtml(s, i, d, { c, ed, weeks, cta, brand, editable, first: sections.findIndex(x => x.type === s.type) === i });
  }
  return `<div class="sf product-page ${t.darkPaper ? 'dark-paper' : ''}" style="--paper:${t.paper};--ink:${t.ink};--acc:${t.accent};--acc-ink:${t.accentInk};--night:${t.night};--night-acc:${t.nightAccent}">
    <nav class="sf-nav"><div class="sf-wrap sf-nav-in">
      <a class="sf-mark" href="#top" data-jump="sfTop">${esc(brand)}</a>
      <div class="sf-links">${links.map(([ty, l]) => `<a href="#" data-jump="sec-${ty}">${l}</a>`).join('')}</div>
      <button class="sf-btn sm" data-order>${esc(cta)}</button>
    </div></nav>
    <div id="sfTop"></div>
    ${body}
    <footer class="sf-foot sf-wrap"><span>Designed by ${esc(m.creator || 'an independent maker')}</span><span>Powered by Premake</span></footer>
    <div class="sf-modal" id="sfModal" hidden></div>
  </div>`;
}

const wrap = (s, inner) => `<div class="sf-sec${s.style === 'dark' ? ' is-dark' : s.style === 'accent' ? ' is-accent' : ''}" data-section="${esc(s.type)}">${inner}</div>`;
const sub = s => s.subtitle ? `<p class="sf-sub">${esc(s.subtitle)}</p>` : '';

function specsHtml(d, s) {
  const dims = d.specs.dims, weeks = d.ship_weeks || 3;
  const inch = n => (n / 25.4).toFixed(1);
  return `<div>
    <h2>${esc(s?.title || 'Specs')}</h2>${s ? sub(s) : ''}
    <dl class="sf-dl">
      ${dims ? `<dt>Size</dt><dd>${dims.join(' × ')} mm<span>${dims.map(inch).join(' × ')} in, W × D × H</span></dd>` : ''}
      <dt>Material</dt><dd>${esc(d.specs.material)} printed body${d.box.hardware.length ? '<span>with off-the-shelf hardware inside</span>' : ''}</dd>
      <dt>Printed weight</dt><dd>${d.specs.grams} g<span>plastic parts, before hardware</span></dd>
      <dt>Build time</dt><dd>${shipDays(d, 'Ships in')}<span>${d.sell_assembled === false ? 'kit: parts ship to you, with step-by-step instructions' : 'made to order: printed and assembled, then shipped'}</span></dd>
      <dt>Designer</dt><dd>${esc(d.meta.creator || 'Independent maker')}</dd>
    </dl>
  </div>`;
}
function boxHtml(d, s) {
  return `<div>
    <h2>${esc(s?.title || 'What’s in the box')}</h2>${s ? sub(s) : ''}
    <div class="sf-box">
      ${d.sell_assembled === false ? (d.box.kit_ok ? `<div><h4>Kit</h4><p>${d.box.printed.length} printed parts, the hardware and step-by-step instructions. Parts ship to you.</p></div>` : '<div><h4>Not available to order yet</h4><p>This design needs assembly.</p></div>') : `<div><h4>Assembled</h4><p>One ready-to-use ${esc(d.meta.title.toLowerCase())}, fully assembled and checked.</p></div>`}
      ${d.box.kit_ok && d.sell_assembled !== false ? `<div><h4>Kit option</h4><p>${d.box.printed.length} printed parts and a bag of hardware to put together yourself.</p></div>` : ''}
      ${d.box.hardware.length ? `<div class="sf-hw"><h4>Hardware inside</h4><ul>${d.box.hardware.map(h => `<li><span>${esc(h.name)}</span><b>× ${esc(h.qty)}</b></li>`).join('')}</ul></div>` : ''}
    </div>
  </div>`;
}

/** Ship time: the quote's qty-1 lead time (same number as the studio's order pill and the Store card). */
const shipDays = (d, pre) => d.build_days ? `${pre} ${d.build_days} day${d.build_days === 1 ? '' : 's'}` : `${pre} about ${d.ship_weeks || 3} weeks`;
function sectionHtml(s, i, d, { c, ed, weeks, cta, brand, first, editable }) {
  // Hero: ads hero render, else thumb.png, else a live render snapshot in the user's colour (made on the fly)
  const hero = d.images.hero || d.images.thumb || (editable ? W.ctx?.hero?.() : null);
  if (!hero && editable && d.has_model) W.ctx?.wantHero?.();
  switch (s.type) {
    case 'hero': return wrap(s, `<header class="sf-hero sf-wrap" id="sec-hero">
      <div class="sf-hero-copy">
        ${c.headline ? ed('headline', 'h1') : `<h1>${esc(brand)}</h1>`}
        ${ed('tagline', 'p', 'sf-tag')}
        <div class="sf-buy"><div class="sf-price">${money(d.price)}</div><button class="sf-btn" data-order>${esc(cta)}</button></div>
        <ul class="sf-assure"><li>${shipDays(d, 'Ships in')}</li><li>Made to order in the USA</li><li>No payment taken today</li></ul>
      </div>
      <div class="sf-hero-img ${d.images.hero ? '' : 'thumb'}">${hero ? `<img src="${esc(hero)}" alt="${esc(brand)}">` : `<div class="sf-hero-wait">${d.has_model ? '<div class="big-spin"></div>Rendering the product…' : 'The product image appears once the model is built.'}</div>`}</div>
    </header>`);
    case 'intro': return wrap(s, `<section class="sf-intro sf-wrap" id="sec-intro">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${ed('intro', 'p')}</section>`);
    case 'benefits': return wrap(s, `<section class="sf-feats-sec sf-wrap" id="sec-benefits">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${sub(s)}
      <div class="sf-feats">${c.benefits.map((b, j) => `<div class="sf-feat"><span class="sf-n">${String(j + 1).padStart(2, '0')}</span>${ed(`benefits.${j}.title`, 'h3')}${ed(`benefits.${j}.body`, 'p')}</div>`).join('')}</div></section>`);
    case 'gallery': {
      const imgs = [d.images.low && ['', d.images.low], d.images.detail && ['crop', d.images.detail], d.images.front && ['', d.images.front]].filter(Boolean).slice(0, s.title ? 3 : 2);
      if (!imgs.length) return '';
      return wrap(s, `<section class="sf-band" id="sec-gallery"><div class="sf-wrap">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${sub(s)}<div class="sf-band-in n${imgs.length}">
        ${imgs.map(([cls, src]) => `<figure class="${cls}"><img src="${esc(src)}" alt=""></figure>`).join('')}</div></div></section>`);
    }
    case 'specs': return wrap(s, `<section class="sf-specs single sf-wrap" id="sec-specs">${specsHtml(d, s)}</section>`);
    case 'in-the-box': return wrap(s, `<section class="sf-specs single sf-wrap" id="sec-in-the-box">${boxHtml(d, s)}</section>`);
    case 'how-its-made': {
      const steps = [
        ['You order', 'Nothing is made ahead. Your order starts the build.'],
        ['Printed in PETG', `${d.specs.printed_parts || 'Several'} printed part${d.specs.printed_parts === 1 ? '' : 's'}, about ${d.build_days} day${d.build_days === 1 ? '' : 's'} on our printers.`],
        d.sell_assembled === false ? ['Shipped as a kit', 'Each part ships to you from where it’s made, with step-by-step instructions to put it together.']
          : ['Assembled and shipped', d.specs.assembly_minutes ? `About ${d.specs.assembly_minutes} minutes of hand assembly, a check, then it ships.` : 'Checked by hand, packed and shipped.'],
      ];
      return wrap(s, `<section class="sf-made" id="sec-how-its-made"><div class="sf-wrap">
        <h2>${esc(s.title || 'How it’s made')}</h2>${sub(s)}
        ${ed('made', 'p', 'sf-made-p')}
        <ol class="sf-steps">${steps.map(([h, p]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join('')}</ol>
      </div></section>`);
    }
    case 'comparison': return wrap(s, `<section class="sf-compare sf-wrap" id="${first ? 'sec-comparison' : 'sec-comparison' + i}">
      <h2>${esc(s.title)}</h2>${sub(s)}
      <div class="sf-table"><table>
        <thead><tr>${s.columns.map((h, j) => `<th scope="col"${j ? '' : ' class="rl"'}>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${s.rows.map(r => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map(x => `<td>${esc(x) || '–'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></section>`);
    case 'faq': return wrap(s, `<section class="sf-faq sf-wrap" id="sec-faq">
      <div><h2>${esc(s.title || 'Questions')}</h2>${sub(s)}</div>
      <div>${c.faq.map((f, j) => `<details ${j === 0 ? 'open' : ''}><summary>${ed(`faq.${j}.q`)}<i></i></summary>${ed(`faq.${j}.a`, 'p')}</details>`).join('')}</div>
    </section>`);
    case 'custom-text': return wrap(s, `<section class="sf-text sf-wrap" id="sec-text${i}">
      ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${sub(s)}
      <div class="sf-text-body">${String(s.body || '').split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('')}</div></section>`);
    case 'cta': return wrap(s, `<section class="sf-end" id="sec-cta"><div class="sf-wrap">
      <h2>${esc(s.title || brand)}</h2>
      <p>${s.subtitle ? esc(s.subtitle) + ' · ' : ''}${money(d.price)} · ${shipDays(d, 'ships in')}</p>
      <button class="sf-btn" data-order>${esc(cta)}</button>
    </div></section>`);
    default: return '';
  }
}

function wirePage(root) {
  const ctx = W.ctx;
  $$('[data-jump]', root).forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $$('[contenteditable][data-k]', root).forEach(n => {
    n.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); n.blur(); } };
    n.onclick = e => { if (n.closest('summary')) e.preventDefault(); };
    n.onblur = () => {
      const v = n.textContent.replace(/\s+/g, ' ').trim();
      if (!v || v === get(W.d.copy, n.dataset.k)) { n.textContent = get(W.d.copy, n.dataset.k); }
      else { set(W.d.copy, n.dataset.k, v); save(); }
      if (W.pendingDraw) setTimeout(() => { if (!(document.activeElement?.isContentEditable)) draw(); }, 0);
    };
  });
  $$('[data-cta]', root).forEach(b => b.onclick = () => { if (W.d.copy.cta === b.dataset.cta) return; W.d.copy.cta = b.dataset.cta; save(draw); draw(); });
  $$('[data-order]', root).forEach(b => b.onclick = () => openOrder(root));
  const g = $('#sfGen', root); if (g) g.onclick = generate;
  const pb = $('#sfPub', root); if (pb) pb.onclick = togglePublish;
}

async function togglePublish() {
  const ctx = W.ctx;
  if (W.pubBusy || !ctx.src?.project) return;
  const key = W.key, on = !W.d.published;
  W.pubBusy = true; draw();
  try {
    const r = await ctx.api.publish(ctx.src.project, on);
    if (W.key !== key) return;
    W.d.published = r.published;
    ctx.toast(r.published ? 'Listed in the store' : 'Removed from the store');
  } catch (e) { ctx.toast(e.message); }
  if (W.key !== key) return;
  W.pubBusy = false; draw();
}

function save(after) {
  const key = W.key, ctx = W.ctx;
  ctx.api.saveSite(ctx.src, W.d.copy).then(d => { if (W.key !== key) return; W.d.copy = d.copy; W.d.generated = d.generated; ctx.toast('Saved'); after?.(); })
    .catch(e => ctx.toast(e.message));
}

async function generate() {
  if (W.busy) return;
  const key = W.key, ctx = W.ctx;
  W.busy = true; draw();
  try { await ctx.api.generateAds(ctx.src); ctx.toast('Copy written. Ads are ready too.'); }
  catch (e) { ctx.toast(e.message); }
  if (W.key !== key) return;
  W.busy = false; load();
}

function openOrder(root) {
  const ctx = W.ctx;
  const d = W.d, cta = d.copy.cta || 'Pre-order', wait = /waitlist/i.test(cta);
  const box = $('#sfModal', root);
  box.hidden = false;
  box.innerHTML = `<div class="sf-dialog" role="dialog" aria-modal="true" aria-labelledby="sfmT">
    <button class="sf-x" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button>
    <h3 id="sfmT">${wait ? 'Join the waitlist' : `${esc(cta === 'Pre-order' ? 'Pre-order' : cta)} · ${esc(d.meta.title)}`}</h3>
    <p>${wait ? 'We’ll email you once when it’s ready to order.' : `${money(d.price)}. We’ll email you before we build yours.`}</p>
    <form id="sfForm">
      <label><span>Name</span><input name="name" required maxlength="120" autocomplete="name"></label>
      <label><span>Email</span><input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <div class="sf-demo">No payment now. We email you before anything is built.</div>
      <div class="sf-err" id="sfErr" hidden></div>
      <button class="sf-btn block" id="sfGo">${wait ? 'Join the waitlist' : 'Reserve mine'}</button>
    </form></div>`;
  const close = () => { box.hidden = true; box.innerHTML = ''; };
  box.onclick = e => { if (e.target === box || e.target.closest('[data-close]')) close(); };
  setTimeout(() => $('input[name=name]', box)?.focus(), 30);
  $('#sfForm', box).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    $('#sfGo', box).disabled = true;
    try {
      const r = await ctx.api.waitlist(ctx.src, { ...f, kind: wait ? 'waitlist' : 'preorder' });
      W.d.waitlist_count = r.count;
      $('.sf-dialog', box).innerHTML = `<button class="sf-x" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button>
        <h3>${r.already ? 'You’re already on the list' : 'You’re on the list'}</h3>
        <p>Thanks, ${esc(f.name.split(' ')[0])}. We’ll email ${esc(f.email)} before anything is built.</p>
        <div class="sf-demo">No payment was taken.</div>
        <button class="sf-btn block" data-close style="margin-top:16px">Done</button>`;
      const n = $('.sf-count', W.el); if (n) n.textContent = `${r.count} sign-up${r.count === 1 ? '' : 's'}`;
    } catch (err) {
      const x = $('#sfErr', box); x.hidden = false; x.textContent = err.message; $('#sfGo', box).disabled = false;
    }
  };
}
