// Admin Inbox (/admin#inbox): the "Message us" threads, one per user (server/supportchat.js). Same two-pane layout as
// Live support (.sup-* in admin.css). initInbox() runs on every admin page: it polls /pulse (a worker drives the timer,
// like incoming calls in web/call.js, so a background tab still hears it) and plays a sound + shows a desktop
// notification for each new message, and keeps the nav count current. Every user string goes through esc().
import { esc } from '/chatui.js';

const $ = (s, el = document) => el.querySelector(s);
const API = '/api/supportchat/admin';
const I = { list: null, err: null, thread: null, threadErr: null, hash: null, filter: 'open', sending: [], since: 0, timer: null, main: null };

async function api(path, opts = {}) {
  let r;
  try { r = await fetch(path, { ...opts, cache: 'no-store', headers: opts.body ? { 'Content-Type': 'application/json' } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error('Can’t reach the server. Check your connection.'); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d?.error || `Request failed (${r.status})`);
  return d;
}
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const clock = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
const initial = e => esc(String(e || '?').trim()[0]?.toUpperCase() || '?');
const avatar = (e, size) => `<span class="ibx-av" style="width:${size}px;height:${size}px" aria-hidden="true">${initial(e)}</span>`;

function setBadge(n) {
  const b = $('#navInbox'); if (!b) return;
  b.hidden = !n; b.textContent = n;
}

// ---------------------------------------------------------------- list + thread
async function loadList() {
  try { const r = await api(API); I.list = r.threads; I.err = null; setBadge(r.unread); } catch (e) { I.err = e; }
  drawList();
}
async function loadThread(hash) {
  try { const t = await api(`${API}/${hash}`); if (I.hash === hash) { I.thread = t; I.threadErr = null; } }
  catch (e) { if (I.hash === hash) I.threadErr = e; }
  if (I.hash === hash) drawThread();
  const c = I.list?.find(x => x.hash === hash);
  if (c?.unread) { c.unread = 0; setBadge(I.list.reduce((n, x) => n + x.unread, 0)); drawList(); }
}

export function renderInbox(main, arg) {
  I.main = main;
  const hash = /^[a-f0-9]{24}$/.test(arg || '') ? arg : null;
  if (!$('.ibx', main)) {
    main.innerHTML = `<div class="sup ibx"><section class="sup-list" aria-label="Threads"><div class="sup-list-h"><h1>Inbox</h1>
        <div class="ibx-filter" role="tablist"><button type="button" role="tab" data-f="open">Open</button><button type="button" role="tab" data-f="resolved">Resolved</button><button type="button" role="tab" data-f="all">All</button></div></div>
      <div class="sup-items" id="ibxItems"><div class="adm-load">Loading…</div></div></section>
      <section class="sup-thread" id="ibxThread" aria-label="Thread"></section></div>`;
    $('.ibx-filter', main).onclick = e => { const b = e.target.closest('[data-f]'); if (b) { I.filter = b.dataset.f; drawList(); } };
  }
  $('.ibx', main).classList.toggle('has-sel', !!hash);
  if (I.hash !== hash) { I.hash = hash; I.thread = null; I.threadErr = null; }
  drawList(); drawThread();
  loadList();
  if (hash) loadThread(hash);
  clearInterval(I.timer);
  I.timer = setInterval(() => {
    if (!$('.ibx') ) { clearInterval(I.timer); return; }
    if (document.hidden) return;
    loadList();
    if (I.hash) loadThread(I.hash);
  }, 6000);
}

function drawList() {
  const el = $('#ibxItems'); if (!el) return;
  for (const b of document.querySelectorAll('.ibx-filter [data-f]')) b.setAttribute('aria-selected', String(b.dataset.f === I.filter));
  if (I.err) { el.innerHTML = `<div class="adm-err">${esc(I.err.message)}</div>`; return; }
  if (!I.list) return;
  const list = I.list.filter(c => I.filter === 'all' || (I.filter === 'resolved' ? c.resolved : !c.resolved));
  if (!list.length) {
    el.innerHTML = `<div class="adm-empty" style="padding:16px 12px">${I.filter === 'resolved' ? 'Nothing resolved yet.' : I.list.length ? 'All caught up.' : 'No messages yet. They show up here when someone presses Message us in the studio.'}</div>`;
    return;
  }
  el.innerHTML = list.map(c => `<a class="sup-item${c.hash === I.hash ? ' on' : ''}${c.unread ? ' unread' : ''}${c.resolved ? ' ibx-done' : ''}" href="#inbox/${c.hash}">
    ${avatar(c.user, 40)}
    <span style="min-width:0"><div class="nm">${esc(c.user)}</div><div class="em">${c.design ? esc(c.design) : 'No design open'}</div>
      <div class="ls">${c.last.from === 'josh' ? 'You: ' : ''}${esc(c.last.text)}</div></span>
    <span class="rt"><span>${esc(ago(c.last.t))}</span>${c.unread ? `<span class="ud" title="${c.unread} unread"></span>` : ''}${c.resolved ? '<span>Resolved</span>' : ''}</span></a>`).join('');
}

function ctxLine(c) {
  if (!c) return '';
  const bits = [];
  if (c.title || c.design) {
    const label = esc(c.title || c.design) + (c.kind === 'example' ? ' (example)' : '');
    bits.push(c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${label}</a>` : label);
  } else if (c.url) bits.push(`<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>`);
  if (c.page) bits.push(esc(c.page));
  if (c.device) bits.push(esc(c.device));
  if (c.viewport) bits.push(esc(c.viewport.replace('x', ' × ')));
  return bits.length ? `<div class="ibx-ctx" title="${esc(c.ua || '')}">${bits.join(' · ')}</div>` : '';
}
function msgsHtml(list) {
  let day = '';
  return list.map(m => {
    const d = new Date(m.t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const sep = d !== day ? `<div class="sup-day">${esc(d)}</div>` : ''; day = d;
    const me = m.from === 'josh';
    const imgs = (m.images || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Attached image" loading="lazy"></a>`).join('');
    return `${sep}<div class="sup-m ${me ? 'me' : 'them'}${m.pending ? ' pending' : ''}"><div class="meta">${me ? 'You · ' : ''}${esc(clock(m.t))}</div>
      ${imgs ? `<div class="ibx-imgs">${imgs}</div>` : ''}${m.text ? `<div class="bub ibx-text">${esc(m.text)}</div>` : ''}${me ? '' : ctxLine(m.ctx)}</div>`;
  }).join('');
}
function drawThread() {
  const el = $('#ibxThread'); if (!el) return;
  if (!I.hash) { el.innerHTML = '<div class="sup-none">Pick a thread.</div>'; return; }
  const back = `<a class="sup-back" href="#inbox" aria-label="Back to the inbox">${BACK}</a>`;
  if (I.threadErr) { el.innerHTML = `<div class="sup-ctx">${back}</div><div class="adm-err">${esc(I.threadErr.message)}</div>`; return; }
  const t = I.thread;
  if (!t) { el.innerHTML = `<div class="sup-ctx">${back}<span class="muted">Loading…</span></div>`; return; }
  const draft = $('#ibxInput')?.value || '';
  const box = $('#ibxMsgs');
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const msgs = [...t.messages, ...I.sending.filter(s => s.hash === t.hash)];
  const html = msgsHtml(msgs);
  if (box && el.dataset.hash === t.hash && el.dataset.resolved === String(t.resolved)) {
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; if (atBottom) box.scrollTop = box.scrollHeight; }
    return;
  }
  el.dataset.hash = t.hash; el.dataset.resolved = String(t.resolved);
  el.innerHTML = `<div class="sup-ctx">${back}${avatar(t.user, 40)}
      <div class="ti"><b>${esc(t.user)}</b><span><span>${t.resolved ? 'Resolved' : 'Open'}</span><span>Started ${esc(ago(t.created))}</span></span></div>
      <button type="button" class="btn sm" id="ibxResolve">${t.resolved ? 'Reopen' : 'Mark resolved'}</button></div>
    <div class="sup-msgs" id="ibxMsgs">${html || '<div class="sup-none">No messages yet.</div>'}</div>
    <div class="sup-comp"><textarea id="ibxInput" rows="1" placeholder="Reply as Josh" aria-label="Reply"></textarea><button type="button" class="btn primary" id="ibxSend">Send</button></div>
    <div class="sup-hint">Enter to send, Shift+Enter for a new line. They see your reply within a few seconds.</div>`;
  $('#ibxMsgs').dataset.h = html;
  const ta = $('#ibxInput'); ta.value = draft; grow(ta);
  const b = $('#ibxMsgs'); b.scrollTop = b.scrollHeight;
  ta.oninput = () => grow(ta);
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); reply(); } };
  $('#ibxSend').onclick = reply;
  $('#ibxResolve').onclick = resolve;
  if (!matchMedia('(pointer: coarse)').matches) ta.focus({ preventScroll: true });
}
function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight + 2) + 'px'; }

