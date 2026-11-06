// The Order tab: where to buy every part, drawn as an iOS grouped list. We don't print or sell the parts; for each part
// (printed / cut metal and panels / extrusion / bought) it lists the places that sell or make it, cheapest first, with
// the file to upload (STL / STEP / DXF) right next to the shop link, the rest under "More options". On top: a quantity
// stepper (it picks the shops' price break) and an "about $X" estimate: the cheapest option per part, before shipping.
// Used by the studio (web/app.js renderOrder, also the phone Order sheet) and the public build page (web/buildpage.js).
//
//   renderOrderView(el, ctx)
//   ctx: { key, quote, title, thumb, thumbLoading, src, buildHref, buildHtml, partThumb(name), wire(el), askNoMetal() }
//   askNoMetal: studio only, your own design: sends "redesign without cut metal" to the design agent (absent = no button)
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
export const PICKS = [1, 5, 10, 50, 100];
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

/** The "Buy" group under How many: one row per shop that covers a whole section, cheapest live metal shop first when it
 * beats SendCutSend. Each: { shop, title, sub, usd, kind: live|estimate|pending|quote, url, files?: {href, label}, steps?, find? } */
export function buyGroup(lines, n = 1, qtys = TIERS, src = {}) {
  const by = k => (lines || []).filter(l => groupOf(l) === k);
  const rows = [];
  const pr = by('printed');
  if (pr.length) {
    const p = printedSet(pr, n, qtys);
    rows.push({ shop: 'Slant 3D', title: `Slant 3D · all ${plural(pr.length, 'printed part')}`, usd: p.usd, url: p.url,
      kind: p.usd != null ? 'live' : p.pending ? 'pending' : 'quote',
      sub: [p.usd != null ? 'Live quote' : p.pending ? 'Getting a live quote' : 'Upload the STLs for a price', p.lead, p.setup ? `incl. ${money(p.setup)} setup` : ''].filter(Boolean).join(' · '),
      files: fileUrl(src?.printed_zip || '') ? { href: src.printed_zip, label: `Download ${plural(pr.length, 'STL')}` } : null });
  }
  const cut = by('metal');
  if (cut.length) {
    const c = cutSet(cut, n, qtys);
    const zip = fileUrl(src?.cut_zip || '') ? { href: src.cut_zip, label: `Download ${plural(cut.length, 'file')}` } : null;
    const scsRow = { shop: 'SendCutSend', title: `SendCutSend · ${plural(cut.length, 'cut part')}`, usd: c.scs.usd, url: c.scs.url, kind: c.scs.usd != null ? c.scs.kind : 'quote',
      sub: 'Download the files, then upload them on the quote page', files: zip, steps: true };
    if (c.live && (c.scs.usd == null || c.live.usd < c.scs.usd)) {
      rows.push({ shop: c.live.service, title: `${c.live.service} · all ${plural(cut.length, 'cut part')}`, usd: c.live.usd, url: c.live.url, kind: 'live',
        sub: 'Live quote · upload the STEP files there', files: zip ? { href: zip.href + '&want=step', label: 'Download STEPs' } : null });
    }
    rows.push(scsRow);
  }
  const bought = by('bought');
  if (bought.length) {
    const { basket, search, urls } = amazonBasket(bought, n);
    const about = items => { let u = 0, k = 0; for (const it of items) { const b = buyOptions(it.line, n, qtys).find(o => o.amz); if (b?.usd != null) { u += b.usd; k++; } } return k ? r2(u) : null; };
    urls.forEach((u, i) => rows.push({ shop: 'Amazon', title: `Amazon · add ${plural(basket.length, 'part')} to basket${urls.length > 1 ? ` (${i + 1} of ${urls.length})` : ''}`,
      sub: 'Amazon asks you to confirm before adding', usd: about(basket), kind: 'estimate', url: u, basket: basket.length }));
    if (search.length) rows.push({ shop: 'Amazon', title: `Amazon · find ${plural(search.length, basket.length ? 'more part' : 'part')}`,
      sub: 'No exact product yet: each opens an Amazon search', usd: about(search), kind: 'estimate', url: '', find: search.length });
  }
  return rows;
}

