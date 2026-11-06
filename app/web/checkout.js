// Stripe Checkout in the studio: Order-tab buy buttons, the order modal, /orders/success, /orders (and the admin list).
// Server side: server/payments.js. Prices shown here are display only; the server recomputes them.
import { designPath, current } from './nav.js'; // urls: clean URLs
import { ACCESS } from './api.js';
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n == null || isNaN(n)) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const days = n => `${n} day${n === 1 ? '' : 's'}`;
const STATUSES = ['pending', 'paid', 'printing', 'shipped', 'canceled', 'refunded'];
const X = '<button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button>';
const LOCK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const INFO = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M8 7v4.5M8 4.5v.5" stroke="currentColor" stroke-width="1.5"/></svg>';

/** {enabled, test, contact, admin, tax}. Fetched once at load; checkout stays off if the server doesn't answer. */
export const CHECKOUT = await fetch('/api/checkout/config', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
  .then(r => r.ok ? r.json() : null).catch(() => null) || { enabled: false, missing: true, contact: '' };

async function call(path, opts = {}) {
  let r;
  try {
    r = await fetch(path, { ...opts, cache: 'no-store', headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw Object.assign(new Error('Can’t reach the server. Check your connection and retry.'), { status: 0 }); }
  let data = null; try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(data?.error || `Request failed (${r.status})`), { status: r.status });
  return data;
}

let termsLink = null; // set once we know a terms page exists
const isPage = p => fetch(p, { method: 'HEAD', cache: 'no-store' }).then(r => r.ok && /html/.test(r.headers.get('content-type') || '')).catch(() => false);
const termsCheck = (async () => { for (const p of ['/terms', '/terms.html']) if (await isPage(p)) { termsLink = p; return; } })();

/** The Order-tab button for one tier. */
export function buyButton(t, i, selected) {
  if (!CHECKOUT.enabled) return `<button class="btn sm block" disabled title="Payments are being set up">Checkout opens soon</button>`;
  return `<button class="btn ${selected ? 'primary' : ''} sm block" data-buy="${i}">Order ${t.qty}</button>`;
}

/** The Order tab's button: straight to Stripe for exactly what the Order tab shows (the server prices it again, the same
 * way, and charges that). Throws with a readable message; on success the page navigates away. */
export async function startCheckout({ src, qty, omit, addons, total }) {
  track('checkout_started', { qty, total, mode: 'kit', left_out: (omit || []).length, addons: (addons || []).join(',') || 'none', design: src?.project ? 'project' : src?.example ? 'example' : 'other' }, { now: true }); // analytics:
  const r = await call('/api/checkout', { method: 'POST', body: { source: src, qty, mode: 'kit', ...(omit?.length ? { omit } : {}), ...(addons?.length ? { addons } : {}) } });
  location.assign(r.url);
  return r;
}

const LEFT_OUT = { printed: 'printed parts', metal: 'cut metal and panels', extrusion: 'aluminium extrusion', bought: 'bought parts' };
/** The order modal: summary + "Continue to secure checkout" (redirects to Stripe). ctx: { title, src, mode, tier, omit, close, errBox }
 * omit: kit-contents groups left out on the Order tab (tier is already priced without them; the server recomputes it). */
// agentbrain: designs that need soldering (bom.needs_soldering) offer a cheap iron kit, one per order (server: agentbrain.addonsFor)
const SOLDER_USD = 16;
export async function openCheckout({ title, src, mode, tier: t, omit, close, errBox, solder }) {
  let iron = false;
  omit = Array.isArray(omit) ? omit.filter(k => LEFT_OUT[k]) : [];
  const box = $('#modalBox');
  const note = () => `${mode === 'kit' ? 'Kit: parts ship to you, with step-by-step instructions.' : 'Made to order.'} Ships in about ${days(t.lead_time_days)}. Questions: <a href="mailto:${esc(CHECKOUT.contact)}">${esc(CHECKOUT.contact)}</a>${termsLink ? ` · <a href="${termsLink}" target="_blank" rel="noopener">Terms</a>` : ''}`;
  box.innerHTML = `
    <div class="modal-head"><h2 id="modalTitle">Order ${t.qty} × ${esc(title)}</h2>${X}</div>
    <div class="modal-body">
      <div class="summary"><div class="legend">
        <span class="k">${t.at_cost ? `Parts for ${t.qty} ${t.qty === 1 ? 'kit' : 'kits'}, at cost` : `${t.qty} × ${mode === 'kit' ? 'kit' : 'assembled'} at ${money(t.unit_price)}`}</span><span class="v">${money(t.subtotal)}</span>
        ${omit.length ? `<span class="k">Leaving out</span><span class="v">${esc(omit.map(k => LEFT_OUT[k]).join(', '))}</span>` : ''}
        <span class="k">${t.at_cost ? 'Shipping (each supplier’s own)' : 'Shipping, US ground'}</span><span class="v">${money(t.shipping)}</span>
        ${t.at_cost && t.card_fee != null ? `<span class="k">Card fee (what Stripe charges)</span><span class="v">${money(t.card_fee)}</span>` : ''}
        ${CHECKOUT.tax ? '<span class="k">Sales tax</span><span class="v">at checkout</span>' : ''}
        <span class="k">Ships in</span><span class="v">about ${days(t.lead_time_days)}</span>
        ${solder ? `<span class="k" id="coIronK" hidden>Soldering iron kit</span><span class="v" id="coIronV" hidden>${money(SOLDER_USD)}</span>` : ''}
        <span class="k tot">Total</span><span class="v tot" id="coTotal">${money(t.total)}</span></div></div>
      ${solder ? `<label class="co-iron"><input type="checkbox" id="coIron"><span><b>Add a soldering iron kit · ${money(SOLDER_USD)}</b><small>${esc(solder.reason || 'This build needs a little soldering.')} Iron, stand, solder and tips; skip it if you have one.</small></span></label>` : ''}
      <div class="co-note">${INFO}<span id="coNote">${note()}</span></div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">You enter your US shipping address and card on Stripe’s checkout page.</p>
      ${CHECKOUT.test ? '<div class="co-test">Test mode: pay with card 4242 4242 4242 4242, any future date, any CVC.</div>' : ''}
      <div id="coErr" style="margin-top:10px" hidden></div>
    </div>
    <div class="modal-foot"><span class="co-secure">${LOCK}Payments by Stripe</span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="coGo">Continue to secure checkout</button></div>`;
  $('#modal').hidden = false;
  $$('[data-close]', box).forEach(b => b.onclick = close);
  termsCheck.then(() => { const n = $('#coNote', box); if (n) n.innerHTML = note(); });
  const go = $('#coGo', box);
  const ironBox = $('#coIron', box);
  if (ironBox) ironBox.onchange = () => {
    iron = ironBox.checked;
    $('#coIronK', box).hidden = $('#coIronV', box).hidden = !iron;
    $('#coTotal', box).textContent = money(t.total + (iron ? SOLDER_USD : 0));
  };
  setTimeout(() => go.focus(), 30);
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'Opening checkout…';
    track('checkout_started', { qty: t.qty, total: t.total, unit_price: t.unit_price, mode, left_out: omit.length, design: src?.project ? 'project' : src?.example ? 'example' : 'other' }, { now: true }); // analytics:
    try {
      const r = await call('/api/checkout', { method: 'POST', body: { source: src, qty: t.qty, mode, ...(omit.length ? { omit } : {}), ...(iron ? { addons: ['soldering_iron'] } : {}) } });
      location.assign(r.url);
    } catch (err) {
      $('#coErr', box).hidden = false; $('#coErr', box).innerHTML = errBox(err);
      go.disabled = false; go.textContent = 'Continue to secure checkout';
    }
  };
}

// ---------------------------------------------------------------- /orders pages (old #/orders)
const shipDate = o => {
  const from = Date.parse(o.paid_at || o.created) || Date.now();
  return new Date(from + (o.lead_time_days || 0) * 864e5).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const designHref = s => esc(designPath(s?.project ? { project: s.project } : s?.example ? { example: s.example } : null)); // urls:
const addr = a => a ? [a.name, a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', ') + (a.postal_code ? ' ' + a.postal_code : ''), a.country && a.country !== 'US' ? a.country : '']
  .filter(Boolean).map(esc).join(' · ') : '';
const label = s => s === 'pending' ? 'Awaiting payment' : s === 'printing' ? 'In production' : s ? s[0].toUpperCase() + s.slice(1) : '';
const trackHtml = o => (o.tracking || []).map(t => t.url && /^https:\/\//.test(t.url) ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc([t.carrier, t.number].filter(Boolean).join(' '))}</a>` : esc([t.carrier, t.number].filter(Boolean).join(' '))).join(', ');

/** route: { sub: '' | 'success' | 'all', params: URLSearchParams }. ctx: { errBox } */
export async function renderOrders(el, route, ctx) {
  if (route.sub === 'success') return renderSuccess(el, route.params.get('session_id') || '', ctx);
  if (route.sub === 'all' && CHECKOUT.admin) return location.replace('/admin#orders'); // admin: all orders live in the admin panel
  const all = route.sub === 'all' && CHECKOUT.admin;
  const head = `<h1>${all ? 'All orders' : 'My orders'}</h1>
    <p class="sub">${all ? 'Every order, newest first. Set the status as it moves through printing and shipping.' : 'Orders you placed. We email you when each one ships.'}</p>
    ${CHECKOUT.admin ? `<div class="orders-tabs"><a href="/orders" class="${all ? '' : 'on'}">My orders</a><a href="/admin#orders" class="${all ? 'on' : ''}">All orders</a></div>` : ''}`;
  el.innerHTML = `<div class="orders-inner">${head}<div class="ord-list"><div class="skel" style="height:64px"></div><div class="skel" style="height:64px"></div></div></div>`;
  let list;
  try { list = await call('/api/orders' + (all ? '?all=1' : '')); }
  catch (e) { $('.ord-list', el).innerHTML = ctx.errBox(e); return; }
  if (!list.length) {
    $('.ord-list', el).innerHTML = `<div class="ord-empty">${all ? 'No orders yet.' : 'No orders yet. Open a design, go to its Order tab and pick a quantity.'}<br><a href="${designPath(null)}">Back to the studio</a></div>`;
    return;
  }
  $('.ord-list', el).innerHTML = list.map(o => `
    <div class="ord" data-id="${esc(o.id)}">
      <div><a class="t" href="${designHref(o.source)}">${esc(o.title)}</a>
        <div class="m">${o.qty} × ${esc(o.mode)} · ordered ${esc(new Date(o.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}${o.status === 'paid' || o.status === 'printing' ? ` · ships about ${esc(shipDate(o))}` : ''}${o.livemode ? '' : ' · test'}</div></div>
      <div class="r"><b>${money(o.amount_total != null ? o.amount_total / 100 : o.total)}</b><span class="st ${esc(o.status)}">${esc(label(o.status))}</span></div>
      ${o.ship_to && !all ? `<div class="addr">${o.status === 'shipped' ? 'Shipped' : 'Ships'} to ${addr(o.ship_to)}</div>` : ''}
      ${o.tracking?.length ? `<div class="addr">Tracking: ${trackHtml(o)}</div>` : ''}
      ${all ? `<div class="admin-row"><span>${esc(o.email || o.user || '')}</span><span>${addr(o.ship_to) || 'No address yet'}</span>
        <code>${esc(o.id)}</code>${o.payment_intent ? `<code>${esc(o.payment_intent)}</code>` : ''}${o.amount_mismatch ? '<b style="color:var(--danger)">Amount differs from quote</b>' : ''}
        <label style="margin-left:auto">Status <select data-status>${STATUSES.concat(STATUSES.includes(o.status) ? [] : [o.status]).map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></label></div>` : ''}
    </div>`).join('');
  $$('[data-status]', el).forEach(sel => sel.onchange = async () => {
    const id = sel.closest('.ord').dataset.id;
    sel.disabled = true;
    try { const o = await call(`/api/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: sel.value } }); const st = $('.st', sel.closest('.ord')); st.className = 'st ' + o.status; st.textContent = label(o.status); }
    catch (e) { alert(e.message); }
    sel.disabled = false;
  });
}

async function renderSuccess(el, sid, ctx) {
  const wrap = inner => { el.innerHTML = `<div class="ord-done">${inner}</div>`; };
  if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) { wrap(`<h1>Order not found</h1><p>This link is missing its checkout session.</p><div class="actions"><a class="btn" href="/orders">My orders</a></div>`); return; }
  wrap(`<div class="tick wait"><span class="spin"></span></div><h1>Confirming your payment</h1><p>This takes a few seconds.</p>`);
  let o;
  for (let i = 0; i < 8; i++) {
    if (!current().startsWith('/orders/success')) return;
    try { o = await call(`/api/orders/session/${encodeURIComponent(sid)}`); }
    catch (e) { wrap(`<h1>We couldn’t load this order</h1>${ctx.errBox(e)}<div class="actions"><a class="btn" href="/orders">My orders</a></div>`); return; }
    if (o.status !== 'pending') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!current().startsWith('/orders/success')) return;
  const ok = o.status !== 'pending' && o.status !== 'expired' && o.status !== 'canceled';
  if (ok) { // analytics: once per checkout session in this browser (the server sends its own, source: 'server')
    let seen = false; try { seen = localStorage.getItem('buildery.paid.' + sid) === '1'; localStorage.setItem('buildery.paid.' + sid, '1'); } catch {}
    if (!seen) track('checkout_completed', { source: 'web', order_id: o.id, qty: o.qty, mode: o.mode, total: o.amount_total != null ? o.amount_total / 100 : o.total, currency: 'usd' });
  }
  const tick = '<svg viewBox="0 0 16 16" width="24" height="24"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>';
  wrap(`<div class="tick ${ok ? '' : 'wait'}">${ok ? tick : INFO}</div>
    <h1>${ok ? 'Order confirmed' : 'Payment still processing'}</h1>
    <p>${ok ? 'We’ll email you when it ships.' : 'Stripe hasn’t confirmed the payment yet. This page updates in My orders once it does.'}</p>
    <div class="summary"><div class="legend">
      <span class="k">${o.qty} × ${esc(o.title)} (${esc(o.mode)})</span><span class="v">${money(o.subtotal)}</span>
      <span class="k">Shipping</span><span class="v">${money(o.shipping)}</span>
      <span class="k tot">Paid</span><span class="v tot">${money(o.amount_total != null ? o.amount_total / 100 : o.total)}</span>
      <span class="k">Estimated ship date</span><span class="v">${esc(shipDate(o))}</span>
      ${o.ship_to ? `<span class="k">Ships to</span><span class="v">${addr(o.ship_to)}</span>` : ''}
      <span class="k">Order</span><span class="v"><code>${esc(o.id)}</code></span></div></div>
    <p class="muted" style="font-size:12px;margin-top:12px">Made to order. Questions: <a href="mailto:${esc(CHECKOUT.contact)}">${esc(CHECKOUT.contact)}</a></p>
    <div class="actions"><a class="btn primary" href="/orders">My orders</a><a class="btn" href="${designHref(o.source)}">Back to the design</a></div>`);
}

/** Hide the sidebar "My orders" link for visitors who can't order. */
export function ordersLinkVisible() { return !!(ACCESS.authed && !ACCESS.showcase && !CHECKOUT.missing); }
