// phonestudio: the studio on phones (<= 860 px), after the approved phone prototype. Desktop never runs any of it: every
// handler checks phone() first, and the styles are in web/phone.css under @media (max-width: 640px). Nothing here owns
// app state; app.js keeps routing, chat and panels (hooks: window.__forma.setRtab, 'forma:rtab', 'forma:sent').
//  1. Floating glass top bar: left round button (back on every screen below Designs; none on Designs itself, there is no
//     projects drawer on phones: web/phonedesigns.js is the full-page list), the screen name in
//     a centre pill with a small spinner while an agent works elsewhere (inside a design the chat line and card say it), right round button (≡ menu, green dot when Josh can
//     take a video call).
//  2. Right menu: a glass bottom sheet with Order, Launch, App (a design with electronics), Share, Versions (in a design) or Examples, Store, Orders
//     (elsewhere), then Call Josh and Account.
//  3. Order and Launch: full-height sheets that hold #orderPane / #launchPane while open (moved back on close).
//  4. Model card: small glass icon buttons in its corner (Explode with a compact slider, See-through, Render, Move),
//     a "Drag to rotate · tap a part" hint, and the viewer's presentation look (viewer.setPresentation).
//  5. Composer: a round "+" (photo library, take photo, screenshot), a pill text box, send that is Stop while the
//     agent runs and the box is empty (typing while it runs still queues).
//  6. Typing: the model card flies to a floating, still turning thumbnail in the top corner (drag it to either side,
//     tap it to close the keyboard and bring the card back). Scrolling back through the chat does the same.
//     Sending closes the keyboard and brings the card back so the change is seen landing.
import { ACCESS } from './api.js';
import { current, go, isGuest, phoneDepth } from './nav.js'; // urls: clean URLs; current() is the route in the old #/ shape
import { sheet, actionSheet, toast as msToast, register, closeOthers, syncDim, anyOpen } from './msheet.js'; // phonekit: every pop-up
import { FILAMENTS } from './hover.js'; // phonekit: the part sheet's colour swatches

