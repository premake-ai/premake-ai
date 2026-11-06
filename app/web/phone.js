// phone: the studio as a phone app (<= 860 px; styles.css "Phone app"). Nothing here owns app state: app.js keeps
// routing, panels and modals; this adds the native-feeling layer around them. Loaded by the studio (index.html) and the
// build page (buildpage.js); each part checks that its elements exist.
//  1. Top bar: the studio's floating glass bar lives in web/phonestudio.js; this keeps the back-button history.
//  2. Push / pop: a horizontal slide along the list -> detail stack (Designs -> New design / Examples / Store / Orders
//     -> a design; nav.js phoneDepth). Back slides right. There is no projects drawer on phones: Designs is a full page
//     (web/phonedesigns.js).
//  3. Sheets: the dialog modal (checkout), the account menu, Versions, Share and Call Josh are bottom sheets with a grab handle.
//     Drag one down to dismiss it; a dim backdrop catches taps outside.
// Respects prefers-reduced-motion (no slides; sheets just appear).

import { go, phoneDepth } from './nav.js'; // phonenav: the screen depth comes from the clean path

const phone = () => matchMedia('(max-width: 640px)').matches;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const body = document.body;

// ---------------------------------------------------------------- 1. top bar
// The studio's floating glass bar (back, title pill, right menu) is web/phonestudio.js. This keeps the back button in
// step with the browser history: each history entry remembers the path it was opened from (history.state.mprev), so
// back is history.back() when that path is the screen below this one (browser back and forward then match the stack),
// else (a deep link, a reload) it goes to the parent: an example's gallery, otherwise Designs (the guests' New design).
const studio = $('#studio');
let lastPath = location.pathname;
function stamp(prev) {
  const st = history.state;
  if (st && typeof st === 'object' && 'mprev' in st) return;
  try { history.replaceState({ ...(st && typeof st === 'object' ? st : {}), mprev: prev }, ''); } catch {}
}
if (studio) {
  stamp(null);
  window.__phoneBack = () => {
    const prev = history.state?.mprev;
    if (prev != null && phoneDepth(prev) < phoneDepth()) { history.back(); return; }
    const m = location.pathname.split('/').filter(Boolean);
    go(m[0] === 'examples' && m[1] ? '/examples' : '#/');
  };
}

// ---------------------------------------------------------------- 2. push / pop
function slide(dir) {
  if (still() || !phone()) return;
  const el = ['#mDesigns', '#studio', '#market', '#orders', '#guidePage', '#launch'].map(s => $(s)).find(x => x && !x.hidden);
  if (!el) return;
  el.classList.remove('m-push', 'm-pop');
  void el.offsetWidth; // restart the animation
  el.classList.add(dir);
  el.addEventListener('animationend', () => el.classList.remove(dir), { once: true });
  setTimeout(() => el.classList.remove(dir), 600); // a backgrounded page may never fire animationend
}
addEventListener('forma:route', () => {
  const was = lastPath, now = location.pathname;
  if (now === was) return;
  stamp(was);
  lastPath = now;
  const a = phoneDepth(was), b = phoneDepth(now);
  // after app.js's own forma:route handler has swapped the screen (it may be registered after this one), before paint
  if (b !== a) requestAnimationFrame(() => slide(b > a ? 'm-push' : 'm-pop'));
});

