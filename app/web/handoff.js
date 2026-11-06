// handoff: "Continue on phone". A small modal with a QR code for a 2-minute, single-use link (premake.ai/phone/<code>)
// that opens this design on a phone, signed in as you. Opened from the Share popover and a design's right-click menu.
// Server: server/handoff.js + routes in server/server.js; the gateway redeems the code (gateway/handoff.js).
/** web/apps/qr.js (the vendored encoder) is a classic script, window.BuilderyQR; load it once. Same as appview.js. */
let qrLoad = null;
function loadQr() {
  if (window.BuilderyQR) return Promise.resolve(window.BuilderyQR);
  qrLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = '/apps/qr.js'; s.async = true;
    s.onload = () => (window.BuilderyQR ? resolve(window.BuilderyQR) : reject(new Error('qr')));
    s.onerror = () => { qrLoad = null; reject(new Error('qr')); };
    document.head.append(s);
  });
  return qrLoad;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let open = null;

/** Open the modal for design `id` (`title` for the heading's sentence). */
export function openHandoff(id, title = 'this design') {
  open?.close();
  const w = document.createElement('div');
  w.className = 'modal-wrap del-modal ho-modal';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="hoT"><div class="modal-body">
    <h2 id="hoT">Continue on phone</h2>
    <p>Scan with your phone’s camera to open ${esc(title)} there, signed in as you.</p>
    <div class="ho-qr" aria-live="polite"><div class="ho-skel"></div></div>
    <p class="ho-url"></p>
    <p class="ho-meta"></p></div>
    <div class="modal-foot"><button type="button" class="btn" data-x>Done</button></div></div>`;
  let timer = 0, gen = 0, exp = 0;
  const qr = w.querySelector('.ho-qr'), urlEl = w.querySelector('.ho-url'), meta = w.querySelector('.ho-meta');
  const close = () => { clearInterval(timer); w.remove(); removeEventListener('keydown', onKey, true); if (open?.w === w) open = null; };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const left = () => {
    const s = Math.round((exp - Date.now()) / 1000);
    return s <= 0 ? '' : s > 90 ? '2 min' : s > 45 ? '1 min' : `${s} s`;
  };
  const tick = () => {
    const l = left();
    if (l) { meta.querySelector('.ho-left').textContent = `Expires in ${l}`; return; }
    clearInterval(timer);
    qr.classList.add('ho-dead');
    meta.innerHTML = '<span class="ho-left">Expired</span> · <button type="button" class="ho-lnk" data-new>New code</button>';
  };
  async function make() {
    const my = ++gen;
    clearInterval(timer);
    qr.classList.remove('ho-dead');
    qr.innerHTML = '<div class="ho-skel"></div>'; urlEl.textContent = ''; meta.textContent = '';
    let j;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(id)}/handoff`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
    } catch (e) {
      if (my !== gen || !w.isConnected) return;
      qr.innerHTML = `<p class="ho-err">${esc(e.message === 'Failed to fetch' ? 'Can’t reach Premake. Check your connection.' : e.message)}</p>`;
      meta.innerHTML = '<button type="button" class="ho-lnk" data-new>Try again</button>';
      return;
    }
    if (my !== gen || !w.isConnected) return;
    exp = Date.now() + (j.ttl_s || 120) * 1000;
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'QR code that opens this design on your phone');
    try { const Q = await loadQr(); if (my !== gen) return; Q.draw(cv.getContext('2d'), Q.encode(j.url), 6); qr.replaceChildren(cv); }
    catch { qr.innerHTML = '<p class="ho-err">The QR code didn’t load. Open the link below on your phone instead.</p>'; }
    urlEl.textContent = j.url.replace(/^https?:\/\//, '');
    urlEl.title = j.url;
    meta.innerHTML = '<span class="ho-left"></span> · <button type="button" class="ho-lnk" data-new>New code</button>';
    tick(); timer = setInterval(tick, 1000);
  }
  w.addEventListener('click', e => {
    if (e.target === w || e.target.closest('[data-x]')) close();
    else if (e.target.closest('[data-new]')) make();
  });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(w);
  w.querySelector('[data-x]').focus();
  open = { w, close };
  make();
}