const phone = () => matchMedia('(max-width: 640px)').matches;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const body = document.body;
const F = () => window.__forma || {};
const S = () => F().state || {};
const svg = (d, w = 20, sw = 2) => `<svg viewBox="0 0 20 20" width="${w}" height="${w}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const I = {
  back: '<svg viewBox="0 0 12 20" width="11" height="18" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: svg('M3.5 6h13M3.5 10h13M3.5 14h13', 20, 1.9),
  examples: svg('M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z', 20, 1.5),
  store: svg('M3.5 7.5h13l-1 9h-11zM7 7.5V6a3 3 0 0 1 6 0v1.5', 20, 1.5),
  orders: svg('M3 6l7-3 7 3v8l-7 3-7-3zM3 6l7 3 7-3M10 9v8', 20, 1.5),
  x: svg('M5 5l10 10M15 5L5 15', 16, 2),
  order: svg('M3 4.5h2l1.6 8.2h8.3L16.5 7H6', 20, 1.6) .replace('</svg>', '<circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="14" cy="16" r="1.2" fill="currentColor"/></svg>'),
  launch: svg('M11.8 3.2c2.8 0 5 2.2 5 5L11.2 13.8 6.2 8.8zM6.2 8.8 3 9.4 1.8 12.4l3.8-.6M11.2 13.8l-.6 3.2-3 1.2.6-3.8', 20, 1.5),
  share: svg('M10 12.5V3M6.3 6.7 10 3l3.7 3.7M4.5 10.5v6h11v-6', 20, 1.6),
  flash: svg('M6 6h8v8H6zM8 3.5V6M12 3.5V6M8 14v2.5M12 14v2.5M3.5 8H6M3.5 12H6M14 8h2.5M14 12h2.5', 20, 1.5), // firmware: a chip
  versions: svg('M10 3.2a6.8 6.8 0 1 1-6.5 4.7M3.2 3.5v4.4h4.4M10 6.5V10l2.6 1.8', 20, 1.6),
  call: svg('M2.5 6.2c0-.9.7-1.6 1.6-1.6h7.3c.9 0 1.6.7 1.6 1.6v7.6c0 .9-.7 1.6-1.6 1.6H4.1c-.9 0-1.6-.7-1.6-1.6zM13 8.6l4.5-2.6v8l-4.5-2.6', 20, 1.6),
  user: svg('M10 10.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM3.6 17c.8-3 3.4-4.6 6.4-4.6s5.6 1.6 6.4 4.6', 20, 1.6),
  out: svg('M8 3.5H4.5v13H8M12 6.5 15.5 10 12 13.5M15.5 10H8', 20, 1.6),
  admin: svg('M10 2.8 16 5v4.6c0 3.6-2.6 6.4-6 7.6-3.4-1.2-6-4-6-7.6V5z', 20, 1.6),
  chev: svg('M8 5l5 5-5 5', 16, 1.8),
  reset: svg('M4.6 7.6A6 6 0 1 1 4.2 12M4 3.6v4.2h4.2', 20, 1.7), // reset view
  explode: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M8 1v4M8 11v4M1 8h4M11 8h4M3 3l2.5 2.5M13 13l-2.5-2.5M13 3l-2.5 2.5M3 13l2.5-2.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>',
  wire: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><circle cx="3.2" cy="4" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12.8" cy="12" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.9 4c5 0 1.2 8 6.2 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>', // wireview
  ghost: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/></svg>',
  render: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M8 1.8l1.5 3.6 3.7.3-2.8 2.5.9 3.7L8 9.9l-3.3 2 .9-3.7-2.8-2.5 3.7-.3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  steps: svg('M7.5 5h9M7.5 10h9M7.5 15h9', 20, 1.7).replace('</svg>', '<circle cx="3.6" cy="5" r="1.3" fill="currentColor"/><circle cx="3.6" cy="10" r="1.3" fill="currentColor"/><circle cx="3.6" cy="15" r="1.3" fill="currentColor"/></svg>'),
  power: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M8 1.8v5.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.6 4a5.2 5.2 0 106.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  move: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  plus: svg('M10 4v12M4 10h12', 18, 2),
  photo: svg('M3 5.5c0-.8.7-1.5 1.5-1.5h11c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5zM3.5 14l4-4.2 3 3 2-2 4 3.9', 20, 1.5).replace('</svg>', '<circle cx="13" cy="7.6" r="1.3" fill="currentColor"/></svg>'),
  camera: svg('M2.5 6.6c0-.9.7-1.6 1.6-1.6h2.1l1.3-1.9h5l1.3 1.9h2.1c.9 0 1.6.7 1.6 1.6v8.2c0 .9-.7 1.6-1.6 1.6H4.1c-.9 0-1.6-.7-1.6-1.6z', 20, 1.5).replace('</svg>', '<circle cx="10" cy="10.6" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'),
  shot: svg('M3 7V4.5C3 3.7 3.7 3 4.5 3H7M13 3h2.5c.8 0 1.5.7 1.5 1.5V7M17 13v2.5c0 .8-.7 1.5-1.5 1.5H13M7 17H4.5C3.7 17 3 16.3 3 15.5V13', 20, 1.5).replace('</svg>', '<rect x="7" y="7" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'),
  app: svg('M6.5 2.5h7c.8 0 1.5.7 1.5 1.5v12c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5zM8.8 15h2.4', 20, 1.6), // apps: the companion app
  undo: svg('M7.5 4.5 3.8 8.2l3.7 3.7M4 8.2h7.6a4.4 4.4 0 0 1 0 8.8H9', 20, 1.6),
  redo: svg('M12.5 4.5l3.7 3.7-3.7 3.7M16 8.2H8.4a4.4 4.4 0 0 0 0 8.8H11', 20, 1.6),
  text: svg('M2.8 15.5 6.6 5.5l3.8 10M4.1 12.2h5M12.2 15.5l2.6-6.6 2.6 6.6M13.1 13.3h3.4', 20, 1.5),
  play: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M6.6 4.2v11.6c0 .6.6.9 1.1.6l9-5.8a.7.7 0 0 0 0-1.2l-9-5.8c-.5-.3-1.1 0-1.1.6z" fill="currentColor"/></svg>',
  full: svg('M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4', 20, 1.7),
  unfull: svg('M7.5 3.5v4h-4M12.5 3.5v4h4M7.5 16.5v-4h-4M12.5 16.5v-4h4', 20, 1.7),
  ask: svg('M4 4.5h12c.6 0 1 .4 1 1v7.5c0 .6-.4 1-1 1H9.5L6 16.8V14H4c-.6 0-1-.4-1-1V5.5c0-.6.4-1 1-1z', 20, 1.6),
  hide: svg('M3 3l14 14M8.6 4.7A8 8 0 0 1 10 4.6c4.6 0 7.4 5.4 7.4 5.4a13 13 0 0 1-2.3 3M5.2 5.6A13 13 0 0 0 2.6 10s2.8 5.4 7.4 5.4a7.7 7.7 0 0 0 4.1-1.2M8.3 8.3a2.4 2.4 0 0 0 3.4 3.4', 20, 1.5),
  only: svg('M10 2.8l6.2 3.6v7.2L10 17.2l-6.2-3.6V6.4zM3.8 6.4 10 10l6.2-3.6M10 10v7.2', 20, 1.5),
  showall: svg('M2.6 10S5.4 4.6 10 4.6s7.4 5.4 7.4 5.4-2.8 5.4-7.4 5.4S2.6 10 2.6 10z', 20, 1.5).replace('</svg>', '<circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'),
  material: svg('M10 2.8c3 3.4 5 6.2 5 8.7a5 5 0 0 1-10 0c0-2.5 2-5.3 5-8.7z', 20, 1.5),
  link: svg('M8 4.5H4.5v11h11V12M11.5 3.5h5v5M16.3 3.7 9.5 10.5', 20, 1.5),
};

const studio = $('#studio'), topbar = $('.topbar:not(.bp-top)');
if (studio && topbar) init();

function init() {
  // ---------------------------------------------------------------- route helpers
  const hashParts = () => current().replace(/^\/?/, '').split('?')[0].split('/').filter(Boolean);
  /** A design is open: #/p/<id>, #/examples/<slug>, #/site|ads/p|examples/<id>, #/launch/p|examples/<id>. */
  function inDesignRoute() {
    const p = hashParts();
    if ((p[0] === 'p' || p[0] === 'examples') && p[1]) return true;
    if (['site', 'ads', 'launch', 'app'].includes(p[0]) && (p[1] === 'p' || p[1] === 'examples') && p[2]) return true;
    return false;
  }
  /** phonenav: the signed-in / on a phone is the Designs list (web/phonedesigns.js); /new is New design. */
  const designsScreen = () => !isGuest() && phoneDepth() === 0 && !hashParts().length;
  const designScreen = () => phone() && !studio.hidden && studio.classList.contains('mode-work') && inDesignRoute();
  const ownDesign = () => S().cur?.kind === 'project' && !S().cur?.readOnly && (!S().cur.role || S().cur.role === 'owner'); // share: not designs shared with you
  function screenTitle() {
    const p = hashParts(), crumb = $('#crumb b')?.textContent?.trim() || '';
    if (inDesignRoute()) return crumb || 'Design';
    if (!p.length) return designsScreen() ? 'Designs' : 'New design'; // phonenav: / is Designs (web/phonedesigns.js), /new the new-design screen (web/phonehome.js)
    if (p[0] === 'examples') return 'Examples';
    if (p[0] === 'store') return 'Store';
    return crumb || 'Premake';
  }

  // ---------------------------------------------------------------- 1. top bar
  topbar.classList.add('m-bar');
  const left = document.createElement('button');
  left.type = 'button'; left.className = 'm-bl m-glass';
  const mid = document.createElement('div');
  mid.className = 'm-bt';
  mid.innerHTML = '<button type="button" class="m-btp m-glass" tabindex="-1"><span class="m-spin" hidden></span><span class="m-btt"></span></button>';
  const right = document.createElement('button');
  right.type = 'button'; right.className = 'm-br m-glass';
  right.setAttribute('aria-label', 'Menu'); right.setAttribute('aria-haspopup', 'dialog');
  right.innerHTML = I.menu + '<span class="m-dot" hidden></span>';
  topbar.append(left, mid, right);
  const pillBtn = $('.m-btp', mid);
  left.onclick = () => { (window.__phoneBack || (() => { go('#/'); }))(); }; // phonenav: always back (web/phone.js)
  pillBtn.onclick = () => { // working somewhere else: the pill takes you there
    const ri = $('#runInd');
    if (!inDesignRoute() && ri && !ri.hidden && ri.getAttribute('href')) go(ri.getAttribute('href'));
  };
  right.onclick = () => openMenu();

  let joshOn = false;
  document.addEventListener('forma:josh', e => { joshOn = !!e.detail?.on; syncBar(); });
  let support = null;
  import('./support.js').then(m => { support = m.supportBubble; support.check?.(false); }).catch(() => {});
  setInterval(() => { if (phone() && !document.hidden) support?.check?.(false); }, 60000);

  const busyNow = () => {
    const ri = $('#runInd');
    return (!!ri && !ri.hidden) || (inDesignRoute() && !!S().chat?.live?.running);
  };
  function syncBar() {
    if (!phone()) { body.classList.remove('m-design', 'm-busy', 'm-home'); return; }
    const design = inDesignRoute();
    const kind = phoneDepth() > 0 ? 'back' : 'none'; // phonenav: the root screen (Designs, or a guest's New design) has no back
    if (left.dataset.k !== kind) {
      left.dataset.k = kind;
      left.innerHTML = kind === 'back' ? I.back : '';
      left.setAttribute('aria-label', 'Back');
      left.toggleAttribute('hidden', kind === 'none');
    }
    const hm = !studio.hidden && studio.classList.contains('mode-home');
    if (body.classList.contains('m-home') !== hm) body.classList.toggle('m-home', hm);
    const t = screenTitle();
    const tt = $('.m-btt', mid);
    if (tt.textContent !== t) tt.textContent = t;
    // inside a design: busy only means THIS design is being worked on (the chat shows it, the thumbnail gets a dot);
    // other designs' runs show on the Designs list, not as a spinner on an unrelated design's title
    const busy = design ? !!S().chat?.live?.running : busyNow();
    $('.m-spin', mid).hidden = design || !busy;
    pillBtn.setAttribute('aria-label', busy ? `${t}, AI working` : t);
    if (body.classList.contains('m-busy') !== busy) body.classList.toggle('m-busy', busy);
    $('.m-dot', right).hidden = !joshOn;
    right.setAttribute('aria-label', joshOn ? 'Menu. Josh is available for a call' : 'Menu');
    const ds = designScreen();
    if (body.classList.contains('m-design') !== ds) {
      body.classList.toggle('m-design', ds);
      if (ds) setTimeout(() => resetView(false), 0); // 3. the card opens fresh: camera, zoom and explode back to the start
      else setFull(false);
    }
    syncCard();
  }

  // ---------------------------------------------------------------- sheets (menu, Order, Launch, Versions): web/msheet.js
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** An inset grouped list row. k: data-m key (a button) or href (a link); v: the right-hand value. */
  function row(k, icon, label, v = '', o = {}) {
    const inner = `<span class="ms-ic">${icon}</span><span class="ms-l">${label}${o.small ? `<small>${o.small}</small>` : ''}</span>${v ? `<span class="ms-v">${v}</span>` : ''}${o.chev === false ? '' : `<span class="ms-chev">${I.chev}</span>`}`;
    if (o.href) return `<a class="ms-row ${o.cls || ''}" href="${escH(o.href)}">${inner}</a>`;
    return `<button type="button" class="ms-row ${o.cls || ''}" data-m="${k}" ${o.disabled ? 'disabled' : ''}>${inner}</button>`;
  }
  const list = rows => rows.length ? `<div class="ms-list">${rows.join('')}</div>` : '';

  // 12. text size: Small / Default / Large / Larger, remembered; scales the chat and the sheets (phone.css [data-ts])
  const TS = [['s', 'Small'], ['m', 'Default'], ['l', 'Large'], ['xl', 'Larger']];
  const tsNow = () => { try { const v = localStorage.getItem('formery.textSize'); return TS.some(t => t[0] === v) ? v : 'm'; } catch { return 'm'; } };
  const applyTs = v => { if (v === 'm') delete document.documentElement.dataset.ts; else document.documentElement.dataset.ts = v; };
  applyTs(tsNow());
  const tsHtml = () => { const now = tsNow(), i = TS.findIndex(t => t[0] === now);
    return `<div class="ms-sec">Text size</div><div class="ms-seg" style="--n:4;--i:${i}" role="radiogroup" aria-label="Text size">${TS.map(([k, t], j) =>
      `<button type="button" role="radio" data-ts="${k}" aria-checked="${k === now}" class="${k === now ? 'on' : ''}"><span style="font-size:${[13, 15, 17, 19][j]}px">${t}</span></button>`).join('')}</div>`; };

  // 2. right menu
  const menu = sheet({ cls: 'ms-menu', label: 'Menu', dim: 'full', onClose: () => right.focus({ preventScroll: true }) });
  function openMenu() {
    const design = inDesignRoute() && !!S().cur;
    const rows = [], hist = [];
    if (design) {
      rows.push(row('order', I.order, 'Order', 'Where to buy')); // order tab: shops per part, not our checkout price
      const lb = $('#launchBtn');
      if (lb && !lb.hidden && !lb.disabled) rows.push(row('launch', svg('M10 3v10M5.5 9 10 13.5 14.5 9M4 17h12', 20, 1.5), 'Make'));
      const app = S().cur?.data?.app || null; // apps: the App sheet (open the companion app full screen, or build it)
      if (S().cur?.kind === 'project' ? app?.show : app?.exists) rows.push(row('app', I.app, S().cur?.kind === 'project' ? 'App' : 'Try the app', S().cur?.kind === 'project' && !app.exists ? 'Not built yet' : ''));
      if ($('#asmTabBtn') && !$('#asmTabBtn').hidden) rows.push(row('assemble', I.flash, 'Assemble', 'Print, wire, flash, test')); // assemble: web/assemble.js
      if ($('#shareBtn') && !$('#shareBtn').hidden) rows.push(row('share', I.share, 'Share'));
      // 2. undo and the version history (the row above the composer is gone on phones)
      const h = F().history?.();
      if (h?.versions?.length && F().canEdit?.()) {
        const busy = !!F().historyBusy?.();
        hist.push(row('undo', I.undo, 'Undo last change', h.current_v ? `v${h.current_v}` : 'Original', { chev: false, disabled: busy || !h.can_undo }));
        if (h.can_redo) hist.push(row('redo', I.redo, 'Redo', '', { chev: false, disabled: busy }));
        hist.push(row('versions', I.versions, 'Version history', `${h.versions.length + 1}`));
      }
      if (ownDesign() && window.premakeDuplicate) rows.push(row('dup', '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M16 5V4.5A1.5 1.5 0 0 0 14.5 3h-10A1.5 1.5 0 0 0 3 4.5v10A1.5 1.5 0 0 0 4.5 16H5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>', 'Duplicate')); // duplicate:
      if (ownDesign() && window.formeryRename) rows.push(row('rename', '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>', 'Rename')); // agentbrain: web/rename.js
    } else { // phonenav: the pages that used to live in the projects drawer
      const at = location.pathname.split('/')[1] || '';
      if (at !== 'examples') rows.push(row('examples', I.examples, 'Examples'));
      if (at !== 'store') rows.push(row('store', I.store, 'Store'));
      if (at !== 'orders' && $('#sideOrders') && !$('#sideOrders').hidden) rows.push(row('orders', I.orders, 'Orders'));
    }
    const more = [];
    if (support?.supported?.()) more.push(row('call', I.call, 'Call Josh', joshOn ? '<span class="m-on">Available now</span>' : ''));
    // account: the avatar menu's email, Admin and Sign out (the bar's own avatar is hidden on phones)
    const acct = [];
    const email = $('#conn .acct-email')?.textContent?.trim();
    if (email) {
      acct.push(`<div class="ms-row m-acct-email"><span class="ms-ic">${I.user}</span><span class="ms-l">${escH(email)}</span></div>`);
      for (const a of $$('#conn .acct-menu a')) {
        const href = a.getAttribute('href') || '';
        if (/admin/i.test(href)) acct.push(row('', I.admin, 'Admin', '', { href }));
        else if (/sign out/i.test(a.textContent)) acct.push(row('', I.out, 'Sign out', '', { href, cls: 'ms-danger', chev: false }));
      }
    } else if ($('#conn .guest-signin') || (ACCESS.showcase && ACCESS.signin)) acct.push(row('signin', I.user, 'Sign in'));
    menu.setTitle(screenTitle());
    menu.body.innerHTML = [list(rows), list(hist), list(more), tsHtml(), acct.length ? `<div class="ms-sec">Account</div>${list(acct)}` : ''].filter(Boolean).join('');
    $$('.ms-list', menu.body).forEach((l, i) => { if (i) l.style.marginTop = '18px'; });
    menu.open();
    setTimeout(() => menu.body.querySelector('.ms-row[data-m]:not([disabled]), a.ms-row')?.focus({ preventScroll: true }), 60);
  }
  menu.body.addEventListener('click', e => {
    const t = e.target.closest('[data-ts]');
    if (t) { // text size: stays open so the change shows
      try { localStorage.setItem('formery.textSize', t.dataset.ts); } catch {}
      applyTs(t.dataset.ts);
      const seg = t.closest('.ms-seg'), i = TS.findIndex(x => x[0] === t.dataset.ts);
      seg.style.setProperty('--i', i);
      $$('[data-ts]', seg).forEach(b => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      return;
    }
    const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
    const k = b.dataset.m;
    if (!k) return;
    menu.close();
    // let the menu start closing before the next sheet opens over it
    setTimeout(() => {
      if (k === 'order' || k === 'launch') F().setRtab?.(k);
      else if (k === 'share') $('#shareBtn')?.click();
      else if (k === 'app' && S().cur?.id) openApp(); // apps: the App sheet
      else if (k === 'assemble') window.premakeAssemble?.(); // assemble: the full-screen step flow
      else if (k === 'undo') F().historyAct?.('undo');
      else if (k === 'redo') F().historyAct?.('redo');
      else if (k === 'versions') openVersions();
      else if (k === 'rename') window.formeryRename?.();
      else if (k === 'dup') window.premakeDuplicate?.();
      else if (k === 'call') support?.open?.();
      else if (k === 'examples') go('/examples');
      else if (k === 'store') go('/store');
      else if (k === 'orders') go('/orders');
      else if (k === 'signin') ($('#conn .guest-signin') || $('#conn'))?.click();
    }, 120);
  });

  // app-preview: the App sheet. Built: Open app (the real shell, full screen, your devices), Try with demo data, and how to
  // add it to the Home Screen. Not built: what it is and Build the app (the app agent, same first prompt as desktop).
  // Examples: Try the app (/apps/ex/<slug>, demo data). No frame on phones: the app opens full screen.
  const appSheet = sheet({ cls: 'ms-app', title: 'App', dim: 'full' });
  const APP_I = { open: svg('M8 4H4.5v11.5H16V12M11 3.5h5.5V9M16.5 3.5 9 11', 20, 1.6), demo: svg('M3.5 15.5l4-5 3 3 2.5-3 3.5 5zM3.5 4.5h13v11h-13z', 20, 1.5),
    build: svg('M10 3.5v13M3.5 10h13', 20, 1.8) };
  function openApp() {
    const cur = S().cur; if (!cur) return;
    const app = cur.data?.app || {}, ex = cur.kind !== 'project';
    const name = escH(app.name || (cur.data?.meta?.title ? `${cur.data.meta.title}` : 'App'));
    const rows = [];
    let note = '';
    if (ex) {
      rows.push(row('', APP_I.open, 'Try the app', '', { href: app.url || '#' }));
      note = 'A demo with made-up readings, so you can see how it works.';
    } else if (app.exists) {
      const base = `/apps/${encodeURIComponent(cur.id)}`;
      rows.push(row('', APP_I.open, 'Open app', '', { href: base, small: 'Full screen, with your devices' }));
      rows.push(row('', APP_I.demo, 'Try with demo data', '', { href: `${base}?preview=1` }));
      note = 'To keep it on your phone: open the app, tap Share, then Add to Home Screen.';
    } else {
      const busy = !!F().appRunning?.();
      rows.push(row('build', APP_I.build, busy ? 'Building your app…' : 'Build the app', '', { chev: false, disabled: busy }));
      note = 'A phone app for this design: live readings, history, alerts and controls. It takes a few minutes; you can keep designing.';
    }
    appSheet.setTitle(name);
    appSheet.body.innerHTML = `${list(rows)}<p class="ms-foot">${escH(note)}</p>`;
    appSheet.open();
  }
  appSheet.body.addEventListener('click', e => {
    const b = e.target.closest('[data-m="build"]'); if (!b || b.disabled) return;
    appSheet.close();
    F().appBuild?.();
    msToast('Building your app. It takes a few minutes.');
  });

  // Versions: every saved version as an inset list; a tap goes back to it (the app's restore, with its toast)
  const verSheet = sheet({ cls: 'ms-versions', title: 'Version history', dim: 'full' });
  const agoTxt = t => { const s = Math.max(0, Date.now() / 1000 - (t || 0)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
  function openVersions() {
    const h = F().history?.(); if (!h) return;
    const busy = !!F().historyBusy?.() || !!S().chat?.live?.running;
    const vrow = (n, label, title, sub, cur, off) => `<button type="button" class="ms-row ms-ver${cur ? ' ms-on' : ''}" data-ver="${n}" ${busy || cur ? 'disabled' : ''}>
      <span class="ms-ic ms-vn">${escH(label)}</span><span class="ms-l"><span class="ms-vt">${escH(String(title).replace(/[*_`#]+/g, ''))}</span><small>${sub}</small></span>${cur ? '<span class="ms-tag">Current</span>' : off ? '<span class="ms-tag">Undone</span>' : ''}</button>`;
    verSheet.body.innerHTML = `<div class="ms-sec">${busy ? 'Available when the AI finishes' : 'Tap one to go back to it. Nothing is lost.'}</div>
      <div class="ms-list">${[...h.versions].sort((a, b) => b.n - a.n).map(v => vrow(v.n, `v${v.v}`, v.summary || v.prompt || 'Change',
        `${escH(v.prompt ? '“' + v.prompt.slice(0, 60) + (v.prompt.length > 60 ? '…' : '') + '”' : '')}${v.prompt ? ' · ' : ''}${escH(agoTxt(v.t))}`, v.current, !v.active)).join('')}
      ${vrow(0, 'v0', 'Original', 'Before the first chat change', !h.head, false)}</div>`;
    verSheet.open();
  }
  verSheet.body.addEventListener('click', e => {
    const b = e.target.closest('[data-ver]'); if (!b || b.disabled) return;
    verSheet.close();
    F().historyAct?.('restore', +b.dataset.ver);
  });

  // 3. Order and Launch sheets: the panes move in while open
  const paneSheet = sheet({ cls: 'ms-pane', title: 'Order', dim: 'full', fit: 'full',
    onClose: () => { if (S().rtab && S().rtab !== 'chat') F().setRtab?.('chat'); setTimeout(() => { if (!paneSheet.isOpen()) returnPanes(); }, 420); } });
  const rightAside = $('#right');
  function returnPanes() {
    const chat = $('#chatPane'), order = $('#orderPane'), launch = $('#launchPane');
    if (order && order.parentElement !== rightAside) chat.after(order);
    if (launch && launch.parentElement !== rightAside) rightAside.append(launch);
  }
  document.addEventListener('forma:rtab', e => {
    const t = e.detail;
    if (!phone() || (t !== 'order' && t !== 'launch')) { if (paneSheet.isOpen()) paneSheet.close(); return; }
    const pane = $(t === 'order' ? '#orderPane' : '#launchPane');
    returnPanes();
    paneSheet.body.append(pane);
    paneSheet.setTitle(t === 'order' ? 'Order' : 'Make');
    pane.scrollTop = 0;
    $('#chatInput')?.blur();
    paneSheet.open();
  });
  matchMedia('(max-width: 640px)').addEventListener?.('change', () => {
    if (phone()) return;
    closeOthers(null);
    returnPanes(); resetPip(); setFull(false);
    S().viewer?.setPresentation?.(false);
    body.classList.remove('m-design', 'm-busy', 'm-pip', 'm-home');
  });

  // ---------------------------------------------------------------- 4. model card
  const pane = $('#modelPane'), center = $('#studio .center');
  const vb = document.createElement('div');
  vb.className = 'm-vbtns';
  vb.innerHTML = `<button type="button" class="m-vb m-glass" data-v="explode" aria-label="Explode" aria-pressed="false" aria-expanded="false" aria-haspopup="dialog">${I.explode}</button>
    <button type="button" class="m-vb m-glass" data-v="ghost" aria-label="See-through" aria-pressed="false">${I.ghost}</button>
    <button type="button" class="m-vb m-glass" data-v="render" aria-label="Look" aria-pressed="false" aria-haspopup="dialog">${I.render}</button>
    <button type="button" class="m-vb m-glass" data-v="move" aria-label="Move" aria-pressed="false" hidden>${I.move}</button>
    <button type="button" class="m-vb m-glass" data-v="power" aria-label="Turn it on" aria-pressed="false" hidden>${I.power}</button>`;
  pane.append(vb);
  const hint = document.createElement('div');
  hint.className = 'm-hint m-glass'; hint.textContent = 'Drag to rotate · tap a part'; hint.hidden = true;
  pane.append(hint);
  // top left: ▶ build steps (4) and full screen (11), round glass buttons like the ones at the bottom
  const tl = document.createElement('div');
  tl.className = 'm-tl';
  tl.innerHTML = `<button type="button" class="m-vb m-glass m-stp" data-v="steps" aria-label="Play the build steps" hidden>${I.play}</button>
    <button type="button" class="m-vb m-glass m-fs" data-v="full" aria-label="Full screen" aria-pressed="false">${I.full}</button>
    <button type="button" class="m-vb m-glass m-wire" data-v="wire" aria-label="Wiring" aria-pressed="false" aria-haspopup="dialog" hidden>${I.wire}</button>`;
  pane.append(tl);
  // order: an orange pill at the card's top right ("Order · $33"), same source as the desktop #orderPill (app.js renderOrderPill)
  const ord = document.createElement('button');
  ord.type = 'button'; ord.className = 'm-order'; ord.hidden = true;
  pane.append(ord);
  ord.onclick = () => { closeOthers(null); F().setRtab?.('order'); };
  function syncOrder() {
    const op = $('#orderPill'), sub = $('#orderPill .op-t span')?.textContent || '';
    const price = (sub.match(/^(.*?) delivered/) || [])[1] || '';
    const ok = !!op && !op.hidden && !!$('#orderPill .op-go') && !pane.classList.contains('vp-building') && !pane.classList.contains('building');
    const html = `${I.order}<span>Order${price ? ` · ${price.replace(/\.00$/, '')}` : ''}</span>`;
    if (ord.innerHTML !== html) ord.innerHTML = html;
    ord.setAttribute('aria-label', price ? `Order, ${price} delivered` : 'Order');
    if (ord.hidden === ok) ord.hidden = !ok;
  }
  const op = $('#orderPill');
  if (op) new MutationObserver(syncOrder).observe(op, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(syncOrder).observe(pane, { attributes: true, attributeFilter: ['class'] });
  syncOrder();

  // ---------------------------------------------------------------- 4b. card sheets (web/msheet.js, dim "card")
  // Bottom sheets over the chat, never over the model card, so the 3D change shows live above them. One at a time. The
  // dim under the card closes the open one; a tap on the card picks a part (the part sheet) or closes it. Drags on the
  // card never close. Swipe down (phone.js), × and Escape close too.
  const cardSheet = (cls, title, onClose) => sheet({ cls, title, dim: 'card', fit: 'card', onOpen: () => syncVb(), onClose: () => { syncVb(); onClose?.(); } });
  const partsCS = cardSheet('m-cs-parts', 'Parts', () => setTimeout(returnTree, still() ? 0 : 420)), expCS = cardSheet('m-cs-explode', 'Explode');
  const treeEl = $('#tree'), treeBody = $('#treeBody');
  const pBody = partsCS.body;
  pBody.innerHTML = '<div class="m-cs-slot"></div>';
  expCS.body.innerHTML = `<input type="range" class="m-cs-range" min="0" max="100" value="0" aria-label="Explode amount">
    <div class="m-cs-ends"><span>Together</span><span>Apart</span></div>`;
  const expIn = $('.m-cs-range', expCS.el), expBtn = $('[data-v=explode]', vb);
  const tbRange = () => $('#explode');
  const setExplode = n => { const r = tbRange(); if (r && Number(r.value) !== n) { r.value = String(n); r.dispatchEvent(new Event('input', { bubbles: true })); } };
  const lookOpen = () => !!S().render && !!$('#renderBar.m-look.on:not([hidden])');
  const csOpen = () => partsCS.isOpen() ? 'parts' : expCS.isOpen() ? 'explode' : partCS.isOpen() ? 'part' : editsCS.isOpen() ? 'edits' : null;
  function returnTree() { if (treeBody && treeBody.parentElement !== treeEl && !partsCS.isOpen()) treeEl.append(treeBody); }
  function prepCS() { $('#chatInput')?.blur(); if (pip) exitPip(); }
  function openParts() {
    prepCS();
    $('.m-cs-slot', pBody).append(treeBody);
    partsCS.setTitle('Parts', $('#treeCount')?.textContent || '');
    pBody.scrollTop = 0;
    partsCS.open();
  }
  // 5. Explode: opening it shows the model apart; closing without touching the slider puts it back together
  let expAuto = false;
  function openExplode() {
    prepCS();
    const r = tbRange();
    expAuto = !!r && Number(r.value) === 0;
    if (expAuto) setExplode(50);
    expCS.open();
  }
  const expClose = expCS.close;
  expCS.close = q => { if (!expCS.isOpen()) return; expClose(q); if (expAuto) { expAuto = false; setExplode(0); } syncVb(); };
  window.__mParts = () => { if (partsCS.isOpen()) partsCS.close(); else openParts(); }; // app.js: the "Parts N" pill
  window.__mCloseCS = () => { for (const s of [partsCS, expCS, partCS, editsCS]) s.close(); }; // phone.js
  // the part menu's "show in Parts" adds .open-m: open the sheet instead
  new MutationObserver(() => { if (phone() && treeEl.classList.contains('open-m')) { treeEl.classList.remove('open-m'); openParts(); } }).observe(treeEl, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('forma:tree', () => { partsCS.setTitle('Parts', $('#treeCount')?.textContent || ''); if (partCS.isOpen()) drawPart(); });
  // the Look sheet (app.js #renderBar) and the build steps (assembly.js) join the one-at-a-time rule and the dim
  register(() => phone() && lookOpen(), () => { if (S().render) $('#renderBtn')?.click(); }, 'card', $('#renderBar'));
  new MutationObserver(() => syncDim()).observe($('#renderBar'), { attributes: true, attributeFilter: ['class', 'hidden'] });
  const steps = () => S().viewer?.assembly?.steps;
  register(() => phone() && !!steps()?.open, () => steps()?.close(), 'card', null);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !phone()) return;
    if (lookOpen()) { e.stopPropagation(); $('#renderBtn')?.click(); }
  }, true);
  $('#chatInput')?.addEventListener('focus', () => { if (csOpen() && csOpen() !== 'part') window.__mCloseCS(); if (lookOpen()) $('#renderBtn')?.click(); });

  // 6. the part sheet: what the desktop hover card shows (web/hover.js), as a native sheet. The part glows while it is open.
  const partCS = sheet({ cls: 'm-cs-part', title: '', dim: 'card', fit: 'card', onClose: () => { glow(null); partName = null; } });
  let partName = null;
  const glow = name => { const names = !name ? null : Array.isArray(name) ? name : [name]; dispatchEvent(new CustomEvent('buildery:partfocus', { detail: { names, on: !!names, ms: 10 * 60000 } })); };
  const PROC = { print: '3D printed', extrusion: 'Aluminium extrusion', sheet: 'Laser-cut sheet metal', laser: 'Laser-cut', bought: 'Bought part' };
  const procOf = p => p.process || (p.group === 'component' ? 'bought' : 'print');
  const n1 = x => { const r = Math.round(Number(x) * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
  let thumbMod = null;
  function drawPart() {
    const v = S().viewer, it = v?.items.find(x => x.p.name === partName);
    if (!it) { partCS.close(); return; }
    const p = it.p, proc = procOf(p), d = v.hover?.describe?.(p) || { line: '' };
    const pm = v.partmenu?.state || {}, iso = pm.isolated === partName, hidden = v.hidden.has(partName);
    const edit = !!F().canEdit?.();
    const thumb = thumbMod?.partThumb?.(v, partName);
    if (!thumbMod) import('./partthumbs.js').then(m => { thumbMod = m; if (partCS.isOpen()) drawPart(); }).catch(() => {});
    const mat = it.look ? (it.look.label || String(it.look).replace(/_/g, ' ')) : p.material && !/^(pla|petg|printed)$/i.test(p.material) ? String(p.material).replace(/_/g, ' ') : proc === 'print' ? 'PETG' : '';
    const fil = FILAMENTS.find(([h]) => h === String(p.color || '').toLowerCase());
    const pr = (S().cur?.data?.bom?.printed || []).find(x => x.name === partName || (x.file && x.file === p.file)) || {};
    const hours = pr.print_hours ?? p.print_hours, grams = pr.grams ?? p.grams;
    const price = (/<em>([^<]*)<\/em>/.exec(d.line || '') || [])[1] || '';
    const info = [];
    info.push(`<div class="ms-row"><span class="ms-l">Made by</span><span class="ms-v">${escH(PROC[proc] || proc)}</span></div>`);
    if (mat) info.push(`<div class="ms-row"><span class="ms-l">Material</span><span class="ms-v" style="text-transform:capitalize">${escH(mat)}</span></div>`);
    if (p.color) info.push(`<div class="ms-row"><span class="ms-l">Colour</span><span class="ms-v"><i class="ms-dot" style="background:${escH(p.color)}"></i>${escH(fil ? fil[1] : 'Custom')}</span></div>`);
    if (p.size?.length === 3) info.push(`<div class="ms-row"><span class="ms-l">Size</span><span class="ms-v">${p.size.map(x => Math.abs(x) >= 20 ? String(Math.round(x)) : n1(x)).join(' × ')} mm</span></div>`);
    if (proc === 'print' && (hours != null || grams != null)) info.push(`<div class="ms-row"><span class="ms-l">Print</span><span class="ms-v">${[hours != null ? `${n1(hours)} h` : '', grams != null ? `${Math.round(grams)} g` : ''].filter(Boolean).join(' · ')}</span></div>`);
    if (price) info.push(`<div class="ms-row"><span class="ms-l">${proc === 'bought' ? 'Price' : 'Cost'}</span><span class="ms-v">${escH(price)}</span></div>`);
    if (d.buy) info.push(`<a class="ms-row" href="${escH(d.buy.url)}" target="_blank" rel="noopener noreferrer"><span class="ms-l">Supplier</span><span class="ms-v ms-acc">${escH(d.buy.label)}</span><span class="ms-chev">${I.link}</span></a>`);
    const sw = edit && proc === 'print' && !p.subparts?.length ? `<div class="ms-sec">Colour</div><div class="ms-sws" role="group" aria-label="Filament colour">${FILAMENTS.map(([hex, n]) =>
      `<button type="button" class="ms-sw ${String(p.color || '').toLowerCase() === hex ? 'on' : ''}" data-col="${hex}" style="--c:${hex}" aria-label="${n}"></button>`).join('')}${p.design_color ? '<button type="button" class="ms-sw ms-sw0" data-col="" aria-label="Back to the design colour">↺</button>' : ''}</div>` : '';
    const acts = [
      edit ? row('ask', I.ask, 'Ask about this part', '', { cls: 'ms-accent', chev: false }) : '',
      hidden ? row('unhide', I.showall, 'Show this part', '', { chev: false }) : row('hide', I.hide, 'Hide', '', { chev: false }),
      iso ? row('showall', I.showall, 'Show all parts', '', { chev: false }) : row('only', I.only, 'Show only this part', '', { chev: false }),
      edit ? row('change', I.material, proc === 'print' ? 'Change colour or material…' : 'Change this part…', '', { chev: false }) : '',
    ].filter(Boolean);
    partCS.setTitle('', '');
    $('.m-cs-title', partCS.el).innerHTML = `<span class="ms-pthumb">${thumb ? `<img src="${thumb}" alt="">` : `<i style="background:${escH(p.color || '#c9c6c0')}"></i>`}</span><span class="ms-ptxt"><span class="ms-pname">${escH(partName)}</span><span class="ms-psub">${d.line || ''}</span></span>`;
    partCS.el.setAttribute('aria-label', partName);
    partCS.body.innerHTML = `${list(acts)}${sw}<div class="ms-sec">Details</div>${list(info)}`;
  }
  function openPart(name, opts = {}) {
    const v = S().viewer;
    if (!phone() || !v?.items.some(x => x.p.name === name)) return;
    if (opts.fromChat) $('#chatInput')?.blur();
    if (pip) { exitPip(); setTimeout(() => openPart(name), still() ? 0 : 460); return; } // the card comes back first, so the part shows above the sheet
    partName = name;
    drawPart();
    partCS.body.scrollTop = 0;
    partCS.open();
    glow(name);
    if (v.present) v.present.idleAt = Math.max(v.present.idleAt, performance.now() + 12000);
  }
  // a row in Parts opens that part's sheet (its eye still hides / shows it)
  pBody.addEventListener('click', e => {
    const r = e.target.closest('.titem'); if (!r || e.target.closest('.eye')) return;
    e.stopPropagation(); openPart(r.dataset.sel);
  }, true);
  window.__mPartTap = true; // hover.js: no floating tooltip on the phone card, the sheet instead
  window.__mPartSheet = name => openPart(name, { fromChat: true }); // chatui.js part names, partmenu.js long-press
  partCS.body.addEventListener('click', e => {
    const v = S().viewer, name = partName; if (!v || !name) return;
    const c = e.target.closest('[data-col]');
    if (c) { F().colorPart?.(name, c.dataset.col || null); setTimeout(drawPart, 30); return; }
    const b = e.target.closest('[data-m]'); if (!b) return;
    const k = b.dataset.m, p = v.items.find(x => x.p.name === name)?.p;
    if (k === 'ask') { partCS.close(); F().askPart?.(name, p); }
    else if (k === 'hide') {
      partCS.close();
      if (v.partmenu) v.partmenu.hideCompletely(name); else v.setHidden(name, true);
      F().renderTree?.();
      msToast(`${name} hidden`, { action: { label: 'Show', run: () => { if (v.partmenu) v.partmenu.unhide(name); else v.setHidden(name, false); F().renderTree?.(); } } });
    }
    else if (k === 'unhide') { if (v.partmenu) v.partmenu.unhide(name); else v.setHidden(name, false); F().renderTree?.(); drawPart(); }
    else if (k === 'only') { v.partmenu?.isolate(name); drawPart(); }
    else if (k === 'showall') { v.partmenu?.showAll(); F().renderTree?.(); drawPart(); }
    else if (k === 'change') {
      partCS.close();
      const ta = $('#chatInput'); if (!ta) return;
      F().askPart?.(name, p);
      ta.value = procOf(p) === 'print' ? `Make the ${name} ` : `Change the ${name}: `;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
    }
  });

  // 8. "Editing 6 parts": the live line's parts as a list (tap one for its sheet)
  const editsCS = cardSheet('m-cs-edits', 'Editing', () => { if (!partCS.isOpen()) glow(null); });
  document.addEventListener('click', e => {
    const sm = e.target.closest?.('.msgs .activity summary[data-eparts]');
    if (!sm || !phone()) return;
    e.preventDefault(); e.stopPropagation();
    let names = []; try { names = JSON.parse(sm.dataset.eparts); } catch {}
    if (names.length === 1) { openPart(names[0], { fromChat: true }); return; }
    const v = S().viewer;
    editsCS.setTitle('Editing', `${names.length} parts`);
    glow(names);
    editsCS.body.innerHTML = list(names.map(n => { const c = v?.items.find(x => x.p.name === n)?.p.color;
      return `<button type="button" class="ms-row" data-ep="${escH(n)}"><span class="ms-ic"><i class="ms-dot" style="background:${escH(c || '#c9c6c0')}"></i></span><span class="ms-l">${escH(n)}</span><span class="ms-chev">${I.chev}</span></button>`; }));
    $('#chatInput')?.blur();
    if (pip) { exitPip(); setTimeout(() => editsCS.open(), still() ? 0 : 460); } else editsCS.open();
  }, true);
  editsCS.body.addEventListener('click', e => { const b = e.target.closest('[data-ep]'); if (b) openPart(b.dataset.ep); });

  // taps on the card: a part opens its sheet (another part switches it), empty space closes the open sheet, a double tap
  // resets the view (3). The single tap waits a moment for a possible second one.
  const viewport = $('#viewport');
  let tdown = null, lastTap = null, tapT = 0;
  viewport.addEventListener('pointerdown', e => { if (phone() && e.isPrimary) tdown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; else tdown = null; });
  viewport.addEventListener('pointerup', e => {
    const d = tdown; tdown = null;
    if (!d || d.id !== e.pointerId || !body.classList.contains('m-design') || pip) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 400) return; // a drag or a hold
    if (e.target.closest?.('button, .m-vbtns, .m-tl, .tree, .m-order, .pm-chip')) return;
    const now = performance.now(), x = e.clientX, y = e.clientY;
    if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) { // double tap
      clearTimeout(tapT); lastTap = null;
      resetView(true);
      return;
    }
    lastTap = { t: now, x, y };
    clearTimeout(tapT);
    tapT = setTimeout(() => cardTap(x, y), 260);
  });
  viewport.addEventListener('pointercancel', () => { tdown = null; });
  function cardTap(x, y) {
    if (steps()?.open) return;
    const v = S().viewer, name = v?.partmenu?.pick?.(x, y) || v?.hover?.pick?.(x, y)?.p?.name || null;
    if (lookOpen()) { if (!name) $('#renderBtn')?.click(); return; } // Look: a tap on a part picks the part to colour (partmenu.js)
    if (expCS.isOpen()) { expCS.close(); return; }
    if (name) openPart(name);
    else if (csOpen()) window.__mCloseCS();
  }
  /** 3. Back to the start: camera, zoom, explode, see-through, hidden parts, steps. quiet: no toast. */
  function resetView(toastIt) {
    window.__mCloseCS();
    if (S().viewer) F().resetPreview?.({ quiet: !toastIt });
    expAuto = false;
    syncVb();
  }

  vb.addEventListener('click', e => {
    const b = e.target.closest('.m-vb'); if (!b) return;
    const k = b.dataset.v;
    if (k === 'explode') { if (expCS.isOpen()) expCS.close(); else openExplode(); }
    else if (k === 'render') { if (!lookOpen()) { closeOthers(null); prepCS(); } $('#renderBtn')?.click(); }
    else if (k === 'ghost') $('#ghostBtn')?.click();
    else if (k === 'move') $('#toolbar .tmove-btn')?.click();
    else if (k === 'power') $('#toolbar .tpower-btn')?.click(); // power: web/effects.js
    syncVb();
  });
  expIn.addEventListener('input', () => { expAuto = false; const r = tbRange(); if (!r) return; r.value = expIn.value; r.dispatchEvent(new Event('input', { bubbles: true })); syncVb(); });
  function syncVb() {
    const r = tbRange(), ex = Number(r?.value || 0);
    if (document.activeElement !== expIn && expIn.value !== String(ex)) expIn.value = String(ex);
    expIn.style.setProperty('--p', ex + '%');
    const set = (k, on) => { const b = $(`[data-v=${k}]`, vb); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
    set('explode', ex > 0 || expCS.isOpen());
    expBtn.setAttribute('aria-expanded', String(expCS.isOpen()));
    set('ghost', $('#ghostBtn')?.getAttribute('aria-pressed') === 'true' || !!$('#ghostBtn')?.classList.contains('on'));
    set('render', !!$('#renderBtn')?.classList.contains('on'));
    $('[data-v=render]', vb).setAttribute('aria-expanded', String(!!$('#renderBtn')?.classList.contains('on')));
    treeEl.classList.toggle('m-on', partsCS.isOpen());
    $('#treeToggle')?.setAttribute('aria-expanded', String(partsCS.isOpen()));
    const mv = $('#toolbar .tmove-btn');
    const mb = $('[data-v=move]', vb);
    mb.hidden = !mv || mv.hidden;
    set('move', !!mv?.classList.contains('on'));
    const wb = $('#toolbar .twire-btn'); const wv = $('[data-v=wire]', tl); wv.hidden = !wb || wb.hidden; wv.classList.toggle('on', !!wb?.classList.contains('on')); wv.setAttribute('aria-pressed', String(!!wb?.classList.contains('on'))); // wireview
    const pw = $('#toolbar .tpower-btn'); $('[data-v=power]', vb).hidden = !pw || pw.hidden; set('power', !!pw?.classList.contains('on')); // power
  }
  new MutationObserver(syncVb).observe($('#toolbar'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'hidden'] });
  document.addEventListener('input', e => { if (e.target === tbRange()) syncVb(); });
  addEventListener('forma:route', () => closeOthers(null));
  syncVb();

  // ---------------------------------------------------------------- 4c. build steps (web/assembly.js StepView)
  // A round glass ▶ at the card's top left plays the steps straight away. The steps' sheet (assembly.js phone markup)
  // has pause, "Step 3 of 9", swipe between steps, × to stop and "Play again" at the end.
  const stp = $('[data-v=steps]', tl);
  tl.addEventListener('click', async e => {
    const b = e.target.closest('.m-vb'); if (!b) return;
    if (b.dataset.v === 'full') { setFull(!body.classList.contains('m-full3d')); return; }
    if (b.dataset.v === 'wire') { const w = S().viewer?.wiring; if (w?.on && !w.sheet?.isOpen()) w.openSheet(); else $('#toolbar .twire-btn')?.click(); syncVb(); return; } // wireview: on + Connections sheet; again: the sheet, then off
    closeOthers(null);
    if (S().render) { $('#renderBtn')?.click(); await new Promise(r => setTimeout(r, 0)); }
    prepCS();
    steps()?.show(0, { play: true });
  });
  function syncStp() {
    const n = S().viewer?.parts?.().length || 0;
    const ok = n > 1 && !!steps() && !steps().open;
    if (stp.hidden === ok) stp.hidden = !ok;
  }
  pane.addEventListener('viewer:assembly', () => {
    const open = phone() && !!steps()?.open;
    body.classList.toggle('m-steps', open);
    if (open) closeOthers(null);
    syncStp(); syncDim();
  });
  document.addEventListener('forma:tree', syncStp);
  new MutationObserver(syncStp).observe(pane, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => { if (steps()?.open && phone()) steps().fit?.(); });
  syncStp();

  // 11. full screen: the card fills the screen (no bar, no chat); the same button or Escape / back brings it back
  function setFull(on) {
    on = !!on && phone() && body.classList.contains('m-design');
    if (body.classList.contains('m-full3d') === on) return;
    if (on) { closeOthers(null); $('#chatInput')?.blur(); if (pip) resetPip(); }
    body.classList.toggle('m-full3d', on);
    const b = $('[data-v=full]', tl);
    b.innerHTML = on ? I.unfull : I.full; b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); b.setAttribute('aria-pressed', String(on));
    syncCard();
    requestAnimationFrame(() => { try { S().viewer?.resize?.(); } catch {} });
    setTimeout(() => { try { S().viewer?.resize?.(); } catch {} }, 450);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && body.classList.contains('m-full3d') && !anyOpen()) { e.stopPropagation(); setFull(false); } }, true);
  addEventListener('forma:route', () => setFull(false));

  // hint pill: on opening a design, gone after 4 s or the first touch
  let hintT = null, hintFor = '';
  function showHint() {
    if (!designScreen()) return;
    const key = location.pathname;
    if (hintFor === key) return;
    hintFor = key;
    hint.hidden = false; hint.classList.remove('off');
    clearTimeout(hintT); hintT = setTimeout(hideHint, 4200);
  }
  function hideHint() { hint.classList.add('off'); clearTimeout(hintT); hintT = setTimeout(() => { hint.hidden = true; }, 400); }
  $('#viewport').addEventListener('pointerdown', () => { if (!hint.hidden) hideHint(); });

  // presentation look in the viewer while the design screen shows
  const topH = () => topbar.getBoundingClientRect().height || 48;
  function syncCard() {
    const ds = body.classList.contains('m-design');
    const v = S().viewer;
    if (v?.setPresentation) {
      if (ds) {
        v.setPresentation(true, { pip: !!pip, offsetY: pip || body.classList.contains('m-full3d') ? 0 : Math.round(topH() / 2) });
        // the part menu, the explode slider or a part's sheet is open: hold the turntable still
        if (v.present && ($('.pm-menu:not([hidden])') || csOpen() === 'explode' || csOpen() === 'part')) v.present.idleAt = Math.max(v.present.idleAt, performance.now() + 8000);
      }
      else if (v.present) v.setPresentation(false);
    }
    if (!ds && pip) resetPip();
    if (ds) showHint();
    else hintFor = '';
    if (ds && !card.h) setCardH();
  }
  const card = { h: 0 };
  function setCardH() {
    card.h = Math.round(Math.max(260, Math.min(innerHeight * 0.47, innerHeight - 300)));
    document.documentElement.style.setProperty('--m-card-h', card.h + 'px');
  }
  addEventListener('resize', () => { if (!phone()) return; setCardH(); if (pip) placePip(false); });

  // ---------------------------------------------------------------- 5. composer
  const composer = $('#composer'), input = $('#chatInput'), cbox = $('#composer .cbox');
  const plus = document.createElement('button');
  plus.type = 'button'; plus.className = 'm-plus m-glass';
  plus.setAttribute('aria-label', 'Add a photo'); plus.setAttribute('aria-haspopup', 'menu'); plus.setAttribute('aria-expanded', 'false');
  plus.innerHTML = I.plus;
  composer.prepend(plus);
  // keep the keyboard (and the focus) where it is when "+" is pressed; the choices are the shared action sheet
  plus.addEventListener('pointerdown', e => e.preventDefault());
  const pickPhoto = k => {
    const lib = $$('#composer .cbar input[type=file]').find(i => !i.classList.contains('cam-input'));
    if (k === 'lib') lib?.click();
    else {
      const cam = $('#composer .cam-input');
      if (cam) cam.click();
      else if (lib) { lib.setAttribute('capture', 'environment'); lib.click(); setTimeout(() => lib.removeAttribute('capture'), 1000); }
    }
  };
  plus.onclick = () => actionSheet({ actions: [{ label: 'Photo library', icon: I.photo, run: () => pickPhoto('lib') }, { label: 'Take photo', icon: I.camera, run: () => pickPhoto('cam') }] });
  const stopBtn = $('#stopBtn'), sendBtn = $('#sendBtn');
  function syncComposer() {
    const has = !!input.value.trim() || !!$('#composer .att-strip')?.children.length;
    composer.classList.toggle('m-has', has);
    composer.classList.toggle('m-run', !!stopBtn && !stopBtn.hidden);
  }
  input.addEventListener('input', syncComposer);
  new MutationObserver(syncComposer).observe(composer, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  syncComposer();
  if (stopBtn) stopBtn.setAttribute('aria-label', 'Stop');
  sendBtn?.setAttribute('aria-label', 'Send');

  // ---------------------------------------------------------------- 6. floating thumbnail (PiP)
  const PIP = 112, M = 12, PIP_PAD = 112; // phone.css body.m-pip .msgs padding-top: 16 + 112
  const slot = document.createElement('div');
  slot.className = 'm-slot'; slot.hidden = true;
  center.before(slot);
  const catcher = document.createElement('div');
  catcher.className = 'm-pipcatch'; catcher.setAttribute('role', 'button'); catcher.setAttribute('aria-label', 'Show the model');
  catcher.innerHTML = '<span class="m-pipbusy" aria-hidden="true"></span>';
  center.append(catcher);
  const msgs = $('#msgs');
  let pip = null;          // { why: 'kb' | 'scroll', t }
  let pipSide = 'right', pipY = null, exitT = null;
  const appH = () => Math.round(window.visualViewport ? visualViewport.height : innerHeight);
  function pipRect() {
    const min = topH() + 6, max = Math.max(min, appH() - (composer.offsetHeight || 64) - PIP - 10);
    const y = Math.max(min, Math.min(max, pipY ?? min));
    return { left: pipSide === 'left' ? M : innerWidth - PIP - M, top: y, width: PIP, height: PIP };
  }
  const setRect = (el, r) => { el.style.left = r.left + 'px'; el.style.top = r.top + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; };
  function stick(ms) {
    const end = performance.now() + ms;
    const tick = () => { msgs.scrollTop = msgs.scrollHeight; if (performance.now() < end) requestAnimationFrame(tick); };
    tick();
  }
  function enterPip(why) {
    if (!body.classList.contains('m-design')) return;
    if (pip) { if (why === 'kb') pip.why = 'kb'; return; }
    clearTimeout(exitT);
    const r = center.getBoundingClientRect();
    pip = { why, t: performance.now() };
    S().viewer?.hover?.hide?.();
    if (!hint.hidden) hideHint();
    window.__mCloseCS?.();
    slot.style.height = r.height + 'px'; slot.hidden = false;
    center.classList.remove('m-anim');
    // 7. the chat makes room above its first message so the thumbnail never covers it (scroll position kept)
    const st = msgs.scrollTop;
    body.classList.add('m-pip');
    if (st > 4) msgs.scrollTop = st + PIP_PAD;
    setRect(center, { left: r.left, top: r.top, width: r.width, height: r.height });
    void center.offsetWidth;
    if (!still()) center.classList.add('m-anim');
    setRect(center, pipRect());
    slot.style.height = topH() + 'px';
    syncCard();
    if (why === 'kb') stick(520); // not on a scroll: pinning the chat to the bottom would fight the finger and stop the scroll
  }
  function exitPip(opts = {}) {
    if (!pip) return;
    pip = null;
    const H = card.h || Math.round(innerHeight * 0.47);
    if (!still()) center.classList.add('m-anim');
    setRect(center, { left: 0, top: 0, width: innerWidth, height: H });
    slot.style.height = H + 'px';
    syncCard();
    if (opts.stick) stick(520);
    clearTimeout(exitT);
    exitT = setTimeout(() => { if (!pip) resetPip(); }, still() ? 0 : 440);
  }
  function resetPip() {
    pip = null; clearTimeout(exitT);
    const st = msgs.scrollTop, was = body.classList.contains('m-pip');
    body.classList.remove('m-pip');
    if (was && st > PIP_PAD) msgs.scrollTop = st - PIP_PAD;
    center.classList.remove('m-anim', 'm-drag');
    center.style.left = center.style.top = center.style.width = center.style.height = '';
    slot.hidden = true; slot.style.height = '';
  }
  function placePip(anim = true) {
    if (!pip) return;
    center.classList.toggle('m-anim', anim && !still());
    setRect(center, pipRect());
  }
  window.visualViewport?.addEventListener('resize', () => { if (pip) placePip(false); });

  // drag the thumbnail (snaps to the nearer side); a tap brings the model back and closes the keyboard
  let drag = null;
  catcher.addEventListener('touchstart', e => { if (pip) e.preventDefault(); }, { passive: false }); // keep the keyboard up while dragging
  catcher.addEventListener('pointerdown', e => {
    if (!pip) return;
    e.preventDefault();
    const r = center.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
    catcher.setPointerCapture?.(e.pointerId);
  });
  catcher.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    center.classList.remove('m-anim'); center.classList.add('m-drag');
    center.style.left = Math.max(4, Math.min(innerWidth - PIP - 4, drag.l + dx)) + 'px';
    center.style.top = Math.max(topH(), Math.min(appH() - PIP - 4, drag.t + dy)) + 'px';
  });
  const dragEnd = () => {
    if (!drag) return;
    const d = drag; drag = null;
    center.classList.remove('m-drag');
    if (!d.moved) { input.blur(); exitPip({ stick: false }); return; }
    const r = center.getBoundingClientRect();
    pipSide = r.left + PIP / 2 < innerWidth / 2 ? 'left' : 'right';
    pipY = r.top;
    placePip(true);
  };
  catcher.addEventListener('pointerup', dragEnd);
  catcher.addEventListener('pointercancel', dragEnd);
  catcher.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && pip) { e.preventDefault(); input.blur(); exitPip(); } });

  // keyboard: focus the composer -> thumbnail; leave it -> card back
  input.addEventListener('focus', () => { if (phone() && body.classList.contains('m-design')) enterPip('kb'); });
  input.addEventListener('blur', () => setTimeout(() => {
    if (pip?.why === 'kb' && document.activeElement !== input) exitPip({ stick: true });
  }, 0));
  // sent: keyboard down, card back so the change is seen landing (changefx glow / poof play in the big view)
  document.addEventListener('forma:sent', () => {
    if (!phone()) return;
    input.blur();
    if (pip) exitPip({ stick: true }); else stick(400);
  });

  // any scroll of the chat (up or down) shrinks the card; it only comes back on a tap or after sending
  // (bringing it back at the top / bottom of the chat jumped the scroll position mid-gesture)
  let ty = null;
  const canCollapse = () => msgs.scrollHeight > msgs.clientHeight + 80;
  msgs.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
  msgs.addEventListener('touchmove', e => {
    if (ty == null || !phone()) return;
    if (!pip && canCollapse() && Math.abs(e.touches[0].clientY - ty) > 12) enterPip('scroll');
  }, { passive: true });
  msgs.addEventListener('touchend', () => { ty = null; }, { passive: true });
  msgs.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > 2 && !pip && phone() && canCollapse()) enterPip('scroll');
  }, { passive: true });

  // ---------------------------------------------------------------- wiring
  addEventListener('forma:route', () => { if (pip) resetPip(); setTimeout(syncBar, 0); });
  new MutationObserver(syncBar).observe($('#crumb'), { childList: true, subtree: true, characterData: true });
  new MutationObserver(syncBar).observe(studio, { attributes: true, attributeFilter: ['class', 'hidden'] });
  const ri = $('#runInd'); if (ri) new MutationObserver(syncBar).observe(ri, { attributes: true, attributeFilter: ['hidden', 'href'] });
  setInterval(() => { if (phone()) syncBar(); }, 800); // the agent's run state and the viewer (created lazily)
  syncBar();
}
