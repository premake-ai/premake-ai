// phonehome: the New design screen on phones (<= 860 px; /new, signed in or not; the signed-in / is the Designs list in
// web/phonedesigns.js) as a native screen, after the approved phone prototype (mobile-proto/e-pip #new). Desktop never sees any of it: the elements added
// here are display: none outside @media (max-width: 640px) in web/phone.css, and every handler checks phone() first.
// Nothing here owns state or the create flow: app.js keeps #homeForm's submit (create the project, image uploads, the
// instant sketch), guest.js its signed-out draft and sign-in, attach.js the photo inputs. This only re-lays them out:
//  1. Stage: the empty 3D viewer space (soft studio light, a faint floor grid, a floating dashed ghost box) with
//     "Describe something to make" and an "or snap a photo" pill.
//  2. A "Browse examples" link (your designs are the Designs list one screen back, so there is no Recent row).
//  3. Starter chips just above the composer.
//  4. Composer: #homeForm as the design screen's phone composer: a round "+" (photo library, take photo), a pill text
//     box and a round orange send (#homeGo). Pinned to the bottom; --app-h (visualViewport, app.js) keeps it above the keyboard.
//  5. Store: a large "Store" title over the store's own list (web/market.js keeps the page).
import { actionSheet } from './msheet.js'; // phonekit: the shared action sheet
const phone = () => matchMedia('(max-width: 640px)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = () => window.__forma?.state || {};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (d, w = 20, sw = 1.5) => `<svg viewBox="0 0 20 20" width="${w}" height="${w}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  plus: svg('M10 4v12M4 10h12', 18, 2),
  up: '<svg class="m-up" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  photo: svg('M3 5.5c0-.8.7-1.5 1.5-1.5h11c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5zM3.5 14l4-4.2 3 3 2-2 4 3.9').replace('</svg>', '<circle cx="13" cy="7.6" r="1.3" fill="currentColor"/></svg>'),
  camera: svg('M2.5 6.6c0-.9.7-1.6 1.6-1.6h2.1l1.3-1.9h5l1.3 1.9h2.1c.9 0 1.6.7 1.6 1.6v8.2c0 .9-.7 1.6-1.6 1.6H4.1c-.9 0-1.6-.7-1.6-1.6z').replace('</svg>', '<circle cx="10" cy="10.6" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'),
};
// a faint dashed box floating over the floor: where the model will appear
const GHOST = `<svg class="m-hghost" viewBox="0 0 140 132" width="132" height="124" aria-hidden="true">
  <path d="M70 14 124 42 70 70 16 42Z" fill="rgba(255,255,255,.55)"/><path d="M16 42 70 70v58L16 100Z" fill="rgba(255,255,255,.32)"/><path d="M70 70 124 42v58l-54 28Z" fill="rgba(255,255,255,.2)"/>
  <path d="M70 14v58M16 100l54-28 54 28" fill="none" stroke="#948f85" stroke-opacity=".38" stroke-width="1.2" stroke-dasharray="3.5 3"/>
  <path d="M70 14 124 42 70 70 16 42ZM16 42v58l54 28 54-28V42M70 70v58" fill="none" stroke="#948f85" stroke-opacity=".85" stroke-width="1.4" stroke-dasharray="4.5 3.2" stroke-linejoin="round"/></svg>`;
// the floor: a faint grid in perspective (lines run to a vanishing point above the stage)
const FLOOR = (() => {
  const d = [];
  for (let x = -760; x <= 1160; x += 48) d.push(`M${200 + (x - 200) * 0.06} 0L${x} 200`);
  for (const t of [0.1, 0.18, 0.28, 0.4, 0.55, 0.73, 0.95]) d.push(`M-400 ${(t * 200).toFixed(1)}H800`);
  return `<svg class="m-hfloor" viewBox="0 0 400 200" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><path d="${d.join('')}" fill="none" stroke="#1b1a17" stroke-opacity=".1" stroke-width=".8" vector-effect="non-scaling-stroke"/></svg>`;
})();
const STARTERS = [
  ['Phone stand', 'An adjustable phone stand for my desk'],
  ['Wall hook for headphones', 'A wall hook for headphones with a cable wrap'],
  ['Cable organiser', 'A desk cable organiser with five slots'],
  ['Replacement knob', 'A replacement knob, like the one in my photo', 'photo'],
];
const PH_PHONE = 'What do you want to make?';

const home = $('#home'), inner = $('#home .home-inner'), form = $('#homeForm'), ta = $('#homePrompt'), go = $('#homeGo');
if (home && inner && form && ta && go) initHome();
initStore();