async function reply() {
  const ta = $('#ibxInput'); const text = ta.value.trim(); const hash = I.hash;
  if (!text || !hash) return;
  ta.value = ''; grow(ta);
  const pend = { hash, from: 'josh', text, t: Date.now(), pending: true };
  I.sending.push(pend); drawThread();
  try { const r = await api(`${API}/${hash}`, { method: 'POST', body: { text } }); if (I.hash === hash && I.thread) I.thread.messages = r.messages; }
  catch (e) { toast(e.message); if (I.hash === hash && !$('#ibxInput')?.value) $('#ibxInput').value = text; }
  I.sending = I.sending.filter(x => x !== pend);
  if (I.hash === hash) drawThread();
  loadList();
}
async function resolve() {
  const t = I.thread; if (!t) return;
  try { const r = await api(`${API}/${t.hash}/resolve`, { method: 'POST', body: { resolved: !t.resolved } }); t.resolved = r.resolved; drawThread(); loadList(); }
  catch (e) { toast(e.message); }
}
function toast(msg) {
  const t = document.createElement('div');
  t.setAttribute('role', 'status');
  t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100;background:var(--a-s3);color:var(--a-text);border:1px solid var(--a-line2);padding:8px 14px;border-radius:8px;max-width:90vw';
  t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 4000);
}

