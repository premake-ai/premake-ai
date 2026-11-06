// Share links. Two halves:
//  1. In the studio: the Share popover (desktop) / iOS sheet (phones) for the open design (toggleSharePop). Projects:
//     "Anyone with the link can: Edit | Make a copy" (Edit by default), Create link, copy link, native share sheet, Stop
//     sharing. Examples are always public at /d/ex-<slug>.
//  2. The public page /d/<id> (server/share.js renders its <head> with Open Graph tags): a read-only 3D viewer of the
//     latest version, title / creator / description / parts / size, and Open / Sign in, Remix, Order, Build it yourself.
//     Signed in, /d/<id> on an edit / copy link goes straight to the studio (server); this page is for signed-out
//     visitors, link unfurlers and ?preview=1.
// Server side: server/share.js.

import { statsHtml } from './stats.js'; // card-stats: "Designed in 8 min · $6.34 each"
import { track } from './analytics.js'; // analytics: PostHog events (never blocks)
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function call(url, opts = {}) {
  let r;
  try {
    r = await fetch(url, { cache: 'no-store', ...opts, headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw Object.assign(new Error('Can’t reach Premake. Check your connection and retry.'), { status: 0 }); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(d?.error || `Request failed (${r.status})`), { status: r.status });
  return d;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    const i = document.createElement('textarea'); i.value = t; i.style.position = 'fixed'; i.style.opacity = '0';
    document.body.appendChild(i); i.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    i.remove(); return ok;
  }
}
const canNativeShare = () => typeof navigator.share === 'function';

// ---------------------------------------------------------------- 1. studio popover
let pop = null;
function closePop() {
  if (!pop) return;
  pop.el.remove(); pop.btn.setAttribute('aria-expanded', 'false');
  removeEventListener('pointerdown', pop.outside, true); removeEventListener('keydown', pop.key, true); removeEventListener('hashchange', closePop); removeEventListener('forma:route', closePop);
  pop = null;
}
function place(el, btn) {
  const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 24);
  el.style.width = w + 'px';
  el.style.top = Math.round(r.bottom + 6) + 'px';
  el.style.left = Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.right - w))) + 'px';
}

/** Open (or close) the share popover under btn for the design cur ({ kind: 'project' | 'example', id, data }). */
export async function toggleSharePop(btn, cur) {
  if (pop) { const same = pop.btn === btn; closePop(); if (same) return; }
  if (!cur?.id) return;
  const el = document.createElement('div');
  el.className = 'share-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Share this design');
  document.body.appendChild(el);
  pop = { el, btn, outside: e => { if (!el.contains(e.target) && !btn.contains(e.target)) closePop(); }, key: e => { if (e.key === 'Escape') { closePop(); btn.focus(); } } };
  addEventListener('pointerdown', pop.outside, true); addEventListener('keydown', pop.key, true); addEventListener('hashchange', closePop); addEventListener('forma:route', closePop);
  btn.setAttribute('aria-expanded', 'true');
  place(el, btn);
  const title = cur.data?.meta?.title || cur.data?.manifest?.title || 'this design';
  const mine = pop;

  if (cur.kind !== 'project') { // examples: always public
    render(el, { example: true, on: true, remix: true, url: `/d/ex-${cur.id}` }, title);
    return;
  }
  el.innerHTML = '<div class="sp-body"><div class="sp-skel"></div><div class="sp-skel"></div></div>';
  let st;
  try { st = await call(`/api/projects/${encodeURIComponent(cur.id)}/share`); }
  catch (e) { if (pop === mine) el.innerHTML = `<div class="sp-body"><p class="sp-err">${esc(e.message)}</p></div>`; return; }
  if (pop !== mine) return;
  const save = async (patch) => {
    el.classList.add('busy');
    try { st = { ...await call(`/api/projects/${encodeURIComponent(cur.id)}/share`, { method: 'POST', body: { on: st.on, access: st.access, ...patch } }), id: cur.id }; }
    catch (e) { st.err = e.message; }
    el.classList.remove('busy');
    if (pop === mine) { render(el, st, title, save); if (patch.on && st.on) track('share_link_created', { access: st.access }); } // analytics:
  };
  st.id = cur.id; // handoff: the Continue on phone row needs it
  render(el, st, title, save);
}

const MODE_TXT = {
  edit: ['Edit', 'Signed-in people can change it by chatting with the agent, and order it. Sharing, the website and launching stay yours.'],
  copy: ['Make a copy', 'Signed-in people see it in the studio. Their first change makes their own copy.'],
};
const CHECK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICO = {
  link: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M8.5 11.5a3.2 3.2 0 004.6.2l2.6-2.6a3.2 3.2 0 00-4.6-4.6l-1 1M11.5 8.5a3.2 3.2 0 00-4.6-.2L4.3 10.9a3.2 3.2 0 004.6 4.6l1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 12.5V3M6.3 6.7 10 3l3.7 3.7M4.5 10.5v6h11v-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  phone: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="5.5" y="2.5" width="9" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 15h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', // handoff:
  eye: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};
