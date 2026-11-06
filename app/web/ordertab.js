// The Order tab: where the money goes. We don't print or sell the parts; the tab shows one section per shop (Slant 3D for
// the printed parts, Amazon for bought parts and pre-cut extrusion, SendCutSend or the cheapest cutting shop for cut
// metal, and any other shop that is cheapest for a part), each with its price, delivery time, an Order button and its
// parts dearest first. On top: a quantity stepper (it picks the shops' price break) and "Parts about $X" (estimateTotal)
// with a thin split bar; pinned at the bottom: parts, estimated shipping, the total and one "Order everything" button
// that opens the shops one by one. Layout: option 10b of the order-panel mockups (Josh, 6 Nov).
// Used by the studio (web/app.js renderOrder, also the phone Order sheet) and the public build page (web/buildpage.js).
//
//   renderOrderView(el, ctx)
//   ctx: { key, quote, title, thumb, thumbLoading, src, wire(el), askNoMetal() }   (buildHref / buildHtml / partThumb: unused)
//   askNoMetal: studio only, your own design: sends "redesign without cut metal" to the design agent (absent = no link)
// Data: GET /api/sourcing (server/sourcing.js, via web/sourcing.js sourcingData). "Premake print" / "Premake shop model"
// are our own cost models, not places to buy, so they never show here. Checkout code (server/payments.js) is untouched,
// just not used by this tab.

import { sourcingData } from './sourcing.js';
import { amazonBasket } from './amazon.js'; // "Add N parts to Amazon basket" (exact ASINs only)
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const fileUrl = u => /^https?:\/\//i.test(u || '') || /^\/(?!\/)/.test(u || '') ? u : '';
const r2 = v => Math.round(v * 100) / 100;
/** $1,234.56 */
const money = v => (v == null || !Number.isFinite(+v)) ? '–' : '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

export const TIERS = [1, 10, 100, 500]; // the quantities /api/sourcing prices at (server/sourcing.js QTYS)
export const GROUPS = [
  { k: 'printed', label: 'Printed parts', how: 'Download the STLs and upload them all to one print shop as a single order.' },
  { k: 'metal', label: 'Cut metal and panels', how: 'Download the DXF or STEP and upload it to the cutting shop.' },
  { k: 'bought', label: 'Bought parts', how: 'Amazon first. Links without an exact product open a search. Prices marked about are estimates.' },
];
/** The Order tab's sections. Extrusion is bought pre-cut, so it sits with Bought parts (server/payments.js kitGroupOf
 * still keeps it apart for checkout). */
export const groupOf = l => l?.type === 'printed' ? 'printed' : l?.type === 'bought' ? 'bought' : l?.type === 'fabricated' ? (l.process === 'extrusion' ? 'bought' : 'metal') : null;
const isAmazon = o => /^amazon\b/i.test(String(o?.service || '')) || /^https?:\/\/([\w-]+\.)*amazon\.com\//i.test(String(o?.url || ''));

// ---------------------------------------------------------------- pure helpers (server/ordertab.test.js)
/** The shops' price break that applies at n kits: the biggest priced quantity not above n. */
export const tierFor = (n, qtys = TIERS) => qtys.reduce((t, q) => (q <= n ? q : t), qtys[0]);

/** Our own cost models (Premake print, Premake shop model): never a place to buy. */
export const isOurs = o => !!o && (o.compare || o.source === 'Premake' || /^premake\b/i.test(o.service || ''));

