// "Message us": the user's written thread with Josh, shown inside the support card / phone sheet (web/support.js).
// Server: server/supportchat.js (/api/supportchat). Polls every 6 s while open; the bubble's unread dot polls /unread.
// Each message carries context (design, page, viewport); the server adds browser/OS. Only Josh sees it.
// Images: re-encoded in the browser (max 1600 px JPEG, no EXIF), then checked again on the server.
// Styles: web/support.css under .sc-*.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const CLIP = '<svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7.2" cy="8.3" r="1.5" fill="currentColor"/><path d="M3 14.5l4.2-3.6 3 2.4 3.1-3.3 4.2 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const SEND = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 16V4.5M5 9l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MAX_SIDE = 1600, MAX_BYTES = 5 * 1024 * 1024, MAX_IMAGES = 4, MAX_TEXT = 4000;

async function api(path, opts = {}) {
  let r;
  try { r = await fetch(path, { cache: 'no-store', ...opts }); } catch { throw Object.assign(new Error('Can’t reach Premake. Check your connection.'), { status: 0 }); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(d?.error || `Something went wrong (${r.status})`), { status: r.status });
  return d;
}
const signin = () => dispatchEvent(new CustomEvent('forma:signin')); // guest: web/guest.js opens the sign-in modal

/** Unread replies from Josh (0 for guests or on any error). */
export async function supportUnread() {
  try { return (await api('/api/supportchat/unread')).unread || 0; } catch { return 0; }
}

async function shrink(file) {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name || 'That file'} is not an image.`);
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    try { src = await createImageBitmap(file); } catch { throw new Error(`Couldn’t read ${file.name || 'that image'}.`); }
  }
  const k = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  for (const q of [0.85, 0.7, 0.55]) {
    const b = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error('That image is too big. Try a smaller one.');
}

const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(t) {
  const d = new Date(t), today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function msgsHtml(list) {
  if (!list.length) return '<p class="sc-empty">Tell us what’s broken or what you’d like. The team usually replies within a few hours.</p>';
  let day = '';
  return list.map((m, i) => {
    const d = dayLabel(m.t), next = list[i + 1];
    const sep = d !== day ? `<div class="sc-day">${esc(d)}</div>` : ''; day = d;
    const tail = !next || next.from !== m.from || next.t - m.t > 600e3 || dayLabel(next.t) !== d;
    const imgs = (m.images || []).map(u => `<a class="sc-img" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Attached image" loading="lazy"></a>`).join('');
    return `${sep}<div class="sc-m ${m.from === 'josh' ? 'them' : 'me'}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}">
      ${imgs ? `<div class="sc-imgs">${imgs}</div>` : ''}${m.text ? `<div class="sc-b">${esc(m.text)}</div>` : ''}
      ${m.failed ? `<div class="sc-t">Not sent. <button type="button" class="sc-retry" data-i="${i}">Try again</button></div>` : tail ? `<div class="sc-t">${m.from === 'josh' ? 'Premake · ' : ''}${m.pending ? 'Sending…' : esc(clock(m.t))}</div>` : ''}</div>`;
  }).join('');
}

/**
 * The thread view. opts: { context(): {design, kind, title, url, page, viewport}, onBack(), onClose(), onUnread(n), phone() }
 * Returns { render(container), stop(), poll() }.
 */