// ---------------------------------------------------------------- 3. sheets
// Each: [the sheet element, is it open, close it]. Drag starts on the sheet's top 56 px, or anywhere when it is
// scrolled to the top and the finger moves down.
const SHEETS = [
  [() => $('#modal:not([hidden]) .modal'), () => { const w = $('#modal'); w?.dispatchEvent(new MouseEvent('click', { bubbles: true })); if (w && !w.hidden) { w.hidden = true; $('#modalBox').innerHTML = ''; } }],
  [() => $('.conn .acct[open] .acct-menu'), () => { const d = $('.conn .acct[open]'); if (d) d.open = false; }],
  [() => $('#verPop:not([hidden])'), () => $('#verBtn')?.click()],
  [() => $('.share-pop'), () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
  [() => $('.sup-pop:not([hidden])'), () => $('.sup-pop .sup-x')?.click()], // call: the Chat pane's "Call Josh" sheet (support.js)
  [() => $('.m-cs-asm.on'), () => window.__forma?.state?.viewer?.assembly?.steps?.close()], // the build steps (assembly.js)
  [t => [...document.querySelectorAll('.ms-sheet.on')].find(x => x.contains(t)) || null, el => window.__ms?.closeEl(el)], // phonekit (web/msheet.js): the menu, Order, Launch, Versions, Parts, Explode, a part
  [() => $('.render-bar.m-look.on:not([hidden])'), () => { if ($('#renderBtn')?.classList.contains('on')) $('#renderBtn').click(); }], // the ☆ Look sheet (app.js)
];
let sd = null; // { el, close, y0, dy, t0, drag }
addEventListener('touchstart', e => {
  if (!phone() || e.touches.length !== 1) return;
  for (const [get, close] of SHEETS) {
    const el = get(e.target);
    if (!el || !el.contains(e.target)) continue;
    const t = e.touches[0], top = el.getBoundingClientRect().top;
    const scroller = e.target.closest('.modal, .acct-menu, .ver-pop, .share-pop, .ver-list, .modal-body, .m-cs-body > .pane, .lk-body, .m-cs-body');
    const atTop = !scroller || scroller.scrollTop <= 0;
    if (t.clientY - top < 56 || atTop) sd = { el, close, x0: t.clientX, y0: t.clientY, dy: 0, t0: e.timeStamp, drag: false, head: t.clientY - top < 56 };
    return;
  }
}, { passive: true });
addEventListener('touchmove', e => {
  if (!sd) return;
  const dy = e.touches[0].clientY - sd.y0;
  if (!sd.drag) {
    if (dy < -6) { sd = null; return; } // scrolling the sheet's content up
    if (dy < 6) return;
    if (Math.abs(e.touches[0].clientX - sd.x0) > dy) { sd = null; return; } // sideways (the Look sheet's swatch row)
    if (e.target.closest('input[type=range], textarea')) { sd = null; return; }
    sd.drag = true; sd.el.style.transition = 'none';
  }
  e.preventDefault();
  sd.dy = Math.max(0, dy);
  sd.el.style.transform = `translateY(${sd.dy}px)`;
}, { passive: false });
function sheetEnd(e) {
  if (!sd) return;
  const s = sd; sd = null;
  if (!s.drag) return;
  const h = s.el.offsetHeight, fast = e.timeStamp - s.t0 < 250 && s.dy > 40;
  if (s.dy > Math.min(140, h * 0.3) || fast) {
    if (still()) { s.el.style.transform = ''; s.el.style.transition = ''; s.close(s.el); return; }
    s.el.style.transition = 'transform .2s ease-in';
    s.el.style.transform = `translateY(${h + 20}px)`;
    setTimeout(() => { s.close(s.el); s.el.style.transform = ''; s.el.style.transition = ''; }, 190);
  } else {
    s.el.style.transition = 'transform .25s cubic-bezier(.3, .8, .25, 1)';
    s.el.style.transform = '';
    setTimeout(() => { s.el.style.transition = ''; }, 260);
  }
}
addEventListener('touchend', sheetEnd); addEventListener('touchcancel', sheetEnd);

// A dim layer under the small sheets (Versions, Share) that catches taps outside them. The modal and the account menu
// bring their own (the modal's wrapper, the menu's ::before).
const dim = document.createElement('div');
dim.className = 'm-dim'; dim.hidden = true;
body.append(dim);
dim.addEventListener('click', () => { /* the sheets' own outside-tap handlers close them */ });
function syncDim() {
  const on = phone() && !!($('#verPop:not([hidden])') || $('.share-pop'));
  if (dim.hidden === on) dim.hidden = !on;
}
new MutationObserver(syncDim).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
// account menu: a tap on its backdrop (the details element's ::before) closes it
document.addEventListener('click', e => { if (e.target.matches?.('.conn .acct[open]')) { e.preventDefault(); e.target.open = false; } });
