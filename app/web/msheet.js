// msheet: the phone's one pop-up system (<= 860 px). Every phone pop-up looks and behaves the same:
//  1. sheet(): a bottom sheet (grab handle, rounded top, blur, a dim backdrop, swipe down / tap outside / × / Escape to
//     close). dim 'full' dims the whole screen; dim 'card' dims only under the model card, so the 3D change shows live
//     above it (Parts, Explode, a part, Look, Build steps). One sheet at a time.
//  2. actionSheet(): an iOS action sheet for confirmations and short choices: title, one line, full-width actions
//     (the main one orange), Cancel. It floats over everything, sheets included.
//  3. toast(): a small pill above the composer ("Rewound to v3   Go forward").
// Sheets made elsewhere (app.js Look, assembly.js Build steps, Share, Call Josh) use the same .m-csheet look in
// web/phone.css and register() here so they share the dim and the one-at-a-time rule. Swipe down is web/phone.js.
// Desktop never opens any of these (callers check phone()), except toast() which callers only use on phones.
const phone = () => matchMedia('(max-width: 640px)').matches;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const DUR = 380;

// ---------------------------------------------------------------- dim + registry
// REG: every sheet the dim knows about: { isOpen(), close(), dim: 'full' | 'card' | 'none', own: bool }
const REG = [];
let dimEl = null;
function dim() {
  if (dimEl) return dimEl;
  dimEl = document.createElement('div');
  dimEl.className = 'ms-dim'; dimEl.hidden = true;
  document.body.append(dimEl);
  dimEl.addEventListener('click', () => { const top = openList().pop(); top?.close(); });
  return dimEl;
}
const openList = () => REG.filter(r => { try { return r.isOpen(); } catch { return false; } });
let dimRaf = 0;
export function syncDim() {
  if (dimRaf) return;
  dimRaf = requestAnimationFrame(() => {
    dimRaf = 0;
    const d = dim(), open = phone() ? openList() : [];
    const mode = open.some(r => r.dim === 'full') ? 'full' : open.some(r => r.dim === 'card') ? 'card' : '';
    clearTimeout(d._t);
    if (!mode) { d.classList.remove('on'); d._t = setTimeout(() => { d.hidden = true; }, still() ? 0 : 300); return; }
    const card = document.body.classList.contains('m-design') && !document.body.classList.contains('m-pip') && !document.body.classList.contains('m-full3d')
      ? document.querySelector('#modelPane')?.getBoundingClientRect() : null;
    d.style.top = mode === 'card' && card ? Math.max(0, Math.round(card.bottom + 4)) + 'px' : '0px';
    d.dataset.mode = mode;
    if (d.hidden) { d.hidden = false; void d.offsetHeight; }
    d.classList.add('on');
  });
}
/** A sheet built elsewhere joins the dim and the one-at-a-time rule. Returns the entry. */
export function register(isOpen, close, dimMode = 'card', el = null) {
  const r = { isOpen, close, dim: dimMode, el };
  REG.push(r);
  return r;
}
/** Close every open sheet except keep (an entry or an element). */
export function closeOthers(keep) {
  for (const r of openList()) if (r !== keep && r.el !== keep) { try { r.close(true); } catch {} }
}
export const anyOpen = () => openList().length > 0;
/** The open sheet whose element is el (or contains it): close it. phone.js swipe-down. */
export function closeEl(el) { const r = openList().find(x => x.el && (x.el === el || x.el.contains(el))); if (r) r.close(); return !!r; }
/** The open sheet (if any) that holds el. */
export const sheetOf = el => openList().find(x => x.el && (x.el === el || x.el.contains(el)))?.el || null;
export function closeTop() { const top = openList().pop(); if (top) top.close(); return !!top; }

// ---------------------------------------------------------------- 1. sheet
/**
 * opts = { title, sub, label, cls, dim: 'full' | 'card', fit: 'card' (the space under the model card) | 'full' |
 *          'auto', html, onOpen, onClose, close: false (no ×) }
 * Returns { el, head, body, open(), close(), isOpen(), setTitle(t, sub) }. Built once, opened many times.
 */
