// photocard: the design agent's photo request ("photo": true in questions.json, server/agentbrain.js). A card under its
// reply with three ways to send one photo: this computer's camera (a live preview, take, retake, send), your phone (a QR
// code for a 10-minute link straight to this computer, server/photosnap.js; the photo lands while the card waits), or a
// file. The photo goes to the agent as the next message, like an attached image ("Here's the photo.").
// askcard.js renders it (photoCardHtml / photoDoneHtml); app.js calls setProject() so uploads know the design.
import { processImage, upload } from './attach.js';
import { loadQr } from './handoff.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SENT = 'Here’s the photo.';
const SKIP = 'Skipped the photo: carry on with your best guess and say what you assumed.';
const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent) && !('ontouchend' in document);
const narrow = () => matchMedia('(max-width: 640px)').matches;
let projectId = () => null;
let wired = false, open = null;

export function setProject(fn) { projectId = fn; }

const camSvg = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 6.5h3l1.5-2h5l1.5 2h3v9H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="10.8" r="2.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const phoneSvg = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="5.5" y="2.5" width="9" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 15h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const fileSvg = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m4 14 4-4 3 3 2-2 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/** The live card for photo question q (the last message, nothing running). */
export function photoCardHtml(q) {
  ensureWired();
  const btns = narrow()
    ? `<button type="button" class="pc-btn" data-pc-take>${camSvg}<span>Take photo</span></button>
       <button type="button" class="pc-btn" data-pc-file>${fileSvg}<span>Choose photo</span></button>`
    : `<button type="button" class="pc-btn" data-pc-cam>${camSvg}<span>Use ${isMac() ? 'this Mac’s' : 'this computer’s'} camera</span></button>
       <button type="button" class="pc-btn" data-pc-phone>${phoneSvg}<span>Use your phone</span></button>
       <button type="button" class="pc-btn" data-pc-file>${fileSvg}<span>Choose a file</span></button>`;
  return `<div class="ab-card pc-card" data-pc role="group" aria-label="Photo request from the designer">
    <p class="ab-qt">${esc(q.question)}</p>
    <div class="pc-btns">${btns}</div>
    <p class="pc-err" hidden></p>
    <div class="ab-foot"><button type="button" class="ab-skip" data-pc-skip>Skip</button></div></div>`;
}

/** An answered photo request: the question and whether a photo went. */
export function photoDoneHtml(q, reply) {
  const sent = reply?.role === 'user' && (reply.attachments?.length || String(reply.text || '').startsWith(SENT));
  return `<div class="ab-card ab-done pc-card" role="group" aria-label="Photo request, answered"><p class="ab-qt">${esc(q.question)}</p>
    <p class="pc-done">${sent ? 'Photo sent' : 'Skipped'}</p></div>`;
}

function sendPhotos(files) {
  close();
  dispatchEvent(new CustomEvent('formery:send', { detail: { text: SENT, attachments: files } }));
}
function showErr(msg) {
  const el = document.querySelector('[data-pc] .pc-err');
  if (el) { el.textContent = msg; el.hidden = !msg; }
}
async function uploadFile(file) {
  const pid = projectId();
  if (!pid) throw new Error('Open your design first.');
  const blob = await processImage(file);
  const r = await upload(pid, blob);
  return { id: r.id, url: r.url };
}
function pickFile(capture) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  if (capture) inp.capture = 'environment';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    showErr('');
    try { sendPhotos([await uploadFile(f)]); } catch (e) { showErr(e.message); }
  };
  inp.click();
}

