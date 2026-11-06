// Admin fulfilment (/admin#fulfilment, and the panel under each paid order in /admin#orders).
// Server: server/fulfilment (/api/admin/fulfilment/*). Human in the loop: nothing here pays or submits an order.
// Every user-supplied string goes through esc().
import { esc } from '/chatui.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => (n == null || isNaN(n) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const toMs = t => (t == null ? null : typeof t === 'number' ? t : Date.parse(t));
const age = t => { const ms = toMs(t); if (!ms) return '–'; const h = (Date.now() - ms) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`; };
const when = t => { const ms = toMs(t); return ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–'; };
const ST = { todo: 'To do', quoted: 'Quoted', placed: 'Placed', shipped: 'Shipped', received: 'Received', skipped: 'Skipped' };
const ST_PILL = { todo: 'warn', quoted: 'acc', placed: 'acc', shipped: 'ok', received: 'ok', skipped: '' };
const ORDER_ST = { paid: 'Paid', printing: 'In production', shipped: 'Shipped' };
const pill = s => `<span class="adm-pill ${ST_PILL[s] || ''}">${esc(ST[s] || s)}</span>`;
const costTxt = c => !c ? '–' : c.kind === 'skipped' ? '–' : `${money(c.usd)}<span class="ful-ck"> ${c.kind === 'actual' ? 'actual' : c.kind === 'live' ? 'live' : 'est.'}${c.unpriced ? `, ${c.unpriced} unpriced` : ''}</span>`;
const addrHtml = a => !a ? '<span class="muted">No address</span>' : esc([a.name, a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', ') + (a.postal_code ? ' ' + a.postal_code : ''), a.country].filter(Boolean).join(', '));
const COPY = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 10.5V3.5A1 1 0 014 2.5h6.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const EXT = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v4h-9v-9h4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
const DL = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';

async function copy(text, toast, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); toast(what); } catch { toast('Copy failed'); } t.remove(); }
}

// ---------------------------------------------------------------- queue view (#fulfilment)
export async function renderQueue(el, { api, toast, isCurrent }) {
  let r; try { r = await api('/api/admin/fulfilment'); } catch (e) { el.innerHTML = `<div class="adm-err">${esc(e.message)}</div>`; return; }
  if (!isCurrent()) return;
  const rows = r.jobs;
  const warn = r.ship_from?.placeholder ? `<div class="ful-warn">Set your own address (BUILDERY_SHIP_FROM_* in app/.env.local) before placing “ship to us” jobs.</div>` : '';
  if (!rows.length) { el.innerHTML = `${warn}<div class="adm-empty">Nothing to place. Paid orders show up here as supplier jobs.</div>`; return; }
  const orders = new Set(rows.map(x => x.order_id)).size;
  el.innerHTML = `${warn}<div class="adm-row"><span class="muted">${rows.length} open job${rows.length > 1 ? 's' : ''} across ${orders} order${orders > 1 ? 's' : ''}, oldest first</span></div>
    <div class="ful-q">${rows.map(x => x.error ? `<a class="ful-qi bad" href="#fulfilment/${encodeURIComponent(x.order_id)}">
        <span class="ful-qa">${esc(age(x.paid_at))}</span><span class="ful-qm"><b>${esc(x.title)}</b><span>${esc(x.error)}</span></span></a>` : `
      <a class="ful-qi" href="#fulfilment/${encodeURIComponent(x.order_id)}">
        <span class="ful-qa" title="Paid ${esc(when(x.paid_at))}">${esc(age(x.paid_at))}</span>
        <span class="ful-qm"><b>${esc(x.job.label)}</b><span>${esc(x.title)} · ${esc(x.qty)} × ${esc(x.mode)}${x.livemode ? '' : ' · test'} · ${x.job.parts} part${x.job.parts > 1 ? 's' : ''}, ${x.job.units} pcs · ${x.job.ship_to === 'customer' ? 'drop-ship' : 'to us'}</span></span>
        <span class="ful-qc">${costTxt(x.job.cost)}</span>
        <span class="ful-qs">${pill(x.job.status)}</span></a>`).join('')}</div>`;
}

// ---------------------------------------------------------------- plan panel (one order)
export async function mountPlan(el, oid, ctx) {
  el.classList.add('ful');
  el.innerHTML = '<div class="adm-load">Loading fulfilment…</div>';
  let plan;
  try { plan = await ctx.api(`/api/admin/fulfilment/${encodeURIComponent(oid)}`); }
  catch (e) { el.innerHTML = `<div class="adm-err">${esc(e.message)}</div>`; return; }
  draw(el, plan, ctx);
}

function draw(el, P, ctx) {
  const { api, toast } = ctx;
  const s = P.summary, o = P.order;
  const base = `/api/admin/fulfilment/${encodeURIComponent(o.id)}`;
  const openJobs = new Set($$('details.ful-job[open]', el).map(d => d.dataset.job));
  const first = !el.dataset.drawn; el.dataset.drawn = '1';
  const mut = async (path, method, body, btn) => {
    if (btn) btn.disabled = true;
    try { const r = await api(base + path, { method, body: body || {} }); if (r.manual) toast(r.reason); draw(el, r, ctx); return r; }
    catch (e) { toast(e.message); if (btn) btn.disabled = false; return null; }
  };
  const placedAny = P.jobs.some(j => ['placed', 'shipped', 'received'].includes(j.status));
  el.innerHTML = `
    ${P.error ? `<div class="adm-err">${esc(P.error)}</div>` : ''}
    ${P.ship_from.placeholder && P.jobs.some(j => j.ship_to === 'us') ? '<div class="ful-warn">Your own address is still a placeholder. Set BUILDERY_SHIP_FROM_NAME, _LINE1, _CITY, _STATE, _POSTAL_CODE, _PHONE and _EMAIL in app/.env.local, then restart.</div>' : ''}
    <div class="ful-sum">
      <div><span>Customer paid</span><b>${money(s.paid_usd)}</b><small>excl. tax</small></div>
      <div><span>Stripe fee</span><b>${money(s.stripe_fee_usd)}</b><small>estimate</small></div>
      <div><span>Supplier cost</span><b>${money(s.cost_usd)}</b><small>${s.cost_estimated ? 'partly estimated' : 'live or actual'}${s.unpriced ? `, ${s.unpriced} unpriced` : ''}</small></div>
      <div class="${s.margin_usd < 0 ? 'neg' : ''}"><span>Margin</span><b>${money(s.margin_usd)}</b><small>${s.margin_pct != null ? s.margin_pct + '%' : ''} before your shipping</small></div>
    </div>
    <div class="ful-cust">
      <div><span class="muted">Customer</span> ${esc(o.email || '–')} · ${esc(o.qty)} × ${esc(o.mode)} · order is <b>${esc(ORDER_ST[o.status] || o.status)}</b></div>
      <div><span class="muted">Ships to</span> ${addrHtml(o.ship_to)}</div>
      ${o.tracking?.length ? `<div><span class="muted">Tracking</span> ${o.tracking.map(t => t.url ? `<a class="lnk" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.carrier)} ${esc(t.number)}</a>` : `${esc(t.carrier)} ${esc(t.number)}`).join(', ')}</div>` : ''}
      <form class="ful-ship" data-ship>
        <input type="text" name="carrier" placeholder="Carrier" aria-label="Carrier to customer" value="">
        <input type="text" name="tracking" placeholder="Tracking # to customer" aria-label="Tracking number to customer">
        <button class="btn sm" type="submit">Mark shipped to customer</button>
      </form>
    </div>
    <div class="ful-jobs">${P.jobs.map(j => jobHtml(j, P)).join('') || '<div class="adm-empty">No supplier jobs.</div>'}</div>
    <div class="ful-foot">
      ${!placedAny ? '<button class="btn sm" data-rebuild>Rebuild from current parts list</button>' : ''}
      <details class="ful-log"><summary>History (${(P.log || []).length})</summary><ul>${(P.log || []).slice().reverse().map(l => `<li><span class="muted">${esc(when(l.t))}</span> ${esc(l.what)}${l.by ? ` <span class="muted">· ${esc(l.by)}</span>` : ''}</li>`).join('')}</ul></details>
    </div>`;
  $$('details.ful-job', el).forEach(d => { if (openJobs.has(d.dataset.job) || (first && d.dataset.status !== 'received' && d.dataset.status !== 'skipped' && P.jobs.length <= 3)) d.open = true; });

  $('[data-ship]', el).onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    if (!f.get('tracking') && !confirm('Mark shipped without a tracking number?')) return;
    mut('', 'PATCH', { shipped: true, carrier: f.get('carrier'), tracking: f.get('tracking') }, $('button', e.target)).then(r => r && toast('Customer sees Shipped'));
  };
  const rb = $('[data-rebuild]', el); if (rb) rb.onclick = () => confirm('Rebuild every job from the design’s current parts list? Quotes on this order are dropped.') && mut('/rebuild', 'POST', {}, rb);

  for (const card of $$('details.ful-job', el)) {
    const jid = card.dataset.job, j = P.jobs.find(x => x.id === jid), jp = `/${jid}`;
    $$('select[data-f]', card).forEach(sel => sel.onchange = () => mut(jp, 'PATCH', { [sel.dataset.f]: sel.value }, sel));
    $$('[data-copy]', card).forEach(b => b.onclick = () => copy(b.dataset.copy === 'ship' ? j.kit.ship_to.text : b.dataset.copy === 'cart' ? j.kit.cart_text : j.kit.text, toast,
      { ship: 'Address copied', cart: 'List copied', kit: 'Order details copied' }[b.dataset.copy]));
    const q = $('[data-quote]', card); if (q) q.onclick = () => { q.textContent = 'Getting quote…'; mut(jp + '/quote', 'POST', {}, q); };
    const pl = $('[data-paylink]', card);
    if (pl) pl.onclick = () => {
      const opt = $('input[name="ship-' + jid + '"]:checked', card)?.value;
      const o2 = j.slant.shipping_options.find(x => x.id === opt);
      if (!confirm(`Create a Slant 3D payment link for ${money((j.slant.subtotal_usd || 0) + (o2?.rate_usd || 0))} (${o2 ? o2.carrier + ' ' + o2.service : 'shipping'})?\n\nThis only creates the link. Nothing is paid until you open it and pay.`)) return;
      pl.textContent = 'Creating link…';
      mut(jp + '/checkout', 'POST', { confirm: true, shipping_option_id: opt, again: !!j.slant.checkout }, pl);
    };
    const form = $('form[data-place]', card);
    if (form) form.onsubmit = e => {
      e.preventDefault(); const f = new FormData(form);
      const body = { order_no: f.get('order_no'), carrier: f.get('carrier'), tracking: f.get('tracking'), cost_actual_usd: f.get('cost') === '' ? null : f.get('cost'), note: f.get('note') };
      if (e.submitter?.dataset.mark && ['todo', 'quoted'].includes(j.status)) body.status = 'placed';
      mut(jp, 'PATCH', body, e.submitter).then(r => r && toast(body.status ? 'Marked placed' : 'Saved'));
    };
  }
}

function slantHtml(j) {
  const q = j.slant;
  const btnQ = `<button class="btn sm${q ? '' : ' primary'}" data-quote ${j.busy ? 'disabled' : ''}>${q ? 'Re-quote' : 'Get Slant quote'}</button>`;
  if (!q) return `<div class="ful-slant"><p class="muted">Uploads the STLs to Slant 3D, sets ${j.parts[0]?.qty ?? ''} sets and rates shipping to ${j.ship_to === 'customer' ? 'the customer' : 'you'}. Nothing is ordered.</p>${btnQ}</div>`;
  const opts = q.shipping_options || [];
  const chosen = q.checkout?.shipping_option_id || q.chosen_shipping;
  return `<div class="ful-slant">
    <dl class="ful-kv"><dt>Quote</dt><dd class="mono">${esc(q.quote_id)}</dd><dt>Sets</dt><dd>${esc(q.quantity)} × ${money(q.unit_usd)}${q.setup_usd ? ` + ${money(q.setup_usd)} setup` : ''} = <b>${money(q.subtotal_usd)}</b></dd>
      <dt>Material</dt><dd>${esc(q.material)} ${esc(q.color || '')}</dd><dt>Lead time</dt><dd>${esc(q.lead_time || '–')}</dd><dt>Ship to</dt><dd>${esc(q.shipping_to || '–')}</dd>
      <dt>Quoted</dt><dd>${esc(when(q.quoted_at))}</dd></dl>
    ${q.feedback?.length ? `<ul class="ful-fb">${q.feedback.map(f => `<li class="${f.severity === 'problem' ? 'bad' : ''}">${esc(f.part)}: ${esc(f.title)}</li>`).join('')}</ul>` : ''}
    ${q.shipping_error ? `<div class="ful-warn">${esc(q.shipping_error)}</div>` : ''}
    ${opts.length ? `<fieldset class="ful-opts"><legend>Shipping</legend>${opts.map(o => `<label><input type="radio" name="ship-${esc(j.id)}" value="${esc(o.id)}" ${o.id === chosen ? 'checked' : ''}>
      <span>${esc(o.carrier)} ${esc(o.service)}</span><span class="muted">${o.days ? `${esc(o.days)} d` : ''}</span><b>${money(o.rate_usd)}</b></label>`).join('')}</fieldset>` : ''}
    <div class="ful-total">Total <b>${money(q.total_usd)}</b></div>
    <div class="ful-acts">${btnQ}
      ${opts.length ? `<button class="btn sm${q.checkout ? '' : ' primary'}" data-paylink ${j.busy ? 'disabled' : ''}>${q.checkout ? 'New payment link' : 'Create Slant payment link'}</button>` : ''}
      ${q.checkout ? `<a class="btn sm primary" href="${esc(q.checkout.checkout_url)}" target="_blank" rel="noopener">${EXT}Open payment link</a>` : ''}</div>
    ${q.checkout ? `<p class="muted">Link created ${esc(when(q.checkout.created_at))}. Pay it, then enter Slant’s order # below and mark placed.</p>` : ''}
  </div>`;
}

function jobHtml(j, P) {
  const k = j.kit;
  const files = k.files.length ? `<div class="ful-files">${k.files.map(f => `<a class="btn sm" href="${esc(f.href)}" download>${DL}${esc(f.label)} <span class="muted">${esc(f.part)}</span></a>`).join('')}
      ${k.zip ? `<a class="btn sm" href="${esc(k.zip)}" download>${DL}All files (.zip)</a>` : ''}</div>` : '';
  const parts = `<div class="ful-parts">${k.parts.map(p => `<div class="ful-part"><div class="ful-pn"><b>${esc(p.name)}</b><span>× ${esc(p.qty)}</span></div>
      <dl class="ful-kv">${p.settings.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl></div>`).join('')}</div>`;
  const cart = k.cart ? `<div class="ful-cart">${k.cart.map(c => `<div><span class="q">${esc(c.qty)} ×</span><span class="n">${c.url ? `<a class="lnk" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</span><span class="num">${c.unit_usd != null ? money(c.unit_usd) : ''}</span></div>`).join('')}</div>` : '';
  const alt = j.alternatives.length > 1 ? `<label>Supplier <select data-f="supplier">${j.alternatives.map(a => `<option value="${esc(a.id)}" ${a.id === j.supplier ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : '';
  return `<details class="ful-job" data-job="${esc(j.id)}" data-status="${esc(j.status)}">
    <summary><span class="ful-jt"><b>${esc(j.label)}</b><span class="muted">${j.parts.length} part${j.parts.length > 1 ? 's' : ''} · ${j.ship_to === 'customer' ? 'drop-ship to customer' : 'ship to us'}${j.order_no ? ` · #${esc(j.order_no)}` : ''}</span></span>
      <span class="ful-jc">${costTxt(j.cost)}</span>${pill(j.status)}</summary>
    <div class="ful-jb">
      <div class="ful-ctl">${alt}
        <label>Ship to <select data-f="ship_to"><option value="us" ${j.ship_to === 'us' ? 'selected' : ''}>Us (assemble or pack)</option><option value="customer" ${j.ship_to === 'customer' ? 'selected' : ''}>Customer (drop-ship)</option></select></label>
        <label>Status <select data-f="status">${P.statuses.map(s => `<option value="${s}" ${s === j.status ? 'selected' : ''}>${esc(ST[s])}</option>`).join('')}</select></label>
      </div>
      ${k.api ? `<p class="ful-api muted">${k.auto ? 'Automatic ordering is on.' : 'Manual for now.'} ${esc(k.api)}</p>` : ''}
      ${j.supplier === 'slant3d' ? slantHtml(j) : ''}
      <div class="ful-kit">
        <div class="ful-acts">
          ${k.open_url && j.supplier !== 'slant3d' ? `<a class="btn sm primary" href="${esc(k.open_url)}" target="_blank" rel="noopener">${EXT}Open ${esc(k.supplier_name)}</a>` : ''}
          <button class="btn sm" data-copy="kit">${COPY}Copy order details</button>
          ${k.cart ? `<button class="btn sm" data-copy="cart">${COPY}Copy list</button>` : ''}
        </div>
        ${files}${cart || parts}
        <div class="ful-addr"><div><span class="muted">${k.ship_to.mode === 'customer' ? 'Ship to customer' : 'Ship to us'}</span>
          <pre>${esc(k.ship_to.text || 'No address')}</pre>${k.ship_to.placeholder ? '<span class="ful-bad">Placeholder: set BUILDERY_SHIP_FROM_*</span>' : ''}</div>
          <button class="btn sm" data-copy="ship">${COPY}Copy address</button></div>
      </div>
      <form class="ful-place" data-place>
        <input type="text" name="order_no" placeholder="Supplier order #" aria-label="Supplier order number" value="${esc(j.order_no || '')}">
        <input type="number" name="cost" step="0.01" min="0" placeholder="Actual cost $" aria-label="Actual cost in dollars" value="${j.cost_actual_usd ?? ''}">
        <input type="text" name="carrier" placeholder="Carrier" aria-label="Carrier" value="${esc(j.carrier || '')}">
        <input type="text" name="tracking" placeholder="Tracking #" aria-label="Tracking number" value="${esc(j.tracking || '')}">
        <input type="text" name="note" placeholder="Note" aria-label="Note" value="${esc(j.note || '')}" class="wide">
        <span class="ful-acts">${['todo', 'quoted'].includes(j.status) ? '<button class="btn sm primary" type="submit" data-mark="1">Save and mark placed</button>' : ''}<button class="btn sm" type="submit">Save</button></span>
      </form>
    </div></details>`;
}