export function sheet(opts = {}) {
  const el = document.createElement('div');
  el.className = `m-csheet ms-sheet ${opts.cls || ''}`; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', opts.label || opts.title || 'Sheet');
  if (opts.dim !== 'card') el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="m-cs-head"><div class="m-grab" aria-hidden="true"></div><b class="m-cs-title"></b><span class="m-cs-n"></span>
    ${opts.close === false ? '' : `<button type="button" class="m-cs-x" aria-label="Close">${X}</button>`}</div><div class="m-cs-body"></div>`;
  document.body.append(el);
  const head = el.querySelector('.m-cs-head'), body = el.querySelector('.m-cs-body');
  let isOpen = false, returnFocus = null;
  const api = {
    el, head, body,
    isOpen: () => isOpen,
    setTitle(t, sub = '') { el.querySelector('.m-cs-title').textContent = t || ''; el.querySelector('.m-cs-n').textContent = sub || ''; if (t) el.setAttribute('aria-label', t); },
    open() {
      if (!phone()) return api;
      if (!isOpen) closeOthers(entry);
      clearTimeout(el._t);
      fit();
      if (!isOpen) { returnFocus = document.activeElement; isOpen = true; el.hidden = false; void el.offsetHeight; el.classList.add('on'); opts.onOpen?.(api); }
      syncDim();
      return api;
    },
    close(quick) {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove('on'); el.style.transform = '';
      clearTimeout(el._t);
      el._t = setTimeout(() => { if (!isOpen) { el.hidden = true; el.style.transform = ''; } }, quick === true || still() ? 0 : DUR);
      syncDim();
      opts.onClose?.(api);
      if (returnFocus?.isConnected && el.contains(document.activeElement)) returnFocus.focus?.({ preventScroll: true });
    },
    fit,
  };
  function fit() {
    el.classList.toggle('ms-tall', opts.fit === 'full');
    if (opts.fit === 'card') {
      const r = document.querySelector('#modelPane')?.getBoundingClientRect();
      const top = document.body.classList.contains('m-design') && r && !document.body.classList.contains('m-pip') ? r.bottom : innerHeight * 0.4;
      el.style.maxHeight = Math.max(240, Math.min(innerHeight - 60, innerHeight - top - 8)) + 'px';
    } else if (opts.fit !== 'full') el.style.maxHeight = '';
  }
  if (opts.title) api.setTitle(opts.title, opts.sub);
  if (opts.html) body.innerHTML = opts.html;
  el.querySelector('.m-cs-x')?.addEventListener('click', () => api.close());
  const entry = register(() => isOpen, q => api.close(q), opts.dim || 'full', el);
  entry.sheet = api;
  addEventListener('resize', () => { if (isOpen) fit(); });
  return api;
}

// ---------------------------------------------------------------- 2. action sheet
let actEl = null, actDim = null, actDone = null;
/**
 * opts = { title, message, actions: [{ label, run, style: 'primary' (orange, default for the first) | 'default' |
 *          'destructive', icon }], cancel: 'Cancel' }
 * Each action's run() is called inside the tap (so it may open a file picker). Returns a Promise of the picked index
 * (-1 for Cancel / outside).
 */
export function actionSheet(opts = {}) {
  if (!actEl) {
    actDim = document.createElement('div'); actDim.className = 'ms-adim'; actDim.hidden = true;
    actEl = document.createElement('div'); actEl.className = 'ms-action'; actEl.hidden = true;
    actEl.setAttribute('role', 'alertdialog'); actEl.setAttribute('aria-modal', 'true');
    document.body.append(actDim, actEl);
    actDim.addEventListener('click', () => endAction(-1));
    actEl.addEventListener('click', e => {
      const b = e.target.closest('[data-ai]'); if (!b) return;
      endAction(+b.dataset.ai);
    });
    // keep the keyboard where it is (the composer's "+")
    actEl.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && actEl && !actEl.hidden && actEl.classList.contains('on')) { e.stopPropagation(); endAction(-1); } }, true);
  }
  if (actDone) endAction(-1, true);
  const acts = opts.actions || [];
  actEl.setAttribute('aria-label', opts.title || 'Choose');
  actEl.innerHTML = `<div class="ms-agroup">${opts.title || opts.message ? `<div class="ms-ahead">${opts.title ? `<b>${esc(opts.title)}</b>` : ''}${opts.message ? `<p>${esc(opts.message)}</p>` : ''}</div>` : ''}
    <div class="ms-abtns">${acts.map((a, i) => `<button type="button" class="ms-abtn ${a.style || (i === 0 && acts.length === 1 ? 'primary' : 'default')}" data-ai="${i}">${a.icon || ''}<span>${esc(a.label)}</span></button>`).join('')}</div></div>
    <button type="button" class="ms-acancel" data-ai="-1">${esc(opts.cancel || 'Cancel')}</button>`;
  actEl._acts = acts;
  return new Promise(res => {
    actDone = res;
    clearTimeout(actEl._t);
    actDim.hidden = false; actEl.hidden = false; void actEl.offsetHeight;
    actDim.classList.add('on'); actEl.classList.add('on');
    setTimeout(() => actEl.querySelector('.ms-abtn')?.focus({ preventScroll: true }), 60);
  });
}
function endAction(i, quick) {
  if (!actEl || !actDone) return;
  const done = actDone; actDone = null;
  const a = actEl._acts?.[i];
  if (a?.run) { try { a.run(); } catch (e) { console.warn(e); } }
  actEl.classList.remove('on'); actDim.classList.remove('on');
  clearTimeout(actEl._t);
  actEl._t = setTimeout(() => { if (!actDone) { actEl.hidden = true; actDim.hidden = true; } }, quick || still() ? 0 : 320);
  done(a ? i : -1);
}
/** Yes / no: resolves true when the action was picked. */
export async function confirmSheet({ title, message, action, cancel, destructive }) {
  const i = await actionSheet({ title, message, cancel, actions: [{ label: action, style: destructive ? 'destructive' : 'primary' }] });
  return i === 0;
}

// ---------------------------------------------------------------- 3. toast
let tEl = null;
/** opts = { action: { label, run } | { label, href }, ms } */
export function toast(msg, opts = {}) {
  if (!tEl) {
    tEl = document.createElement('div');
    tEl.className = 'ms-toast'; tEl.hidden = true; tEl.setAttribute('role', 'status'); tEl.setAttribute('aria-live', 'polite');
    document.body.append(tEl);
    tEl.addEventListener('click', e => {
      const b = e.target.closest('[data-ta]'); if (!b) return;
      const a = tEl._a; hideToast();
      if (a?.run) { e.preventDefault(); a.run(); }
    });
  }
  const a = opts.action || null;
  tEl._a = a;
  tEl.innerHTML = `<span class="ms-tmsg">${esc(msg)}</span>${a ? (a.href ? `<a class="ms-tact" data-ta href="${esc(a.href)}">${esc(a.label)}</a>` : `<button type="button" class="ms-tact" data-ta>${esc(a.label)}</button>`) : ''}`;
  tEl.classList.toggle('has-act', !!a);
  clearTimeout(tEl._t); clearTimeout(tEl._h);
  if (tEl.hidden) { tEl.hidden = false; void tEl.offsetHeight; }
  tEl.classList.add('on');
  tEl._t = setTimeout(hideToast, opts.ms || (a ? 6000 : 2400));
}
function hideToast() {
  if (!tEl) return;
  tEl.classList.remove('on');
  clearTimeout(tEl._t); clearTimeout(tEl._h);
  tEl._h = setTimeout(() => { if (!tEl.classList.contains('on')) tEl.hidden = true; }, still() ? 0 : 300);
}

// Escape: the top sheet (action sheets handle their own, first)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !phone()) return;
  const own = openList().filter(r => r.sheet);
  if (own.length) { e.stopPropagation(); own.pop().close(); }
}, true);
addEventListener('resize', () => syncDim());

window.__ms = { sheet, actionSheet, confirmSheet, toast, register, closeOthers, closeTop, closeEl, sheetOf, syncDim, anyOpen }; // phone.js swipe-down, app.js