// ---------------------------------------------------------------- per-design state
const states = new Map(); // design key -> { qty, open:Set }
function stateFor(key) {
  if (!states.has(key)) states.set(key, { qty: 1, open: new Set() });
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

  // head
  const head = `<div class="ot-id">${ctx.thumb !== undefined ? `<span class="ot-thumb ${ctx.thumbLoading ? 'loading' : ''}"><img ${ctx.thumb ? `src="${esc(ctx.thumb)}"` : ''} alt=""></span>` : ''}
      <div><b>${esc(ctx.title || 'This design')}</b><span>Every part, and where to buy it</span></div></div>`;

  // quantity
  const qtySec = `<div class="ot-gh">How many</div>
    <div class="ot-g">
      <div class="ot-row ot-qrow">
        <div class="ot-step" role="group" aria-label="Quantity">
          <button type="button" class="ot-sb" data-ot-dec aria-label="One fewer" ${N <= 1 ? 'disabled' : ''}>${MINUS}</button>
          <input class="ot-qn num" data-ot-qty type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" value="${N}" aria-label="Number to build">
          <button type="button" class="ot-sb" data-ot-inc aria-label="One more">${PLUS}</button>
        </div>
        <div class="ot-each">${tot ? `<b class="num">${money(tot.each)}</b><span>about, each${N > 1 ? ` at ${N}` : ''}</span>` : ''}</div>
      </div>
      <div class="ot-row ot-picks">${PICKS.map(n => `<button type="button" class="ot-pk ${N === n ? 'on' : ''}" data-ot-pick="${n}" aria-pressed="${N === n}">${n}</button>`).join('')}</div>
    </div>`;

  // buy: one row per shop that covers a whole section
  const buys = lines.length ? buyGroup(lines, N, qtys, src) : [];
  const buySec = buys.length ? `<div class="ot-gh">Buy</div><div class="ot-g ot-buy">${buys.map(buyRowHtml).join('')}</div>` : '';

  // (no separate "Estimated cost" box: the total sits in the bar at the bottom, Josh 6 Nov)

  // parts, by group
  const groups = GROUPS.map(g => ({ ...g, ls: lines.filter(l => groupOf(l) === g.k) })).filter(g => g.ls.length);
  const solder = (q.tiers || []).find(t => t.at_cost && t.addons)?.addons?.solder;
  const top = g => g.k === 'printed' ? printedSetHtml(g.ls, N, qtys, st, src) : g.k === 'bought' ? basketHtml(g.ls, N, qtys, st) : g.k === 'metal' ? cutSetHtml(g.ls, N, qtys, st, src) : '';
  const rows = g => g.k === 'printed' ? eachPartHtml(g.ls, N, qtys, st) : g.ls.map(l => partHtml(l, N, qtys, st)).join('');
  const partSecs = groups.map(g => `<div class="ot-gh" data-ot-sec="${g.k}"><span>${esc(g.label)}</span><span>${plural(g.ls.length, 'part')}</span></div>
    ${top(g)}
    <div class="ot-g">${rows(g)}
      ${g.k === 'bought' && solder?.needed && safeUrl(solder.url) ? `<a class="ot-row ot-opt ot-link" href="${esc(solder.url)}" target="_blank" rel="noopener noreferrer">
        <span class="ot-pth ic">${IRON}</span>
        <span class="ot-rt"><b>Soldering iron, if you need one</b><span>Cordless USB kit with solder, Amazon · about ${money(solder.usd)}</span></span>
        <i class="ot-ext">${EXT}</i></a>` : ''}
    </div>
    <p class="ot-gf">${esc(g.how)}</p>
    ${g.k === 'metal' && ctx.askNoMetal ? `<div class="ot-g ot-gap"><button type="button" class="ot-row ot-rb ot-act" data-ot-nometal>
      <span class="ot-rt"><b>Ask Premake to not use cut metal</b><span>Redesign these as 3D printed parts or parts you can buy on Amazon</span></span><i class="ot-chev">${CHEV}</i></button></div>` : ''}`).join('');

  const empty = !lines.length ? `<div class="ot-g" style="margin-top:22px"><div class="ot-row"><span class="ot-rt"><b>${src === null && !ctx.src ? 'No parts list yet' : 'Finding places to buy each part…'}</b><span>${src === null && !ctx.src ? 'Shops show up once the design has a parts list.' : 'Checking print shops, cutting shops and stores.'}</span></span></div></div>` : '';

  const foot = `<div class="ot-more">
    ${ctx.buildHtml || (ctx.buildHref ? `<a class="ot-diy" href="${esc(ctx.buildHref)}">Step-by-step build instructions →</a>` : '')}
    <details class="ot-how"><summary>Where the prices come from</summary>
      <p>Live prices come straight from the shop’s own quote (Slant 3D, RMFG and others). Prices marked about are estimates, from the parts list or a typical price, so check on the shop’s site. Shops without a price give an instant quote once you upload the file. Shipping and tax are extra and set by each shop.${src?.slant?.error ? ` Slant 3D: ${esc(cleanNote(src.slant.error))}.` : ''}</p>
    </details></div>`;

  const pin = tot ? `<div class="ot-pin"><div class="ot-tot"><span>${quoting ? '<span class="ot-upd">Getting live prices…</span>' : `Estimate for ${plural(N, 'build')}`}</span><b class="num">about ${money(tot.usd)}</b></div>
    <p class="ot-fine">Cheapest option per part, before shipping. You buy from each shop directly.</p></div>` : '';

  el.innerHTML = `<div class="ot"><div class="ot-scroll">${head}${qtySec}${buySec}${empty}${partSecs}${foot}</div>${pin}</div>`;
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
  el.querySelectorAll('[data-ot-pick]').forEach(b => b.onclick = () => setQty(+b.dataset.otPick));
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
  el.querySelectorAll('[data-ot-find]').forEach(b => b.onclick = () => {
    st.open.add('amzsearch'); rerender();
    el.querySelector('[data-ot-open="amzsearch"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  const nm = el.querySelector('[data-ot-nometal]');
  if (nm) nm.onclick = () => { track('ask_no_metal', {}); ctx.askNoMetal?.(NO_METAL_PROMPT); };
  ctx.wire?.(el);
  fillThumbs(el, ctx);
}

/** What "Ask Premake to not use cut metal" sends to the design agent. */
export const NO_METAL_PROMPT = 'Redesign this without cut metal or laser-cut panels: make those parts 3D printed, or use parts you can buy on Amazon.';

/** Printed parts: one order for the whole set (Slant 3D, the zip of every STL), other print shops as whole-set links. */
function printedSetHtml(ls, N, qtys, st, src) {
  const per = ls.map(l => buyOptions(l, N, qtys));
  const { usd, estimate, pending, url, lead, setup } = printedSet(ls, N, qtys);
  const sub = ['Slant 3D', lead, setup ? `incl. ${money(setup)} setup` : '', usd != null && !estimate ? 'live quote' : usd != null ? 'estimate until Slant quotes' : pending ? 'getting a live quote' : 'quote when you upload the STLs'].filter(Boolean).join(' · ');
  const others = [], seen = new Set(['Slant 3D']);
  for (const o of per.flat()) if (!seen.has(o.service) && o.url && o.kind !== 'pending') { seen.add(o.service); others.push(o); }
  const more = st.open.has('printshops');
  const zip = fileUrl(src?.printed_zip || '');
  return `<div class="ot-g ot-set">
    <a class="ot-row ot-opt ot-link ot-hero" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="Slant 3D">${logo('Slant 3D')}
      <span class="ot-rt"><b>Order all ${plural(ls.length, 'printed part')}</b><span>${esc(sub)}</span></span>
      <span class="ot-amt num ${usd == null ? 'muted' : ''}">${usd != null ? `${estimate ? '<small>about</small> ' : ''}${money(usd)}` : pending ? 'Quoting…' : 'Upload for price'}</span><i class="ot-ext">${EXT}</i></a>
    ${zip ? `<a class="ot-row ot-opt ot-link" href="${esc(zip)}" download>
      <span class="ot-logo file" aria-hidden="true">${DL}</span>
      <span class="ot-rt"><b>Download all STLs (.zip)</b><span>Upload them to Slant 3D, or any shop below, as one order</span></span></a>` : ''}
    ${others.length ? `<div class="ot-cell ${more ? 'open' : ''}"><button type="button" class="ot-row ot-rb ot-opt ot-mrow" data-ot-open="printshops" aria-expanded="${more}">
      <span class="ot-rt"><b>Other print shops</b><span>${esc(others.map(o => o.service).slice(0, 4).join(', '))}${others.length > 4 ? '…' : ''}</span></span>
      <span class="ot-amt muted num">${others.length}</span><i class="ot-chev">${CHEV}</i></button>
      ${more ? others.map(o => `<a class="ot-row ot-opt ot-link ot-sub" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(o.service)}">${logo(o.service)}
        <span class="ot-rt"><b>${esc(o.service)}</b><span>${esc([o.note, 'upload the whole set for one quote'].filter(Boolean).join(' · '))}</span></span><i class="ot-ext">${EXT}</i></a>`).join('') : ''}</div>` : ''}
  </div>`;
}
/** One Buy row: the shop link (whole row), and under it the files to upload; SendCutSend gets numbered steps. */
function buyRowHtml(b) {
  const amt = b.usd != null ? `${b.kind === 'estimate' ? '<small>about</small> ' : ''}${money(b.usd)}` : b.kind === 'pending' ? 'Quoting…' : b.find ? '' : 'Upload for price';
  const inner = `${logo(b.shop)}<span class="ot-rt"><b>${esc(b.title)}</b><span>${esc(b.sub)}</span></span>
      <span class="ot-amt num ${b.usd == null ? 'muted' : ''}">${amt}</span>`;
  const main = b.find
    ? `<button type="button" class="ot-row ot-rb ot-opt ot-hero" data-ot-find="${b.find}">${inner}<i class="ot-chev">${CHEV}</i></button>`
    : `<a class="ot-row ot-opt ot-link ot-hero" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(b.shop)}"${b.basket ? ` data-ot-basket="${b.basket}"` : ''}>${inner}<i class="ot-ext">${EXT}</i></a>`;
  const btns = b.steps
    ? `<div class="ot-btns">${b.files ? `<a class="ot-btn" href="${esc(b.files.href)}" download>1. ${esc(b.files.label)}</a>` : ''}<a class="ot-btn" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(b.shop)}">${b.files ? '2. ' : ''}Open quote page</a></div>`
    : b.files ? `<div class="ot-btns"><a class="ot-btn" href="${esc(b.files.href)}" download>${esc(b.files.label)}</a><a class="ot-btn" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(b.shop)}">Open ${esc(b.shop)}</a></div>` : '';
  return `<div class="ot-cell ot-bcell">${main}${btns}</div>`;
}

/** Cut parts: SendCutSend in two steps (download every file, open the quote page), each part's own file listed by name. */
function cutSetHtml(ls, N, qtys, st, src) {
  const c = cutSet(ls, N, qtys);
  const files = cutFileList(ls);
  const zip = fileUrl(src?.cut_zip || '');
  const open = st.open.has('cutfiles');
  const amt = c.scs.usd != null ? `${c.scs.kind === 'estimate' ? '<small>about</small> ' : ''}${money(c.scs.usd)}` : 'Upload for price';
  return `<div class="ot-g ot-set">
    ${zip ? `<a class="ot-row ot-opt ot-link ot-hero" href="${esc(zip)}" download>
      <span class="ot-logo file" aria-hidden="true">${DL}</span>
      <span class="ot-rt"><b>1. Download all ${plural(ls.length, 'file')} (.zip)</b><span>DXF for flat parts, STEP for the rest</span></span></a>` : ''}
    ${files.length ? `<div class="ot-cell ${open ? 'open' : ''}"><button type="button" class="ot-row ot-rb ot-opt ot-mrow" data-ot-open="cutfiles" aria-expanded="${open}">
      <span class="ot-rt"><b>Files in the zip</b><span>${esc(files.map(f => f.name).slice(0, 3).join(', '))}${files.length > 3 ? '…' : ''}</span></span>
      <span class="ot-amt muted num">${files.length}</span><i class="ot-chev">${CHEV}</i></button>
      ${open ? files.map(f => `<a class="ot-row ot-opt ot-link ot-sub" href="${esc(f.href)}" download>
        <span class="ot-rt"><b>${esc(f.name)}</b><span>${esc(f.label)} file</span></span><i class="ot-ext">${DL}</i></a>`).join('') : ''}</div>` : ''}
    <a class="ot-row ot-opt ot-link ot-hero" href="${esc(c.scs.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="SendCutSend">${logo('SendCutSend')}
      <span class="ot-rt"><b>${zip ? '2. ' : ''}Open SendCutSend</b><span>Upload the files on its quote page for the exact price${c.scs.usd != null && c.scs.kind === 'estimate' ? ' · ours is an estimate' : ''}</span></span>
      <span class="ot-amt num ${c.scs.usd == null ? 'muted' : ''}">${amt}</span><i class="ot-ext">${EXT}</i></a>
  </div>`;
}

/** Printed parts, one by one: folded under one row so the set reads as one order. */
function eachPartHtml(ls, N, qtys, st) {
  const open = st.open.has('eachprinted');
  return `<div class="ot-cell ${open ? 'open' : ''}"><button type="button" class="ot-row ot-rb ot-mrow ot-each-row" data-ot-open="eachprinted" aria-expanded="${open}">
      <span class="ot-rt"><b>Each part on its own</b><span>Prices per part, single STLs, other shops</span></span>
      <span class="ot-amt muted num">${ls.length}</span><i class="ot-chev">${CHEV}</i></button></div>
    ${open ? ls.map(l => partHtml(l, N, qtys, st)).join('') : ''}`;
}
/** Bought parts: "Add N parts to Amazon basket" for every line with an exact Amazon product, and the rest as searches. */
function basketHtml(ls, N, qtys, st) {
  const { basket, search, urls } = amazonBasket(ls, N);
  if (!basket.length && !search.length) return '';
  const about = items => { let u = 0, k = 0; for (const it of items) { const b = buyOptions(it.line, N, qtys).find(o => o.amz); if (b?.usd != null) { u += b.usd; k++; } } return k ? `about ${money(r2(u))}` : ''; };
  const pieces = items => items.reduce((a, it) => a + it.qty, 0);
  const open = st.open.has('amzsearch');
  const cartRows = urls.map((u, i) => `<a class="ot-row ot-opt ot-link ot-hero" href="${esc(u)}" target="_blank" rel="noopener noreferrer" data-ot-basket="${basket.length}">${logo('Amazon')}
      <span class="ot-rt"><b>Add ${plural(basket.length, 'part')} to Amazon basket${urls.length > 1 ? ` (${i + 1} of ${urls.length})` : ''}</b><span>${esc([`${plural(pieces(basket), 'item')} in all`, 'Amazon asks you to confirm before adding'].join(' · '))}</span></span>
      <span class="ot-amt num">${esc(about(basket))}</span><i class="ot-ext">${EXT}</i></a>`).join('');
  const findTitle = basket.length ? `${search.length} more to find on Amazon` : `Find ${plural(search.length, 'part')} on Amazon`;
  const findRow = search.length ? `<div class="ot-cell ${open ? 'open' : ''}"><button type="button" class="ot-row ot-rb ot-opt ot-mrow" data-ot-open="amzsearch" aria-expanded="${open}">
      ${basket.length ? '' : logo('Amazon')}<span class="ot-rt"><b>${esc(findTitle)}</b><span>No exact product in the parts list yet, so each opens an Amazon search</span></span>
      <span class="ot-amt muted num">${search.length}</span><i class="ot-chev">${CHEV}</i></button>
      ${open ? search.map(it => `<a class="ot-row ot-opt ot-link ot-sub" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer" data-ot-shop="Amazon">
        <span class="ot-rt"><b>${esc(it.line.name)}</b><span>${esc(`Need ${it.qty} · search Amazon`)}</span></span><i class="ot-ext">${EXT}</i></a>`).join('') : ''}</div>` : '';
  return `<div class="ot-g ot-set">${cartRows}${findRow}</div>`;
}

const priceHtml = o => o.usd != null ? `${o.kind === 'estimate' ? '<small>about</small> ' : ''}${money(o.usd)}` : o.kind === 'pending' ? 'Quoting…' : o.upload ? 'Upload for price' : 'See price';
function optSub(o) {
  const bits = [];
  if (o.kind === 'live') bits.push(o.checked ? 'Price checked on their site' : 'Live quote');
  else if (o.kind === 'estimate') bits.push('Estimate');
  else if (o.kind === 'pending') bits.push('Getting a live quote');
  else bits.push(o.upload ? `Upload the ${o.upload.split(' ').pop()} on their quote page for the price` : 'Check the price on their site');
  if (o.lead) bits.push(o.lead);
  if (o.setup) bits.push(`+${money(o.setup)} setup per order`);
  if (o.note && o.note !== 'No live price right now') bits.push(o.note);
  return bits.join(' · ');
}

/** One part: a row with its best price; tap it for the shops (cheapest first), the files to upload, and More options. */
function partHtml(l, N, qtys, st) {
  const opts = buyOptions(l, N, qtys);
  const best = opts[0];
  const id = 'p:' + (l.id || l.name);
  const open = st.open.has(id), more = st.open.has('m:' + id);
  const need = (Number(l.qty_per_unit) || 1) * N;
  const sub = [need > 1 ? `Need ${need}` : '', best ? best.service : 'No shop found', best?.lead || ''].filter(Boolean).join(' · ');
  const files = filesFor(l, opts);
  const optRow = o => o.url ? `<a class="ot-row ot-opt ot-link" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" data-ot-shop="${esc(o.service)}">${logo(o.service)}
      <span class="ot-rt"><b>${esc(o.service)}</b><span title="${esc(optSub(o))}">${esc(optSub(o))}</span></span>
      <span class="ot-amt num ${o.usd == null ? 'muted' : ''}">${priceHtml(o)}</span><i class="ot-ext">${EXT}</i></a>`
    : `<div class="ot-row ot-opt">${logo(o.service)}<span class="ot-rt"><b>${esc(o.service)}</b><span title="${esc(optSub(o))}">${esc(optSub(o))}</span></span><span class="ot-amt num muted">${priceHtml(o)}</span></div>`;
  const fileRow = f => `<a class="ot-row ot-opt ot-link" href="${esc(f.href)}" download>
      <span class="ot-logo file" aria-hidden="true">${DL}</span>
      <span class="ot-rt"><b>Download ${esc(f.label)}</b><span>${esc(f.for ? `To upload to ${f.for}` : 'The part file')}</span></span></a>`;
  const rest = opts.slice(1);
  return `<div class="ot-cell ${open ? 'open' : ''}">
    <button type="button" class="ot-row ot-rb ot-prow" data-ot-open="${esc(id)}" aria-expanded="${open}">
      ${pthHtml(l.name)}
      <span class="ot-rt"><b>${esc(l.name)}</b><span>${esc(sub)}</span></span>
      <span class="ot-amt num ${best?.usd == null ? 'muted' : ''}">${best ? priceHtml(best) : ''}</span><i class="ot-chev">${CHEV}</i>
    </button>
    ${open ? `<div class="ot-opts">
      ${best ? optRow(best) : `<div class="ot-row ot-opt"><span class="ot-rt"><b>No shop found yet</b><span>${esc(l.detail || '')}</span></span></div>`}
      ${files.map(fileRow).join('')}
      ${rest.length ? `<div class="ot-cell ${more ? 'open' : ''}"><button type="button" class="ot-row ot-rb ot-opt ot-mrow" data-ot-open="m:${esc(id)}" aria-expanded="${more}">
        <span class="ot-rt"><b>More options</b><span>${esc(rest.map(o => o.service).slice(0, 4).join(', '))}${rest.length > 4 ? '…' : ''}</span></span>
        <span class="ot-amt muted num">${rest.length}</span><i class="ot-chev">${CHEV}</i></button>
        ${more ? rest.map(optRow).join('') : ''}</div>` : ''}
    </div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- shop logos
const LOGO = {
  'Slant 3D': { bg: '#14261c', fg: '#7be3a0', html: 'S3D', small: true },
  SendCutSend: { bg: '#1d3fd8', fg: '#fff', html: 'SCS', small: true },
  Amazon: { bg: '#131a22', fg: '#fff', html: 'a<i></i>', amz: true },
  Craftcloud: { bg: '#e8f0ff', fg: '#2b4fd8', html: 'C' },
  JLC3DP: { bg: '#fff1e6', fg: '#c2410c', html: 'JLC', small: true },
  RMFG: { bg: '#1c1917', fg: '#fff', html: 'RM', small: true },
  MATERIAM: { bg: '#eef6f1', fg: '#166534', html: 'M' },
};
const logo = shop => {
  const L = LOGO[shop] || { bg: '#efeeea', fg: '#57534e', html: esc(String(shop || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?') };
  return `<b class="ot-logo ${L.small ? 'sm' : ''} ${L.amz ? 'amz' : ''}" style="background:${L.bg};color:${L.fg}" aria-hidden="true">${L.html}</b>`;
};

/** Part renders already made, so a re-render (quantity change, opening a row) draws them at once instead of blanking them. */
const thumbUrls = new Map(); // part line name -> image url
const pthHtml = name => thumbUrls.has(name)
  ? `<span class="ot-pth" aria-hidden="true" data-ot-pth="${esc(name)}" data-done="1" style="background-image:url(${thumbUrls.get(name)})"></span>`
  : `<span class="ot-pth" aria-hidden="true" data-ot-pth="${esc(name)}"></span>`;

/** Part renders next to each line; one per idle slice so opening the tab never stalls. */
function fillThumbs(el, ctx) {
  if (!ctx.partThumb) return;
  const todo = [...el.querySelectorAll('.ot-pth[data-ot-pth]:not([data-done])')];
  const idle = window.requestIdleCallback || (f => setTimeout(f, 16));
  const step = () => {
    const t = todo.shift(); if (!t) return;
    t.dataset.done = '1';
    const url = ctx.partThumb(t.dataset.otPth);
    if (url) { thumbUrls.set(t.dataset.otPth, url); t.style.backgroundImage = `url(${url})`; }
    idle(step);
  };
  idle(step);
}

const MINUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const PLUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const CHEV = '<svg viewBox="0 0 8 14" width="7" height="12" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXT = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3h4v4M13 3L7.5 8.5"/></svg>';
const DL = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>';
const IRON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l5.5-5.5M8.5 15.5l2 2 9-9a2.1 2.1 0 00-3-3l-9 9z"/><path d="M14 7l3 3"/></svg>';

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('otCss')) return;
  const st = document.createElement('style'); st.id = 'otCss';
  st.textContent = `
.pane.order.ot-host:not([hidden]),.order.ot-host:not([hidden]){display:flex!important;flex-direction:column;overflow:hidden!important;padding:0!important}
.ot{--ot-line:rgba(60,55,50,.13);--ot-muted:var(--muted,#6b6560);--ot-faint:#a8a29e;--ot-bg:#f3f2ef;--ot-cell:#fff;--ot-acc:var(--accent,#f97316);
  flex:1;min-height:0;display:flex;flex-direction:column;color:var(--text,#1c1917);background:var(--ot-bg);font-size:15px}
.ot .num{font-variant-numeric:tabular-nums}
.ot .muted{color:var(--ot-muted)}
.ot-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 16px 22px}
.ot-id{display:flex;gap:12px;align-items:center;min-width:0;padding:2px 2px 4px}
.ot-id b{display:block;font-size:17px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ot-id span{display:block;font-size:13px;color:var(--ot-muted)}
.ot-id>div{min-width:0}
.ot-thumb{width:52px;height:52px;border-radius:12px;overflow:hidden;flex:none;background:#e4e5e7}
.ot-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ot-thumb.loading img,.ot-thumb img:not([src]){visibility:hidden}
.ot-gh{margin:22px 16px 7px;font-size:13px;color:var(--ot-muted);display:flex;justify-content:space-between;gap:8px}
.ot-g{background:var(--ot-cell);border-radius:12px;overflow:hidden}
.ot-gf{margin:7px 16px 0;font-size:12.5px;line-height:1.45;color:var(--ot-muted)}
.ot-upd{color:var(--ot-acc);font-weight:600}
.ot-row{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 16px;position:relative;box-sizing:border-box;width:100%}
.ot-g>.ot-row+.ot-row::before,.ot-cell+.ot-cell::before,.ot-g>.ot-cell+.ot-row::before,.ot-opts>.ot-row::before,.ot-opts>.ot-cell::before,.ot-opts .ot-cell>.ot-row+.ot-row::before{content:"";position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--ot-line)}
.ot-cell{position:relative}
.ot-rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;text-align:left}
.ot-rt b{font-weight:500;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ot-rt>span{font-size:13px;color:var(--ot-muted);overflow-wrap:break-word}
.ot-amt{flex:none;font-size:15px;white-space:nowrap;text-align:right}
.ot-chev{flex:none;display:grid;color:#c4c0b9;transition:transform .2s;font-style:normal}
.ot-cell.open>.ot-rb .ot-chev{transform:rotate(90deg)}
.ot-ext{flex:none;display:grid;color:#b5b0a8;font-style:normal}
.ot-rb{all:unset;box-sizing:border-box;flex:1;min-width:0;display:flex;align-items:center;gap:12px;cursor:pointer;min-height:44px;-webkit-tap-highlight-color:transparent}
button.ot-row.ot-rb{padding:8px 16px;width:100%}
.ot-rb:focus-visible,.ot-sb:focus-visible,.ot-pk:focus-visible,.ot-link:focus-visible{outline:2px solid var(--ot-acc);outline-offset:-2px}
@media (hover:hover){.ot-rb:hover .ot-rt b,.ot-link:hover .ot-rt b{text-decoration:underline;text-decoration-color:var(--ot-line)}}
.ot-rb:active,.ot-link:active{background:#f1f0ed}
/* quantity */
.ot-qrow{justify-content:space-between;min-height:60px}
.ot-step{display:flex;align-items:center;background:#f1f0ed;border-radius:10px;padding:3px}
.ot-sb{all:unset;width:40px;height:36px;display:grid;place-items:center;border-radius:8px;cursor:pointer;color:var(--text,#1c1917);-webkit-tap-highlight-color:transparent}
.ot-sb:active:not(:disabled){background:#e4e2de}
.ot-sb:disabled{color:#c9c5be;cursor:default}
.ot-qn{width:58px;height:36px;border:0;border-radius:8px;background:#fff;text-align:center;font:600 17px/1 var(--ui,inherit);color:inherit;padding:0;box-shadow:0 1px 2px rgba(0,0,0,.08);-webkit-appearance:none;appearance:none}
.ot-qn:focus{outline:2px solid var(--ot-acc);outline-offset:0}
.ot-each{text-align:right;display:flex;flex-direction:column;line-height:1.2;white-space:nowrap}
.ot-each b{font-size:17px;font-weight:650}
.ot-each span{font-size:12.5px;color:var(--ot-muted)}
.ot-picks{gap:8px;padding-top:4px;padding-bottom:12px;min-height:0}
.ot-pk{all:unset;flex:1;text-align:center;height:34px;line-height:34px;border-radius:9px;background:#f1f0ed;font-weight:600;font-size:14px;cursor:pointer;font-variant-numeric:tabular-nums;-webkit-tap-highlight-color:transparent}
.ot-pk.on{background:var(--text,#1c1917);color:#fff}
/* parts and shops */
.ot-link{text-decoration:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.ot-pth{flex:none;width:40px;height:40px;border-radius:9px;background:#f4f3f0 center/86% no-repeat;display:block;box-shadow:inset 0 0 0 .5px var(--ot-line)}
.ot-pth:not([style]):not(.ic){background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a8a29e' stroke-width='1.5' stroke-linejoin='round'%3E%3Cpath d='M12 3l8 4.5v9L12 21l-8-4.5v-9z'/%3E%3Cpath d='M4 7.5l8 4.5 8-4.5M12 12v9'/%3E%3C/svg%3E");background-size:20px}
.ot-pth.ic{display:grid;place-items:center;color:#78716c;box-shadow:none}
.ot-prow{min-height:56px}
.ot-prow .ot-rt b{white-space:normal;overflow-wrap:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.25}
.ot-amt small{font-size:12px;color:var(--ot-muted)}
.ot-cell.open>.ot-prow{background:#faf9f7}
.ot-opts{background:#faf9f7;padding-left:52px}
.ot-opts .ot-row{padding-left:0}
.ot-opts .ot-row::before{left:0!important}
.ot-opt{min-height:52px}
.ot-opt .ot-rt b{font-size:14.5px}
.ot-opt .ot-amt{font-size:14.5px}
.ot-opt .ot-rt>span{font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ot-mrow .ot-rt b{color:var(--ot-acc);font-weight:600}
.ot-opts .ot-cell .ot-opt:not(.ot-mrow){padding-left:0}
.ot-g{container-type:inline-size}
@container (max-width:380px){.ot-g .ot-pth{width:34px;height:34px}.ot-g .ot-row{gap:10px}.ot-opts{padding-left:16px}.ot-g .ot-amt{font-size:14px}}
.ot-logo{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;font-weight:800;font-size:15px;flex:none;position:relative;line-height:1;font-style:normal;font-family:var(--ui,inherit)}
.ot-logo.sm{font-size:9.5px}
.ot-logo.amz{font-size:17px;font-weight:700}
.ot-logo.amz i{position:absolute;left:8px;right:8px;bottom:6px;height:2px;border-radius:2px;background:#ff9900}
.ot-logo.file{background:#fff1e6;color:var(--ot-acc)}
/* more */
.ot-more{margin:22px 16px 0;display:flex;flex-direction:column;gap:12px}
.ot-diy{all:unset;cursor:pointer;font-size:15px;font-weight:500;color:var(--ot-acc)}
.ot-diy:hover{text-decoration:underline}
.ot-how{font-size:13px;color:var(--ot-muted)}
.ot-how summary{cursor:pointer;width:max-content;max-width:100%}
.ot-how p{margin:8px 0 0;line-height:1.55}
/* pinned estimate */
.ot-pin{flex:none;position:sticky;bottom:0;z-index:3;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:rgba(250,249,247,.94);
  -webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);border-top:.5px solid var(--ot-line);display:flex;flex-direction:column;gap:2px}
.ot-tot{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;color:var(--ot-muted)}
.ot-tot b{font-size:19px;font-weight:700;color:var(--text,#1c1917)}
.ot-fine{margin:0;font-size:12px;color:var(--ot-muted)}
.ot-g>.ot-row+.ot-cell::before,.ot-set .ot-cell>.ot-row+.ot-row::before{content:"";position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--ot-line)}
.ot-set .ot-cell>.ot-row{position:relative}
.ot-set{margin-bottom:10px}
.ot-set .ot-hero{min-height:60px}
.ot-set .ot-hero .ot-rt b{font-weight:600;font-size:15px;white-space:normal;line-height:1.25}
.ot-set .ot-sub{padding-left:58px}
.ot-set .ot-sub::before{left:58px!important}
.ot-set .ot-rt b,.ot-act .ot-rt b{white-space:normal;line-height:1.25}
.ot-each-row .ot-rt b{font-weight:500;color:var(--text,#1c1917)}
.ot-gap{margin-top:12px}
.ot-act .ot-rt b{color:var(--ot-acc);font-weight:600}
.ot-buy .ot-bcell+.ot-bcell::before{content:"";position:absolute;top:0;left:58px;right:0;height:.5px;background:var(--ot-line)}
.ot-buy .ot-hero{min-height:60px}
.ot-buy .ot-hero .ot-rt b{font-weight:600;white-space:normal;line-height:1.25}
.ot-btns{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 12px 58px}
.ot-btn{flex:1 1 120px;min-width:0;display:grid;place-items:center;height:36px;padding:0 10px;border-radius:9px;background:#f1f0ed;color:var(--ot-acc);font-weight:600;font-size:14px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent}
.ot-btn:active{background:#e4e2de}
.ot-btn:focus-visible{outline:2px solid var(--ot-acc);outline-offset:-2px}
@container (max-width:380px){.ot-btns{padding-left:16px}}
@media (prefers-reduced-motion:reduce){.ot-chev{transition:none}}`;
  document.head.appendChild(st);
}
