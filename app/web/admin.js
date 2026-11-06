// Admin panel (/admin): live support, overview, users, projects, orders, agent runs, system.
// Server: server/admin.js (/api/admin/*, admins only). Every user-supplied string goes through esc() or textHtml().
import { esc, textHtml } from '/chatui.js';
import { renderQueue, mountPlan } from '/admin/fulfil.js'; // fulfilment: supplier jobs per paid order
import { renderInbox, initInbox } from '/admin/inbox.js'; // supportchat: "Message us" threads

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $('#main');
const NOSSE = new URLSearchParams(location.search).has('nosse');

async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch(path, { ...opts, cache: 'no-store', headers: opts.body ? { 'Content-Type': 'application/json' } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw Object.assign(new Error('Can’t reach the server. Check your connection.'), { status: 0 }); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(d?.error || `Request failed (${r.status})`), { status: r.status });
  return d;
}

// ---------------------------------------------------------------- formatting
const toMs = t => (t == null ? null : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
function ago(t) {
  const ms = toMs(t); if (!ms) return '–';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
const when = t => { const ms = toMs(t); return ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–'; };
const clock = t => { const ms = toMs(t); return ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; };
const sec = ms => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) + ' s' : '–');
const money = n => (n == null || isNaN(n) ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const bytes = n => { if (!Number.isFinite(n)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`; };
const dur = s => { if (!Number.isFinite(s)) return '–'; if (s < 60) return `${s} s`; if (s < 3600) return `${Math.floor(s / 60)} min`; if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`; return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`; };
const thumbStyle = u => (u ? ` style="background-image:url('${esc(u)}')"` : '');
const studioHref = id => `/designs/${encodeURIComponent(id)}`; // urls: the studio fills in the slug
const errBox = e => `<div class="adm-err">${esc(e.message || e)}</div>`;
const TAB = { model: 'Model', code: 'Code', site: 'Website', ads: 'Ads' };

// ---------------------------------------------------------------- routing + nav drawer
const SECTIONS = { support: 'Live support', inbox: 'Inbox', overview: 'Overview', users: 'Users', projects: 'Projects', orders: 'Orders', fulfilment: 'Fulfilment', runs: 'Agent runs', system: 'System' };
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  const [sec = 'support', ...rest] = p.split('/');
  return { sec: SECTIONS[sec] ? sec : 'support', arg: rest.length ? decodeURIComponent(rest.join('/')) : null, q: new URLSearchParams(q) };
}
let R = parse();
function setNav(open) { document.body.classList.toggle('nav-open', open); $('#burger').setAttribute('aria-expanded', String(open)); }
$('#burger').onclick = () => setNav(!document.body.classList.contains('nav-open'));
$('#scrim').onclick = () => setNav(false);
addEventListener('keydown', e => { if (e.key === 'Escape') setNav(false); });
function route() {
  const prev = R; R = parse(); setNav(false);
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.sec === R.sec));
  $('#crumb').textContent = SECTIONS[R.sec];
  main.classList.toggle('full', R.sec === 'support' || R.sec === 'inbox');
  if (R.sec === 'support') return renderSupport(prev.sec !== 'support');
  if (R.sec === 'inbox') { renderInbox(main, R.arg); return updateTitle(); } // supportchat
  ({ overview: renderOverview, users: renderUsers, projects: renderProjects, orders: renderOrders, fulfilment: renderFulfilment, runs: renderRuns, system: renderSystem })[R.sec]();
  updateTitle();
}
addEventListener('hashchange', route);

// ---------------------------------------------------------------- live support state
const SUP = { list: null, err: null, thread: null, threadErr: null, sending: [] };
let unreadTotal = 0;
function updateTitle() {
  const n = unreadTotal;
  document.title = `${n ? `(${n}) ` : ''}${SECTIONS[R.sec]} · Premake admin`;
  const b = $('#navUnread'); b.hidden = !n; b.textContent = n;
}
async function loadConversations() {
  try { const r = await api('/api/admin/support'); SUP.list = r.conversations || []; SUP.err = null; }
  catch (e) { SUP.err = e; }
  unreadTotal = (SUP.list || []).reduce((a, c) => a + (c.unread || 0), 0);
  updateTitle();
  if (R.sec === 'support') drawList();
}
async function loadThread(id) {
  try { const t = await api(`/api/admin/support/${encodeURIComponent(id)}`); if (R.sec === 'support' && R.arg === id) { SUP.thread = t; SUP.threadErr = null; } }
  catch (e) { if (R.arg === id) { SUP.thread = null; SUP.threadErr = e; } }
  if (R.sec === 'support' && R.arg === id) drawThread();
  const c = (SUP.list || []).find(x => x.id === id);
  if (c && c.unread) { c.unread = 0; unreadTotal = SUP.list.reduce((a, x) => a + (x.unread || 0), 0); updateTitle(); drawList(); }
}

function renderSupport(entering) {
  if (!$('.sup', main)) {
    main.innerHTML = `<div class="sup"><section class="sup-list" aria-label="Conversations"><div class="sup-list-h"><h1>Live support</h1><div class="sup-notify" id="supNotify"></div></div>
      <div class="sup-items" id="supItems"><div class="adm-load">Loading conversations…</div></div></section>
      <section class="sup-thread" id="supThread" aria-label="Conversation"></section></div>`;
  }
  $('.sup', main).classList.toggle('has-sel', !!R.arg);
  drawNotify();
  if (entering || !SUP.list) loadConversations(); else drawList();
  if (R.arg) { if (SUP.thread?.id !== R.arg) { SUP.thread = null; SUP.threadErr = null; } drawThread(); loadThread(R.arg); }
  else { SUP.thread = null; drawThread(); }
  updateTitle();
}
function drawList() {
  const el = $('#supItems'); if (!el) return;
  if (SUP.err) { el.innerHTML = errBox(SUP.err); return; }
  if (!SUP.list) return;
  if (!SUP.list.length) { el.innerHTML = '<div class="adm-empty" style="padding:16px 12px">No conversations yet. They appear here when someone writes to live support from the studio.</div>'; return; }
  el.innerHTML = SUP.list.map(c => `<a class="sup-item${c.id === R.arg ? ' on' : ''}${c.unread ? ' unread' : ''}" href="#support/${encodeURIComponent(c.id)}">
    <span class="th"${thumbStyle(c.thumb)}>${c.online ? '<span class="dot on" title="Online now"></span>' : ''}</span>
    <span style="min-width:0"><div class="nm">${esc(c.title)}</div><div class="em">${esc(c.email || c.owner || 'Unknown user')}</div>
      <div class="ls">${c.last.from === 'josh' ? 'You: ' : ''}${esc(c.last.text)}</div></span>
    <span class="rt"><span>${esc(ago(c.last.t))}</span>${c.unread ? `<span class="ud" title="${c.unread} unread"></span>` : ''}${c.online ? '<span class="onl">Online now</span>' : ''}</span></a>`).join('');
}
function msgsHtml(list) {
  let last = '';
  return list.map(m => {
    const day = new Date(toMs(m.t)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const sep = day !== last ? `<div class="sup-day">${esc(day)}</div>` : ''; last = day;
    const me = m.from === 'josh';
    const ctx = [m.context?.tab ? TAB[m.context.tab] || m.context.tab : '', Number.isFinite(m.context?.version) && m.context.version ? `v${m.context.version}` : ''].filter(Boolean).join(' · ');
    return `${sep}<div class="sup-m ${me ? 'me' : 'them'}${m.pending ? ' pending' : ''}"><div class="meta">${esc(me ? (m.email && m.email !== 'josh' ? m.email : 'Josh') : (m.email || 'User'))} · ${esc(clock(m.t))}${ctx && !me ? ` · ${esc(ctx)}` : ''}</div>
      <div class="bub">${textHtml(m.text)}</div></div>`;
  }).join('');
}
function drawThread() {
  const el = $('#supThread'); if (!el) return;
  if (!R.arg) { el.innerHTML = '<div class="sup-none">Pick a conversation.</div>'; return; }
  if (SUP.threadErr) { el.innerHTML = `<div class="sup-ctx"><a class="sup-back" href="#support" aria-label="Back to conversations">${BACK}</a></div>${errBox(SUP.threadErr)}`; return; }
  const t = SUP.thread;
  if (!t) { el.innerHTML = `<div class="sup-ctx"><a class="sup-back" href="#support" aria-label="Back to conversations">${BACK}</a><span class="muted">Loading…</span></div>`; return; }
  const p = t.project;
  const draft = $('#supInput')?.value || '';
  const keepScroll = $('#supMsgs'); const atBottom = !keepScroll || keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 60;
  el.innerHTML = `<div class="sup-ctx"><a class="sup-back" href="#support" aria-label="Back to conversations">${BACK}</a>
      <span class="th"${thumbStyle(p.thumb)}></span>
      <div class="ti"><b>${esc(p.title)}</b><span><span>${esc(p.owner || 'Unknown user')}</span>
        <span><span class="dot ${t.online ? 'on' : ''}"></span> ${t.online ? 'Online now' : `Last seen ${esc(ago(p.last_seen))}`}</span>
        <span>${p.current_v ? `Version v${esc(p.current_v)}` : 'Original version'}${p.versions ? ` of ${esc(p.versions)}` : ''}</span>${p.running ? '<span class="adm-pill acc">Agent running</span>' : ''}</span></div>
      <a class="btn sm" href="${studioHref(t.id)}" target="_blank" rel="noopener">${EXT}<span class="lbl">Open design</span></a></div>
    <div class="sup-msgs" id="supMsgs">${t.messages.length || SUP.sending.length ? msgsHtml([...t.messages, ...SUP.sending.filter(s => s.id === t.id)]) : '<div class="sup-none">No messages yet.</div>'}</div>
    <div class="sup-comp"><textarea id="supInput" rows="1" placeholder="Reply as Josh…" aria-label="Reply"></textarea><button class="btn primary" id="supSend">Send</button></div>
    <div class="sup-hint">Enter to send, Shift+Enter for a new line</div>`;
  const ta = $('#supInput'); ta.value = draft; grow(ta);
  const box = $('#supMsgs'); if (atBottom) box.scrollTop = box.scrollHeight;
  ta.oninput = () => grow(ta);
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendReply(); } };
  $('#supSend').onclick = sendReply;
  if (!isTouch && document.activeElement?.tagName !== 'TEXTAREA') ta.focus({ preventScroll: true });
}
const isTouch = matchMedia('(pointer: coarse)').matches;
function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight + 2) + 'px'; }
async function sendReply() {
  const ta = $('#supInput'); const text = ta.value.trim(); const id = R.arg;
  if (!text || !id) return;
  askNotifyOnce();
  ta.value = ''; grow(ta);
  const pend = { id, from: 'josh', text, t: Date.now() / 1000, pending: true };
  SUP.sending.push(pend); drawThread();
  try { const r = await api(`/api/admin/support/${encodeURIComponent(id)}`, { method: 'POST', body: { text } }); if (R.arg === id) SUP.thread = { id, messages: r.messages, online: r.online, project: r.project }; }
  catch (e) { toast(e.message); if (R.arg === id && !$('#supInput').value) $('#supInput').value = text; }
  SUP.sending = SUP.sending.filter(x => x !== pend);
  if (R.arg === id) drawThread();
  loadConversations();
}
const BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
const EXT = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v4h-9v-9h4" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
function toast(msg) {
  const t = document.createElement('div');
  t.setAttribute('role', 'status');
  t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100;background:var(--a-s3);color:var(--a-text);border:1px solid var(--a-line2);padding:8px 14px;border-radius:8px;max-width:90vw';
  t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 4000);
}

// ---------------------------------------------------------------- notifications: sound, desktop, tab title
let actx = null;
addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }, { once: false, passive: true });
function ping() {
  if (!actx) return;
  try {
    const t0 = actx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.12]]) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.18, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.3);
      o.start(t0 + d); o.stop(t0 + d + 0.32);
    }
  } catch {}
}
const NOTIFY_KEY = 'buildery.admin.notifyAsked';
const asked = () => { try { return localStorage.getItem(NOTIFY_KEY) === '1'; } catch { return false; } };
function askNotifyOnce() {
  if (!('Notification' in window) || Notification.permission !== 'default' || asked()) return;
  try { localStorage.setItem(NOTIFY_KEY, '1'); } catch {}
  Notification.requestPermission().then(drawNotify).catch(() => {});
}
function drawNotify() {
  const el = $('#supNotify'); if (!el) return;
  if (!('Notification' in window)) { el.textContent = 'New messages play a sound.'; return; }
  const p = Notification.permission;
  if (p === 'granted') el.innerHTML = '<span class="dot on"></span>Desktop notifications on';
  else if (p === 'denied') el.textContent = 'Desktop notifications are blocked in this browser. New messages still play a sound.';
  else el.innerHTML = '<span>Get a desktop notification for new messages.</span><button id="notifyBtn">Turn on</button>';
  const b = $('#notifyBtn'); if (b) b.onclick = () => { try { localStorage.setItem(NOTIFY_KEY, '1'); } catch {} Notification.requestPermission().then(drawNotify).catch(() => {}); };
}
async function notifyNew(ev) {
  ping();
  const c = (SUP.list || []).find(x => x.id === ev.id);
  const viewing = R.sec === 'support' && R.arg === ev.id && !document.hidden;
  if (viewing || !('Notification' in window) || Notification.permission !== 'granted') return;
  const last = c?.last?.text || 'New message';
  try {
    const n = new Notification(`${c?.title || 'Live support'}${c?.email ? ' · ' + c.email : ''}`, { body: last.slice(0, 160), tag: 'sup-' + ev.id });
    n.onclick = () => { focus(); location.hash = `#support/${encodeURIComponent(ev.id)}`; n.close(); };
  } catch {}
}

// ---------------------------------------------------------------- live events: SSE, polling fallback
const LIVE = { boot: null, seq: 0, es: null, sseOk: false, lastMsg: 0, poll: null, timer: null };
function setLive(state, label) { const el = $('#live'); $('.dot', el).className = 'dot' + (state === 'ok' ? ' on' : state === 'err' ? ' bad' : ''); $('.adm-live-l', el).textContent = label; }
let refreshT = null;
function refreshSoon() { clearTimeout(refreshT); refreshT = setTimeout(loadConversations, 150); }
async function onEvent(ev) {
  if (ev.type === 'hello') {
    if (ev.boot !== LIVE.boot) { const restarted = !!LIVE.boot; LIVE.boot = ev.boot; LIVE.seq = ev.seq || 0; if (restarted) { refreshSoon(); if (R.arg) loadThread(R.arg); } }
    return;
  }
  if (ev.type === 'ping') return;
  if (ev.seq != null) { if (ev.seq <= LIVE.seq) return; LIVE.seq = ev.seq; }
  if (ev.type === 'support') {
    if (R.sec === 'support' && R.arg === ev.id) loadThread(ev.id);
    await loadConversations();
    if (ev.from === 'user') notifyNew(ev);
  }
}
function startSSE() {
  if (NOSSE || !window.EventSource) return startPoll();
  const es = new EventSource('/api/admin/events'); LIVE.es = es; LIVE.sseOk = false;
  const arm = () => { clearTimeout(LIVE.timer); LIVE.timer = setTimeout(() => { if (LIVE.es === es && !LIVE.sseOk) startPoll(); }, 5000); };
  arm();
  es.onopen = arm;
  es.onerror = () => { if (LIVE.es !== es) return; LIVE.sseOk = false; startPoll(); };
  es.onmessage = m => {
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    LIVE.lastMsg = Date.now();
    if (!LIVE.sseOk) { LIVE.sseOk = true; stopPoll(); setLive('ok', 'Live'); refreshSoon(); }
    onEvent(ev);
  };
}
// A stream that went quiet (missed two pings) is dead: poll until it delivers again.
setInterval(() => { if (LIVE.es && LIVE.sseOk && Date.now() - LIVE.lastMsg > 40000) { LIVE.sseOk = false; startPoll(); } }, 10000);
function startPoll() {
  if (LIVE.poll) return;
  LIVE.poll = { t: null };
  setLive('ok', NOSSE ? 'Live (polling)' : 'Live (polling)');
  pollOnce();
}
function stopPoll() { if (!LIVE.poll) return; clearTimeout(LIVE.poll.t); LIVE.poll = null; }
async function pollOnce() {
  if (!LIVE.poll) return;
  try {
    const r = await api(`/api/admin/poll?${new URLSearchParams(LIVE.boot ? { since: LIVE.seq, boot: LIVE.boot } : {})}`);
    if (r.reset || r.boot !== LIVE.boot) { const first = !LIVE.boot; LIVE.boot = r.boot; LIVE.seq = r.seq; if (!first) { refreshSoon(); if (R.arg) loadThread(R.arg); } }
    else for (const ev of r.events) await onEvent(ev);
    setLive('ok', 'Live (polling)');
  } catch { setLive('err', 'Reconnecting'); }
  if (LIVE.poll) LIVE.poll.t = setTimeout(pollOnce, document.hidden ? 8000 : 2500);
}
// Presence: an open SSE stream or any /api/admin request counts. A heartbeat keeps "Josh is online" true while the tab is open.
setInterval(() => { api('/api/admin/heartbeat', { method: 'POST', body: {} }).catch(() => {}); }, 60000);
// Presence dots and "last seen" drift: refresh the list every 20 s while support is open.
setInterval(() => { if (R.sec === 'support' && !document.hidden) loadConversations(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && LIVE.poll) { clearTimeout(LIVE.poll.t); pollOnce(); } });

// ---------------------------------------------------------------- overview
const METRIC = { signups: 'Signups', active: 'Active users', designs: 'Designs created', runs: 'Agent runs', failed: 'Failed runs', orders: 'Orders', revenue: 'Revenue paid' };
function spark(s) {
  const w = 140, h = 34, max = Math.max(1, ...s), n = s.length;
  const pts = s.map((v, i) => `${(i / (n - 1)) * w},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,${h} ${pts} ${w},${h}" fill="currentColor" fill-opacity=".12" stroke="none"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function shell(title, sub, body = '<div class="adm-load">Loading…</div>') { main.innerHTML = `<div class="adm-sec"><h1>${esc(title)}</h1>${sub ? `<p class="adm-sub">${sub}</p>` : ''}<div id="secBody">${body}</div></div>`; return $('#secBody'); }
async function renderOverview() {
  const el = shell('Overview', 'Today and the last 7 days. Lines show the last 14 days.');
  let o; try { o = await api('/api/admin/overview'); } catch (e) { el.innerHTML = errBox(e); return; }
  if (R.sec !== 'overview') return;
  const fmt = (k, v) => (k === 'revenue' ? money(v) : Number(v).toLocaleString('en-US'));
  el.innerHTML = `<div class="adm-cards">${o.metrics.map(m => `<div class="adm-card${m.key === 'failed' && m.d7 ? ' bad' : ''}"><div class="k">${esc(METRIC[m.key] || m.key)}</div>
      <div class="v">${fmt(m.key, m.today)}<small>today</small></div><div class="k">${fmt(m.key, m.d7)} in 7 days</div>${spark(m.series)}</div>`).join('')}</div>
    <div class="adm-h2">Run times (last ${esc(o.timing[0]?.n ?? 0)} design runs)</div>
    <div class="adm-tw" style="max-width:520px"><table class="adm-t"><thead><tr><th>Phase</th><th class="num">Runs</th><th class="num">p50</th><th class="num">p90</th></tr></thead><tbody>
      ${o.timing.map(t => `<tr><td>${esc({ first_token: 'First token', first_model: 'First model', end: 'Done' }[t.key] || t.key)}</td><td class="num">${t.n}</td><td class="num">${sec(t.p50)}</td><td class="num">${sec(t.p90)}</td></tr>`).join('')}</tbody></table></div>
    <div class="adm-h2">All time</div>
    <dl class="adm-kv"><dt>Users</dt><dd>${o.totals.users}</dd><dt>Projects</dt><dd>${o.totals.projects}</dd><dt>Agent runs</dt><dd>${o.totals.runs}</dd><dt>Orders</dt><dd>${o.totals.orders}</dd></dl>`;
}

// ---------------------------------------------------------------- users
async function renderUsers() {
  const el = shell('Users', 'Everyone who has signed in. Click a row for their projects.');
  let list; try { list = await api('/api/admin/users'); } catch (e) { el.innerHTML = errBox(e); return; }
  if (R.sec !== 'users') return;
  el.innerHTML = `<div class="adm-row"><input type="search" id="uq" placeholder="Search email" aria-label="Search users" style="width:260px"><span class="grow"></span><span class="muted">${list.length} users</span></div><div id="ut"></div>`;
  const draw = () => {
    const q = $('#uq').value.trim().toLowerCase();
    const rows = list.filter(u => !q || u.email.includes(q));
    $('#ut').innerHTML = rows.length ? `<div class="adm-tw"><table class="adm-t"><thead><tr><th>Email</th><th class="hide-m">First seen</th><th>Last active</th><th class="num">Projects</th><th class="num">Runs today</th><th class="num hide-m">Runs 7d</th><th class="num hide-m">Orders</th><th class="num hide-m">Paid</th></tr></thead><tbody>
      ${rows.map(u => `<tr class="click" data-email="${esc(u.email)}"><td class="t1">${esc(u.email)}</td><td class="hide-m">${esc(when(u.first_seen))}</td><td>${esc(ago(u.last_seen))}</td><td class="num">${u.projects}</td><td class="num">${u.runs_today}</td><td class="num hide-m">${u.runs_7d}</td><td class="num hide-m">${u.orders}</td><td class="num hide-m">${u.paid ? money(u.paid) : '–'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="adm-empty">No users match.</div>';
    $$('#ut tr[data-email]').forEach(tr => tr.onclick = () => { location.hash = `#projects?owner=${encodeURIComponent(tr.dataset.email)}`; });
  };
  $('#uq').oninput = draw; draw();
}

// ---------------------------------------------------------------- projects
async function renderProjects() {
  const owner = R.q.get('owner') || '';
  const el = shell('Projects', owner ? `Projects owned by <b>${esc(owner)}</b> · <a class="lnk" href="#projects">Show all</a>` : 'Every project. Open any of them in the studio.');
  let list; try { list = await api('/api/admin/projects' + (owner ? `?owner=${encodeURIComponent(owner)}` : '')); } catch (e) { el.innerHTML = errBox(e); return; }
  if (R.sec !== 'projects') return;
  el.innerHTML = `<div class="adm-row"><input type="search" id="pq" placeholder="Search title or owner" aria-label="Search projects" style="width:260px">
    <select id="pf" aria-label="Filter"><option value="">All</option><option value="running">Running</option><option value="shared">Shared</option><option value="published">Published</option><option value="support">With support chat</option></select><span class="grow"></span><span class="muted" id="pc"></span></div><div id="pt"></div>`;
  const draw = () => {
    const q = $('#pq').value.trim().toLowerCase(), f = $('#pf').value;
    const rows = list.filter(p => (!q || p.title.toLowerCase().includes(q) || String(p.owner || '').includes(q))
      && (!f || (f === 'running' ? p.running || p.site_running || p.ads_running : f === 'support' ? p.support > 0 : p[f])));
    $('#pc').textContent = `${rows.length} of ${list.length}`;
    $('#pt').innerHTML = rows.length ? `<div class="adm-tw"><table class="adm-t"><thead><tr><th></th><th>Title</th><th class="hide-m">Owner</th><th>Updated</th><th>State</th><th class="num hide-m">Versions</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td><span class="th"${thumbStyle(p.thumb)}></span></td>
        <td class="wrap"><div class="t1">${esc(p.title)}</div><div class="t2 mono">${esc(p.id)}</div></td>
        <td class="hide-m">${p.owner ? `<a class="lnk" href="#projects?owner=${encodeURIComponent(p.owner)}">${esc(p.owner)}</a>` : '–'}</td>
        <td>${esc(ago(p.updated))}</td>
        <td><span style="display:flex;gap:4px;flex-wrap:wrap">${p.running ? '<span class="adm-pill acc">Design running</span>' : ''}${p.site_running ? '<span class="adm-pill acc">Page running</span>' : ''}${p.ads_running ? '<span class="adm-pill acc">Ads running</span>' : ''}${p.online ? '<span class="adm-pill ok">Owner online</span>' : ''}${p.shared ? '<span class="adm-pill">Shared</span>' : ''}${p.published ? '<span class="adm-pill ok">Published</span>' : ''}${p.support ? `<a class="adm-pill warn" href="#support/${encodeURIComponent(p.id)}">Support ${p.support}</a>` : ''}</span></td>
        <td class="num hide-m">${p.versions}</td>
        <td><a class="btn sm" href="${studioHref(p.id)}" target="_blank" rel="noopener">Open</a></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="adm-empty">No projects match.</div>';
  };
  $('#pq').oninput = draw; $('#pf').onchange = draw; draw();
}

// ---------------------------------------------------------------- orders (moved from the studio's #/orders/all)
const ORDER_STATUSES = ['pending', 'paid', 'printing', 'shipped', 'refunded', 'canceled'];
const statusLabel = s => ({ pending: 'Pending', paid: 'Paid', printing: 'Printing', shipped: 'Shipped', canceled: 'Canceled', expired: 'Expired', refunded: 'Refunded' }[s] || s);
const addr = a => !a ? '' : [a.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].filter(Boolean).map(esc).join(', ');
async function renderOrders() {
  const el = shell('Orders', 'Every order, newest first. Set the status as it moves through printing and shipping.');
  let list; try { list = await api('/api/orders?all=1'); } catch (e) { el.innerHTML = errBox(e); return; }
  if (R.sec !== 'orders') return;
  el.innerHTML = `<div class="adm-row"><select id="of" aria-label="Status filter"><option value="">All statuses</option>${ORDER_STATUSES.concat('expired').map(s => `<option value="${s}">${statusLabel(s)}</option>`).join('')}</select><span class="grow"></span><span class="muted" id="oc"></span></div><div id="ot"></div>`;
  const draw = () => {
    const f = $('#of').value; const rows = list.filter(o => !f || o.status === f);
    $('#oc').textContent = `${rows.length} orders`;
    $('#ot').innerHTML = rows.length ? `<div class="adm-tw"><table class="adm-t"><thead><tr><th>Ordered</th><th>Design</th><th class="hide-m">Customer</th><th class="hide-m">Ship to</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
      ${rows.map(o => `<tr data-id="${esc(o.id)}"><td>${esc(when(o.created))}${o.livemode ? '' : '<div class="t2">Test</div>'}</td>
        <td class="wrap"><div class="t1">${o.source?.project ? `<a class="lnk" href="${studioHref(o.source.project)}" target="_blank" rel="noopener">${esc(o.title)}</a>` : esc(o.title)}</div><div class="t2">${esc(o.qty)} × ${esc(o.mode)} · <span class="mono">${esc(o.id)}</span>${o.amount_mismatch ? ' · <b style="color:var(--a-bad)">Amount differs from quote</b>' : ''}</div></td>
        <td class="hide-m">${esc(o.email || o.user || '–')}</td>
        <td class="hide-m"><div class="addr">${addr(o.ship_to) || '<span class="muted">No address yet</span>'}</div></td>
        <td class="num">${money(o.amount_total != null ? o.amount_total / 100 : o.total)}</td>
        <td><select class="ord-st" data-status aria-label="Status">${ORDER_STATUSES.concat(ORDER_STATUSES.includes(o.status) ? [] : [o.status]).map(s => `<option value="${esc(s)}" ${s === o.status ? 'selected' : ''}>${esc(statusLabel(s))}</option>`).join('')}</select>${FUL_ST.has(o.status) ? ' <button class="btn sm" data-ful aria-expanded="false">Fulfilment</button>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="adm-empty">No orders yet.</div>';
    $$('#ot [data-status]').forEach(sel => sel.onchange = async () => {
      const id = sel.closest('tr').dataset.id; sel.disabled = true;
      try { const o = await api(`/api/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: sel.value } }); const i = list.findIndex(x => x.id === id); if (i >= 0) list[i] = { ...list[i], ...o }; toast(`Order set to ${statusLabel(o.status)}`); }
      catch (e) { toast(e.message); }
      sel.disabled = false;
    });
    $$('#ot [data-ful]').forEach(btn => btn.onclick = () => { // fulfilment: the plan panel opens under the order row
      const tr = btn.closest('tr'), next = tr.nextElementSibling;
      if (next?.classList.contains('ful-row')) { next.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      const row = document.createElement('tr'); row.className = 'ful-row'; row.innerHTML = '<td colspan="6"><div></div></td>'; tr.after(row);
      btn.setAttribute('aria-expanded', 'true'); mountPlan($('div', row), tr.dataset.id, { api, toast });
    });
  };
  $('#of').onchange = draw; draw();
}

// ---------------------------------------------------------------- fulfilment (web/fulfil.js, server/fulfilment)
const FUL_ST = new Set(['paid', 'printing', 'shipped']);
function renderFulfilment() {
  if (R.arg) {
    const el = shell('Fulfilment', `<a class="lnk" href="#fulfilment">All open jobs</a> · <span class="mono">${esc(R.arg)}</span>`);
    return mountPlan(el, R.arg, { api, toast });
  }
  const el = shell('Fulfilment', 'Supplier jobs to place across paid orders, oldest first. Nothing is ordered or paid until you do it.');
  return renderQueue(el, { api, toast, isCurrent: () => R.sec === 'fulfilment' && !R.arg });
}

// ---------------------------------------------------------------- agent runs
async function renderRuns() {
  const q = R.q;
  const el = shell('Agent runs', 'Recent agent turns across every user, newest first.', '');
  el.innerHTML = `<form class="adm-row" id="rf"><input type="search" name="user" placeholder="User email" aria-label="User" value="${esc(q.get('user') || '')}" style="width:200px">
    <select name="kind" aria-label="Agent"><option value="">All agents</option>${['design', 'site', 'ads'].map(k => `<option value="${k}" ${q.get('kind') === k ? 'selected' : ''}>${{ design: 'Design', site: 'Website', ads: 'Ads' }[k]}</option>`).join('')}</select>
    <select name="ok" aria-label="Result"><option value="">All results</option>${['ok', 'failed', 'stopped'].map(k => `<option value="${k}" ${q.get('ok') === k ? 'selected' : ''}>${{ ok: 'Succeeded', failed: 'Failed', stopped: 'Stopped' }[k]}</option>`).join('')}</select>
    <select name="n" aria-label="How many">${[100, 200, 500].map(n => `<option ${String(n) === (q.get('n') || '200') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    ${q.get('project') ? `<span class="adm-pill">Project ${esc(q.get('project'))} <a href="#runs" aria-label="Clear project filter">×</a></span><input type="hidden" name="project" value="${esc(q.get('project'))}">` : ''}
    <span class="grow"></span><span class="muted" id="rc"></span></form><div id="rt"><div class="adm-load">Loading…</div></div>`;
  const form = $('#rf');
  const go = () => { const p = new URLSearchParams([...new FormData(form)].filter(([, v]) => v)); location.hash = '#runs' + (String(p) ? '?' + p : ''); };
  form.onchange = go; form.onsubmit = e => { e.preventDefault(); go(); };
  let r; try { r = await api('/api/admin/runs?' + new URLSearchParams([...q].filter(([, v]) => v))); } catch (e) { $('#rt').innerHTML = errBox(e); return; }
  if (R.sec !== 'runs') return;
  $('#rc').textContent = `${r.runs.length} of ${r.total}`;
  $('#rt').innerHTML = r.runs.length ? `<div class="adm-tw"><table class="adm-t"><thead><tr><th>When</th><th class="hide-m">User</th><th>Project</th><th class="hide-m">Agent</th><th class="hide-m">Model</th><th class="hide-m">Effort</th><th>Result</th><th class="num">First model</th><th class="num">Done</th><th class="num hide-m">Denied</th><th class="num hide-m">Builds</th></tr></thead><tbody>
    ${r.runs.map(x => `<tr><td>${esc(when(x.t))}</td><td class="hide-m">${x.user ? `<a class="lnk" href="#runs?user=${encodeURIComponent(x.user)}">${esc(x.user)}</a>` : '–'}</td>
      <td class="wrap"><a class="lnk" href="#runs?project=${encodeURIComponent(x.id)}">${esc(x.title)}</a></td>
      <td class="hide-m">${esc({ design: 'Design', site: 'Website', ads: 'Ads' }[x.kind] || x.kind)}${x.warm ? ' <span class="t2">warm</span>' : ''}</td>
      <td class="hide-m mono">${esc(x.model || '–')}</td><td class="hide-m">${esc(x.effort || 'default')}</td>
      <td>${x.stopped ? '<span class="adm-pill warn">Stopped</span>' : x.ok ? '<span class="adm-pill ok">OK</span>' : `<span class="adm-pill bad" title="${esc(x.error || '')}">Failed</span>`}</td>
      <td class="num">${sec(x.first_model)}</td><td class="num">${sec(x.end)}</td>
      <td class="num hide-m">${x.denied ? `<b style="color:var(--a-warn)">${x.denied}</b>` : 0}</td><td class="num hide-m">${x.builds}${x.failed_builds ? ` <span class="t2">(${x.failed_builds} failed)</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="adm-empty">No runs match.</div>';
}

// ---------------------------------------------------------------- system
async function renderSystem() {
  const el = shell('System', 'This Mac’s server, the warm agent pool and the gateway.');
  let s; try { s = await api('/api/admin/system'); } catch (e) { el.innerHTML = errBox(e); return; }
  if (R.sec !== 'system') return;
  const g = s.gateway, c = s.concurrency, maxPart = Math.max(1, ...s.disk.parts.map(p => p.bytes || 0));
  el.innerHTML = `<div class="adm-cards">
      <div class="adm-card"><div class="k">Server uptime</div><div class="v">${esc(dur(s.uptime_s))}</div><div class="k">Started ${esc(when(s.started))}</div></div>
      <div class="adm-card"><div class="k">Agents running</div><div class="v">${c.active}<small>of ${c.max}</small></div><div class="k">Design ${c.design} · Website ${c.site} · Ads ${c.ads + c.ads_jobs} · Sketch ${c.sketches}</div></div>
      <div class="adm-card"><div class="k">Rate-limit hits</div><div class="v">${s.rate_hits.last_hour}<small>last hour</small></div><div class="k">${s.rate_hits.last_24h} in 24 h</div></div>
      <div class="adm-card"><div class="k">Mac</div><div class="v"><span class="dot on"></span> Up</div><div class="k">Load ${esc(s.load.join(' / '))} · ${esc(bytes(s.rss))} memory</div></div>
      <div class="adm-card"><div class="k">Gateway</div><div class="v">${!g.configured ? '<span class="dot"></span> Not set' : g.ok ? '<span class="dot on"></span> Healthy' : '<span class="dot bad"></span> Down'}</div><div class="k">${g.configured ? `${g.ms} ms${g.ok ? ` · Mac ${g.target ? 'registered' : 'not registered'} · Google ${g.google ? 'on' : 'off'}` : ''}` : 'Local only'}</div></div>
      <div class="adm-card"><div class="k">Presence</div><div class="v">${s.presence.users_online}<small>users online</small></div><div class="k">Support shows ${s.presence.admin_online ? '“Josh is online”' : '“Usually replies within a few hours”'}</div></div>
    </div>
    <div class="adm-h2">Warm agent pool (${s.pool.length} of ${s.limits.pool_max})</div>
    ${s.pool.length ? `<div class="adm-tw"><table class="adm-t"><thead><tr><th>Project</th><th class="hide-m">Owner</th><th>State</th><th class="hide-m">Effort</th><th class="num">Age</th><th class="num">Idle</th></tr></thead><tbody>
      ${s.pool.map(p => `<tr><td><a class="lnk" href="${studioHref(p.id)}" target="_blank" rel="noopener">${esc(p.title)}</a></td><td class="hide-m">${esc(p.owner || '–')}</td><td>${p.busy ? '<span class="adm-pill acc">Busy</span>' : '<span class="adm-pill">Idle</span>'}</td><td class="hide-m">${esc(p.effort)}</td><td class="num">${esc(dur(p.age_s))}</td><td class="num">${esc(dur(p.idle_s))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="adm-empty" style="padding:8px 0">No warm agents.</div>'}
    <div class="adm-h2">Build workers (${s.workers.length} of ${s.limits.workers_max})</div>
    ${s.workers.length ? `<div class="adm-tw"><table class="adm-t"><thead><tr><th>Project</th><th class="hide-m">Owner</th><th class="num">Age</th><th class="num">Idle</th></tr></thead><tbody>
      ${s.workers.map(w => `<tr><td>${esc(w.title)}</td><td class="hide-m">${esc(w.owner || '–')}</td><td class="num">${esc(dur(w.age_s))}</td><td class="num">${esc(dur(w.idle_s))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="adm-empty" style="padding:8px 0">No build workers.</div>'}
    <div class="adm-h2">Rate-limit hits by kind (24 h)</div>
    ${Object.keys(s.rate_hits.by_kind).length ? `<dl class="adm-kv">${Object.entries(s.rate_hits.by_kind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<dt>${esc(k)}</dt><dd>${n}</dd>`).join('')}</dl>` : '<div class="adm-empty" style="padding:8px 0">None.</div>'}
    <div class="adm-h2">Disk: data/ ${esc(bytes(s.disk.total))}${Number.isFinite(s.disk.free) ? ` · ${esc(bytes(s.disk.free))} free on the volume` : ''}</div>
    <div class="adm-tw" style="max-width:560px"><table class="adm-t"><tbody>${s.disk.parts.map(p => `<tr><td>${esc(p.name)}</td><td style="width:50%"><div class="adm-bar"><i style="width:${((p.bytes || 0) / maxPart * 100).toFixed(1)}%"></i></div></td><td class="num">${esc(bytes(p.bytes))}</td></tr>`).join('')}</tbody></table></div>
    <div class="adm-h2">Limits</div>
    <dl class="adm-kv"><dt>Runs per hour / day</dt><dd>${s.limits.runs_per_hour} / ${s.limits.runs_per_day} per user</dd><dt>Agents at once</dt><dd>${s.limits.concurrent}</dd>
      <dt>Warm pool</dt><dd>${s.limits.pool_max} total, ${s.limits.pool_per_user} per user, ${s.limits.pool_idle_min} min idle</dd><dt>Node</dt><dd>${esc(s.node)}</dd><dt>Host uptime</dt><dd>${esc(dur(s.host_uptime_s))}</dd></dl>`;
}

// ---------------------------------------------------------------- boot
route();
startSSE();
if (R.sec !== 'support') loadConversations(); // unread count in the nav and the tab title
initInbox(); // supportchat: new-message sound + desktop notification on every admin page