// ---------------------------------------------------------------- new-message alerts on every admin page
let actx = null;
addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }, { passive: true });
function ping() {
  if (!actx) return;
  try {
    const t0 = actx.currentTime;
    for (const [f, d] of [[660, 0], [990, 0.13]]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.18, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.3);
      o.start(t0 + d); o.stop(t0 + d + 0.32);
    }
  } catch {}
}
function alertNew(m) {
  const viewing = I.hash === m.hash && $('.ibx') && !document.hidden;
  if (viewing) return;
  ping();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`Message from ${m.user}`, { body: String(m.text || '').slice(0, 160), tag: 'inbox-' + m.hash });
    n.onclick = () => { focus(); location.hash = `#inbox/${m.hash}`; n.close(); };
  } catch {}
}
export function initInbox() {
  let inflight = false;
  const tick = async () => {
    if (inflight) return; inflight = true;
    try {
      const r = await api(`${API}/pulse?since=${I.since}`);
      if (I.since) r.fresh.forEach(alertNew);
      if (r.fresh.length && $('.ibx')) loadList();
      I.since = Math.max(I.since, ...r.fresh.map(x => x.t), I.since ? 0 : r.now);
      setBadge(r.unread);
    } catch {}
    inflight = false;
  };
  let n = 0;
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000)'], { type: 'text/javascript' })));
    w.onmessage = () => { if (++n % 5 === 0) tick(); }; // every 10 s
  } catch { setInterval(tick, 10000); }
  tick();
}