export function supportThread(opts) {
  let host = null, timer = null, list = [], pending = [], imgs = [], loaded = false, err = '', inflight = false, draft = '';

  function draw() {
    if (!host) return;
    const box = host.querySelector('.sc-msgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const html = loaded || pending.length ? msgsHtml([...list, ...pending]) : '<p class="sc-empty">Loading…</p>';
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; if (atBottom || box.dataset.first !== '1') { box.scrollTop = box.scrollHeight; box.dataset.first = '1'; } }
    host.querySelector('.sc-err').textContent = err;
    host.querySelector('.sc-err').hidden = !err;
    const tray = host.querySelector('.sc-tray');
    tray.hidden = !imgs.length;
    tray.innerHTML = imgs.map((x, i) => `<span class="sc-th${x.state === 'up' ? ' busy' : ''}"><img src="${esc(x.preview)}" alt=""><button type="button" class="sc-th-x" data-i="${i}" aria-label="Remove image">${X}</button></span>`).join('');
    sync();
  }
  function sync() {
    if (!host) return;
    const ta = host.querySelector('textarea');
    const can = (ta.value.trim() || imgs.some(x => x.state === 'ok')) && !imgs.some(x => x.state === 'up');
    host.querySelector('.sc-send').disabled = !can;
    host.querySelector('.sc-att').disabled = imgs.length >= MAX_IMAGES;
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(opts.phone() ? 120 : 140, ta.scrollHeight) + 'px'; }

  async function poll() {
    if (!host || inflight) return;
    inflight = true;
    try {
      const r = await api('/api/supportchat?read=1');
      list = r.messages || []; loaded = true; if (err && !pending.some(p => p.failed)) err = '';
      opts.onUnread?.(0);
    } catch (e) {
      if (e.status === 401) { stop(); opts.onClose?.(); signin(); inflight = false; return; }
      err = e.message;
    }
    inflight = false;
    draw();
  }

  async function send(retry) {
    const ta = host.querySelector('textarea');
    let item = retry;
    if (!item) {
      const text = ta.value.trim().slice(0, MAX_TEXT);
      const ok = imgs.filter(x => x.state === 'ok');
      if (!text && !ok.length) return;
      item = { from: 'user', text, t: Date.now(), pending: true, ids: ok.map(x => x.id), images: ok.map(x => x.preview) };
      ta.value = ''; draft = ''; grow(ta); imgs = []; pending.push(item);
    } else { item.failed = false; item.pending = true; }
    err = ''; draw();
    try {
      const r = await api('/api/supportchat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.text, images: item.ids, context: opts.context() }) });
      list = r.messages; loaded = true;
      pending = pending.filter(p => p !== item);
    } catch (e) {
      if (e.status === 401) { pending = pending.filter(p => p !== item); stop(); opts.onClose?.(); signin(); return; }
      item.pending = false; item.failed = true; err = e.message;
    }
    draw();
  }

  async function addFiles(files) {
    for (const f of [...files].slice(0, MAX_IMAGES - imgs.length)) {
      const x = { state: 'up', preview: '' };
      imgs.push(x); draw();
      try {
        const blob = await shrink(f);
        x.preview = URL.createObjectURL(blob); draw();
        const r = await api('/api/supportchat/image', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        x.id = r.id; x.state = 'ok';
      } catch (e) {
        imgs = imgs.filter(y => y !== x);
        if (e.status === 401) { stop(); opts.onClose?.(); signin(); return; }
        err = e.message;
      }
      draw();
    }
  }

  function render(container) {
    host = container;
    host.innerHTML = `${opts.phone() ? '<div class="sup-grab" aria-hidden="true"></div>' : ''}
      <div class="sc-head">
        <button type="button" class="btn sm sc-back" aria-label="Back">${BACK}</button>
        <span class="sup-av" aria-hidden="true">J</span>
        <div class="sup-who"><b>Message the Premake team</b><span>Usually replies within a few hours</span></div>
        <button type="button" class="btn sm sup-x" aria-label="Close">${X}</button>
      </div>
      <div class="sc-msgs" role="log" aria-live="polite" aria-label="Messages"></div>
      <p class="sc-err" role="alert" hidden></p>
      <div class="sc-tray" hidden></div>
      <form class="sc-comp">
        <button type="button" class="sc-att" aria-label="Attach a screenshot" title="Attach a screenshot">${CLIP}</button>
        <input type="file" accept="image/*" multiple hidden>
        <textarea rows="1" maxlength="${MAX_TEXT}" placeholder="Write a message" aria-label="Message"></textarea>
        <button type="submit" class="sc-send" aria-label="Send" disabled>${SEND}</button>
      </form>`;
    const ta = host.querySelector('textarea'), file = host.querySelector('input[type=file]');
    host.querySelector('.sc-back').onclick = () => { stop(); opts.onBack?.(); };
    host.querySelector('.sc-att').onclick = () => file.click();
    file.onchange = () => { addFiles(file.files); file.value = ''; };
    host.querySelector('.sc-comp').onsubmit = e => { e.preventDefault(); send(); };
    ta.value = draft; grow(ta);
    ta.oninput = () => { draft = ta.value; grow(ta); sync(); };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !opts.phone()) { e.preventDefault(); send(); } };
    ta.onpaste = e => { const fs = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); addFiles(fs); } };
    host.addEventListener('click', e => {
      const rm = e.target.closest('.sc-th-x'); if (rm) { imgs.splice(Number(rm.dataset.i), 1); draw(); return; }
      const rt = e.target.closest('.sc-retry'); if (rt) { const p = [...list, ...pending][Number(rt.dataset.i)]; if (p?.failed) send(p); }
    });
    draw();
    poll();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) poll(); }, 6000);
    if (!opts.phone()) ta.focus({ preventScroll: true });
  }
  function stop() { clearInterval(timer); timer = null; host = null; }
  return { render, stop, poll, active: () => !!host };
}