function initHome() {
  // ---------------------------------------------------------------- 1. stage
  const stage = document.createElement('div');
  stage.className = 'm-hstage';
  stage.innerHTML = `${FLOOR}<div class="m-hshadow" aria-hidden="true"></div>${GHOST}
    <div class="m-hcta"><h2>Describe something to make</h2>
      <button type="button" class="m-hsnap m-glass">${I.camera}<span>or snap a photo</span></button></div>`;

  // ---------------------------------------------------------------- 2. browse examples
  const browse = document.createElement('a');
  browse.className = 'm-hbrowse'; browse.href = '/examples'; browse.textContent = 'Browse examples';

  // ---------------------------------------------------------------- 3. starter chips
  const chips = document.createElement('div');
  chips.className = 'm-hchips'; chips.setAttribute('aria-label', 'Ideas to start from');
  chips.innerHTML = '<p class="m-hchips-l">Start from one of these, or type your own.</p>' + STARTERS.map(([label], i) => `<button type="button" class="m-hchip m-glass" data-i="${i}">${esc(label)}</button>`).join('');

  inner.append(stage, browse, chips);

  // ---------------------------------------------------------------- 4. composer
  const plus = document.createElement('button');
  plus.type = 'button'; plus.className = 'm-hplus m-glass';
  plus.setAttribute('aria-label', 'Add a photo'); plus.setAttribute('aria-haspopup', 'menu'); plus.setAttribute('aria-expanded', 'false');
  plus.innerHTML = I.plus;
  const pmenu = document.createElement('div');
  pmenu.className = 'm-hpmenu m-glass'; pmenu.hidden = true; pmenu.setAttribute('role', 'menu');
  pmenu.innerHTML = `<button type="button" role="menuitem" data-p="lib">${I.photo}<span>Photo library</span></button>
    <button type="button" role="menuitem" data-p="cam">${I.camera}<span>Take photo</span></button>`;
  form.prepend(plus, pmenu);
  go.insertAdjacentHTML('beforeend', I.up);
  go.setAttribute('aria-label', 'Start building');

  const libInput = () => $$('input[type=file]', form).find(i => !i.classList.contains('cam-input'));
  function pick(kind) {
    const lib = libInput();
    if (kind === 'lib') { lib?.click(); return; }
    const cam = $('.cam-input', form);
    if (cam) cam.click();
    else if (lib) { lib.setAttribute('capture', 'environment'); lib.click(); setTimeout(() => lib.removeAttribute('capture'), 1000); }
  }
  // keep the keyboard (and the focus) where it is when "+" is pressed
  plus.addEventListener('pointerdown', e => e.preventDefault());
  pmenu.addEventListener('pointerdown', e => e.preventDefault());
  const setPm = open => { pmenu.hidden = !open; plus.setAttribute('aria-expanded', String(open)); plus.classList.toggle('on', open); };
  // phonekit: "+" opens the shared iOS action sheet (web/msheet.js), the same as the design composer's
  plus.onclick = () => { setPm(false); actionSheet({ actions: [{ label: 'Photo library', icon: I.photo, run: () => pick('lib') }, { label: 'Take photo', icon: I.camera, run: () => pick('cam') }] }); };
  document.addEventListener('pointerdown', e => { if (!pmenu.hidden && !pmenu.contains(e.target) && !plus.contains(e.target)) setPm(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pmenu.hidden) { setPm(false); plus.focus({ preventScroll: true }); } });
  pmenu.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; setPm(false); pick(b.dataset.p); });
  $('.m-hsnap', stage).onclick = () => pick('cam');

  chips.addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const [, text, hint] = STARTERS[+b.dataset.i];
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    try { ta.setSelectionRange(text.length, text.length); } catch {}
    if (hint === 'photo') { plus.classList.remove('nudge'); void plus.offsetWidth; plus.classList.add('nudge'); }
  });
  plus.addEventListener('animationend', () => plus.classList.remove('nudge'));

  // send enabled look, the pill grows with the text (phones only; desktop keeps its 3-row box)
  function syncComposer() {
    const has = !!ta.value.trim() || !!$('.att-strip', form)?.children.length;
    form.classList.toggle('m-has', has);
    if (phone()) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'; }
  }
  ta.addEventListener('input', syncComposer);
  new MutationObserver(syncComposer).observe(form, { subtree: true, childList: true });

  // phone placeholder (attach.js swaps in its own after a photo, and puts ours back)
  const desk = ta.placeholder, deskRows = ta.rows;
  function syncMode() {
    const p = phone();
    ta.rows = p ? 1 : deskRows;
    if (p && ta.placeholder === desk) ta.placeholder = PH_PHONE;
    else if (!p && ta.placeholder === PH_PHONE) ta.placeholder = desk;
    if (!p) { ta.style.height = ''; setPm(false); }
    syncComposer();
  }
  matchMedia('(max-width: 640px)').addEventListener?.('change', syncMode);
  syncMode();
}

// ---------------------------------------------------------------- 5. Store: a large title on phones
function initStore() {
  const m = $('#market');
  if (!m) return;
  const add = () => {
    const intro = $('.mk-intro', m);
    if (intro && !$('.m-ltitle', intro)) intro.insertAdjacentHTML('afterbegin', '<h1 class="m-ltitle">Store</h1>');
  };
  new MutationObserver(add).observe(m, { childList: true });
  add();
}