/** A shop's note, made readable: raw API errors become "No live price right now". */
export function cleanNote(note) {
  const s = String(note || '').trim();
  if (!s) return '';
  if (/live quote unavailable|error|invalid/i.test(s)) return 'No live price right now';
  if (/^share of the whole-set quote/i.test(s)) return '';
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

/** Every place to buy one sourcing line at n kits, best first: priced options cheapest first (a real quote wins a tie),
 * then shops still quoting, then ones that quote on their own site, in the server's order. A parts-list estimate rides on
 * the listed supplier's link (else the first plain link), marked as an estimate.
 * Each: { service, url, kind: live|estimate|pending|quote, each, usd (for every piece needed), need, lead, setup, upload, note } */
export function buyOptions(l, n = 1, qtys = TIERS) {
  const t = tierFor(n, qtys);
  const need = (Number(l?.qty_per_unit) || 1) * n;
  const raw = (l?.options || []).filter(o => !isOurs(o) && (safeUrl(o.url) || o.kind === 'pending'));
  const amzFirst = groupOf(l) === 'bought'; // bought parts: Amazon is the first option whenever there is one (Josh, 5 Nov)
  const est = Number(l?.estimate?.unit_usd);
  const unpricedAt = o => !(o.prices && o.prices[t] != null);
  let estOn = Number.isFinite(est) && est > 0
    ? (groupOf(l) === 'printed' && raw.find(o => o.service === 'Slant 3D' && unpricedAt(o))) // printed: our filament + print-time estimate on Slant until it quotes
      || (amzFirst && raw.find(o => isAmazon(o) && unpricedAt(o))) || raw.find(o => l.supplier && String(o.service).toLowerCase() === String(l.supplier).toLowerCase() && unpricedAt(o)) || raw.find(o => !o.upload && unpricedAt(o)) || null : null;
  // cut parts with no shop price at all: our shop model's number rides on the first upload shop (SendCutSend), as "about"
  let ourEach = null;
  if (!estOn && groupOf(l) === 'metal' && raw.every(unpricedAt)) {
    const ours = (l?.options || []).find(o => isOurs(o) && Number(o.prices?.[t]) > 0);
    estOn = ours ? raw.find(o => o.service === 'SendCutSend' && o.kind !== 'pending') || raw.find(o => o.upload && o.kind !== 'pending') || null : null;
    if (estOn) ourEach = +ours.prices[t];
  }
  const out = raw.map((o, i) => {
    const p = o.prices?.[t];
    const has = p != null && Number.isFinite(+p) && +p > 0; // a $0 "live" price is a failed quote, never real
    const each = has ? +p : o === estOn ? (ourEach ?? est) : null;
    const kind = has ? (o.kind === 'live' || o.kind === 'listed' ? 'live' : 'estimate') : o === estOn ? 'estimate' : o.kind === 'pending' ? 'pending' : 'quote';
    return { service: String(o.service || 'Shop'), url: safeUrl(o.url), kind, each, usd: each == null ? null : r2(each * need), need,
      lead: o.lead?.[t] || '', setup: Number(o.setup?.[t]) || 0, upload: o.upload || '', note: cleanNote(o.note), checked: o.kind === 'listed' ? o.fetched_at || null : null, i,
      amz: amzFirst && isAmazon(o) };
  });
  const rank = o => o.usd != null ? 0 : o.kind === 'pending' ? 1 : 2;
  return out.sort((a, b) => (b.amz - a.amz) || rank(a) - rank(b) || (rank(a) === 0 ? a.usd - b.usd || (a.kind === 'live' ? -1 : 0) - (b.kind === 'live' ? -1 : 0) : 0) || a.i - b.i);
}

/** "About $X": the cheapest option per part for n kits, plus each shop's per-order setup fee once. Lines with no price
 * anywhere are counted, not guessed. */
export function estimateTotal(lines, n = 1, qtys = TIERS) {
  let usd = 0, live = 0, unpriced = 0;
  const setup = new Map();
  for (const l of lines || []) {
    const b = buyOptions(l, n, qtys)[0];
    if (!b || b.usd == null) { unpriced++; continue; }
    usd += b.usd;
    if (b.kind === 'live') live += b.usd;
    if (b.setup) setup.set(b.service, b.setup);
  }
  const fees = [...setup.values()].reduce((a, v) => a + v, 0);
  usd += fees; live += fees;
  return { usd: r2(usd), live: r2(live), estimate: r2(usd - live), setup: r2(fees), unpriced, each: n > 0 ? r2(usd / n) : null };
}

/** The files a part's shops need: [{ label, href, for: 'Slant 3D or Craftcloud' }]. Printed parts: every shop takes STL. */
export function filesFor(l, opts) {
  const shops = label => (opts || []).filter(o => l.type === 'printed' ? label === 'STL' : o.upload && o.upload.includes(label)).map(o => o.service);
  return (l?.downloads || []).filter(d => fileUrl(d.href)).map(d => {
    const s = [...new Set(shops(d.label))];
    return { label: d.label, href: d.href, for: s.length ? s.slice(0, 2).join(' or ') : '' };
  });
}

export const SCS_QUOTE = 'https://app.sendcutsend.com/customer#/quote?action=builder'; // SendCutSend's own upload-and-quote page

/** The whole printed set at Slant 3D for n builds: { usd (live, incl. setup once) | null, pending, url, lead, setup }. */
export function printedSet(ls, n = 1, qtys = TIERS) {
  const slant = ls.map(l => buyOptions(l, n, qtys).find(x => x.service === 'Slant 3D')).filter(Boolean);
  const priced = ls.length > 0 && slant.length === ls.length && slant.every(o => o.usd != null);
  const setup = priced ? Math.max(0, ...slant.map(o => o.setup || 0)) : 0;
  return { usd: priced ? r2(slant.reduce((a, o) => a + o.usd, 0) + setup) : null, estimate: slant.some(o => o.kind === 'estimate'), pending: slant.some(o => o.kind === 'pending'),
    url: slant.find(o => o.url)?.url || 'https://www.slant3d.com/', lead: slant.find(o => o.lead)?.lead || '', setup };
}

/** Each cut part's file for a cutting shop, by part name: its DXF when flat, else STEP, else STL. */
export function cutFileList(ls) {
  const pick = l => { const d = (l.downloads || []).filter(x => fileUrl(x.href)); return d.find(x => x.label === 'DXF') || d.find(x => x.label === 'STEP') || d.find(x => x.label === 'STL') || null; };
  return (ls || []).map(l => ({ name: l.name, file: pick(l) })).filter(x => x.file).map(x => ({ name: x.name, label: x.file.label, href: x.file.href }));
}

/** The cut parts at n builds: SendCutSend's total (live or about; null when a part has no number) and the cheapest live shop
 * that prices every cut part. -> { n, scs: { usd, kind, url }, live: { service, usd, url } | null } */
export function cutSet(ls, n = 1, qtys = TIERS) {
  const per = ls.map(l => buyOptions(l, n, qtys));
  const scs = per.map(p => p.find(o => o.service === 'SendCutSend'));
  const scsUsd = ls.length && scs.every(o => o && o.usd != null) ? r2(scs.reduce((a, o) => a + o.usd, 0)) : null;
  let live = null;
  for (const svc of new Set(per.flat().filter(o => o.kind === 'live' && o.usd != null).map(o => o.service))) {
    const os = per.map(p => p.find(o => o.service === svc && o.kind === 'live' && o.usd != null));
    if (!os.every(Boolean)) continue;
    const usd = r2(os.reduce((a, o) => a + o.usd, 0));
    if (!live || usd < live.usd) live = { service: svc, usd, url: os.find(o => o.url)?.url || '' };
  }
  return { n: ls.length, scs: { usd: scsUsd, kind: scs.every(o => o?.kind === 'live') ? 'live' : 'estimate', url: scs.find(o => o?.url)?.url || SCS_QUOTE }, live };
}

// ---------------------------------------------------------------- shops (the "Where the money goes" layout, Josh 6 Nov)
/** Shipping per order when the shop gives us no number: Slant 3D about $9, Amazon free (over $35), SendCutSend about $12. */
export const SHIP_EST = { 'Slant 3D': 9, Amazon: 0, SendCutSend: 12 };
export const SHIP_OTHER = 10;
export const ARRIVES = { 'Slant 3D': 'Arrives in about 4 to 8 days', Amazon: 'Arrives in 1 to 2 days with Prime', SendCutSend: 'Arrives in about 5 to 8 days' };
const FIRST = ['Slant 3D', 'Amazon', 'SendCutSend'];
export const NO_SHOP = 'No shop yet';

/** The Order tab's sections, one per shop. Every part sits at the shop estimateTotal picks for it (its first buyOptions),
 * so the sections add up to that total, setup fees included; a printed part with no price anywhere goes to Slant 3D, which
 * prints the whole set. Slant 3D, Amazon, SendCutSend first, then the other shops, dearest first.
 * -> [{ shop, kind: printed|bought|metal, items: [{ line, o, need }] (dearest first), usd (null: nothing priced), setup,
 *       unpriced, url, basket (Amazon basket links), search (Amazon lines with no exact product), find (Amazon with only
 *       searches: no Order link), ship, arrives, zip }] */
export function shopSections(lines, n = 1, qtys = TIERS, src = {}) {
  const by = new Map();
  for (const l of lines || []) {
    const opts = buyOptions(l, n, qtys);
    let o = opts[0] || null;
    if (groupOf(l) === 'printed' && (!o || o.usd == null)) o = opts.find(x => x.service === 'Slant 3D') || o;
    const shop = o ? o.service : NO_SHOP;
    if (!by.has(shop)) by.set(shop, []);
    by.get(shop).push({ line: l, o, need: (Number(l?.qty_per_unit) || 1) * n });
  }
  const out = [];
  for (const [shop, items] of by) {
    items.sort((a, b) => (b.o?.usd ?? -1) - (a.o?.usd ?? -1));
    const priced = items.filter(i => i.o?.usd != null);
    const setup = priced.reduce((s, i) => (i.o.setup ? i.o.setup : s), 0); // estimateTotal: one setup fee per shop
    const usd = priced.length ? r2(priced.reduce((a, i) => a + i.o.usd, 0) + setup) : null;
    const kinds = items.map(i => groupOf(i.line));
    const kind = kinds.includes('printed') ? 'printed' : kinds.includes('metal') ? 'metal' : 'bought';
    const ls = items.map(i => i.line);
    let url = items.find(i => i.o?.url)?.o.url || '', basket = [], search = [];
    if (shop === 'Slant 3D') url = printedSet(ls.filter(l => groupOf(l) === 'printed'), n, qtys).url;
    else if (shop === 'SendCutSend') url = items.find(i => i.o?.url)?.o.url || SCS_QUOTE;
    else if (shop === 'Amazon') {
      const b = amazonBasket(ls, n);
      basket = b.urls; search = b.search;
      url = b.urls[0] || (b.search.length ? '' : url); // no exact products: no one link orders them; each part searches
    }
    const zip = kind === 'printed' ? fileUrl(src?.printed_zip || '') : kind === 'metal' ? fileUrl(src?.cut_zip || '') : '';
    const lead = items.find(i => i.o?.lead)?.o.lead || '';
    out.push({ shop, kind, items, usd, setup: r2(setup), unpriced: items.length - priced.length, url: safeUrl(url), basket, search, find: !url && search.length > 0,
      ship: shop === NO_SHOP ? 0 : SHIP_EST[shop] ?? SHIP_OTHER,
      arrives: ARRIVES[shop] || (lead ? (/day|week/i.test(lead) ? `Arrives in about ${lead}` : `Lead time ${lead}`) : ''), zip });
  }
  const rank = s => s.shop === NO_SHOP ? 99 : FIRST.includes(s.shop) ? FIRST.indexOf(s.shop) : 10;
  return out.sort((a, b) => rank(a) - rank(b) || (b.usd ?? -1) - (a.usd ?? -1));
}

/** The footer: parts (= estimateTotal), shipping per shop you order from, and the two added. */
export function orderTotals(sections, tot) {
  const ship = (sections || []).reduce((a, s) => a + s.ship, 0);
  const parts = tot?.usd ?? 0;
  return { parts, ship, total: r2(parts + ship) };
}

/** "Next: Amazon basket": what the guided Order everything list calls each shop. */
const nextLabel = s => s.find ? `find the Amazon parts (${s.items.length})` : s.shop === 'Amazon' && s.basket.length ? 'Amazon basket' : s.shop;
const countLabel = s => {
  const k = s.items.length;
  return s.kind === 'printed' ? plural(k, 'print') : s.kind === 'metal' ? plural(k, 'cut part') : plural(k, 'part');
};
const GREYS = ['#57534e', '#a8a29e', '#d6d3d1', '#78716c', '#c4c0b9', '#8f8a84', '#e7e5e4'];

// ---------------------------------------------------------------- per-design state
const states = new Map(); // design key -> { qty, open:Set, guide }
function stateFor(key) {
  if (!states.has(key)) states.set(key, { qty: 1, open: new Set(), guide: 0 });
  return states.get(key);
}

// ---------------------------------------------------------------- render
export function renderOrderView(el, ctx) {
  injectCss();
  const key = ctx.key || 'x', q = ctx.quote || {};
  const st = stateFor(key);
  const src = ctx.src ? sourcingData(ctx.src, () => { if (el.isConnected && el.dataset.otKey === key) renderOrderView(el, ctx); }) : null;
  const scroller = el.querySelector('.ot-scroll');
  const keep = el.dataset.otKey === key && scroller ? scroller.scrollTop : 0;
  el.dataset.otKey = key;
  el.classList.add('ot-host');

  const N = st.qty;
  const qtys = src?.qtys?.length ? src.qtys : TIERS;
  const lines = src?.lines || [];
  const tot = lines.length ? estimateTotal(lines, N, qtys) : null;
  const quoting = src?.status === 'quoting';
  const secs = lines.length ? shopSections(lines, N, qtys, src) : [];
  const shops = secs.filter(s => s.url || s.find);
  const sums = orderTotals(secs, tot);
  const priced = secs.filter(s => s.usd > 0);
  const colorOf = new Map(secs.map((s, i) => [s.shop, GREYS[i % GREYS.length]]));

  // head: thumbnail, name, quantity
  const head = `<div class="ot-id">${ctx.thumb !== undefined ? `<span class="ot-thumb ${ctx.thumbLoading ? 'loading' : ''}"><img ${ctx.thumb ? `src="${esc(ctx.thumb)}"` : ''} alt=""></span>` : ''}
      <div class="ot-idt"><b>${esc(ctx.title || 'This design')}</b><span>${plural(N, 'build')}</span></div>
      <div class="ot-step" role="group" aria-label="Number to build">
        <button type="button" class="ot-sb" data-ot-dec aria-label="One fewer" ${N <= 1 ? 'disabled' : ''}>${MINUS}</button>
        <input class="ot-qn num" data-ot-qty type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" value="${N}" aria-label="Number to build">
        <button type="button" class="ot-sb" data-ot-inc aria-label="One more">${PLUS}</button>
      </div></div>`;

  // parts total and the split bar
  const sum = tot ? `<div class="ot-sum">
      <div class="ot-tl"><span class="ot-mut">Parts</span><b class="num">${tot.usd > 0 ? `about ${money(tot.usd)}` : 'priced on upload'}</b></div>
      ${priced.length ? `<div class="ot-bar" aria-hidden="true">${priced.map(s => `<i style="flex:${s.usd};background:${colorOf.get(s.shop)}"></i>`).join('')}</div>` : ''}
      ${quoting ? '<p class="ot-upd">Getting live prices…</p>' : tot.unpriced ? `<p class="ot-upd">Not counted yet: ${plural(tot.unpriced, 'part')}, priced when you upload the files</p>` : ''}
    </div>` : '';

  const solder = (q.tiers || []).find(t => t.at_cost && t.addons)?.addons?.solder;
  const shopHtml = s => {
    const share = tot?.usd > 0 && s.usd > 0 ? s.usd / tot.usd * 100 : 0;
    const pct = share ? (share < 1 ? ', under 1%' : `, ${Math.round(share)}%`) : '';
    const open = st.open.has('more:' + s.shop);
    const shown = open ? s.items : s.items.slice(0, 5);
    const sub = [s.arrives, s.setup ? `Includes ${money(s.setup)} setup` : '', s.unpriced && s.usd != null ? `${plural(s.unpriced, 'part')} priced on upload` : ''].filter(Boolean);
    const extra = [];
    if (s.zip) extra.push(`<a class="ot-tlink" href="${esc(s.zip)}" download>${s.kind === 'printed' ? 'Download STLs (.zip)' : 'Download cut files (.zip)'}</a>`);
    if (s.shop === 'Amazon' && s.basket.length > 1) s.basket.slice(1).forEach((u, i) => extra.push(`<a class="ot-tlink" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-ot-basket="1">Amazon basket, part ${i + 2}</a>`));
    if (s.shop === 'Amazon' && solder?.needed && safeUrl(solder.url)) extra.push(`<a class="ot-tlink" href="${esc(solder.url)}" target="_blank" rel="noopener noreferrer">Soldering iron, if you need one (about ${money(solder.usd)})</a>`);
    if (s.kind === 'metal' && ctx.askNoMetal) extra.push(`<button type="button" class="ot-tlink" data-ot-nometal>Make these without cut metal</button>`);
    const searchNote = s.shop === 'Amazon' && s.search.length ? `<p class="ot-note">${s.search.length === s.items.length ? 'Tap a part to find it on Amazon' : `${plural(s.search.length, 'part')} not in the basket: tap ${s.search.length === 1 ? 'it' : 'each'} to search Amazon`}</p>` : '';
    const searchUrl = new Map(s.search.map(x => [x.line, safeUrl(x.url)]));
    const row = it => {
      const o = it.o, name = `${it.need > 1 ? `${it.need} x ` : ''}${it.line.name}`;
      const price = o?.usd != null ? money(o.usd) : !o ? 'not found' : o.kind === 'pending' ? 'quoting' : o.upload || it.line.type === 'printed' || it.line.type === 'fabricated' ? 'on upload' : 'see price';
      const href = searchUrl.get(it.line) || (o?.url && o.url !== s.url && !o.upload && s.shop !== 'Slant 3D' ? o.url : '');
      return `<li>${href ? `<a class="ot-pn" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(s.shop)}">${esc(name)}</a>` : `<span class="ot-pn">${esc(name)}</span>`}<span class="num ${o?.usd == null ? 'ot-mut' : ''}">${price}</span></li>`;
    };
    return `<section class="ot-shop" data-ot-sec="${esc(s.shop)}">
      <div class="ot-sh">
        <span class="ot-sq" style="background:${colorOf.get(s.shop)}" aria-hidden="true"></span>
        <div class="ot-st"><b>${esc(s.shop)}</b> <span class="ot-mut ot-sm">${countLabel(s)}${pct}</span></div>
        <span class="ot-sp num ${s.usd == null ? 'ot-mut' : ''}">${s.usd != null ? money(Math.round(s.usd)).replace(/\.00$/, '') : s.shop === NO_SHOP ? '' : 'on upload'}</span>
        ${s.url ? `<a class="ot-ob" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(s.shop)}"${s.basket.length ? ` data-ot-basket="${s.items.length}"` : ''}>Order</a>` : s.find ? `<button type="button" class="ot-ob" data-ot-find="${esc(s.shop)}">Find parts</button>` : ''}
      </div>
      ${sub.length ? `<p class="ot-arr">${esc(sub.join('. '))}</p>` : ''}
      ${searchNote}
      <ul class="ot-pl">${shown.map(row).join('')}</ul>
      ${s.items.length > 5 || extra.length ? `<div class="ot-sx">${s.items.length > 5 ? `<button type="button" class="ot-tlink" data-ot-open="more:${esc(s.shop)}" aria-expanded="${open}">${open ? 'See less' : `See more (${s.items.length - 5})`}</button>` : ''}${extra.join('')}</div>` : ''}
    </section>`;
  };

  const empty = !lines.length ? `<div class="ot-empty"><b>${src === null && !ctx.src ? 'No parts list yet' : 'Finding places to buy each part…'}</b><span>${src === null && !ctx.src ? 'Shops show up once the design has a parts list.' : 'Checking print shops, cutting shops and stores.'}</span></div>` : '';

  // footer: the money, then Order everything (a guided list after the first click: browsers block several tabs at once)
  if (st.guide > shops.length) st.guide = shops.length;
  const g = st.guide;
  const guide = !shops.length ? '' : g === 0
    ? goHtml(shops[0], 0, 'Order everything')
    : `<p class="ot-gd">${esc(`Opened ${shops.slice(0, g).map(s => s.shop).join(', ')}.`)} ${g < shops.length ? `${shops.length - g} more to go.` : 'Check out in each tab.'} <button type="button" class="ot-tlink" data-ot-reset>Start over</button></p>
      ${g < shops.length ? goHtml(shops[g], g, `Next: ${nextLabel(shops[g])}`) : ''}`;
  function goHtml(s, i, label) {
    return s.url ? `<a class="ot-primary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" data-ot-go="${i}">${esc(label)}</a>`
      : `<button type="button" class="ot-primary" data-ot-go="${i}">${esc(label)}</button>`;
  }
  const pin = tot ? `<div class="ot-pin">
      <div class="ot-fl"><span>Parts for ${plural(N, 'build')}</span><span class="num">${tot.usd > 0 ? `about ${money(sums.parts)}` : 'on upload'}</span></div>
      <div class="ot-fl"><span>Shipping, estimated</span><span class="num">about ${money(sums.ship).replace(/\.00$/, '')}</span></div>
      <div class="ot-tl ot-ftot"><span>Total</span><b class="num">about ${money(sums.total)}</b></div>
      <p class="ot-fine">Estimate. You order from each shop directly.</p>
      ${guide}
    </div>` : '';

  el.innerHTML = `<div class="ot"><div class="ot-scroll">${head}${sum}${empty}${secs.length ? `<div class="ot-shops">${secs.map(shopHtml).join('')}</div>` : ''}</div>${pin}</div>`;
  const sc = el.querySelector('.ot-scroll'); if (sc) sc.scrollTop = keep;

  // wiring
  const rerender = () => renderOrderView(el, ctx);
  const setQty = n => {
    n = Math.max(1, Math.min(99999, Math.floor(Number(n)) || 1));
    if (n === st.qty) return;
    st.qty = n; track('order_qty_changed', { qty: n }); rerender();
  };
  el.querySelector('[data-ot-dec]')?.addEventListener('click', () => setQty(st.qty - 1));
  el.querySelector('[data-ot-inc]')?.addEventListener('click', () => setQty(st.qty + 1));
  const qi = el.querySelector('[data-ot-qty]');
  if (qi) {
    qi.addEventListener('focus', () => qi.select());
    qi.addEventListener('input', () => { qi.value = qi.value.replace(/\D+/g, '').slice(0, 5); });
    qi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); qi.blur(); } });
    qi.addEventListener('change', () => setQty(qi.value));
  }
  el.querySelectorAll('[data-ot-open]').forEach(b => b.onclick = () => { const k = b.dataset.otOpen; st.open.has(k) ? st.open.delete(k) : st.open.add(k); rerender(); });
  el.querySelectorAll('a[data-ot-shop]').forEach(a => a.addEventListener('click', () => track('buy_link_opened', { shop: a.dataset.otShop })));
  el.querySelectorAll('a[data-ot-basket]').forEach(a => a.addEventListener('click', () => track('amazon_basket_opened', { items: +a.dataset.otBasket || 0 })));
  el.querySelectorAll('[data-ot-go]').forEach(a => a.addEventListener('click', () => {
    const i = +a.dataset.otGo, s = shops[i];
    track('order_everything', { step: i + 1, of: shops.length, shop: s?.shop });
    st.guide = i + 1;
    if (s?.find) st.open.add('more:' + s.shop); // Amazon with only searches: open its list, each part is a search link
    setTimeout(() => {
      rerender(); // after the link has opened its tab
      if (s?.find) el.querySelector(`[data-ot-sec="${CSS.escape(s.shop)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  }));
  el.querySelectorAll('[data-ot-find]').forEach(b => b.onclick = () => { // Amazon with only searches: the whole list, each part a search
    st.open.add('more:' + b.dataset.otFind); rerender();
    el.querySelector(`[data-ot-sec="${CSS.escape(b.dataset.otFind)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  const rs = el.querySelector('[data-ot-reset]');
  if (rs) rs.onclick = () => { st.guide = 0; rerender(); };
  const nm = el.querySelector('[data-ot-nometal]');
  if (nm) nm.onclick = () => { track('ask_no_metal', {}); ctx.askNoMetal?.(NO_METAL_PROMPT); };
  ctx.wire?.(el);
}

/** What "Make these without cut metal" sends to the design agent. */
export const NO_METAL_PROMPT = 'Redesign this without cut metal or laser-cut panels: make those parts 3D printed, or use parts you can buy on Amazon.';

const MINUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('otCss')) return;
  const st = document.createElement('style'); st.id = 'otCss';
  st.textContent = `
.pane.order.ot-host:not([hidden]),.order.ot-host:not([hidden]){display:flex!important;flex-direction:column;overflow:hidden!important;padding:0!important}
.ot{--ot-line:#e7e5e4;--ot-muted:#78716c;--ot-faint:#a8a29e;--ot-soft:#f5f5f4;--ot-acc:var(--accent,#e8590c);--ot-acc-2:var(--accent-2,#cf4c06);
  flex:1;min-height:0;display:flex;flex-direction:column;color:var(--text,#1c1917);background:#fff;font-size:14px;line-height:1.45}
.ot .num{font-variant-numeric:tabular-nums}
.ot-mut{color:var(--ot-muted)}
.ot-sm{font-size:12.5px}
.ot-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.ot-id{display:flex;align-items:center;gap:12px;padding:16px}
.ot-thumb{width:48px;height:36px;border-radius:8px;overflow:hidden;flex:none;background:var(--ot-soft);border:1px solid var(--ot-line);box-sizing:border-box}
.ot-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ot-thumb.loading img,.ot-thumb img:not([src]){visibility:hidden}
.ot-idt{flex:1;min-width:0}
.ot-idt b{display:block;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ot-idt span{display:block;font-size:13px;color:var(--ot-muted)}
.ot-step{flex:none;display:inline-flex;align-items:center;height:32px;border:1px solid var(--ot-line);border-radius:8px;background:#fff;box-sizing:border-box}
.ot-sb{all:unset;width:30px;height:30px;display:grid;place-items:center;border-radius:7px;cursor:pointer;color:var(--text,#1c1917);-webkit-tap-highlight-color:transparent}
.ot-sb:hover:not(:disabled){background:var(--ot-soft)}
.ot-sb:disabled{color:#d6d3d1;cursor:default}
.ot-qn{width:34px;height:28px;border:0;background:none;text-align:center;font:500 14px/1 var(--ui,inherit);color:inherit;padding:0;-webkit-appearance:none;appearance:none;border-radius:6px}
.ot-qn:focus{outline:2px solid var(--ot-acc);outline-offset:0}
.ot-sum{padding:0 16px 16px}
.ot-tl{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.ot-tl b{font-size:22px;font-weight:600;letter-spacing:-.01em}
.ot-sum .ot-tl{margin-bottom:8px}
.ot-bar{display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden}
.ot-bar i{display:block;min-width:3px}
.ot-upd{margin:8px 0 0;font-size:12.5px;color:var(--ot-muted)}
.ot-shops{padding:0 16px 16px}
.ot-shop{padding:12px 0;border-top:1px solid var(--ot-line)}
.ot-sh{display:flex;align-items:center;gap:12px;min-height:32px}
.ot-sq{flex:none;width:8px;height:8px;border-radius:2px}
.ot-st{flex:1;min-width:0;line-height:1.3}
.ot-st b{font-weight:500}
.ot-st span{white-space:nowrap}
.ot-sp{flex:none;white-space:nowrap}
.ot-arr{margin:0 0 0 20px;font-size:12.5px;color:var(--ot-muted)}
.ot-ob{all:unset;box-sizing:border-box;cursor:pointer;flex:none;display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 10px;border:1px solid var(--ot-line);border-radius:8px;background:#fff;color:var(--text,#1c1917);font-weight:500;font-size:13px;text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}
.ot-ob:hover{background:var(--ot-soft)}
.ot-ob:active{background:#ecebe9}
.ot-note{margin:6px 0 0 20px;font-size:12.5px;color:var(--ot-muted)}
.ot-pl{margin:8px 0 0;padding:0 0 0 20px;list-style:none}
.ot-pl li{display:flex;gap:8px;font-size:12.5px;color:var(--ot-muted);padding:2px 0}
.ot-pn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:inherit;text-decoration:none}
a.ot-pn:hover{color:var(--text,#1c1917);text-decoration:underline;text-decoration-color:var(--ot-line);text-underline-offset:3px}
.ot-sx{display:flex;flex-wrap:wrap;gap:4px 16px;padding-left:20px;margin-top:4px}
.ot-tlink{all:unset;cursor:pointer;font-size:12.5px;color:var(--text,#1c1917);text-decoration:underline;text-decoration-color:var(--ot-line);text-underline-offset:3px}
.ot-tlink:hover{text-decoration-color:var(--text,#1c1917)}
.ot-empty{margin:8px 16px;display:flex;flex-direction:column;gap:2px}
.ot-empty b{font-weight:500}
.ot-empty span{font-size:13px;color:var(--ot-muted)}
.ot-pin{flex:none;border-top:1px solid var(--ot-line);padding:12px 16px calc(14px + env(safe-area-inset-bottom,0px));background:#fff}
.ot-fl{display:flex;justify-content:space-between;gap:12px;font-size:12.5px}
.ot-fl+.ot-fl{margin-top:2px}
.ot-fl>span:first-child{color:var(--ot-muted)}
.ot-ftot{margin-top:6px}
.ot-ftot span{font-weight:600}
.ot-fine{margin:2px 0 10px;font-size:12.5px;color:var(--ot-muted)}
.ot-gd{margin:0 0 8px;font-size:12.5px;color:var(--ot-muted)}
.ot-gd .ot-tlink{margin-left:4px}
.ot-primary{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:100%;height:40px;box-sizing:border-box;border-radius:8px;background:var(--ot-acc);color:#fff;font-weight:500;font-size:14px;text-decoration:none;-webkit-tap-highlight-color:transparent}
.ot-primary:hover{background:var(--ot-acc-2)}
.ot-sb:focus-visible,.ot-ob:focus-visible,.ot-tlink:focus-visible,a.ot-pn:focus-visible{outline:2px solid var(--ot-acc);outline-offset:2px}
.ot-primary:focus-visible{outline:2px solid var(--ot-acc);outline-offset:2px}
@media (max-width:640px){.ot-id,.ot-sum,.ot-shops{padding-left:16px;padding-right:16px}.ot-ob{height:32px}.ot-pl li{padding:3px 0}.ot-primary{height:44px}}`;
  document.head.appendChild(st);
}