// ---------------------------------------------------------------- pop-ups
function modal(title, body, foot) {
  close();
  const w = document.createElement('div');
  w.className = 'modal-wrap del-modal ho-modal pc-modal';
  w.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pcT"><div class="modal-body"><h2 id="pcT">${esc(title)}</h2>${body}</div>
    <div class="modal-foot">${foot}</div></div>`;
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-pc-x]')) close(); });
  document.body.appendChild(w);
  open = { w, cleanup: [() => removeEventListener('keydown', onKey, true)] };
  return w;
}
function close() {
  if (!open) return;
  for (const f of open.cleanup) { try { f(); } catch {} }
  open.w.remove(); open = null;
}

/** This computer's camera: live preview, Take photo -> still, Retake / Send photo. */
async function camera() {
  const w = modal('Take a photo', `<div class="pc-cam"><video playsinline muted autoplay></video><canvas hidden></canvas><p class="pc-note">Starting the camera…</p></div>`,
    `<button type="button" class="btn" data-pc-x>Cancel</button><button type="button" class="btn" data-pc-retake hidden>Retake</button>
     <button type="button" class="btn primary" data-pc-shot disabled>Take photo</button><button type="button" class="btn primary" data-pc-use hidden>Send photo</button>`);
  const me = open, video = w.querySelector('video'), cv = w.querySelector('canvas'), note = w.querySelector('.pc-note');
  const $ = s => w.querySelector(s);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    note.textContent = e?.name === 'NotAllowedError' ? 'The camera is blocked for this page. Allow it in the browser’s address bar, or use your phone instead.' : 'No camera found. Use your phone or choose a file instead.';
    return;
  }
  if (open !== me) { stream.getTracks().forEach(t => t.stop()); return; }
  me.cleanup.push(() => stream.getTracks().forEach(t => t.stop()));
  video.srcObject = stream; note.hidden = true; $('[data-pc-shot]').disabled = false;
  const still = on => { video.hidden = on; cv.hidden = !on; $('[data-pc-shot]').hidden = on; $('[data-pc-use]').hidden = !on; $('[data-pc-retake]').hidden = !on; };
  $('[data-pc-shot]').onclick = () => {
    cv.width = video.videoWidth; cv.height = video.videoHeight;
    cv.getContext('2d').drawImage(video, 0, 0);
    still(true);
  };
  $('[data-pc-retake]').onclick = () => still(false);
  $('[data-pc-use]').onclick = async () => {
    const b = $('[data-pc-use]'); b.disabled = true; b.textContent = 'Sending…';
    try {
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
      sendPhotos([await uploadFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }))]);
    } catch (e) { b.disabled = false; b.textContent = 'Send photo'; note.hidden = false; note.textContent = e.message; }
  };
}

/** Your phone: a QR code for this design's photo link; waits for the photo, then sends it. */
async function phone() {
  const w = modal('Use your phone', `<p>Scan with your phone’s camera, then take the photo there. It comes straight back here.</p>
    <div class="ho-qr" aria-live="polite"><div class="ho-skel"></div></div><p class="ho-url"></p><p class="ho-meta pc-wait"></p>`,
    `<button type="button" class="btn" data-pc-x>Cancel</button>`);
  const me = open, qr = w.querySelector('.ho-qr'), urlEl = w.querySelector('.ho-url'), meta = w.querySelector('.pc-wait');
  const pid = projectId();
  let j;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(pid)}/snap`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  } catch (e) {
    if (open !== me) return;
    qr.innerHTML = `<p class="ho-err">${esc(e.message === 'Failed to fetch' ? 'Can’t reach Premake. Check your connection.' : e.message)}</p>`;
    return;
  }
  if (open !== me) return;
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'QR code that opens the camera page on your phone');
  try { const Q = await loadQr(); Q.draw(cv.getContext('2d'), Q.encode(j.url), 6); qr.replaceChildren(cv); }
  catch { qr.innerHTML = '<p class="ho-err">The QR code didn’t load. Open the link below on your phone instead.</p>'; }
  urlEl.textContent = j.url.replace(/^https?:\/\//, '');
  meta.textContent = 'Waiting for your photo…';
  const end = Date.now() + (j.ttl_s || 600) * 1000;
  const timer = setInterval(async () => {
    if (open !== me) return clearInterval(timer);
    if (Date.now() > end) { clearInterval(timer); qr.classList.add('ho-dead'); meta.textContent = 'This code expired. Cancel and try again.'; return; }
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(pid)}/snap/${encodeURIComponent(j.token)}`, { cache: 'no-store', credentials: 'same-origin' });
      const s = await r.json().catch(() => ({}));
      if (r.ok && s.files?.length && open === me) { clearInterval(timer); sendPhotos(s.files); }
    } catch {}
  }, 2000);
  me.cleanup.push(() => clearInterval(timer));
}

function ensureWired() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('click', e => {
    const card = e.target.closest('[data-pc]');
    if (!card) return;
    if (e.target.closest('[data-pc-cam]')) { e.preventDefault(); camera(); }
    else if (e.target.closest('[data-pc-phone]')) { e.preventDefault(); phone(); }
    else if (e.target.closest('[data-pc-file]')) { e.preventDefault(); pickFile(false); }
    else if (e.target.closest('[data-pc-take]')) { e.preventDefault(); pickFile(true); }
    else if (e.target.closest('[data-pc-skip]')) { e.preventDefault(); dispatchEvent(new CustomEvent('formery:send', { detail: { text: SKIP } })); }
  });
}
