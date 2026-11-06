// Store (/store): a marketplace of designs other people are selling. Global, not scoped to the current design.
// Listings come from /api/store (seeded examples + projects whose product page is published).
// Clicking a card opens that design's own product page (#/site/...). No ratings, reviews or sales counts: we have none.

import { statsHtml } from './stats.js'; // card-stats: "Designed in 8 min · $6.34 each"
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const price = n => n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const SORTS = [['newest', 'Newest'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low'], ['waitlist', 'Most waitlisted']];
const CAT_ORDER = ['Fitness', 'Climbing', 'Home', 'Kitchen', 'Desk', 'Outdoor', 'Cycling', 'Pets', 'Audio', 'Lighting', 'Gaming', 'Workshop', 'Other'];

const M = { list: null, err: null, loading: false, q: '', cat: '', sort: 'newest', busy: new Set() };

export function renderMarket(el, ctx) {
  const p = ctx.params || new URLSearchParams();
  M.q = p.get('q') || '';
  M.cat = p.get('category') || '';
  M.sort = SORTS.some(([k]) => k === p.get('sort')) ? p.get('sort') : 'newest';
  if (ctx.fresh || !M.list) load(el, ctx);
  draw(el, ctx);
}

function load(el, ctx) {
  M.loading = true; M.err = null;
  ctx.api.store().then(l => { M.list = l || []; }).catch(e => { M.err = e; })
    .finally(() => { M.loading = false; if (!el.hidden) draw(el, ctx); });
}

function syncHash() { // urls: the store's filters live in the query: /store?category=&q=&sort=
  const p = new URLSearchParams();
  if (M.cat) p.set('category', M.cat);
  if (M.q.trim()) p.set('q', M.q.trim());
  if (M.sort !== 'newest') p.set('sort', M.sort);
  const h = '/store' + (p.toString() ? '?' + p : '');
  if (location.pathname + location.search !== h) history.replaceState(history.state, '', h);
}

function categories(list) {
  const n = new Map();
  for (const l of list) for (const c of l.categories || [l.category]) n.set(c, (n.get(c) || 0) + 1);
  return [...n.entries()].sort((a, b) => (CAT_ORDER.indexOf(a[0]) + 99) % 99 - (CAT_ORDER.indexOf(b[0]) + 99) % 99 || b[1] - a[1]);
}

function filtered() {
  let l = M.list || [];
  if (M.cat) l = l.filter(x => (x.categories || [x.category]).some(c => c.toLowerCase() === M.cat.toLowerCase()));
  const words = M.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) l = l.filter(x => {
    const hay = [x.title, x.tagline, x.description, x.creator, ...(x.tags || []), ...(x.categories || [])].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const by = {
    newest: (a, b) => String(b.created || '').localeCompare(String(a.created || '')),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    waitlist: (a, b) => b.waitlist_count - a.waitlist_count || String(b.created || '').localeCompare(String(a.created || '')),
  }[M.sort];
  return [...l].sort(by);
}

const ships = d => `Ships in ${d} day${d === 1 ? '' : 's'}`; // qty-1 lead time from the quote, same as the studio
const statusCls = s => /waitlist/i.test(s) ? 'wait' : /pre-order/i.test(s) ? 'pre' : 'mto';

function badges(x) {
  return `${x.demo ? '<span class="mk-badge">Example</span>' : ''}${x.kind === 'project' ? '<span class="mk-badge you">Yours</span>' : ''}`;
}
function remixBtn(x) {
  if (x.kind !== 'example') return '';
  return `<button class="mk-remix" aria-label="Remix ${esc(x.title)}" data-remix="${esc(x.id)}" ${M.busy.has(x.id) ? 'disabled' : ''} title="Copy this design into your projects and change it by chatting">
    <svg viewBox="0 0 16 16" width="13" height="13"><path d="M4 2.5v6a3 3 0 003 3h5M9.5 9L12 11.5 9.5 14M4 2.5L2 4.5M4 2.5l2 2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="mk-remix-t">${M.busy.has(x.id) ? 'Remixing…' : 'Remix'}</span></button>`;
}

function card(x) {
  return `<article class="mk-card">
    <a class="mk-img ${x.image_kind === 'render' ? 'render' : ''}" href="${esc(x.url)}" aria-label="${esc(x.title)}">
      ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ''}
      <span class="mk-badges">${badges(x)}</span>
    </a>
    ${remixBtn(x)}
    <div class="mk-body">
      <div class="mk-row"><a class="mk-title" href="${esc(x.url)}">${esc(x.title)}</a><span class="mk-price">${price(x.price)}</span></div>
      <div class="mk-by">${x.kind === 'project' ? 'by you' : `by ${esc(x.creator || 'an independent maker')}`}</div>
      ${statsHtml(x)}
      <div class="mk-meta">
        <span class="mk-status ${statusCls(x.status)}">${esc(x.status)}</span>
        <span>${ships(x.lead_time_days)}</span>
        ${x.waitlist_count > 0 ? `<span>${x.waitlist_count} on the waitlist</span>` : ''}
      </div>
    </div>
  </article>`;
}

function feature(x) {
  return `<article class="mk-feat">
    <a class="mk-feat-img ${x.image_kind === 'render' ? 'render' : ''}" href="${esc(x.url)}" aria-label="${esc(x.title)}">
      ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ''}
      <span class="mk-badges">${badges(x)}</span>
    </a>
    <div class="mk-feat-body">
      <a class="mk-feat-title" href="${esc(x.url)}">${esc(x.title)}</a>
      <p>${esc(x.tagline)}</p>
      <div class="mk-feat-foot">
        <span class="mk-price">${price(x.price)}</span>
        <span class="mk-status ${statusCls(x.status)}">${esc(x.status)}</span>
        <span class="mk-by">by ${x.kind === 'project' ? 'you' : esc(x.creator || 'an independent maker')}</span>
      </div>
      ${statsHtml(x)}
    </div>
  </article>`;
}

function draw(el, ctx) {
  const all = M.list || [];
  const list = filtered();
  const browsing = !M.q.trim() && !M.cat;
  // Recently listed: newest listings, preferring ones with a studio render. Not a popularity claim.
  const featured = browsing ? [...all].sort((a, b) => (b.image_kind === 'render') - (a.image_kind === 'render') || String(b.created || '').localeCompare(String(a.created || ''))).slice(0, 3) : [];

  if (!$('.mk', el)) shell(el, ctx);
  const s = $('#mkSearch', el);
  if (document.activeElement !== s && s.value !== M.q) s.value = M.q;

  const cats = categories(all);
  $('#mkChips', el).innerHTML = `<button class="mk-chip ${M.cat ? '' : 'on'}" data-cat="">All<span>${all.length || ''}</span></button>
    ${cats.map(([c, n]) => `<button class="mk-chip ${M.cat.toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}<span>${n}</span></button>`).join('')}`;

  const chips = $('#mkChips', el), on = $('.mk-chip.on', chips);
  if (on && (on.offsetLeft < chips.scrollLeft || on.offsetLeft + on.offsetWidth > chips.scrollLeft + chips.clientWidth)) chips.scrollLeft = on.offsetLeft - 16;

  let body;
  if (M.err && !M.list) body = `<div class="mk-empty"><h2>Couldn’t load the store</h2><p>${esc(M.err.message)}</p><button class="mk-btn" data-retry>Try again</button></div>`;
  else if (!M.list) body = `<div class="mk-grid">${Array.from({ length: 8 }, () => '<div class="mk-card skel"><div class="mk-img"></div><div class="mk-body"><i></i><i></i></div></div>').join('')}</div>`;
  else if (!list.length) body = `<div class="mk-empty"><h2>Nothing matches${M.q.trim() ? ` “${esc(M.q.trim())}”` : ''}${M.cat ? ` in ${esc(M.cat)}` : ''}</h2>
      <p>Try a broader search, or describe it and build it yourself.</p>
      <div class="mk-empty-ctas"><button class="mk-btn ghost" data-clear>Clear filters</button><a class="mk-btn" href="/">Design your own</a></div></div>`;
  else body = `<div class="mk-grid">${list.map(card).join('')}</div>`;

  $('#mkFeatured', el).innerHTML = featured.length ? `<section class="mk-featured" aria-label="Recently listed">
      <div class="mk-sec-head"><h2>Recently listed</h2></div>
      <div class="mk-feats">${featured.map(feature).join('')}</div>
    </section>` : '';
  $('#mkResults', el).innerHTML = `<div class="mk-sec-head">
      <h2>${M.cat ? esc(M.cat) : M.q.trim() ? 'Results' : 'All products'} <span class="mk-count">${M.list ? list.length : ''}</span></h2>
      <label class="mk-sort"><span>Sort</span>
        <select id="mkSort">${SORTS.map(([k, t]) => `<option value="${k}" ${M.sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
    </div>${body}`;

  $$('[data-cat]', el).forEach(b => b.onclick = () => { M.cat = b.dataset.cat; syncHash(); draw(el, ctx); });
  $('#mkSort', el).onchange = e => { M.sort = e.target.value; syncHash(); draw(el, ctx); };
  $('[data-retry]', el)?.addEventListener('click', () => load(el, ctx));
  $('[data-clear]', el)?.addEventListener('click', () => { M.q = ''; M.cat = ''; s.value = ''; syncHash(); draw(el, ctx); });
  $$('[data-remix]', el).forEach(b => b.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const slug = b.dataset.remix;
    if (M.busy.has(slug)) return;
    M.busy.add(slug); draw(el, ctx);
    try {
      const { id } = await ctx.api.createProject({ fromExample: slug });
      track('remix_started', { example: slug, project_id: id, page: 'store' }); // analytics:
      ctx.toast('Remixed into your projects');
      ctx.onRemixed?.(id);
    } catch (err) { ctx.toast(err.message); }
    M.busy.delete(slug);
    if (!el.hidden) draw(el, ctx);
  });
}

function shell(el, ctx) {
  el.innerHTML = `<div class="mk">
    <header class="mk-head"><div class="mk-wrap">
      <div class="mk-head-in">
        <div class="mk-intro">
          <h1>Things people designed, <em>made when you order</em></h1>
          <p>Independent makers list their designs here. Each one is made to order and ships as a kit, with step-by-step instructions.</p>
        </div>
        <label class="mk-search">
          <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5"/></svg>
          <input id="mkSearch" type="search" placeholder="Search products, makers, tags" aria-label="Search the store" autocomplete="off">
        </label>
      </div>
      <nav class="mk-chips" id="mkChips" aria-label="Categories"></nav>
    </div></header>
    <main class="mk-wrap mk-main">
      <div id="mkFeatured"></div>
      <section id="mkResults" aria-label="Products"></section>
      <footer class="mk-foot">
        <p>Listings marked Example are designs made by the Premake team. Prices and ship times come from the same quote you see in the studio. Everything is made to order.</p>
        <a class="mk-btn ghost" href="/">Sell your own design</a>
      </footer>
    </main>
  </div>`;
  const s = $('#mkSearch', el);
  let t;
  s.oninput = () => { clearTimeout(t); t = setTimeout(() => { M.q = s.value; syncHash(); draw(el, ctx); }, 120); };
  s.onkeydown = e => { if (e.key === 'Escape' && s.value) { s.value = ''; M.q = ''; syncHash(); draw(el, ctx); } };
}
