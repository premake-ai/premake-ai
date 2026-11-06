// Live support: a floating "Call Josh" bubble at the top right of the studio's Chat pane. Clicking it opens a small card
// (a bottom sheet on phones, dragged down to close by web/phone.js) with Josh's availability and a big "Video call Josh"
// button that runs the call flow in web/call.js, plus "Message us": a written thread with Josh (web/supportchat.js) that
// opens in the same card / sheet, with an orange dot on the bubble for unread replies. Guests pressing either get the
// sign-in modal (forma:signin, web/guest.js opens it). app.js calls supportBubble.sync() from renderChat.
// Styles: web/support.css, scoped to .sup-bub / .sup-pop / .sup-dim (and .sc-* for the thread).
import { callStatus, callsSupported, startCall } from './call.js';
import { supportThread, supportUnread } from './supportchat.js'; // supportchat: "Message us"

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const phone = () => matchMedia('(max-width: 640px)').matches;
const CAM = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="1.5" y="4" width="9" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 7l4-2.3v6.6l-4-2.3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const MSG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 3.5h11v7.5h-6.2L4.5 13.5V11h-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const X = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const pane = document.getElementById('chatPane');
const ctx = { show: false, project: null, example: null, title: '', admin: false };
let status = null, open = false, bub = null, pop = null, dim = null;
let view = 'card', unread = 0; // supportchat: 'card' (call + message buttons) or 'thread'
const thread = supportThread({
  context: () => ({ design: ctx.project || ctx.example || null, kind: ctx.project ? 'project' : ctx.example ? 'example' : null, title: ctx.title || null,
    url: location.pathname + location.hash, page: document.body.classList.contains('m-design') ? 'phone studio' : 'studio', viewport: `${innerWidth}x${innerHeight}` }),
  onBack: () => { view = 'card'; pop.dataset.h = ''; pop.classList.remove('thread'); draw(); place(); },
  onClose: () => close(),
  onUnread: n => setUnread(n),
  phone,
});
function setUnread(n) {
  if (n === unread) return;
  unread = n;
  if (bub) { bub.querySelector('.sup-new').hidden = !n; }
  document.dispatchEvent(new CustomEvent('forma:supunread', { detail: { unread: n } })); // phones may show it on the menu
  if (open && view === 'card') draw();
}
function openThread() {
  if (status?.guest) { close(); dispatchEvent(new CustomEvent('forma:signin')); return; }
  view = 'thread'; pop.dataset.h = ''; pop.classList.add('thread');
  pop.setAttribute('aria-label', 'Message the Premake team');
  thread.render(pop);
  place();
}

if (pane) {
  bub = document.createElement('button');
  bub.type = 'button'; bub.className = 'sup-bub'; bub.hidden = true;
  bub.setAttribute('aria-haspopup', 'dialog'); bub.setAttribute('aria-expanded', 'false');
  bub.innerHTML = '<span class="sup-av" aria-hidden="true">J</span><span class="sup-dot" hidden></span><span class="sup-new" hidden></span>';
  pane.append(bub);
  pop = document.createElement('div');
  pop.className = 'sup-pop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Video call the Premake team');
  dim = document.createElement('div');
  dim.className = 'sup-dim'; dim.hidden = true;
  document.body.append(dim, pop);

  bub.onclick = () => (open ? close() : show());
  dim.onclick = () => close();
  pop.addEventListener('click', e => {
    if (e.target.closest('.sup-x')) return close(true);
    if (e.target.closest('.sup-write')) return openThread();
    if (e.target.closest('.sup-call:not(:disabled)')) {
      const { project, example } = ctx;
      close();
      startCall({ project, example }).finally(() => refresh(true));
    }
  });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { e.stopPropagation(); close(true); } }, true);
  document.addEventListener('pointerdown', e => {
    if (open && !phone() && !pop.contains(e.target) && !bub.contains(e.target)) close();
  });
  addEventListener('resize', () => { if (open) place(); });
  setInterval(() => { if (ctx.show && !document.hidden && !bub.hidden) refresh(true); }, 30000);
  setInterval(() => { if (ctx.show && !document.hidden && !thread.active() && status && !status.guest) supportUnread().then(setUnread); }, 15000); // supportchat: the dot
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx.show) refresh(true); });
}