const isPhone = () => matchMedia('(max-width: 640px)').matches;
const joinedTxt = n => (n ? `${n} ${n === 1 ? 'person has' : 'people have'} opened it signed in.` : '');

function render(el, st, title, save) {
  const full = st.url ? location.origin + st.url : '';
  const access = st.access === 'copy' ? 'copy' : 'edit';
  const phone = isPhone();
  el.classList.toggle('sp-ios', phone);
  if (st.example) {
    el.innerHTML = phone
      ? `<div class="sp-body"><div class="sp-top"><h3 class="sp-h">Share ${esc(title)}</h3><button class="sp-done" data-done>Done</button></div>
        <div class="sp-group">${row('copy', ICO.link, 'Copy link', esc(full))}${canNativeShare() ? row('native', ICO.share, 'Share…') : ''}</div>
        <p class="sp-foot">Examples are public. Anyone with the link can view it in 3D and remix it.</p></div>`
      : `<div class="sp-body"><h3 class="sp-h">Share ${esc(title)}</h3><p class="sp-note">Examples are public. Anyone with the link can view it in 3D and remix it.</p>
        ${linkBox(full)}</div>`;
  } else if (phone) {
    el.innerHTML = `<div class="sp-body">
      <div class="sp-top"><h3 class="sp-h">Share ${esc(title)}</h3><button class="sp-done" data-done>Done</button></div>
      ${st.on ? `<div class="sp-group">${row('copy', ICO.link, 'Copy link', esc(full.replace(/^https?:\/\//, '')))}${canNativeShare() ? row('native', ICO.share, 'Share…') : ''}${row('open', ICO.eye, 'Preview the public page')}</div>`
        : '<p class="sp-lead">Only you can see this design. Create a link to share it.</p>'}
      <h4 class="sp-gh">Anyone with the link can</h4>
      <div class="sp-group" role="radiogroup" aria-label="Anyone with the link can">
        ${['edit', 'copy'].map(k => `<button type="button" class="sp-cell sp-opt" role="radio" aria-checked="${access === k}" data-access="${k}">
          <span class="sp-cl"><b>${MODE_TXT[k][0]}</b><small>${MODE_TXT[k][1]}</small></span><span class="sp-check">${access === k ? CHECK : ''}</span></button>`).join('')}
      </div>
      ${st.on && st.members ? `<p class="sp-foot">${joinedTxt(st.members)}</p>` : ''}
      ${st.err ? `<p class="sp-err">${esc(st.err)}</p>` : ''}
      <div class="sp-group">${st.on ? '<button type="button" class="sp-cell sp-stop" data-stop>Stop sharing</button>' : '<button type="button" class="sp-cell sp-create" data-create>Create link</button>'}</div>
      ${st.on ? '<p class="sp-foot">Stop sharing turns the link off for everyone, at once.</p>' : ''}
    </div>`;
  } else {
    el.innerHTML = `<div class="sp-body">
      <h3 class="sp-h">Share ${esc(title)}</h3>
      ${st.on ? '' : '<p class="sp-note">Only you can see this design. Create a link to share it.</p>'}
      <div class="sp-field"><span class="sp-lbl" id="spModeL">Anyone with the link can</span>
        <div class="sp-seg" role="radiogroup" aria-labelledby="spModeL">${['edit', 'copy'].map(k => `<button type="button" role="radio" aria-checked="${access === k}" data-access="${k}">${MODE_TXT[k][0]}</button>`).join('')}</div>
        <small class="sp-hint">${MODE_TXT[access][1]}</small></div>
      ${st.err ? `<p class="sp-err">${esc(st.err)}</p>` : ''}
      ${st.on ? `${linkBox(full)}
        <div class="sp-actions">${canNativeShare() ? '<button class="btn sm" data-native>Share…</button>' : ''}<a class="sp-open" href="${esc(st.url)}?preview=1" target="_blank" rel="noopener">Preview public page</a></div>
        ${st.members ? `<p class="sp-note">${joinedTxt(st.members)}</p>` : ''}
        <div class="sp-end"><button type="button" class="sp-stop-link" data-stop>Stop sharing</button></div>`
        : '<button type="button" class="btn primary block" data-create>Create link</button>'}
      ${st.id ? `<button type="button" class="sp-phone" data-handoff>${ICO.phone}<span>Continue on phone</span></button>` : ''}
    </div>`;
  }
  el.querySelectorAll('[data-access]').forEach(b => b.onclick = () => {
    if (b.dataset.access === access) return;
    if (!st.on) { st.access = b.dataset.access; render(el, st, title, save); return; } // not shared yet: just the choice
    save?.({ access: b.dataset.access });
  });
  const cr = $('[data-create]', el); if (cr) cr.onclick = () => save?.({ on: true, access });
  const sp = $('[data-stop]', el); if (sp) sp.onclick = () => save?.({ on: false });
  const dn = $('[data-done]', el); if (dn) dn.onclick = () => { closePop(); };
  const cp = $('[data-copy]', el);
  if (cp) cp.onclick = async () => {
    const ok = await copyText(full);
    const lab = $('.sp-cl b', cp) || cp;
    const was = lab.textContent; lab.textContent = ok ? 'Copied' : 'Press ⌘C';
    if (!ok) $('.sp-link input', el)?.select();
    setTimeout(() => { if (lab.isConnected) lab.textContent = was; }, 1600);
  };
  const inp = $('.sp-link input', el); if (inp) inp.onfocus = () => inp.select();
  const nv = $('[data-native]', el);
  if (nv) nv.onclick = () => navigator.share({ title, text: `${title}, made with Premake`, url: full }).catch(() => {});
  const ho = $('[data-handoff]', el); // handoff: Continue on phone (web/handoff.js)
  if (ho) ho.onclick = async () => { const id = st.id; closePop(); (await import('./handoff.js')).openHandoff(id, title); };
  const op = $('[data-open]', el); if (op) op.onclick = () => open(`${st.url}?preview=1`, '_blank', 'noopener');
}
const linkBox = full => `<div class="sp-link"><input readonly value="${esc(full)}" aria-label="Share link"><button class="btn sm primary" data-copy>Copy link</button></div>`;
/** An inset-grouped list row (phones). */
const row = (k, icon, label, sub = '') => `<button type="button" class="sp-cell" data-${k}><span class="sp-ic">${icon}</span><span class="sp-cl"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;

// ---------------------------------------------------------------- 2. public page /d/<id>
const ICON = {
  remix: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 5h7.5a2.5 2.5 0 010 5H5M5 7.5L2.5 10 5 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  order: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 4.5l5.5-2.5 5.5 2.5v7L8 14l-5.5-2.5zM2.5 4.5L8 7l5.5-2.5M8 7v7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  build: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8.5h5M5.5 11h3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 10V2.5M5 5.5l3-3 3 3M3.5 8.5v5h9v-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
const mm = d => d?.length === 3 ? `${d.map(Math.round).join(' × ')} mm` : null;
const signinUrl = (p, what) => `${p.signin || '/auth/signin'}?next=${encodeURIComponent(`/d/${p.id}?do=${what}`)}`;

async function publicPage(id) {
  const root = $('#shareRoot');
  let p;
  try { p = await call(`/api/share/${encodeURIComponent(id)}`); }
  catch (e) { root.innerHTML = `<div class="sh-gone"><h1>This design isn’t shared</h1><p>${esc(e.status === 404 ? 'The link may be wrong, or the owner turned sharing off.' : e.message)}</p><a class="btn" href="/">Go to Premake</a></div>`; return; }
  track('share_opened', { share_id: id, example: id.startsWith('ex-') }); // analytics:
  const size = mm(p.size_mm);
  const joinable = p.kind === 'project' && (p.access === 'edit' || p.access === 'copy'); // signed in, the link opens the studio
  root.innerHTML = `
    <header class="sh-top"><a class="sh-brand" href="/"><span class="sh-mark" aria-hidden="true"></span>Premake</a>
      <button class="btn sm ghost" id="shShare">${ICON.share}<span>Share</span></button></header>
    <main class="sh-main">
      <section class="sh-view" aria-label="3D model of ${esc(p.title)}">
        <div class="sh-canvas" id="shCanvas"></div>
        <div class="sh-hint">Drag to rotate · scroll or pinch to zoom</div>
        ${p.has_model ? '' : '<div class="sh-empty">No 3D model yet</div>'}
      </section>
      <section class="sh-info">
        <h1>${esc(p.title)}</h1>
        <p class="sh-by">by ${esc(p.creator)}</p>
        ${statsHtml(p, 'sh-cstats')}
        ${p.description ? `<p class="sh-desc">${esc(p.description)}</p>` : ''}
        <dl class="sh-stats">
          <div><dt>Parts</dt><dd>${p.parts}${p.printed && p.printed !== p.parts ? ` <small>(${p.printed} printed)</small>` : ''}</dd></div>
          ${size ? `<div><dt>Size</dt><dd>${esc(size)}</dd></div>` : ''}
        </dl>
        <div class="sh-ctas">
          ${joinable ? `<a class="btn primary" id="shOpen" href="${esc(p.authed ? `/d/${p.id}` : signinUrl(p, 'open'))}">${ICON.remix}${p.authed ? 'Open in the studio' : p.access === 'edit' ? 'Sign in to edit' : 'Sign in to make a copy'}</a>` : ''}
          ${p.remix && !joinable ? `<button class="btn primary" id="shRemix">${ICON.remix}Remix</button>` : ''}
          ${p.orderable ? `<button class="btn" id="shOrder">${ICON.order}Order</button>` : ''}
          ${p.guide ? `<a class="btn" href="${esc(p.guide)}">${ICON.build}Build it yourself</a>` : ''}
        </div>
        ${joinable ? `<p class="sh-fine">${p.access === 'edit' ? 'Anyone with this link can change the design by chatting with the design agent, and order one.' : 'Your first change makes your own copy you can keep changing by chatting with the design agent.'}${p.authed ? '' : ' Sign in with Google first.'}</p>`
          : p.remix ? `<p class="sh-fine">${p.authed ? 'Remix makes your own copy you can change by chatting with the design agent.' : 'Remix and Order ask you to sign in first.'}</p>` : ''}
        <p class="sh-err" id="shErr" hidden></p>
      </section>
    </main>
    <footer class="sh-foot">Made with <a href="/">Premake</a>: describe a product, watch the CAD build, order 1 to 500 units.</footer>`;

  const err = m => { const e = $('#shErr'); e.textContent = m || ''; e.hidden = !m; };
  // viewer (reuses the studio's viewer.js)
  if (p.has_model) {
    try {
      const { Viewer } = await import('./viewer.js');
      const v = new Viewer($('#shCanvas'));
      const man = await call(`${p.base}manifest.json`);
      await v.load(man, p.base);
    } catch (e) { console.warn('viewer', e); $('#shCanvas').innerHTML = p.thumb ? `<img class="sh-thumb" src="${esc(p.thumb)}" alt="">` : ''; }
  }
  const remix = $('#shRemix');
  if (remix) remix.onclick = async () => {
    if (!p.authed) { location.href = signinUrl(p, 'remix'); return; }
    remix.disabled = true; err('');
    try { const r = await call('/api/projects', { method: 'POST', body: { fromShare: p.id } }); location.href = `/designs/${encodeURIComponent(r.id)}`; }
    catch (e) { err(e.status === 401 ? 'Sign in to remix.' : e.message); remix.disabled = false; }
  };
  const order = $('#shOrder');
  if (order) order.onclick = () => startOrder(p, order, err);
  $('#shShare').onclick = async () => {
    const url = location.origin + `/d/${p.id}`;
    if (canNativeShare()) { navigator.share({ title: p.title, text: `${p.title}, made with Premake`, url }).catch(() => {}); return; }
    const b = $('#shShare span'); b.textContent = (await copyText(url)) ? 'Link copied' : 'Copy failed';
    setTimeout(() => { b.textContent = 'Share'; }, 1600);
  };
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; } });
  // back from sign-in: ?do=order opens the order summary; ?do=remix only points at the button (a link never creates a copy by itself)
  const want = new URLSearchParams(location.search).get('do');
  if (want) history.replaceState(null, '', location.pathname);
  if (p.authed && want === 'order' && order) startOrder(p, order, err);
  if (p.authed && want === 'remix' && remix) { remix.focus(); remix.classList.add('sh-pulse'); }
}

async function startOrder(p, btn, err) {
  if (!p.authed) { location.href = signinUrl(p, 'order'); return; }
  btn.disabled = true; err('');
  try {
    let co = null; try { co = await import('./checkout.js'); } catch {}
    if (!co?.CHECKOUT?.enabled) { if (p.studio) location.href = p.studio; else err('Ordering opens soon. Try again later.'); return; }
    const q = await call(`/api/share/${encodeURIComponent(p.id)}/quote?mode=assembled`);
    if (q.orderable === false) { err(q.not_orderable || 'Not available to order yet. This design needs assembly.'); return; } // prices: kits only
    const tier = q.tiers.find(t => t.qty === 1) || q.tiers[0];
    const close = () => { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; };
    $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
    co.openCheckout({ title: p.title, src: p.order, mode: q.mode === 'kit' ? 'kit' : 'assembled', tier, close, errBox: e => `<div class="sh-err">${esc(e?.message || 'Something went wrong.')}</div>` });
  } catch (e) { err(e.message); }
  finally { btn.disabled = false; }
}

const pageId = document.body?.dataset?.shareId;
if (pageId) publicPage(pageId);