/** Josh's availability, drawn on the bubble's dot and (when open) the card. */
async function refresh(force) {
  status = await callStatus(force);
  if (status && !status.guest) setUnread(await supportUnread()); // supportchat
  draw();
}
function state() {
  if (ctx.admin) return 'admin';
  if (!status) return 'unknown';
  if (status.guest) return 'guest';
  return status.available ? 'on' : status.reason === 'busy' ? 'busy' : 'off';
}
function draw() {
  if (!bub) return;
  const st = state(), on = st === 'on';
  if (draw.on !== on) { draw.on = on; document.dispatchEvent(new CustomEvent('forma:josh', { detail: { on } })); } // phones: the green dot on the menu button (web/phonestudio.js)
  bub.querySelector('.sup-dot').hidden = !on;
  bub.setAttribute('aria-label', on ? 'Video call the Premake team, available now' : 'Video call the Premake team');
  bub.title = on ? 'The Premake team is available for a video call' : 'Video call the Premake team';
  if (!open || view === 'thread') return;
  const line = {
    on: '<span class="sup-on">Available now</span>',
    busy: 'On another call',
    off: 'Not available right now',
    guest: 'Sign in to start a video call',
    admin: 'This is you',
    unknown: 'Checking if someone is around…',
  }[st];
  const blurb = 'Talk face to face about your design. We can look at it with you and make the changes live.';
  const note = st === 'busy' ? 'The team is on another call right now. Try again later.'
    : st === 'off' ? 'Nobody is available right now. Try again later.'
    : st === 'admin' ? 'You’re signed in as an admin. Visitors see this card, and their calls ring in /admin.'
    : '';
  const canCall = st === 'on' || st === 'guest' || st === 'unknown';
  const html = `${phone() ? '<div class="sup-grab" aria-hidden="true"></div>' : ''}
    <div class="sup-head">
      <span class="sup-av lg" aria-hidden="true">J${on ? '<span class="sup-dot"></span>' : ''}</span>
      <div class="sup-who"><b>The Premake team</b><span>${line}</span></div>
      <button type="button" class="btn sm sup-x" aria-label="Close">${X}</button>
    </div>
    <p class="sup-blurb">${blurb}</p>
    ${ctx.title ? `<p class="sup-about">About: ${esc(ctx.title)}</p>` : ''}
    <button type="button" class="btn primary sup-call" ${canCall ? '' : 'disabled'}>${CAM}Video call the Premake team</button>
    ${note ? `<p class="sup-note">${note}</p>` : ''}
    <button type="button" class="btn sup-write">${MSG}<span>Message us</span>${unread ? `<span class="sup-write-new">${unread === 1 ? 'New reply' : unread + ' new replies'}</span>` : ''}</button>`;
  if (html !== pop.dataset.h) { pop.innerHTML = html; pop.dataset.h = html; } // the 30 s refresh doesn't steal focus
  place();
}
function place() {
  if (phone()) { pop.style.top = pop.style.right = ''; pop.classList.add('sheet'); return; }
  pop.classList.remove('sheet');
  const r = bub.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
}
function show(any) {
  if (!pop || (bub.hidden && !(any && callsSupported()))) return;
  open = true; pop.hidden = false; dim.hidden = !phone();
  bub.setAttribute('aria-expanded', 'true'); bub.classList.add('on');
  draw();
  pop.querySelector('.sup-call:not(:disabled)')?.focus({ preventScroll: true });
  refresh(true);
}
function close(refocus) {
  if (!open) return;
  open = false; pop.hidden = true; pop.dataset.h = ''; dim.hidden = true; pop.style.transform = '';
  if (view === 'thread') { thread.stop(); view = 'card'; pop.classList.remove('thread'); pop.setAttribute('aria-label', 'Video call the Premake team'); } // supportchat
  bub.setAttribute('aria-expanded', 'false'); bub.classList.remove('on');
  if (refocus && !bub.hidden) bub.focus({ preventScroll: true });
}

export const supportBubble = {
  /** { show, project, example, title, admin }: show it for the open design (project = own design, example = an example). */
  sync(o) {
    if (!bub) return;
    const was = ctx.show;
    Object.assign(ctx, o);
    bub.hidden = !ctx.show || !callsSupported();
    pane.classList.toggle('has-sup', !bub.hidden);
    if (bub.hidden) { close(); return; }
    if (!was || !status) refresh(false); else draw();
  },
  close,
  /** Phones: the right menu's "Call Josh" (no bubble there). Works on any studio screen, with or without a design open. */
  open() { show(true); },
  /** supportchat: open straight to the "Message us" thread. */
  message() { show(true); if (open) openThread(); },
  unread: () => unread,
  /** Phones: fetch Josh's availability (fires 'forma:josh' when the green dot should change). */
  check(force) { if (bub && callsSupported()) refresh(force); },
  available: () => state() === 'on',
  supported: () => !!bub && callsSupported(),
};
